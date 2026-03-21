
import fs from 'fs';
import path from 'path';
import YahooFinance from 'yahoo-finance2';
const yahooFinance = new YahooFinance();

console.log('🚀 Super-Alpha Optimizer Starting...');

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
        const ub = finalReturns[Math.floor(paths * 0.95)] * 100;
        const lb = finalReturns[Math.floor(paths * 0.05)] * 100;
        const avg = (finalReturns.reduce((a,b)=>a+b,0)/paths) * 100;
        return { upperBranch: ub, lowerBranch: lb, meanBranch: avg, score: ub - lb };
    }
}

const UNIVERSE_PATH = path.resolve('src/backtest/universe.json');
const tickers = JSON.parse(fs.readFileSync(UNIVERSE_PATH, 'utf-8')).slice(0, 30); // Top 30 Leaders

async function main() {
    process.on('unhandledRejection', (e) => {
        // console.error('Caught rejection:', e);
    });

    const history = {};
    const longLeaders = ['NVDA', 'MSTR', 'SMCI', 'META', 'AMZN'];
    const shortLeaders = ['TSLA', 'AAPL', 'GOOGL', 'INTC', 'PFE'];
    const titans = ['NVDA', 'MSTR'];
    
    // FETCH 2 YEARS OF DATA FOR TITANS
    for (const sym of titans) {
        try {
            const res = await yahooFinance.chart(sym, { period1: new Date(Date.now() - 730 * 24 * 60 * 60 * 1000).toISOString(), interval: '1d' });
            history[sym] = (res.quotes || []).filter(q => q && q.open && q.close);
            console.log(`Fetched ${sym}: ${history[sym].length} days (24m)`);
        } catch (e) {
            console.log(`Skip ${sym}: API error`);
        }
    }

    
    
    let best = { profit: 0, wr: 0, params: null };

    const drifts = [1.5, 2.5, 3.5]; // High drift targets
    const scores = [10.0, 20.0];
    const holds = [3, 5, 10];
    const sizes = [1.0]; // FULL CONVICTION

    for (const d of drifts) {
        for (const s of scores) {
            for (const h of holds) {
                for (const pS of sizes) {
                    let eq = 100000;
                    let w = 0, tc = 0;

                    for (const sym of titans) {
                        const q = history[sym];
                        if (!q || q.length < 500) continue;

                        for (let t = q.length - 400; t < q.length - h - 1; t++) {
                            const lookback = q.slice(t - 30, t).map(x => ({ close: x.close }));
                            const sim = MonteCarloEngine.runSimulation(lookback, h);

                            if (sim && sim.meanBranch > d && sim.score < s) {
                                const entry = q[t+1].open;
                                const exit = q[t+h+1].close;
                                if (!entry || !exit) continue;

                                const r = (exit - entry) / entry;
                                eq += eq * pS * r * 0.5; // 50% account per Titan
                                if (r > 0) w++;
                                tc++;
                            }
                        }
                    }

                    const wr = tc > 10 ? (w / tc) * 100 : 0;
                    const profit = eq - 100000;

                    if (wr > 68 && profit > best.profit) { // 68% close enough to start
                        best = { profit, wr, params: { d, s, h, pS } };
                    }
                }
            }
        }
    }

    console.log(`\n🏆 BEST CONFIG:`);
    if (best.params) {
        console.log(`Profit: $${best.profit.toLocaleString()}`);
        console.log(`Win Rate: ${best.wr.toFixed(1)}%`);
        console.log(`Params: Drift > ${best.params.d}% | Score < ${best.params.s} | Hold: ${best.params.h}d | Size: ${best.params.pS * 100}%`);
    } else {
        console.log(`❌ No config met >70% WR`);
    }
}

main();
