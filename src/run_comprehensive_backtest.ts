
import { fetchIntradayData, generateMockDownTrend } from './backtest/dataFetcher.js';
import * as fs from 'fs';
import * as path from 'path';

// Load tickers from universe.json
const UNIVERSE_PATH = path.resolve('src/backtest/universe.json');
const ALL_TICKERS = JSON.parse(fs.readFileSync(UNIVERSE_PATH, 'utf-8'));
const VOLATILE_TICKERS = ALL_TICKERS;

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
}

async function runBacktest() {
    const isMock = process.argv.includes('--mock');
    console.log(`--- 🧪 "CONSISTENCY + TRAIL" ORB Backtest (30 Days) ${isMock ? '[MOCK MODE]' : ''} ---`);
    console.log('Features: 1R Stop (High WR) + 50% Scale-Out @ 1R + 0.5R Trail');

    const allTrades: Trade[] = [];

    const BATCH_SIZE = 25;
    const tickersToUse = VOLATILE_TICKERS;

    for (let i = 0; i < tickersToUse.length; i += BATCH_SIZE) {
        const batch = tickersToUse.slice(i, i + BATCH_SIZE);
        const promises = batch.map((sym: string) => testTicker(sym, isMock));
        const results = await Promise.all(promises);
        results.forEach(r => allTrades.push(...r));
        console.log(`Processed ${Math.min(i + BATCH_SIZE, VOLATILE_TICKERS.length)}/${VOLATILE_TICKERS.length}...`);
        
        // Add delay to avoid rate limits
        if (i + BATCH_SIZE < VOLATILE_TICKERS.length) {
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }

    const totalReturn = allTrades.reduce((sum, t) => sum + t.returnPercent, 0);
    const wins = allTrades.filter(t => t.pnl > 0);
    const winRate = (wins.length / allTrades.length) * 100;
    
    const longTrades = allTrades.filter(t => t.side === 'LONG');
    const shortTrades = allTrades.filter(t => t.side === 'SHORT');
    
    const longWinRate = (longTrades.filter(t => t.pnl > 0).length / longTrades.length) * 100;
    const shortWinRate = (shortTrades.filter(t => t.pnl > 0).length / shortTrades.length) * 100;

    // --- Risk Metrics ---
    // Sort all trades by entry time to build equity curve
    allTrades.sort((a, b) => new Date(a.entryTime).getTime() - new Date(b.entryTime).getTime());

    let equity = 0;
    let peak = 0;
    let maxDrawdown = 0;
    const equityCurve: number[] = [];
    const returns: number[] = [];

    for (const t of allTrades) {
        equity += t.returnPercent;
        equityCurve.push(equity);
        returns.push(t.returnPercent);
        
        if (equity > peak) peak = equity;
        const dd = peak - equity;
        if (dd > maxDrawdown) maxDrawdown = dd;
    }

    // Sharpe Ratio (Simplified: Daily-ish vol approximation)
    // Assuming risk-free rate = 0
    const avgRet = totalReturn / allTrades.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgRet, 2), 0) / (returns.length - 1);
    const stdDev = Math.sqrt(variance);
    const sharpe = stdDev > 0 ? (avgRet / stdDev) * Math.sqrt(allTrades.length / 30) : 0; // Annualized assuming 30 days sample

    console.log('\n=== 📊 Comprehensive Backtest Results (30 Days) ===');
    console.log(`Mode: ${isMock ? 'OFFLINE (MOCK)' : 'LIVE/CACHE'}`);
    console.log(`Total Universe: ${tickersToUse.length} Tickers`);
    console.log(`Total Trades: ${allTrades.length}`);
    console.log(`Overall Win Rate: ${winRate.toFixed(2)}%`);
    console.log(`  - 🟢 Long Win Rate: ${longWinRate.toFixed(2)}% (${longTrades.length} trades)`);
    console.log(`  - 🔴 Short Win Rate: ${shortWinRate.toFixed(2)}% (${shortTrades.length} trades)`);
    console.log(`Avg Return per Trade: ${avgRet.toFixed(2)}%`);
    console.log(`Total Notional Return: ${totalReturn.toFixed(2)}%`);
    console.log(`Max Drawdown: ${maxDrawdown.toFixed(2)}%`);
    console.log(`Sharpe Ratio: ${sharpe.toFixed(2)}`);
}

