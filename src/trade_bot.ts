import * as fs from 'fs';
import * as path from 'path';
import { fetchIntradayData } from './backtest/dataFetcher.js';
import { fileURLToPath } from 'url';
import type { ApiClient } from './api.js';
import { executeTrade } from './tools/executeTrade.js';
import { getPortfolio } from './tools/getPortfolio.js';

// --- CONFIG ---
const STATE_FILE = path.resolve('bot_state.json');
const VOLATILE_TICKERS = [
    "NVDA", "AMZN", "INTC", "ADT", "SNAP", "STLA", "ONDS", "MARA", "IREN", "BMNR",
    "SOFI", "KVUE", "TSLA", "PLTR", "STKL", "MSTR", "GOOGL", "AAL", "F", "HOOD",
    "AMD", "MSFT", "NU", "PFE", "ACHR", "AAPL", "SMCI", "WULF", "HIMS", "NFLX",
    "APLD", "CPNG", "BAC", "CFLT", "CLSK", "RIG", "SMX", "QBTS", "T", "OWL",
    "MU", "RGTI", "CRWV", "VZ", "PYPL", "BSX", "NOW", "NXE", "PATH", "RBLX",
    "GOOG", "WBD", "JOBY", "CIEN", "AVGO", "LUMN", "IONQ", "SMR", "SOUN", "RIVN"
];
const MAX_POS_PCT = 0.24; // Updated from 0.25 to 0.24 for safety
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
        try {
            const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
            if (state.date === today) return state;
        } catch { /* fall through */ }
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

export async function runTradeBot(api: ApiClient): Promise<string> {
    const output: string[] = [];
    const log = (msg: string) => {
        output.push(msg);
        console.error(`[TRADE BOT] ${msg}`);
    };

    log('--- 🤖 "70% WIN RATE" WIN BOT ---');
    const state = loadState();
    log(`Date: ${state.date}`);
    log(`Executed Trades Today: ${state.executed_trades}`);
    log('Strategy: 1R Stop -> 50% Scale-Out @ 1R -> Move to BE');
    log('------------------------------------');

    // 1. Fetch LIVE portfolio from HTMW
    let cashAvailable = 100000;
    const heldSymbols = new Set<string>();
    let portfolioPositions: any[] = [];

    try {
        const portfolio = await getPortfolio(api);
        let cash = 100000;
        let bp = 100000;

        if (portfolio.cashBalance) {
            cash = typeof portfolio.cashBalance === 'number'
                ? portfolio.cashBalance
                : parseFloat(String(portfolio.cashBalance).replace(/[,$]/g, ''));
        }
        if (portfolio.buyingPower) {
            bp = typeof portfolio.buyingPower === 'number'
                ? portfolio.buyingPower
                : parseFloat(String(portfolio.buyingPower).replace(/[,$]/g, ''));
        }
        cashAvailable = Math.min(cash, bp);

        if (portfolio.positions && Array.isArray(portfolio.positions)) {
            portfolioPositions = portfolio.positions;
            portfolioPositions.forEach((pos: any) => {
                if (pos.symbol) heldSymbols.add(pos.symbol.toUpperCase());
            });
        }
        log(`💰 Cash Available: $${cashAvailable.toFixed(2)}`);
    } catch (e) {
        log(`⚠️ Could not fetch portfolio, using defaults.`);
    }

    const signals: Signal[] = [];

    for (const sym of VOLATILE_TICKERS) {
        const existing = state.positions.find(p => p.symbol === sym && p.status === 'OPEN');
        if (existing) {
            // Check if we actually hold it in HTMW
            if (heldSymbols.has(sym.toUpperCase())) {
                await checkPosition(api, sym, existing, log);
            } else {
                log(`⚠️ ${sym} is in state as OPEN but not found in portfolio. Marking CLOSED.`);
                existing.status = 'CLOSED';
            }
            continue;
        }

        // Avoid re-trading closed symbols
        if (state.positions.find(p => p.symbol === sym && p.status === 'CLOSED')) continue;
        
        // Skip if already held manual or otherwise
        if (heldSymbols.has(sym.toUpperCase())) continue;

        const signal = await checkSetup(sym, state, log);
        if (signal) {
            signals.push(signal);
        }
    }

    // Rank Signals by Conviction (Relative Volume)
    signals.sort((a, b) => b.conviction - a.conviction);

    // Limit signals to available cash
    const topSignals = signals.slice(0, 10);

    if (topSignals.length > 0) {
        log(`\n🚀 [TOP ${topSignals.length} SIGNALS] (Ranked by vol)`);
        for (const sig of topSignals) {
            if (cashAvailable < 1000) {
                log(`   Budget exhausted. Skipping ${sig.symbol}`);
                continue;
            }
            const amountPerTrade = Math.min(cashAvailable * MAX_POS_PCT, cashAvailable);
            const success = await triggerTrade(api, sig, amountPerTrade, state, log);
            if (success) {
                cashAvailable -= amountPerTrade;
            }
        }
    }

    saveState(state);

    log('\n--- 📋 SUMMARY ---');
    const open = state.positions.filter(p => p.status === 'OPEN');
    if (open.length === 0) {
        log('No active positions or pending signals.');
    } else {
        open.forEach(p => {
            log(`[OPEN] ${p.symbol} (${p.side}) - ${p.quantity} SHARES`);
            if (p.scaledOut) {
                log(`   - STATUS: !! SCALED OUT (50% Profit Taken) !!`);
            } else {
                log(`   - ENTRY: $${p.entryPrice.toFixed(2)} | STOP: $${p.stopLoss.toFixed(2)} | TARGET: $${p.target1.toFixed(2)}`);
            }
        });
    }
    log('--------------------------');

    return output.join('\n');
}

