
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { fetchIntradayData, addIndicators, addAdvancedIndicators } from './dataFetcher.js';

const VOLATILE_TICKERS = [
    "NVDA", "AMZN", "INTC", "ADT", "SNAP", "STLA", "ONDS", "MARA", "IREN", "BMNR",
    "SOFI", "KVUE", "TSLA", "PLTR", "STKL", "MSTR", "GOOGL", "AAL", "F", "HOOD",
    "AMD", "MSFT", "NU", "PFE", "ACHR", "AAPL", "SMCI", "WULF", "HIMS", "NFLX",
    "APLD", "CPNG", "BAC", "CFLT", "CLSK", "RIG", "SMX", "QBTS", "T", "OWL",
    "MU", "RGTI", "CRWV", "VZ", "PYPL", "BSX", "NOW", "NXE", "PATH", "RBLX",
    "GOOG", "WBD", "JOBY", "CIEN", "AVGO", "LUMN", "IONQ", "SMR", "SOUN", "RIVN"
];

interface Params {
    volFilter: number;
    atrTrail: number; 
    tpMultiplier: number; 
    minScore: number;
    rangeMax: number;
}

interface Result {
    params: Params;
    winRate: number;
    avgReturn: number;
    trades: number;
    sharpe: number;
    maxDD: number;
}

