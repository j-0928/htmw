
import { fetchIntradayData } from './backtest/dataFetcher.js';
import * as fs from 'fs';
import * as path from 'path';

const VOLATILE_TICKERS = [
    'NVDA', 'TSLA', 'AMD', 'META', 'AMZN', 'NFLX', 'GOOGL', 'MSFT', 'AAPL', 'AVGO',
    'SMCI', 'ARM', 'MU', 'INTC', 'QCOM', 'TXN', 'LRCX', 'AMAT', 'KLAC', 'MRVL',
    'COIN', 'MSTR', 'MARA', 'RIOT', 'CLSK', 'HUT', 'BITF', 'HOOD',
    'PLTR', 'SOUN', 'AI', 'DJT', 'GME', 'AMC', 'CVNA', 'UPST', 'BYND', 'RDDT', 'DKNG',
    'VKTX', 'LLY', 'NVO',
    'RIVN', 'LCID', 'NIO', 'XPEV',
    'FSLR', 'ENPH', 'SEDG', 'RUN',
    'SMX',
    'APP', 'ASTS', 'LUNR', 'SQ', 'SHOP', 'CRWD', 'PANW', 'SNOW', 'U', 'RBLX',
    'AFRM', 'IONQ', 'RGTI', 'MDB', 'NET', 'BILL', 'TWLO', 'OKTA',
    'VRT', 'ANET', 'DELL', // AI Infra
    'PDD', 'BABA', 'JD', 'BIDU', // China Tech
    'WULF', 'IREN', 'CORZ', 'CIFR', // More Crypto Miners
    'MRNA', 'BNTX', 'CRSP', // Biotech
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
}

async function runBacktest() {
    console.log('--- 🧪 "CONSISTENCY + TRAIL" ORB Backtest (30 Days) ---');
    console.log('Features: 1R Stop (High WR) + 50% Scale-Out @ 1R + 0.5R Trail');

    const allTrades: Trade[] = [];

    const BATCH_SIZE = 5;
    for (let i = 0; i < VOLATILE_TICKERS.length; i += BATCH_SIZE) {
        const batch = VOLATILE_TICKERS.slice(i, i + BATCH_SIZE);
        const promises = batch.map(sym => testTicker(sym));
        const results = await Promise.all(promises);
        results.forEach(r => allTrades.push(...r));
        console.log(`Processed ${Math.min(i + BATCH_SIZE, VOLATILE_TICKERS.length)}/${VOLATILE_TICKERS.length}...`);
    }

    const wins = allTrades.filter(t => t.pnl > 0);
    const winRate = (wins.length / allTrades.length) * 100;
    const totalReturn = allTrades.reduce((sum, t) => sum + t.returnPercent, 0);
    const avgReturn = totalReturn / allTrades.length;

    console.log('\n=== 📊 Backtest Results (30 Days) ===');
    console.log(`Total Trades: ${allTrades.length}`);
    console.log(`Win Rate: ${winRate.toFixed(2)}%`);
    console.log(`Avg Return per Trade: ${avgReturn.toFixed(2)}%`);
    console.log(`Total Notional Return: ${totalReturn.toFixed(2)}%`);
}

async function testTicker(symbol: string): Promise<Trade[]> {
    try {
        const data = await fetchIntradayData(symbol, '1mo', '5m');
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

            if (!isGap && prevClose > 0) continue;
            if (candles.length < 7) continue;

            const openingRange = candles.slice(0, 6);
            const rangeHigh = Math.max(...openingRange.map((c: any) => c.high));
            const rangeLow = Math.min(...openingRange.map((c: any) => c.low));
            const avgOpeningVol = openingRange.reduce((sum: number, c: any) => sum + c.volume, 0) / 6;

            if (candles[0].close < 5) continue;

            const rangeHeight = rangeHigh - rangeLow;
            const rangePct = rangeHeight / rangeLow;

            if (rangePct < 0.005 || rangePct > 0.12) continue; // Relaxed max to 12%

            let position: any = null;

            for (let i = 6; i < candles.length; i++) {
                const c = candles[i];

                if (!position) {
                    const volReq = c.volume > avgOpeningVol * 1.2;

                    if (c.high > rangeHigh && volReq) {
                        position = {
                            side: 'LONG',
                            entryPrice: rangeHigh,
                            stop: rangeLow, // 1R Initial Stop
                            target1: rangeHigh + rangeHeight, // Scale-Out level
                            scaledOut: false,
                            maxPrice: c.high,
                            entryTime: c.date,
                            pnlAcc: 0
                        };
                    } else if (c.low < rangeLow && volReq) {
                        position = {
                            side: 'SHORT',
                            entryPrice: rangeLow,
                            stop: rangeHigh, // 1R Initial Stop
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
