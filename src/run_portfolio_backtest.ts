
import { fetchIntradayData } from './backtest/dataFetcher.js';
import * as fs from 'fs';
import * as path from 'path';

const VOLATILE_TICKERS = [
    'NVDA', 'TSLA', 'AMD', 'META', 'AMZN', 'NFLX', 'GOOGL', 'MSFT', 'AAPL', 'AVGO',
    'SMCI', 'ARM', 'MU', 'INTC', 'QCOM', 'TXN', 'LRCX', 'AMAT', 'KLAC', 'MRVL',
    'COIN', 'MSTR', 'MARA', 'RIOT', 'CLSK', 'HUT', 'BITF', 'HOOD',
    'WULF', 'IREN', 'CORZ', 'CIFR', // More Crypto Miners
    'MRNA', 'BNTX', 'CRSP', // Biotech
    'PLTR', 'SOUN', 'AI', 'DJT', 'GME', 'AMC', 'CVNA', 'UPST', 'BYND', 'RDDT', 'DKNG',
    'VKTX', 'LLY', 'NVO',
    'VRT', 'ANET', 'DELL', // AI Infra
    'PDD', 'BABA', 'JD', 'BIDU', // China Tech
    'RIVN', 'LCID', 'NIO', 'XPEV',
    'FSLR', 'ENPH', 'SEDG', 'RUN',
    'SMX',
    'APP', 'ASTS', 'LUNR', 'SQ', 'SHOP', 'CRWD', 'PANW', 'SNOW', 'U', 'RBLX',
    'AFRM', 'IONQ', 'RGTI', 'MDB', 'NET', 'BILL', 'TWLO', 'OKTA',
    'SOFI', 'OPEN', 'SPCE', 'ACHR', 'JOBY', 'Z', 'RDFN', // Speculative & Real Estate
    'TTD', 'DDOG', 'ZS', 'TEAM', 'WDAY', 'NOW' // Cloud/SaaS
];

interface Trade {
    symbol: string;
    entryTime: string;
    exitTime: string;
    side: 'LONG' | 'SHORT';
    entryPrice: number;
    exitPrice: number;
    pnl: number;
    returnPercent: number;
    reason: string;
    relVol: number;
}

interface Signal {
    symbol: string;
    side: 'LONG' | 'SHORT';
    entryPrice: number;
    stop: number;
    target1: number;
    rangeHeight: number;
    candles: any[]; // Store full day's candles for simulation
    relVol: number;
}

async function runPortfolioBacktest() {
    console.log('--- 🏦 PORTFOLIO BACKTEST (Top 5 Daily) ---');
    console.log(`Universe: ${VOLATILE_TICKERS.length} Tickers`);
    console.log('Logic: Collect ALL signals -> Rank by RelVol -> Execute Top 5');

    // 1. Fetch All Data
    const allData = new Map<string, any>(); // symbol -> grouped days
    console.log('Fetching data...');

    // Fetch in batches to avoid overwhelming
    const BATCH_SIZE = 10;
    for (let i = 0; i < VOLATILE_TICKERS.length; i += BATCH_SIZE) {
        const batch = VOLATILE_TICKERS.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(async (sym) => {
            const data = await fetchIntradayData(sym, '1mo', '5m');
            if (data && data.data.length > 0) {
                const days = new Map<string, any[]>();
                data.data.forEach((c: any) => {
                    const day = c.date.split('T')[0];
                    if (!days.has(day)) days.set(day, []);
                    days.get(day)!.push(c);
                });
                allData.set(sym, days);
            }
        }));
        console.log(`Fetched ${Math.min(i + BATCH_SIZE, VOLATILE_TICKERS.length)}/${VOLATILE_TICKERS.length}`);
    }

    // 2. Identify All Unique Dates
    const allDates = new Set<string>();
    for (const days of allData.values()) {
        for (const date of days.keys()) allDates.add(date);
    }
    const sortedDates = Array.from(allDates).sort();

    const portfolioTrades: Trade[] = [];

    // 3. Iterate Day by Day
    for (const date of sortedDates) {
        const dailySignals: Signal[] = [];

        // Check every available ticker for this date
        for (const [sym, daysMap] of allData) {
            const candles = daysMap.get(date);
            if (!candles) continue;

            // Get previous day close (approximation: last close of prev valid day in map)
            // Ideally we need strict sequential data, but for this simulation lookup is acceptable
            // We'll iterate the map keys in order to be safer? 
            // Better: use the index of the date in the sorted array required? 
            // Simplification: We need Pre-Market check which requires previous close. 
            // Let's assume fetch returns a continuous block. We need to find the day BEFORE `date` in `daysMap`.
            const sortedTickerDates = Array.from(daysMap.keys()).sort();
            const dayIdx = sortedTickerDates.indexOf(date);
            if (dayIdx <= 0) continue; // No prev day data

            const prevDayCandles = daysMap.get(sortedTickerDates[dayIdx - 1])!;
            const prevClose = prevDayCandles[prevDayCandles.length - 1].close;

            const signal = checkSignal(sym, candles, prevClose);
            if (signal) dailySignals.push(signal);
        }

        // Rank by RelVol
        dailySignals.sort((a, b) => b.relVol - a.relVol);

        // Take Top 5
        const top5 = dailySignals.slice(0, 5);
        // console.log(`[${date}] Found ${dailySignals.length} signals. Executing Top ${top5.length}.`);

        // Simulate Trades for Top 5
        for (const sig of top5) {
            const trade = simulateTrade(sig);
            if (trade) portfolioTrades.push(trade);
        }
    }

    // 4. Report
    const wins = portfolioTrades.filter(t => t.pnl > 0);
    const winRate = (wins.length / portfolioTrades.length) * 100;
    const totalReturn = portfolioTrades.reduce((sum, t) => sum + t.returnPercent, 0);
    const avgReturn = totalReturn / portfolioTrades.length;

    console.log('\n=== 📊 Portfolio Backtest Results (Top 5 Ranked) ===');
    console.log(`Total Trades Executed: ${portfolioTrades.length}`);
    console.log(`Win Rate: ${winRate.toFixed(2)}%`);
    console.log(`Avg Return per Trade: ${avgReturn.toFixed(2)}%`);
    console.log(`Total Notional Return: ${totalReturn.toFixed(2)}%`);
    console.log(`Profit Factor: ${(wins.reduce((s, t) => s + t.returnPercent, 0) / Math.abs(portfolioTrades.filter(t => t.pnl < 0).reduce((s, t) => s + t.returnPercent, 0))).toFixed(2)}`);
}