if (isMainThread) {
    // TREND RUNNER GRID SEARCH (TARGETING 5%+)
    const VOL_FILTERS = [3.0, 5.0];
    const ATR_TRAILS = [2.0, 4.0, 6.0];
    const TP_MULTS = [5.0, 10.0, 20.0]; // Targeting large runners
    const MIN_SCORES = [5]; 
    const RANGE_MAXS = [0.08, 0.12];

    const grid: Params[] = [];
    for (const volFilter of VOL_FILTERS) 
    for (const atrTrail of ATR_TRAILS)
    for (const tpMultiplier of TP_MULTS)
    for (const minScore of MIN_SCORES)
    for (const rangeMax of RANGE_MAXS) {
        grid.push({ volFilter, atrTrail, tpMultiplier, minScore, rangeMax });
    }

    console.log(`🚀 Starting REAL-WORLD Trend Runner Optimizer on ${os.cpus().length} cores...`);
    console.log(`Grid Size: ${grid.length} combinations | Focus Universe: ${VOLATILE_TICKERS.length} tickers`);
    console.log(`Goal: Avg Return > 5% on live bot universe`);

    const numWorkers = os.cpus().length;
    const tickersPerWorker = Math.ceil(VOLATILE_TICKERS.length / numWorkers);
    
    let finishedWorkers = 0;
    const allResults: Result[] = [];

    for (let i = 0; i < numWorkers; i++) {
        const start = i * tickersPerWorker;
        const end = Math.min(start + tickersPerWorker, VOLATILE_TICKERS.length);
        const workerTickers = VOLATILE_TICKERS.slice(start, end);

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
        const summary = new Map<string, { winRate: number, avgReturn: number, trades: number, sharpe: number, maxDD: number, count: number }>();
        results.forEach(res => {
            const key = JSON.stringify(res.params);
            if (!summary.has(key)) summary.set(key, { winRate: 0, avgReturn: 0, trades: 0, sharpe: 0, maxDD: 0, count: 0 });
            const s = summary.get(key)!;
            s.winRate += res.winRate; s.avgReturn += res.avgReturn; s.trades += res.trades; s.sharpe += res.sharpe; s.maxDD += res.maxDD; s.count++;
        });

        const final: Result[] = [];
        summary.forEach((s, key) => final.push({ params: JSON.parse(key), winRate: s.winRate / s.count, avgReturn: s.avgReturn / s.count, trades: s.trades, sharpe: s.sharpe / s.count, maxDD: s.maxDD / s.count }));
        
        // SORT BY AVERAGE RETURN
        final.sort((a, b) => b.avgReturn - a.avgReturn);

        console.log('\n=== 💎 Top High-Yield "Trend Runner" Results (Real Universe) ===');
        final.slice(0, 10).forEach((f, i) => {
            console.log(`${i+1}. Avg: ${f.avgReturn.toFixed(2)}% | WR: ${f.winRate.toFixed(2)}% | Sharpe: ${f.sharpe.toFixed(2)} | Trades: ${f.trades}`);
            console.log(`   Params: ${JSON.stringify(f.params)}`);
        });
    }

} else {
    // WORKER LOGIC
    const { tickers, grid } = workerData;
    const workerResults: Result[] = [];

    async function runWorker() {
        for (const params of grid) {
            let tT = 0, tW = 0, tR = 0;
            const returns: number[] = [];
            let maxDD = 0, eq = 0, pk = 0;

            for (const sym of tickers) {
                const raw1 = await fetchIntradayData(sym, '1mo', '5m');
                const raw2 = addIndicators(raw1.data);
                const data = { ...raw1, data: addAdvancedIndicators(raw2) };
                
                const trades = backtestTicker(data, params);
                tT += trades.length;
                tW += trades.filter(t => t.pnl > 0).length;
                tR += trades.reduce((s, t) => s + t.returnPercent, 0);
                trades.forEach(t => { returns.push(t.returnPercent); eq += t.returnPercent; if (eq > pk) pk = eq; if (pk - eq > maxDD) maxDD = pk - eq; });
            }

            if (tT > 0) { 
                const winRate = (tW / tT) * 100;
                const avgReturn = tR / tT;
                const variance = returns.reduce((s, r) => s + Math.pow(r - avgReturn, 2), 0) / (returns.length - 1);
                const stdDev = Math.sqrt(variance);
                const sharpe = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(tT / 30) : 0;
                workerResults.push({ params, winRate, avgReturn, trades: tT, sharpe, maxDD });
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
            if (candles.length < 21) continue;
            let isGap = false;
            const openGap = (candles[0].open - prevClose) / prevClose;
            if (prevClose > 0 && Math.abs(openGap) > 0.005) isGap = true;
            prevClose = candles[candles.length - 1].close;
            if (!isGap && prevClose > 0) continue;

            const openingRange = candles.slice(0, 6);
            const rangeHigh = Math.max(...openingRange.map((c: any) => c.high));
            const rangeLow = Math.min(...openingRange.map((c: any) => c.low));
            const rangeHeight = rangeHigh - rangeLow;
            const avgOpVol = openingRange.reduce((s, c) => s + c.volume, 0) / 6;

            let pos: any = null;
            for (let i = 20; i < candles.length; i++) {
                const c = candles[i];
                if (!pos) {
                    const volReq = c.volume > avgOpVol * params.volFilter;
                    let sl = 0, ss = 0;
                    if (c.high > rangeHigh) sl++; if (volReq) sl++; if (c.close > c.vwap) sl++; if (c.rsi < 70) sl++; if (c.cmf > 0) sl++; if (c.isBullish) sl++;
                    if (c.low < rangeLow) ss++; if (volReq) ss++; if (c.close < c.vwap) ss++; if (c.rsi > 30) ss++; if (c.cmf < 0) ss++; if (!c.isBullish) ss++;

                    if (sl >= params.minScore) pos = { side: 'LONG', entry: rangeHigh, sl: rangeLow, target: rangeHigh + (rangeHeight * params.tpMultiplier), maxP: c.high };
                    else if (ss >= params.minScore) pos = { side: 'SHORT', entry: rangeLow, sl: rangeHigh, target: rangeLow - (rangeHeight * params.tpMultiplier), minP: c.low };
                } else {
                    if (pos.side === 'LONG') {
                        pos.maxP = Math.max(pos.maxP, c.high);
                        const trailPrice = pos.maxP - (c.atr * params.atrTrail);
                        const exitLevel = Math.max(pos.sl, trailPrice);
                        if (c.low < exitLevel || c.high > pos.target) {
                            const actualExit = c.high > pos.target ? pos.target : Math.min(c.open, exitLevel);
                            allTrades.push({ pnl: actualExit - pos.entry, returnPercent: (actualExit - pos.entry) / pos.entry * 100 });
                            break;
                        }
                    } else {
                        pos.minP = Math.min(pos.minP, c.low);
                        const trailPrice = pos.minP + (c.atr * params.atrTrail);
                        const exitLevel = Math.min(pos.sl, trailPrice);
                        if (c.high > exitLevel || c.low < pos.target) {
                            const actualExit = c.low < pos.target ? pos.target : Math.max(c.open, exitLevel);
                            allTrades.push({ pnl: pos.entry - actualExit, returnPercent: (pos.entry - actualExit) / pos.entry * 100 });
                            break;
                        }
                    }
                }
            }
        }
        return allTrades;
    }

    runWorker();
}
