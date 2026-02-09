
import { fetchMultipleSymbols, fetchHistoricalData } from './backtest/dataFetcher.js';
import { backtestGapFill, aggregateResults, calculateSMA, DEFAULT_PARAMS } from './backtest/strategy.js';
import * as fs from 'fs';
import * as path from 'path';

interface Result {
    params: any;
    metrics: any;
}

// Function to generate parameter combinations
function generateParams() {
    const gaps = [1, 1.5, 2];
    const rsi = [20, 25];
    const holdDays = [3, 5];
    const useStartSMA = [true];
    const useMarket = [false, true];

    const combinations: any[] = [];

    for (const g of gaps) {
        for (const r of rsi) {
            for (const h of holdDays) {
                for (const s of useStartSMA) {
                    for (const m of useMarket) {
                        combinations.push({
                            ...DEFAULT_PARAMS,
                            gapThreshold: g,
                            minRSI: r,
                            holdDays: h,
                            useSMAFilter: s,
                            smaPeriod: 200,
                            useMarketFilter: m
                        });
                    }
                }
            }
        }
    }
    return combinations;
}

async function runOptimization() {
    console.log('--- 🧬 Starting Expanded Market Optimization ---');
    console.log(`Period: 2023-01-01 to 2026-02-08`);

    try {
        // 1. Load Universe
        const universePath = path.resolve('src/backtest/universe.json');
        if (!fs.existsSync(universePath)) {
            console.error('Universe file not found. Run fetch_universe.ts first.');
            return;
        }
        const universe = JSON.parse(fs.readFileSync(universePath, 'utf-8'));
        console.log(`Loaded ${universe.length} tickers from universe.json`);

        // 2. Fetch Market Data (SPY)
        console.log('Fetching SPY data for Market Regime filter...');
        const startDate = '2023-01-01';
        const endDate = '2026-02-08';
        const spyData = await fetchHistoricalData('SPY', startDate, endDate);

        if (!spyData || spyData.data.length === 0) {
            console.error('Failed to fetch SPY data. Aborting.');
            return;
        }

        // 3. Build Market Trend Map
        const marketTrendMap = new Map<string, boolean>();
        const spyDaily = spyData.data;
        for (let i = 200; i < spyDaily.length; i++) {
            const sma200 = calculateSMA(spyDaily, i, 200);
            const isUptrend = spyDaily[i].close > sma200;
            marketTrendMap.set(spyDaily[i].date, isUptrend);
        }
        console.log(`Market Trend Map built for ${marketTrendMap.size} trading days.`);

        // 4. Fetch Stock Data (Batch)
        console.log(`Fetching historical data for ${universe.length} stocks...`);
        // Limit to top 200 for speed if needed, but let's try 500
        const sampleSize = 300;
        const testUniverse = universe.slice(0, sampleSize);
        console.log(`Running backtest on top ${sampleSize} liquid stocks to save time.`);

        const dataMap = await fetchMultipleSymbols(testUniverse, startDate, endDate);
        console.log(`Successfully fetched data for ${dataMap.size} symbols.`);

        const paramSets = generateParams();
        console.log(`Testing ${paramSets.length} parameter combinations...`);

        const allResults: Result[] = [];

        for (const params of paramSets) {
            let allTrades: any[] = [];
            for (const [symbol, data] of dataMap.entries()) {
                const trades = backtestGapFill(data, symbol, params, marketTrendMap);
                if (trades.length > 0) {
                    allTrades = allTrades.concat(trades);
                }
            }

            const metrics = aggregateResults(allTrades);
            if (metrics.totalTrades > 50) { // Require reasonable sample size
                allResults.push({ params, metrics });
            }
        }

        // Sort by Win Rate (primary) then Profit Factor
        allResults.sort((a, b) => b.metrics.winRate - a.metrics.winRate);

        console.log('\n=== 🏆 Top 5 Configurations by Win Rate ===');

        allResults.slice(0, 5).forEach((res, index) => {
            console.log(`\n#${index + 1}:`);
            console.log(`Params: Gap ${res.params.gapThreshold}%, RSI < ${res.params.minRSI}, Hold ${res.params.holdDays}d, MktFilter: ${res.params.useMarketFilter}`);
            console.log(`Win Rate:       ${res.metrics.winRate.toFixed(2)}%`);
            console.log(`Profit Factor:  ${res.metrics.profitFactor.toFixed(2)}`);
            console.log(`Total Return:   ${res.metrics.totalReturn.toFixed(2)}%`);
            console.log(`Max Drawdown:   ${res.metrics.maxDrawdown.toFixed(2)}%`);
            console.log(`Total Trades:   ${res.metrics.totalTrades}`);
        });

    } catch (error) {
        console.error('Optimization failed:', error);
    }
}

runOptimization();
