
import fs from 'fs';
import path from 'path';
import YahooFinance from 'yahoo-finance2';
const yahooFinance = new YahooFinance();

console.log('🚀 Super-Alpha Leveraged Optimizer (90-Day MSTR/NVDA) Starting...');

class MonteCarloEngine {
    static boxMuller() {
        let u = 0, v = 0;
        while(u === 0) u = Math.random();
        while(v === 0) v = Math.random();
        return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    }

    static runSimulation(candles, steps = 5, paths = 1000) {
        if (!candles || candles.length < 10) return null;
        const returns = [];
        for (let i = 1; i < candles.length; i++) {
            const ret = Math.log(candles[i].close / (candles[i-1].close || candles[i].close));
            if (!isNaN(ret)) returns.push(ret);
        }
        const n = returns.length;
        if (n < 2) return null;
        const mean = returns.reduce((a,b)=>a+b,0)/n;
        const variance = returns.reduce((a,b)=>a+Math.pow(b-mean,2),0)/(n-1);
        const std = Math.sqrt(variance);

        const finalReturns = [];
        for (let p = 0; p < paths; p++) {
            let logRetSum = 0;
            for (let s = 0; s < steps; s++) {
                const z = this.boxMuller();
                logRetSum += (mean - 0.5 * std * std) + std * z;
            }
            finalReturns.push(Math.exp(logRetSum) - 1);
        }
        finalReturns.sort((a,b)=>a-b);
        const ub = (finalReturns[Math.floor(paths * 0.95)] || 0) * 100;
        const lb = (finalReturns[Math.floor(paths * 0.05)] || 0) * 100;
        const avg = ((finalReturns.reduce((a,b)=>a+b,0)/paths) || 0) * 100;
        return { upperBranch: ub, lowerBranch: lb, meanBranch: avg, score: ub - lb };
    }
}

async function main() {
    try {
        const history = {};
        for (const sym of ['MSTR', 'NVDA']) {
            const res = await yahooFinance.chart(sym, { period1: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString(), interval: '1d' });
            history[sym] = (res.quotes || []).filter(x => x && x.open && x.close);
        }

        const drifts = [1.0, 1.5, 2.0];
        const holds = [3, 5];
        let best = { profit: 0, wr: 0, params: null };

        for (const d of drifts) {
            for (const h of holds) {
                let eq = 100000;
                let w = 0, tc = 0;

                for (const sym of ['MSTR', 'NVDA']) {
                    const q = history[sym];
                    for (let t = q.length - 80; t < q.length - h - 1; t++) {
                        if (t < 20) continue;
                        const lookback = q.slice(t - 20, t).map(x => ({ close: x.close }));
                        const sim = MonteCarloEngine.runSimulation(lookback, h);
                        if (!sim) continue;

                        if (sim.meanBranch > d && sim.score < 20) {
                            const entry = q[t+1].open;
                            const exit = q[t+h+1].close;
                            const r = (exit - entry) / entry;
                            eq += eq * 2.0 * r; // 2x Leverage
                            if (r > 0) w++;
                            tc++;
                        }
                    }
                }

                const wr = (tc > 5) ? (w / tc) * 100 : 0;
                const profit = eq - 100000;
                if (wr > 70 && profit > best.profit) {
                    best = { profit, wr, params: { d, h } };
                }
            }
        }

        console.log(`\n🏆 BEST LEVERAGED CONFIG (90-DAY):`);
        if (best.params) {
            console.log(`Profit: $${best.profit.toLocaleString()}`);
            console.log(`Win Rate: ${best.wr.toFixed(1)}%`);
            console.log(`Params: Drift > ${best.params.d}% | Hold: ${best.params.h}d | Lever: 2x`);
        } else {
            console.log(`❌ No config met >70% WR in last 90 days for Leveraged Alpha.`);
        }
    } catch (e) {
        console.error('Fatal:', e);
    }
}

main();