function checkSignal(symbol: string, candles: any[], prevClose: number): Signal | null {
    if (candles.length < 7) return null;

    const openingRange = candles.slice(0, 6);
    const rangeHigh = Math.max(...openingRange.map((c: any) => c.high));
    const rangeLow = Math.min(...openingRange.map((c: any) => c.low));
    const avgVol = openingRange.reduce((sum: number, c: any) => sum + c.volume, 0) / 6;

    if (candles[0].close < 5) return null;

    // Gap
    const gapPct = Math.abs((candles[0].open - prevClose) / prevClose);
    if (gapPct < 0.002) return null;

    // Range
    const rangeHeight = rangeHigh - rangeLow;
    const rangePct = rangeHeight / rangeLow;
    if (rangePct < 0.005 || rangePct > 0.12) return null;

    // Setup Check (Trigger)
    let triggered = false;
    let side: 'LONG' | 'SHORT' = 'LONG';
    let entryPrice = 0;
    let stop = 0;
    let target1 = 0;
    let triggerIndex = -1;
    let relVol = 0;

    for (let i = 6; i < candles.length; i++) {
        const c = candles[i];
        // Volume Filter (Relaxed)
        if (c.volume > 0 && c.volume < avgVol * 0.8) continue;

        // RelVol Calc
        const rv = avgVol > 0 ? c.volume / avgVol : 0;

        if (c.high > rangeHigh) {
            triggered = true; side = 'LONG'; entryPrice = rangeHigh; stop = rangeLow;
            triggerIndex = i;
            relVol = rv;
            target1 = rangeHigh + rangeHeight;
            break;
        } else if (c.low < rangeLow) {
            triggered = true; side = 'SHORT'; entryPrice = rangeLow; stop = rangeHigh;
            triggerIndex = i;
            relVol = rv;
            target1 = rangeLow - rangeHeight;
            break;
        }
    }

    if (!triggered) return null;

    return {
        symbol, side, entryPrice, stop, target1, rangeHeight, relVol,
        candles: candles.slice(triggerIndex) // Pass only remaining candles
    };
}

function simulateTrade(sig: Signal): Trade | null {
    let position = {
        ...sig,
        scaledOut: false,
        stop: sig.stop,
        pnlAcc: 0
    };

    let exitPrice = 0;
    let reason = '';
    const candles = sig.candles;

    for (let i = 0; i < candles.length; i++) {
        const c = candles[i];

        if (sig.side === 'LONG') {
            // 1. Target 1 (Scale Out)
            if (!position.scaledOut && c.high >= sig.target1) {
                position.pnlAcc += (sig.target1 - sig.entryPrice) * 0.5;
                position.stop = sig.entryPrice; // BE
                position.scaledOut = true;
            }
            // 2. Stop
            if (c.low <= position.stop) {
                exitPrice = position.stop;
                reason = position.scaledOut ? 'TRAIL_STOP' : 'STOP';
                break;
            }
        } else {
            if (!position.scaledOut && c.low <= sig.target1) {
                position.pnlAcc += (sig.entryPrice - sig.target1) * 0.5;
                position.stop = sig.entryPrice;
                position.scaledOut = true;
            }
            if (c.high >= position.stop) {
                exitPrice = position.stop;
                reason = position.scaledOut ? 'TRAIL_STOP' : 'STOP';
                break;
            }
        }

        if (i === candles.length - 1) {
            exitPrice = c.close;
            reason = 'EOD';
        }
    }

    if (!exitPrice) return null;

    const remainingQty = position.scaledOut ? 0.5 : 1.0;
    const finalPnl = (sig.side === 'LONG' ? exitPrice - sig.entryPrice : sig.entryPrice - exitPrice) * remainingQty;
    const totalPnl = position.pnlAcc + finalPnl;
    const ret = (totalPnl / sig.entryPrice) * 100;

    return {
        symbol: sig.symbol,
        entryTime: candles[0].date,
        exitTime: candles[candles.length - 1].date,
        side: sig.side,
        entryPrice: sig.entryPrice,
        exitPrice, pnl: totalPnl, returnPercent: ret, reason, relVol: sig.relVol
    };
}

runPortfolioBacktest();
