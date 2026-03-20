
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { fetchIntradayData, addIndicators, addAdvancedIndicators } from './dataFetcher.js';

interface Params {
    volFilter: number;
    atrMult: number;
    minScore: number; 
    rangeMax: number;
}

interface Result {
    params: Params;
    winRate: number;
    avgReturn: number;
    trades: number;
    sharpe: number;
}

if (isMainThread) {
    const UNIVERSE_PATH = path.resolve('src/backtest/universe.json');
    const ALL_TICKERS = JSON.parse(fs.readFileSync(UNIVERSE_PATH, 'utf-8'));
    
    // FINAL SMARTER GRID SEARCH
    const VOL_FILTERS = [3.0, 5.0];
    const ATR_MULTS = [2.5, 3.5];
    const MIN_SCORES = [4, 5, 6]; 
    const RANGE_MAXS = [0.03, 0.05, 0.08];

    const grid: Params[] = [];
    for (const volFilter of VOL_FILTERS) 
    for (const atrMult of ATR_MULTS)
    for (const minScore of MIN_SCORES)
    for (const rangeMax of RANGE_MAXS) {
        grid.push({ volFilter, atrMult, minScore, rangeMax });
    }

    console.log(`🚀 Starting FINAL Zero-Lag Parallel Optimizer on ${os.cpus().length} cores...`);
    console.log(`Grid Size: ${grid.length} combinations | Universe: ${ALL_TICKERS.length} tickers`);

    const numWorkers = os.cpus().length;
    const tickersPerWorker = Math.ceil(ALL_TICKERS.length / numWorkers);
    
    let finishedWorkers = 0;
    const allResults: Result[] = [];

    for (let i = 0; i < numWorkers; i++) {
        const start = i * tickersPerWorker;
        const end = Math.min(start + tickersPerWorker, ALL_TICKERS.length);
        const workerTickers = ALL_TICKERS.slice(start, end);

        const worker = new Worker(fileURLToPath(import.meta.url), {
            workerData: { tickers: workerTickers, grid }
        });

        worker.on('message', (workerResults: Result[]) => {
            allResults.push(...workerResults);
        });

        worker.on('exit', () => {
            finishedWorkers++;
            if (finishedWorkers === numWorkers) {
                printFinalResults(allResults);
            }
        });
    }

    function printFinalResults(results: Result[]) {
        const summary = new Map<string, { winRate: number, avgReturn: number, trades: number, sharpe: number, count: number }>();
        results.forEach(res => {
            const key = JSON.stringify(res.params);
            if (!summary.has(key)) summary.set(key, { winRate: 0, avgReturn: 0, trades: 0, sharpe: 0, count: 0 });
            const s = summary.get(key)!;
            s.winRate += res.winRate; s.avgReturn += res.avgReturn; s.trades += res.trades; s.sharpe += res.sharpe; s.count++;
        });

        const final: Result[] = [];
        summary.forEach((s, key) => final.push({ params: JSON.parse(key), winRate: s.winRate / s.count, avgReturn: s.avgReturn / s.count, trades: s.trades, sharpe: s.sharpe / s.count }));
        final.sort((a, b) => b.winRate - a.winRate);

        console.log('\n=== 🏆 Top ZERO-LAG Multi-Factor Combinations ===');
        final.slice(0, 5).forEach((f, i) => {
            console.log(`${i+1}. WR: ${f.winRate.toFixed(2)}% | Avg: ${f.avgReturn.toFixed(2)}% | Sharpe: ${f.sharpe.toFixed(2)} | Trades: ${f.trades}`);
            console.log(`   Params: ${JSON.stringify(f.params)}`);
        });
    }

} else {
    const { tickers, grid } = workerData;
    const workerResults: Result[] = [];

    async function runWorker() {
        for (const params of grid) {
            let tT = 0, tW = 0, tR = 0;
            const returns: number[] = [];

            for (const sym of tickers) {
                const raw1 = await fetchIntradayData(sym, '1mo', '5m');
                const raw2 = addIndicators(raw1.data);
                const data = { ...raw1, data: addAdvancedIndicators(raw2) };
                const trades = backtestTicker(data, params);
                tT += trades.length;
                tW += trades.filter(t => t.pnl > 0).length;
                tR += trades.reduce((s, t) => s + t.returnPercent, 0);
                trades.forEach(t => returns.push(t.returnPercent));
            }

            if (tT > 0) { 
                const winRate = (tW / tT) * 100;
                const avgReturn = tR / tT;
                const variance = returns.reduce((s, r) => s + Math.pow(r - avgReturn, 2), 0) / (returns.length - 1);
                const stdDev = Math.sqrt(variance);
                const sharpe = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(tT / 30) : 0;
                workerResults.push({ params, winRate, avgReturn, trades: tT, sharpe });
            }
        }
        parentPort?.postMessage(workerResults);
    }

    function backtestTicker(data: any, params: Params) {
        if (data.data.length < 21) return [];
        const days = new Map<string, any[]>();
        data.data.forEach((c: any) => { const day = c.date.split('T')[0]; if (!days.has(day)) days.set(day, []); days.get(day)!.push(c); });

        const allTrades: any[] = [];
        let prevClose = 0;
        for (const [date, candles] of days) {
            let isGap = false;
            if (prevClose > 0 && Math.abs((candles[0].open - prevClose) / prevClose) > 0.002) isGap = true;
            prevClose = candles[candles.length - 1].close;
            if (!isGap && prevClose > 0) continue;
            if (candles.length < 21) continue;

            const openingRange = candles.slice(0, 6);
            const rangeHigh = Math.max(...openingRange.map((c: any) => c.high));
            const rangeLow = Math.min(...openingRange.map((c: any) => c.low));
            const rangeHeight = rangeHigh - rangeLow;
            if (rangeHeight === 0 || (rangeHeight / rangeLow) > params.rangeMax) continue;

            let pos: any = null;
            const avgOpVol = openingRange.reduce((s, c) => s + c.volume, 0) / 6;

            for (let i = 20; i < candles.length; i++) {
                const c = candles[i];
                if (!pos) {
                    const volReq = c.volume > avgOpVol * params.volFilter;
                    let sl = 0, ss = 0;
                    if (c.high > rangeHigh) sl++; if (volReq) sl++; if (c.close > c.vwap) sl++; if (c.rsi < 70) sl++; if (c.cmf > 0) sl++; if (c.isBullish) sl++;
                    if (c.low < rangeLow) ss++; if (volReq) ss++; if (c.close < c.vwap) ss++; if (c.rsi > 30) ss++; if (c.cmf < 0) ss++; if (!c.isBullish) ss++;

                    if (sl >= params.minScore) pos = { side: 'LONG', entry: rangeHigh, sl: rangeLow, target1: rangeHigh + rangeHeight, scaled: false, maxP: c.high };
                    else if (ss >= params.minScore) pos = { side: 'SHORT', entry: rangeLow, sl: rangeHigh, target1: rangeLow - rangeHeight, scaled: false, minP: c.low };
                } else {
                    if (pos.side === 'LONG') {
                        pos.maxP = Math.max(pos.maxP, c.high);
                        if (!pos.scaled && c.high > pos.target1) { pos.scaled = true; pos.sl = pos.entry; }
                        const s = Math.max(pos.sl, pos.maxP - (c.atr * params.atrMult));
                        if (c.low < s) { const ex = Math.min(c.open, s); allTrades.push({ pnl: ex - pos.entry, returnPercent: (ex - pos.entry) / pos.entry * 100 }); break; }
                    } else {
                        pos.minP = Math.min(pos.minP, c.low);
                        if (!pos.scaled && c.low < pos.target1) { pos.scaled = true; pos.sl = pos.entry; }
                        const s = Math.min(pos.sl, pos.minP + (c.atr * params.atrMult));
                        if (c.high > s) { const ex = Math.max(c.open, s); allTrades.push({ pnl: pos.entry - ex, returnPercent: (pos.entry - ex) / pos.entry * 100 }); break; }
                    }
                }
            }
        }
        return allTrades;
    }

    runWorker();
}