async function checkPosition(api: ApiClient, symbol: string, pos: Position, log: (msg: string) => void) {
    const data = await fetchIntradayData(symbol, '1d');
    if (!data || data.data.length === 0) return;
    const currentPrice = data.data[data.data.length - 1].close;

    if (pos.side === 'LONG') {
        // 1. Check for Scale Out
        if (!pos.scaledOut && currentPrice >= pos.target1) {
            log(`🎯 [SCALE OUT] ${symbol} hit Target 1 $${pos.target1}. Selling 50%.`);
            const sellQty = Math.floor(pos.quantity * 0.5);
            try {
                const result = await executeTrade(api, {
                    symbol,
                    action: 'sell',
                    quantity: sellQty,
                    orderType: 'market',
                    duration: 'day'
                });
                if (result.success) {
                    pos.quantity -= sellQty;
                    pos.stopLoss = pos.entryPrice; // Move to Break-Even
                    pos.scaledOut = true;
                    log(`   ✅ Scale out executed.`);
                }
            } catch (e) {
                log(`   ❌ Scale out failed: ${e}`);
            }
        }

        // 2. Finally Check for Stop
        if (currentPrice <= pos.stopLoss) {
            log(`${pos.scaledOut ? '🛡️' : '❌'} [EXIT] ${symbol} hit Stop $${pos.stopLoss}`);
            try {
                const result = await executeTrade(api, {
                    symbol,
                    action: 'sell',
                    quantity: pos.quantity,
                    orderType: 'market',
                    duration: 'day'
                });
                if (result.success) {
                    pos.status = 'CLOSED';
                    pos.pnl = (pos.stopLoss - pos.entryPrice);
                }
            } catch (e) {
                log(`   ❌ Exit failed: ${e}`);
            }
        }
    } else {
        // Short Scale Out
        if (!pos.scaledOut && currentPrice <= pos.target1) {
            log(`🎯 [SCALE OUT] ${symbol} hit Target 1 $${pos.target1}. Buying 50% back.`);
            const coverQty = Math.floor(pos.quantity * 0.5);
            try {
                const result = await executeTrade(api, {
                    symbol,
                    action: 'cover',
                    quantity: coverQty,
                    orderType: 'market',
                    duration: 'day'
                });
                if (result.success) {
                    pos.quantity -= coverQty;
                    pos.stopLoss = pos.entryPrice;
                    pos.scaledOut = true;
                    log(`   ✅ Scale out executed.`);
                }
            } catch (e) {
                log(`   ❌ Scale out failed: ${e}`);
            }
        }

        if (currentPrice >= pos.stopLoss) {
            log(`${pos.scaledOut ? '🛡️' : '❌'} [EXIT] ${symbol} hit Stop $${pos.stopLoss}`);
            try {
                const result = await executeTrade(api, {
                    symbol,
                    action: 'cover',
                    quantity: pos.quantity,
                    orderType: 'market',
                    duration: 'day'
                });
                if (result.success) {
                    pos.status = 'CLOSED';
                    pos.pnl = (pos.entryPrice - pos.stopLoss);
                }
            } catch (e) {
                log(`   ❌ Exit failed: ${e}`);
            }
        }
    }
}

interface Signal {
    symbol: string;
    side: 'LONG' | 'SHORT';
    entryPrice: number;
    stopLoss: number;
    target1: number;
    rangeHeight: number;
    conviction: number; // Relative Volume
}

