
import * as fs from 'fs';
import * as path from 'path';
import { fetchIntradayData } from './backtest/dataFetcher.js';
import { fileURLToPath } from 'url';

// --- CONFIG ---
const STATE_FILE = path.resolve('bot_state.json');
const VOLATILE_TICKERS = [
    'NVDA', 'TSLA', 'AMD', 'META', 'AMZN', 'NFLX', 'GOOGL', 'MSFT', 'AAPL', 'AVGO',
    'SMCI', 'ARM', 'MU', 'INTC', 'QCOM', 'TXN', 'LRCX', 'AMAT', 'KLAC', 'MRVL',
    'COIN', 'MSTR', 'MARA', 'RIOT', 'CLSK', 'HUT', 'BITF', 'HOOD',
    'PLTR', 'SOUN', 'AI', 'DJT', 'GME', 'AMC', 'CVNA', 'UPST', 'BYND', 'RDDT', 'DKNG',
    'VKTX', 'LLY', 'NVO',
    'RIVN', 'LCID', 'NIO', 'XPEV',
    'FSLR', 'ENPH', 'SEDG', 'RUN',
    'SMX'
];
const PORTFOLIO_VALUE = 100000;
const MAX_POS_PCT = 0.24; // Updated from 0.25 to 0.24 for safety
const AMOUNT_PER_TRADE = PORTFOLIO_VALUE * MAX_POS_PCT;
// --------------

interface Position {
    symbol: string;
    side: 'LONG' | 'SHORT';
    entryPrice: number;
    quantity: number;
    initialQty: number; // For scaling out
    stopLoss: number;
    target1: number; // Scale out level
    timestamp: string;
    status: 'OPEN' | 'CLOSED';
    scaledOut: boolean;
    pnl?: number;
    rangeHeight: number;
}

interface BotState {
    date: string;
    positions: Position[];
    ranges: { [symbol: string]: { high: number, low: number, avgVol: number, prevClose: number } };
    executed_trades: number;
}

function loadState(): BotState {
    const today = new Date().toISOString().split('T')[0];
    if (fs.existsSync(STATE_FILE)) {
        const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
        if (state.date === today) return state;
    }
    return {
        date: today,
        positions: [],
        ranges: {},
        executed_trades: 0
    };
}

