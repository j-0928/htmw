
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { fetchIntradayData } from './dataFetcher.js';

const UNIVERSE_PATH = path.resolve('src/backtest/universe.json');
const ALL_TICKERS = JSON.parse(fs.readFileSync(UNIVERSE_PATH, 'utf-8'));

interface TickerResult {
    symbol: string;
    totalProfitPct: number;
    winRate: number;
    trades: number;
    swings: number;
}

if (isMainThread) {
    console.log(`🚀 Ticker Optimizer v4: Ranking 1000 Tickers for High-Yield Elite Sniper...`);
    const numWorkers = os.cpus().length;
    const tickersPerWorker = Math.ceil(ALL_TICKERS.length / numWorkers);

    let finishedCount = 0;
    const aggregateResults: TickerResult[] = [];

    for (let i = 0; i < numWorkers; i++) {
        const start = i * tickersPerWorker;
        const end = Math.min(start + tickersPerWorker, ALL_TICKERS.length);
        const batch = ALL_TICKERS.slice(start, end);

        const worker = new Worker(fileURLToPath(import.meta.url), {
            workerData: { tickers: batch }
        });

        worker.on('message', (res: TickerResult[]) => aggregateResults.push(...res));
        worker.on('error', (err) => console.error(`Worker error:`, err));
        worker.on('exit', () => {
            finishedCount++;
            if (finishedCount === numWorkers) printTopTickers(aggregateResults);
        });
    }

    function printTopTickers(results: TickerResult[]) {
        const filtered = results.filter(r => r.trades >= 2);
        filtered.sort((a,b) => b.totalProfitPct - a.totalProfitPct);

        console.log(`\n💎 TOP 100 "TREND RUNNER" TICKERS (Phase 4 Logic)`);
        console.log(`Universe Size: ${ALL_TICKERS.length} | Scanned: ${results.length} | Active Candidates: ${filtered.length}`);
        
        const top100 = filtered.slice(0, 100);
        console.table(top100.slice(0, 40).map(r => ({
            Symbol: r.symbol,
            'Profit %': r.totalProfitPct.toFixed(2) + '%',
            'Win %': r.winRate.toFixed(2) + '%',
            Trades: r.trades,
            Swings: r.swings
        })));

        const final60 = top100.slice(0, 60).map(r => r.symbol);
        console.log(`\n🚀 SUGGESTED VOLATILE_TICKERS (Copy this):`);
        console.log(JSON.stringify(final60));
    }

} else {
    // WORKER
    const { tickers } = workerData;
    const workerResults: TickerResult[] = [];

    async function runWorker() {
        for (const sym of tickers) {
            try {
                // Rate limit slightly to avoid file system / API congestion
                await new Promise(r => setTimeout(r, 50)); 
                const raw = await fetchIntradayData(sym, '1mo', '5m');
                if (!raw || !raw.data || raw.data.length < 50) continue;
                
                const res = simulateTicker(sym, raw.data);
                if (res) workerResults.push(res);
            } catch (e) { /* skip */ }
        }
        parentPort?.postMessage(workerResults);
    }

    function simulateTicker(symbol: string, data: any[]): TickerResult | null {
        const days = new Map<string, any[]>();
        data.forEach(c => { const d = c.date.split('T')[0]; if (!days.has(d)) days.set(d, []); days.get(d)!.push(c); });
        const dayKeys = Array.from(days.keys());

        let totalProfitPct = 0, wins = 0, tradeCount = 0, swingCount = 0;

        for (let dIdx = 0; dIdx < dayKeys.length; dIdx++) {
            const today = days.get(dayKeys[dIdx])!;
            if (today.length < 21) continue;

            const enriched = addEliteIndicators(today);
            const openingRange = enriched.slice(0, 6);
            const rH = Math.max(...openingRange.map(c => c.high));
            const rL = Math.min(...openingRange.map(c => c.low));
            const avgVol = openingRange.reduce((s,c) => s+c.volume, 0)/6;

            let entry: any = null;
            for (let i = 20; i < today.length; i++) {
                const c = enriched[i];
                if (!entry) {
                    let sL=0, sS=0;
                    if (c.close > rH) sL++; if (c.volume > avgVol*2.5) sL++; if (c.close > c.vwap) sL++; if (c.rsi < 70) sL++; if (c.cmf > -0.1) sL++; if (c.isBullish) sL++;
                    if (c.close < rL) sS++; if (c.volume > avgVol*2.5) sS++; if (c.close < c.vwap) sS++; if (c.rsi > 30) sS++; if (c.cmf < 0.1) sS++; if (!c.isBullish) sS++;

                    if (sL >= 5) entry = { side: 'LONG', p: rH, sl: rL, maxP: c.high, vwap: c.vwap };
                    else if (sS >= 5) entry = { side: 'SHORT', p: rL, sl: rH, minP: c.low, vwap: c.vwap };
                } else {
                    let exitPrice = 0, wasSwing = false;
                    const atr = c.atr || (c.high - c.low);
                    if (entry.side === 'LONG') {
                        entry.maxP = Math.max(entry.maxP, c.high);
                        const curSL = Math.max(entry.sl, entry.maxP - (atr * 3.5));
                        if (c.low <= curSL) exitPrice = curSL;
                    } else {
                        entry.minP = Math.min(entry.minP, c.low);
                        const curSL = Math.min(entry.sl, entry.minP + (atr * 3.5));
                        if (c.high >= curSL) exitPrice = curSL;
                    }

                    if (!exitPrice && i === today.length - 1) {
                        const isB = entry.side === 'LONG' ? (c.close > entry.vwap && c.close > entry.p * 1.02) : (c.close < entry.vwap && c.close < entry.p * 0.98);
                        if (isB && dIdx < dayKeys.length - 1) {
                            wasSwing = true;
                            const nextDay = days.get(dayKeys[dIdx + 1])!;
                            exitPrice = nextDay[0].open;
                        } else exitPrice = c.close;
                    }

                    if (exitPrice) {
                        const ret = entry.side === 'LONG' ? (exitPrice - entry.p)/entry.p : (entry.p - exitPrice)/entry.p;
                        totalProfitPct += ret * 100;
                        tradeCount++;
                        if (ret > 0) wins++;
                        if (wasSwing) swingCount++;
                        break;
                    }
                }
            }
        }
        return tradeCount > 0 ? { symbol, totalProfitPct, winRate: (wins/tradeCount)*100, trades: tradeCount, swings: swingCount } : null;
    }

    function addEliteIndicators(candles: any[]): any[] {
        let cpv = 0, cv = 0, ag = 0, al = 0, trs = 0;
        return candles.map((c, i) => {
            const h = (c.high+c.low+c.close+c.close)/4; cpv += h*c.volume; cv += c.volume;
            if (i > 0) { const d = c.close - (candles[i-1]?.close||c.close); ag = (ag*13 + Math.max(0,d))/14; al = (al*13 + Math.max(0,-d))/14; }
            const tr = i===0?(c.high-c.low):Math.max(c.high-c.low, Math.abs(c.high-(candles[i-1]?.close||c.close)), Math.abs(c.low-(candles[i-1]?.close||c.close)));
            trs = (trs*13 + tr)/14;
            return { ...c, vwap: cpv/cv, rsi: 100-(100/(1+(al===0?100:ag/al))), atr: trs, isBullish: c.close > ((c.high+c.low)/2 - (3*trs)), cmf: 0 };
        });
    }

    runWorker();
}