async function checkSetup(symbol: string, state: BotState, log: (msg: string) => void): Promise<Signal | null> {
    const data = await fetchIntradayData(symbol, '5d', '5m');
    if (!data || data.data.length < 10) return null;

    const candles = data.data;
    const days: any[][] = [];
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
        return null;
    }

    const prevDay = days.length > 1 ? days[days.length - 2] : null;
    const prevClose = prevDay ? prevDay[prevDay.length - 1].close : 0;

    const openingRange = today.slice(0, 6);
    const rangeHigh = Math.max(...openingRange.map((c: any) => c.high));
    const rangeLow = Math.min(...openingRange.map((c: any) => c.low));
    const avgVol = openingRange.reduce((sum: number, c: any) => sum + c.volume, 0) / 6;

    const currentCandle = today[today.length - 1];
    const price = currentCandle.close;

    if (price < 5) return null;

    // 1. Gap Filter
    if (prevClose > 0) {
        const gapPct = Math.abs((today[0].open - prevClose) / prevClose);
        if (gapPct < 0.002) return null;
    }

    // 2. Range Filter
    const rangeHeight = rangeHigh - rangeLow;
    const rangePct = rangeHeight / rangeLow;
    if (rangePct < 0.005 || rangePct > 0.12) return null;

    // 3. Volume Filter (Stricter based on backtesting: 1.5x Avg)
    if (currentCandle.volume > 0 && currentCandle.volume < avgVol * 1.5) {
        log(`⏳ [WAIT] ${symbol}: Volume too low (${currentCandle.volume.toLocaleString()} vs req ${(avgVol * 1.5).toLocaleString()})`);
        return null;
    }

    // 4. Trend Filter (SMA20 Alignment)
    if (today.length < 20) return null; // Need 20 candles for SMA
    const sma20 = today.slice(-20).reduce((sum, c) => sum + c.close, 0) / 20;
    const isAboveSma = price > sma20;
    const isBelowSma = price < sma20;

    const relVol = avgVol > 0 ? currentCandle.volume / avgVol : 0;
    const rangeHeightAbs = rangeHigh - rangeLow;

    // 5. Short Bias Filter (New: "Stocks that will fail")
    // If gapping down > 0.5%, prioritize shorting
    const gapPct = prevClose > 0 ? (today[0].open - prevClose) / prevClose : 0;
    const isBearishGap = gapPct < -0.005;

    if (price > rangeHigh && !isBearishGap && isAboveSma) {
        return {
            symbol, side: 'LONG', entryPrice: rangeHigh, stopLoss: rangeLow,
            target1: rangeHigh + rangeHeightAbs, rangeHeight: rangeHeightAbs, conviction: relVol
        };
    } else if (price < rangeLow && isBelowSma) {
        if (isBearishGap) log(`📉 [BEARISH BIAS] ${symbol} gapping down. Prioritizing short.`);
        return {
            symbol, side: 'SHORT', entryPrice: rangeLow, stopLoss: rangeHigh,
            target1: rangeLow - rangeHeightAbs, rangeHeight: rangeHeightAbs, conviction: relVol
        };
    }

    return null;
}

async function triggerTrade(api: ApiClient, sig: Signal, amount: number, state: BotState, log: (msg: string) => void): Promise<boolean> {
    const quantity = Math.floor(amount / sig.entryPrice);
    if (quantity === 0) return false;

    log(`>>> ACTION: ${sig.side === 'LONG' ? 'BUY' : 'SHORT'} ${quantity} SHARES of ${sig.symbol}`);
    try {
        const result = await executeTrade(api, {
            symbol: sig.symbol,
            action: sig.side === 'LONG' ? 'buy' : 'short',
            quantity: quantity,
            orderType: 'market',
            duration: 'day'
        });

        if (result.success) {
            const pos: Position = {
                symbol: sig.symbol,
                side: sig.side,
                entryPrice: sig.entryPrice,
                quantity,
                initialQty: quantity,
                stopLoss: sig.stopLoss,
                target1: sig.target1,
                timestamp: new Date().toISOString(),
                status: 'OPEN',
                scaledOut: false,
                rangeHeight: sig.rangeHeight
            };

            state.positions.push(pos);
            state.executed_trades++;
            log(`   ✅ ORDER PLACED: ${result.message}`);
            return true;
        } else {
            log(`   ❌ ORDER FAILED: ${result.message}`);
            return false;
        }
    } catch (e) {
        log(`   ❌ ERROR: ${e}`);
        return false;
    }
}