function saveState(state: BotState) {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

export async function runTradeBot(): Promise<string> {
    const output: string[] = [];
    const log = (msg: string) => output.push(msg);

    log('--- 🤖 "70% WIN RATE" HYBRID TRADE BOT ---');
    const state = loadState();
    log(`Date: ${state.date}`);
    log(`Executed Trades Today: ${state.executed_trades}`);
    log('Strategy: 1R Stop -> 50% Scale-Out @ 1R -> Move to BE');
    log('------------------------------------');

    for (const sym of VOLATILE_TICKERS) {
        const existing = state.positions.find(p => p.symbol === sym && p.status === 'OPEN');
        if (existing) {
            await checkPosition(sym, existing, log);
            continue;
        }

        // Avoid re-trading closed symbols
        if (state.positions.find(p => p.symbol === sym && p.status === 'CLOSED')) continue;

        await checkSetup(sym, state, log);
    }

    saveState(state);

    log('\n--- 📋 RECOMMENDATIONS ---');
    const open = state.positions.filter(p => p.status === 'OPEN');
    if (open.length === 0) {
        log('No active positions or pending signals.');
    } else {
        open.forEach(p => {
            log(`[OPEN] ${p.symbol} (${p.side}) - ${p.quantity} SHARES`);
            if (p.scaledOut) {
                log(`   - STATUS: !! SCALED OUT (50% Profit Taken) !!`);
                log(`   - CURRENT STOP: $${p.stopLoss.toFixed(2)} (Break-Even)`);
                log(`   - FINAL EXIT: Close at 4:00 PM ET (EOD)`);
            } else {
                log(`   - ENTRY: $${p.entryPrice.toFixed(2)}`);
                log(`   - STOP LOSS: $${p.stopLoss.toFixed(2)} (Initial 1R)`);
                log(`   - TARGET 1: $${p.target1.toFixed(2)} (Scale Out at 1:1)`);
            }
        });
    }
    log('--------------------------');

    return output.join('\n');
}

async function checkPosition(symbol: string, pos: Position, log: (msg: string) => void) {
    const data = await fetchIntradayData(symbol, '1d');
    if (!data || data.data.length === 0) return;
    const currentPrice = data.data[data.data.length - 1].close;

    if (pos.side === 'LONG') {
        // 1. Check for Scale Out
        if (!pos.scaledOut && currentPrice >= pos.target1) {
            log(`🎯 [SCALE OUT] ${symbol} hit Target 1 $${pos.target1}. Selling 50%.`);
            pos.quantity = Math.floor(pos.quantity * 0.5);
            pos.stopLoss = pos.entryPrice; // Move to Break-Even
            pos.scaledOut = true;
        }

        // 2. Finally Check for Stop
        if (currentPrice <= pos.stopLoss) {
            log(`${pos.scaledOut ? '🛡️' : '❌'} [EXIT] ${symbol} hit Stop $${pos.stopLoss}`);
            pos.status = 'CLOSED';
            pos.pnl = (pos.stopLoss - pos.entryPrice);
        }
    } else {
        // Short Scale Out
        if (!pos.scaledOut && currentPrice <= pos.target1) {
            log(`🎯 [SCALE OUT] ${symbol} hit Target 1 $${pos.target1}. Buying 50% back.`);
            pos.quantity = Math.floor(pos.quantity * 0.5);
            pos.stopLoss = pos.entryPrice;
            pos.scaledOut = true;
        }

        if (currentPrice >= pos.stopLoss) {
            log(`${pos.scaledOut ? '🛡️' : '❌'} [EXIT] ${symbol} hit Stop $${pos.stopLoss}`);
            pos.status = 'CLOSED';
            pos.pnl = (pos.entryPrice - pos.stopLoss);
        }
    }
}

async function checkSetup(symbol: string, state: BotState, log: (msg: string) => void) {
    const data = await fetchIntradayData(symbol, '5d', '5m');
    if (!data || data.data.length < 10) return;

    const candles = data.data;
    const days: any[] = [];
    let currentDayCandles: any[] = [];
    let currentDayStr = '';

    candles.forEach(c => {
        const d = c.date.split('T')[0];
        if (d !== currentDayStr) {
            if (currentDayCandles.length > 0) days.push(currentDayCandles);
            currentDayStr = d;
            currentDayCandles = [];
        }
        currentDayCandles.push(c);
    });
    days.push(currentDayCandles);

    const today = days[days.length - 1];
    if (today.length < 7) {
        log(`⏳ [WAIT] ${symbol}: Market Open + 30m required. Range forming...`);
        return;
    }

    const prevDay = days.length > 1 ? days[days.length - 2] : null;
    const prevClose = prevDay ? prevDay[prevDay.length - 1].close : 0;

    const openingRange = today.slice(0, 6);
    const rangeHigh = Math.max(...openingRange.map((c: any) => c.high));
    const rangeLow = Math.min(...openingRange.map((c: any) => c.low));
    const avgVol = openingRange.reduce((sum: number, c: any) => sum + c.volume, 0) / 6;

    const currentCandle = today[today.length - 1];
    const price = currentCandle.close;

    if (price < 5) return;

    // 1. Gap Filter
    if (prevClose > 0) {
        const gapPct = Math.abs((today[0].open - prevClose) / prevClose);
        if (gapPct < 0.005) return;
    }

    // 2. Range Filter
    const rangeHeight = rangeHigh - rangeLow;
    const rangePct = rangeHeight / rangeLow;
    if (rangePct < 0.005 || rangePct > 0.04) return;

    // 3. Volume Filter
    if (currentCandle.volume < avgVol * 1.2) return;

    if (price > rangeHigh) {
        log(`🚀 [70% SIGNAL] ${symbol} LONG > $${rangeHigh.toFixed(2)}`);
        triggerTrade(symbol, 'LONG', rangeHigh, rangeLow, state, log);
    } else if (price < rangeLow) {
        log(`🔻 [70% SIGNAL] ${symbol} SHORT < $${rangeLow.toFixed(2)}`);
        triggerTrade(symbol, 'SHORT', rangeLow, rangeHigh, state, log);
    }
}

function triggerTrade(symbol: string, side: 'LONG' | 'SHORT', entryPrice: number, stopLoss: number, state: BotState, log: (msg: string) => void) {
    const rangeHeight = Math.abs(entryPrice - stopLoss);
    const target1 = side === 'LONG' ? entryPrice + rangeHeight : entryPrice - rangeHeight;
    const quantity = Math.floor(AMOUNT_PER_TRADE / entryPrice);

    const pos: Position = {
        symbol, side, entryPrice, quantity, initialQty: quantity, stopLoss, target1,
        timestamp: new Date().toISOString(), status: 'OPEN', scaledOut: false, rangeHeight
    };

    state.positions.push(pos);
    state.executed_trades++;

    log(`>>> ACTION: BUY ${quantity} SHARES of ${symbol} (${side})`);
    log(`    ENTRY: $${entryPrice.toFixed(2)}`);
    log(`    STOP:  $${stopLoss.toFixed(2)} (Initial 1R)`);
    log(`    TARGET 1: $${target1.toFixed(2)} (Scaling 50%)`);
}

const __filename = fileURLToPath(import.meta.url);
const isMainModule = process.argv[1] === __filename;

if (isMainModule) {
    runTradeBot().then(output => console.log(output));
}