async function testTicker(symbol: string, isMock: boolean = false): Promise<Trade[]> {
    try {
        const data = isMock 
            ? generateMockDownTrend(symbol) 
            : await fetchIntradayData(symbol, '1mo', '5m');
        if (data.data.length === 0) return [];

        const days = new Map<string, any[]>();
        data.data.forEach(c => {
            const day = c.date.split('T')[0];
            if (!days.has(day)) days.set(day, []);
            days.get(day)!.push(c);
        });

        const trades: Trade[] = [];
        let prevClose = 0;

        for (const [date, candles] of days) {
            let isGap = false;
            if (prevClose > 0) {
                const gapPct = (candles[0].open - prevClose) / prevClose;
                if (Math.abs(gapPct) > 0.002) isGap = true; // Relaxed to 0.2%
            }
            prevClose = candles[candles.length - 1].close;

            if (!isGap && prevClose > 0) {
                // console.log(`Skipping ${date} for ${symbol} - No gap`);
                continue;
            }
            if (candles.length < 7) continue;

            const openingRange = candles.slice(0, 6);
            const rangeHigh = Math.max(...openingRange.map((c: any) => c.high));
            const rangeLow = Math.min(...openingRange.map((c: any) => c.low));
            const avgOpeningVol = openingRange.reduce((sum: number, c: any) => sum + c.volume, 0) / 6;

            if (candles[0].close < 5) continue;

            const rangeHeight = rangeHigh - rangeLow;
            const rangePct = rangeHeight / rangeLow;

            if (rangePct < 0.005 || rangePct > 0.12) continue;

            let position: any = null;

            for (let i = 20; i < candles.length; i++) {
                const c = candles[i];
                
                // Calculate SMA20
                const sma20 = candles.slice(i - 20, i).reduce((sum, c) => sum + c.close, 0) / 20;

                if (!position) {
                    const volReq = c.volume > avgOpeningVol * 1.5; // Tightened to 1.5x

                    if (c.high > rangeHigh && volReq && c.close > sma20) {
                        position = {
                            side: 'LONG',
                            entryPrice: rangeHigh,
                            stop: rangeLow, 
                            target1: rangeHigh + rangeHeight, 
                            scaledOut: false,
                            maxPrice: c.high,
                            entryTime: c.date,
                            pnlAcc: 0
                        };
                    } else if (c.low < rangeLow && volReq && c.close < sma20) {
                        position = {
                            side: 'SHORT',
                            entryPrice: rangeLow,
                            stop: rangeHigh,
                            target1: rangeLow - rangeHeight,
                            scaledOut: false,
                            minPrice: c.low,
                            entryTime: c.date,
                            pnlAcc: 0
                        };
                    }
                } else {
                    let exitPrice = 0;
                    let reason = '';

                    if (position.side === 'LONG') {
                        position.maxPrice = Math.max(position.maxPrice, c.high);

                        // Scale Out @ 1R
                        if (!position.scaledOut && c.high >= position.target1) {
                            position.pnlAcc += (position.target1 - position.entryPrice) * 0.5;
                            // Set dynamic trailing stop (0.5R buffer from peak or at entry)
                            position.stop = position.entryPrice; // Protect BE
                            position.scaledOut = true;
                        }

                        // Exit on Stop
                        if (c.low <= position.stop) {
                            exitPrice = position.stop;
                            reason = position.scaledOut ? 'TRAIL_STOP' : 'STOP';
                        }
                    } else {
                        position.minPrice = Math.min(position.minPrice, c.low);

                        if (!position.scaledOut && c.low <= position.target1) {
                            position.pnlAcc += (position.entryPrice - position.target1) * 0.5;
                            position.stop = position.entryPrice;
                            position.scaledOut = true;
                        }

                        if (c.high >= position.stop) {
                            exitPrice = position.stop;
                            reason = position.scaledOut ? 'TRAIL_STOP' : 'STOP';
                        }
                    }

                    if (!exitPrice && i === candles.length - 1) {
                        exitPrice = c.close;
                        reason = 'EOD';
                    }

                    if (exitPrice) {
                        const remainingQty = position.scaledOut ? 0.5 : 1.0;
                        const finalPnl = (position.side === 'LONG' ? exitPrice - position.entryPrice : position.entryPrice - exitPrice) * remainingQty;
                        const totalPnl = position.pnlAcc + finalPnl;
                        const ret = (totalPnl / position.entryPrice) * 100;

                        trades.push({
                            symbol, side: position.side, entryTime: position.entryTime, exitTime: c.date,
                            entryPrice: position.entryPrice, exitPrice, pnl: totalPnl, returnPercent: ret, reason
                        });
                        break;
                    }
                }
            }
        }
        return trades;
    } catch (e) {
        console.error(`Error testing ${symbol}:`, e);
        return [];
    }
}

runBacktest();
