
import { fetchIntradayData } from './backtest/dataFetcher.js';
import { backtestIntraday, ORB_DEFAULT_PARAMS } from './backtest/intraday_strategy.js';

const VOLATILE_TICKERS = ['NVDA', 'TSLA', 'AMD', 'META', 'AMZN', 'NFLX', 'COIN', 'MSTR'];

async function runIntradayBacktest() {
    console.log('--- ⏱️ Starting Intraday ORB Backtest (Last 5 Days) ---');

    // Fetch data once
    const dataMap = new Map<string, any[]>();
    for (const symbol of VOLATILE_TICKERS) {
        console.log(`Fetching 1m data for ${symbol}...`);
        const result = await fetchIntradayData(symbol, '5d');
        if (result.data.length > 0) {
            dataMap.set(symbol, result.data);
        } else {
            console.log(`Skipping ${symbol} (No data)`);
        }
    }

    // Params to test
    const ranges = [5, 15, 30]; // Opening Range in minutes
    const targets = [1.0, 2.0, 3.0]; // Risk Multiples

    let bestResult: any = { params: '', winRate: 0, profit: 0 };

    for (const range of ranges) {
        for (const target of targets) {
            const params = {
                ...ORB_DEFAULT_PARAMS,
                rangeMinutes: range,
                profitTargetR: target,
                maxHoldMinutes: 60 // Strict 1 hour limit
            };

            let totalTrades = 0;
            let totalWin = 0;
            let totalPL = 0; // Raw price diff * 100 shares

            // Test across all symbols
            for (const [symbol, data] of dataMap.entries()) {
                const trades = backtestIntraday(data, symbol, params);

                totalTrades += trades.length;
                totalWin += trades.filter(t => t.pnl > 0).length;
                totalPL += trades.reduce((sum, t) => sum + t.pnl, 0);
            }

            const winRate = totalTrades > 0 ? (totalWin / totalTrades) * 100 : 0;
            const avgTrade = totalTrades > 0 ? totalPL / totalTrades : 0;

            console.log(`Config: Range ${range}m, Target ${target}R`);
            console.log(`  Trades: ${totalTrades}, Win Rate: ${winRate.toFixed(1)}%, Total P&L: $${totalPL.toFixed(0)}, Avg: $${avgTrade.toFixed(0)}`);

            if (winRate > bestResult.winRate && totalTrades > 5) {
                bestResult = {
                    params: `Range ${range}m, Target ${target}R`,
                    winRate,
                    profit: totalPL,
                    trades: totalTrades
                };
            }
        }
    }

    console.log('\n=== 🏆 Best Intraday Configuration ===');
    console.log(bestResult);
}

runIntradayBacktest();
