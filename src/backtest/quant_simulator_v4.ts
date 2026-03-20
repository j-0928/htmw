
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { fetchIntradayData } from './dataFetcher.js';

const UNIVERSE_PATH = path.resolve('src/backtest/universe.json');
const ALL_TICKERS = JSON.parse(fs.readFileSync(UNIVERSE_PATH, 'utf-8'));

interface QuantResult {
    symbol: string;
    drift: number;
    vol: number;
    upperBranch: number; // 95th percentile
    lowerBranch: number; // 5th percentile
    score: number;       // (UB - LB) / LB * 100
}

if (isMainThread) {
    console.log(`🌀 "LIGHTNING BRANCH" QUANT SIMULATOR v4 (1000 Tickers)`);
    console.log(`Running 1000 Monte Carlo Paths per Ticker on ${os.cpus().length} Cores...`);

    const numWorkers = os.cpus().length;
    const tickersPerWorker = Math.ceil(ALL_TICKERS.length / numWorkers);
    let finished = 0;
    const results: QuantResult[] = [];

    for (let i = 0; i < numWorkers; i++) {
        const batch = ALL_TICKERS.slice(i * tickersPerWorker, (i + 1) * tickersPerWorker);
        const worker = new Worker(fileURLToPath(import.meta.url), { workerData: { tickers: batch } });
        worker.on('message', (msg: QuantResult[]) => results.push(...msg));
        worker.on('error', (e) => console.error(e));
        worker.on('exit', () => {
            finished++;
            if (finished === numWorkers) finalize(results);
        });
    }

    function finalize(results: QuantResult[]) {
        results.sort((a,b) => b.score - a.score);
        console.log(`\n⚡ TOP 100 TICKERS BY PREDICTED "LIGHTNING BRANCH" RANGE (5-DAY)`);
        console.table(results.slice(0, 40).map(r => ({
            Symbol: r.symbol,
            Drift: (r.drift * 100).toFixed(4) + '%',
            Vol: (r.vol * 100).toFixed(2) + '%',
            'Upper Branch (5-Day)': r.upperBranch.toFixed(2) + '%',
            'Lower Branch (5-Day)': r.lowerBranch.toFixed(2) + '%',
            'Branch Score': r.score.toFixed(2) + '%'
        })));

        const topTickers = results.slice(0, 100).map(r => r.symbol);
        fs.writeFileSync(path.resolve('src/backtest/quant_ranks.json'), JSON.stringify(topTickers, null, 2));
        console.log(`\n✅ Quant Ranks saved to src/backtest/quant_ranks.json`);
    }

} else {
    // WORKER: Quant Simulation
    const { tickers } = workerData;
    const workerResults: QuantResult[] = [];

    async function runQuantWorker() {
        for (const sym of tickers) {
            try {
                const raw = await fetchIntradayData(sym, '1mo', '5m');
                if (!raw || !raw.data || raw.data.length < 50) continue;

                const candles = raw.data;
                const returns = [];
                for (let i = 1; i < candles.length; i++) {
                    const ret = Math.log(candles[i].close / candles[i-1].close);
                    returns.push(ret);
                }

                // Daily Drift and Vol (Approx from 5m candles)
                const n = returns.length;
                const mean = returns.reduce((a,b)=>a+b,0)/n;
                const variance = returns.reduce((a,b)=>a+Math.pow(b-mean,2),0)/(n-1);
                const std = Math.sqrt(variance);

                // Monte Carlo Points: 1000 paths, 5 days (assuming ~78 candles of 5m per day = 390 steps)
                const STEPS = 390; 
                const PATHS = 1000;
                const finalReturns: number[] = [];

                for (let p = 0; p < PATHS; p++) {
                    let logRetSum = 0;
                    for (let s = 0; s < STEPS; s++) {
                        // GBM formula: (mean - 0.5*std^2) + std * Z
                        const z = boxMuller();
                        logRetSum += (mean - 0.5 * std * std) + std * z;
                    }
                    finalReturns.push(Math.exp(logRetSum) - 1);
                }

                finalReturns.sort((a,b)=>a-b);
                const ub = finalReturns[Math.floor(PATHS * 0.95)] * 100;
                const lb = finalReturns[Math.floor(PATHS * 0.05)] * 100;
                
                workerResults.push({
                    symbol: sym, drift: mean, vol: std,
                    upperBranch: ub, lowerBranch: lb,
                    score: ub - lb
                });
            } catch (e) { /* skip */ }
        }
        parentPort?.postMessage(workerResults);
    }

    function boxMuller() {
        let u = 0, v = 0;
        while(u === 0) u = Math.random();
        while(v === 0) v = Math.random();
        return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    }

    runQuantWorker();
}
