/**
 * 💀 INVERSE LOSS BOT — "lose()" MCP Tool
 * 
 * Purpose: Auto-execute trades designed to LOSE money on HTMW paper trading.
 * Strategy: BUY-ONLY. Buy at the worst possible times:
 *   1. Buy into BREAKDOWNS (catching falling knives)
 *   2. Buy at BREAKOUT peaks (buying the top right before reversal)
 * No shorting — HTMW doesn't support it.
 * 
 * State: Persists all executed trades to lose_state.json.
 *        Checks portfolio to skip tickers already held.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fetchIntradayData } from './backtest/dataFetcher.js';
import { executeTrade } from './tools/executeTrade.js';
import { getPortfolio } from './tools/getPortfolio.js';
import type { ApiClient } from './api.js';

// --- CONFIG ---
const STATE_FILE = path.resolve('lose_state.json');
const MAX_ALLOC_PCT = 0.25; // Max 25% of cash per trade
const VOLATILE_TICKERS = [
    'NVDA', 'TSLA', 'AMD', 'META', 'AMZN', 'NFLX', 'GOOGL', 'MSFT', 'AAPL', 'AVGO',
    'SMCI', 'ARM', 'MU', 'INTC', 'QCOM', 'TXN', 'LRCX', 'AMAT', 'KLAC', 'MRVL',
    'COIN', 'MSTR', 'MARA', 'RIOT', 'CLSK', 'HUT', 'BITF', 'HOOD',
    'WULF', 'IREN', 'CORZ', 'CIFR',
    'MRNA', 'BNTX', 'CRSP',
    'PLTR', 'SOUN', 'AI', 'DJT', 'GME', 'AMC', 'CVNA', 'UPST', 'BYND', 'RDDT', 'DKNG',
    'VKTX', 'LLY', 'NVO',
    'VRT', 'ANET', 'DELL',
    'PDD', 'BABA', 'JD', 'BIDU',
    'RIVN', 'LCID', 'NIO', 'XPEV',
    'FSLR', 'ENPH', 'SEDG', 'RUN',
    'SMX',
    'APP', 'ASTS', 'LUNR', 'SHOP', 'CRWD', 'PANW', 'SNOW', 'U', 'RBLX',
    'AFRM', 'IONQ', 'RGTI', 'MDB', 'NET', 'BILL', 'TWLO', 'OKTA',
    'SOFI', 'OPEN', 'SPCE', 'ACHR', 'JOBY', 'Z',
    'TTD', 'DDOG', 'ZS', 'TEAM', 'WDAY', 'NOW'
];

// --- STATE ---
interface ExecutedTrade {
    symbol: string;
    quantity: number;
    price: number;
    reason: string;
    timestamp: string;
}

interface LoseState {
    date: string;              // Resets daily
    executedTrades: ExecutedTrade[];
    heldSymbols: string[];     // Symbols we currently hold
    totalSpent: number;
}

function loadState(): LoseState {
    const today = new Date().toISOString().split('T')[0];
    if (fs.existsSync(STATE_FILE)) {
        try {
            const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
            // Reset if it's a new day
            if (raw.date === today) return raw;
        } catch { /* fall through */ }
    }
    return { date: today, executedTrades: [], heldSymbols: [], totalSpent: 0 };
}

