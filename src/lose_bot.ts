/**
 * 💀 INVERSE LOSS BOT — "lose()" MCP Tool
 * 
 * Purpose: Auto-execute trades designed to LOSE money on HTMW paper trading.
 * Strategy: Invert every winning ORB signal, max sizing, no stops.
 * 
 * When the winning bot says BUY → we SHORT.
 * When the winning bot says SELL → we BUY.
 */

import { fetchIntradayData } from './backtest/dataFetcher.js';
import { executeTrade } from './tools/executeTrade.js';
import { getPortfolio } from './tools/getPortfolio.js';
import type { ApiClient } from './api.js';

// Same universe as the winning bot
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

interface LoseSignal {
    symbol: string;
    invertedSide: 'buy' | 'short';  // HTMW action (inverted from winning signal)
    price: number;
    conviction: number; // Lower conviction = worse trade = better for losing
}

/**
 * Detect an ORB signal and INVERT it.
 * If the winning bot would go LONG → we SHORT (or buy into a breakdown).
 * If the winning bot would go SHORT → we BUY (into a breakdown reversal).
 */
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

        // Gap filter (same as winning bot — we need valid setups to invert)
        if (prevClose > 0) {
            const gapPct = Math.abs((today[0].open - prevClose) / prevClose);
            if (gapPct < 0.002) return null;
        }

        // Range filter
        const rangeHeight = rangeHigh - rangeLow;
        const rangePct = rangeHeight / rangeLow;
        if (rangePct < 0.005 || rangePct > 0.12) return null;

        const relVol = avgVol > 0 ? currentCandle.volume / avgVol : 0;

        // 🔄 THE INVERSION: Winning bot goes LONG on breakout → we SHORT
        //                    Winning bot goes SHORT on breakdown → we BUY
        if (price > rangeHigh) {
            // Winning bot would go LONG here → WE SHORT (fade the breakout)
            return { symbol, invertedSide: 'short', price, conviction: relVol };
        } else if (price < rangeLow) {
            // Winning bot would go SHORT here → WE BUY (catch the falling knife)
            return { symbol, invertedSide: 'buy', price, conviction: relVol };
        }

        return null;
    } catch (e) {
        return null;
    }
}

/**
 * Main entry point: Scan universe, invert signals, auto-execute trades.
 */
export async function runLoseBot(api: ApiClient): Promise<string> {
    const output: string[] = [];
    const log = (msg: string) => output.push(msg);

    log('--- 💀 INVERSE LOSS BOT ---');
    log('Strategy: Invert every winning ORB signal. Max sizing. No stops.');
    log('Goal: Lose $50k in 2 weeks.');
    log('---------------------------');

    // 1. Get current portfolio to calculate position sizing
    let cashAvailable = 100000;
    try {
        const portfolio = await getPortfolio(api);
        if (portfolio && (portfolio as any).cashBalance) {
            cashAvailable = parseFloat((portfolio as any).cashBalance.replace(/[,$]/g, ''));
        } else if (portfolio && (portfolio as any).buyingPower) {
            cashAvailable = parseFloat((portfolio as any).buyingPower.replace(/[,$]/g, ''));
        }
        log(`💰 Cash Available: $${cashAvailable.toFixed(2)}`);
    } catch (e) {
        log(`⚠️ Could not fetch portfolio, using default $100k.`);
    }

    // 2. Scan all tickers for inverted signals
    log('\n🔍 Scanning universe for signals to invert...');
    const signals: LoseSignal[] = [];

    for (let i = 0; i < VOLATILE_TICKERS.length; i += 10) {
        const batch = VOLATILE_TICKERS.slice(i, i + 10);
        const results = await Promise.all(batch.map(sym => detectInvertedSignal(sym)));
        results.forEach(sig => { if (sig) signals.push(sig); });
        log(`   Scanned ${Math.min(i + 10, VOLATILE_TICKERS.length)}/${VOLATILE_TICKERS.length}...`);
    }

    log(`\n📊 Found ${signals.length} inverted signals.`);

    if (signals.length === 0) {
        log('❌ No signals found. Market may be closed or range still forming.');
        return output.join('\n');
    }

    // 3. Sort by LOWEST conviction first (worst trades = fastest losses)
    signals.sort((a, b) => a.conviction - b.conviction);

    // 4. Execute ALL signals with aggressive sizing
    // Use 50% of remaining cash per trade (compounds losses fast)
    const MAX_TRADES = signals.length; // No limit — take everything
    const tradesToExecute = signals.slice(0, MAX_TRADES);

    log(`\n🔥 Auto-executing ${tradesToExecute.length} inverted trades...`);
    let tradesPlaced = 0;
    let tradesFailed = 0;

    for (const sig of tradesToExecute) {
        // Aggressive sizing: 50% of cash, minimum 1 share
        const allocation = cashAvailable * 0.50;
        const quantity = Math.max(1, Math.floor(allocation / sig.price));

        try {
            log(`\n   💀 ${sig.invertedSide.toUpperCase()} ${quantity} x ${sig.symbol} @ ~$${sig.price.toFixed(2)} (ConvScore: ${sig.conviction.toFixed(2)})`);

            const result = await executeTrade(api, {
                symbol: sig.symbol,
                action: sig.invertedSide,
                quantity: quantity,
                orderType: 'market',
                duration: 'day'
            });

            if (result.success) {
                log(`   ✅ ORDER PLACED: ${result.message}`);
                tradesPlaced++;
                // Reduce available cash (approximate)
                cashAvailable -= quantity * sig.price;
                if (cashAvailable < 1000) {
                    log('   ⚠️ Cash depleted. Stopping execution.');
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

    log('\n--- 📋 EXECUTION SUMMARY ---');
    log(`Trades Placed: ${tradesPlaced}`);
    log(`Trades Failed: ${tradesFailed}`);
    log(`Remaining Cash (Est): $${Math.max(0, cashAvailable).toFixed(2)}`);
    log('----------------------------');

    return output.join('\n');
}