function saveState(state: LoseState) {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// --- SIGNAL DETECTION ---
interface LoseSignal {
    symbol: string;
    reason: string;
    price: number;
    conviction: number;
}

async function detectInvertedSignal(symbol: string): Promise<LoseSignal | null> {
    try {
        const data = await fetchIntradayData(symbol, '5d', '5m');
        if (!data || data.data.length < 10) return null;

        const candles = data.data;
        const days: any[][] = [];
        let currentDayCandles: any[] = [];
        let currentDayStr = '';

        candles.forEach((c: any) => {
            const d = c.date.split('T')[0];
            if (d !== currentDayStr) {
                if (currentDayCandles.length > 0) days.push(currentDayCandles);
                currentDayStr = d;
                currentDayCandles = [];
            }
            currentDayCandles.push(c);
        });
        if (currentDayCandles.length > 0) days.push(currentDayCandles);

        const today = days[days.length - 1];
        if (!today || today.length < 7) return null;

        const prevDay = days.length > 1 ? days[days.length - 2] : null;
        const prevClose = prevDay ? prevDay[prevDay.length - 1].close : 0;

        const openingRange = today.slice(0, 6);
        const rangeHigh = Math.max(...openingRange.map((c: any) => c.high));
        const rangeLow = Math.min(...openingRange.map((c: any) => c.low));
        const avgVol = openingRange.reduce((sum: number, c: any) => sum + c.volume, 0) / 6;

        const currentCandle = today[today.length - 1];
        const price = currentCandle.close;

        if (price < 5) return null;

        if (prevClose > 0) {
            const gapPct = Math.abs((today[0].open - prevClose) / prevClose);
            if (gapPct < 0.002) return null;
        }

        const rangeHeight = rangeHigh - rangeLow;
        const rangePct = rangeHeight / rangeLow;
        if (rangePct < 0.005 || rangePct > 0.12) return null;

        const relVol = avgVol > 0 ? currentCandle.volume / avgVol : 0;

        if (price < rangeLow) {
            return { symbol, reason: '🔪 Falling Knife', price, conviction: relVol };
        } else if (price > rangeHigh) {
            return { symbol, reason: '📈💀 Buying the Top', price, conviction: relVol };
        }

        return null;
    } catch (e) {
        return null;
    }
}

// --- MAIN ---
export async function runLoseBot(api: ApiClient): Promise<string> {
    const output: string[] = [];
    const log = (msg: string) => output.push(msg);
    const state = loadState();

    log('--- 💀 INVERSE LOSS BOT (BUY-ONLY) ---');
    log('Strategy: Buy falling knives + buy the top. No stops. Max 25% alloc.');
    log('---------------------------------------');

    // 1. Fetch LIVE portfolio from HTMW
    let cashAvailable = 100000;
    const heldSymbols = new Set<string>();

    try {
        const portfolio = await getPortfolio(api);

        // Extract cash
        if (portfolio.cashBalance) {
            cashAvailable = typeof portfolio.cashBalance === 'number'
                ? portfolio.cashBalance
                : parseFloat(String(portfolio.cashBalance).replace(/[,$]/g, ''));
        } else if (portfolio.buyingPower) {
            cashAvailable = typeof portfolio.buyingPower === 'number'
                ? portfolio.buyingPower
                : parseFloat(String(portfolio.buyingPower).replace(/[,$]/g, ''));
        }

        // Extract held symbols from portfolio positions
        if (portfolio.positions && Array.isArray(portfolio.positions)) {
            portfolio.positions.forEach((pos: any) => {
                if (pos.symbol) heldSymbols.add(pos.symbol.toUpperCase());
            });
        }

        log(`💰 Cash Available: $${cashAvailable.toFixed(2)}`);
        log(`📦 Positions Held: ${heldSymbols.size} (${[...heldSymbols].join(', ') || 'none'})`);
    } catch (e) {
        log(`⚠️ Could not fetch portfolio, using defaults.`);
    }

    // Also add symbols from today's state (in case portfolio hasn't updated yet)
    state.heldSymbols.forEach(s => heldSymbols.add(s));
    // Also add symbols from today's executed trades
    state.executedTrades.forEach(t => heldSymbols.add(t.symbol));

    log(`🚫 Skip List (already held/traded today): ${heldSymbols.size} symbols`);

    // 2. Scan universe, skipping held symbols
    log('\n🔍 Scanning universe for signals...');
    const signals: LoseSignal[] = [];

    for (let i = 0; i < VOLATILE_TICKERS.length; i += 10) {
        const batch = VOLATILE_TICKERS.slice(i, i + 10);
        const filtered = batch.filter(sym => !heldSymbols.has(sym));

        if (filtered.length > 0) {
            const results = await Promise.all(filtered.map(sym => detectInvertedSignal(sym)));
            results.forEach(sig => { if (sig) signals.push(sig); });
        }
        log(`   Scanned ${Math.min(i + 10, VOLATILE_TICKERS.length)}/${VOLATILE_TICKERS.length}...`);
    }

    log(`\n📊 Found ${signals.length} new signals (after dedup).`);

    if (signals.length === 0) {
        log('❌ No new signals. Market closed, range forming, or all tickers already held.');
        saveState(state);
        return output.join('\n');
    }

    // 3. Sort worst conviction first
    signals.sort((a, b) => a.conviction - b.conviction);

    // 4. Execute trades — 25% of remaining cash, rounded down to whole shares, min 1
    log(`\n🔥 Auto-executing ${signals.length} trades (up to 25% of cash each)...`);
    let tradesPlaced = 0;
    let tradesFailed = 0;

    for (const sig of signals) {
        const allocation = cashAvailable * MAX_ALLOC_PCT;
        const quantity = Math.max(1, Math.floor(allocation / sig.price));

        try {
            log(`\n   💀 BUY ${quantity} x ${sig.symbol} @ ~$${sig.price.toFixed(2)} [${sig.reason}]`);

            const result = await executeTrade(api, {
                symbol: sig.symbol,
                action: 'buy',
                quantity: quantity,
                orderType: 'market',
                duration: 'day'
            });

            if (result.success) {
                log(`   ✅ ORDER PLACED: ${result.message}`);
                tradesPlaced++;

                // Update state
                const cost = quantity * sig.price;
                cashAvailable -= cost;
                state.totalSpent += cost;
                state.executedTrades.push({
                    symbol: sig.symbol,
                    quantity,
                    price: sig.price,
                    reason: sig.reason,
                    timestamp: new Date().toISOString()
                });
                state.heldSymbols.push(sig.symbol);
                heldSymbols.add(sig.symbol);

                if (cashAvailable < 500) {
                    log('   ⚠️ Cash depleted. Stopping.');
                    break;
                }
            } else {
                log(`   ❌ ORDER FAILED: ${result.message}`);
                tradesFailed++;
            }
        } catch (e) {
            log(`   ❌ ERROR: ${e instanceof Error ? e.message : String(e)}`);
            tradesFailed++;
        }
    }

    // Save state
    saveState(state);

    log('\n--- 📋 EXECUTION SUMMARY ---');
    log(`New Trades Placed: ${tradesPlaced}`);
    log(`Failed: ${tradesFailed}`);
    log(`Total Trades Today: ${state.executedTrades.length}`);
    log(`Total Spent Today: $${state.totalSpent.toFixed(2)}`);
    log(`Remaining Cash (Est): $${Math.max(0, cashAvailable).toFixed(2)}`);
    log(`Held Symbols: ${[...heldSymbols].join(', ')}`);
    log('----------------------------');

    return output.join('\n');
}
