
import * as fs from 'fs';
import * as path from 'path';
import yahooFinance2 from 'yahoo-finance2';
const yahooFinance = new (yahooFinance2 as any)();

// Self-contained MonteCarloEngine to avoid import side-effects
class MonteCarloEngine {
    static boxMuller() {
        let u = 0, v = 0;
        while(u === 0) u = Math.random();
        while(v === 0) v = Math.random();
        return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    }

    static runSimulation(candles: any[], steps = 5, paths = 1000): any | null {
        if (!candles || candles.length < 10) return null;
        const returns = [];
        for (let i = 1; i < candles.length; i++) {
            const ret = Math.log(candles[i].close / candles[i-1].close);
            returns.push(ret);
        }
        const n = returns.length;
        if (n < 2) return null;
        const mean = returns.reduce((a,b)=>a+b,0)/n;
        const variance = returns.reduce((a,b)=>a+Math.pow(b-mean,2),0)/(n-1);
        const std = Math.sqrt(variance);

        const finalReturns: number[] = [];
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
const ALL_TICKERS = JSON.parse(fs.readFileSync(UNIVERSE_PATH, 'utf-8'));

async function fetchHistory(symbol: string): Promise<any[]> {
    try {
        const result = await yahooFinance.chart(symbol, {
            period1: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
            interval: '1d'
        });
        return result.quotes || [];
    } catch (e) {
        return [];
    }
}

async function runAudit() {
    process.on('unhandledRejection', (reason) => {
        // console.error('Caught Unhandled Rejection:', reason);
    });

    console.log(`📊 "INSTITUTIONAL AUDIT" v1 (30-Day Performance)`);
    console.log(`Auditing 200 Representative Tickers...`);

    let totalPnL = 0;
    let wins = 0;
    let losses = 0;
    let tradesCount = 0;
    let equity = 100000;
    let maxDrawdown = 0;
    let peekEquity = 100000;

    const BATCH_SIZE = 50;
    const LIMIT = 50; // ONLY MEGA-CAPS

    const thresholds = [0.3, 0.6, 1.0];
    const scores = [10, 5, 3];

    for (const t_thresh of thresholds) {
        for (const s_thresh of scores) {
            let pnl = 100000;
            let w = 0, l = 0, tc = 0;

            for (let i = 0; i < LIMIT; i += BATCH_SIZE) {
                const batch = ALL_TICKERS.slice(i, i + BATCH_SIZE);
                await Promise.all(batch.map(async (symbol: string) => {
                    const quotes = await fetchHistory(symbol);
                    if (quotes.length < 50) return;
                    for (let t = quotes.length - 21; t < quotes.length - 2; t++) {
                        const lookback = quotes.slice(t - 20, t).map(q => ({ close: q.close }));
                        const sim = MonteCarloEngine.runSimulation(lookback);
                        
                        const tradeSharpe = sim ? sim.meanBranch / (sim.score || 1) : 0;

                        if (sim && tradeSharpe > 0.2) { // 0.2 Sharpe per Trade
                            // Strategy: BUY OPEN (T+1), Bracket Exit
                            const entry = quotes[t+1].open;
                            const high = quotes[t+1].high;
                            const low = quotes[t+1].low;
                            const close = quotes[t+1].close;
                            if (!entry || !high || !low) continue;

                            let tradeReturn = (close - entry) / entry;
                            
                            // 1.0% STOP LOSS / 5% TAKE PROFIT Brackets
                            if ((low - entry) / entry < -0.010) {
                                tradeReturn = -0.010;
                            } else if ((high - entry) / entry > 0.05) {
                                tradeReturn = 0.05;
                            }

                            pnl *= (1 + tradeReturn * 0.25);
                            if (tradeReturn > 0) w++; else l++;
                            tc++;
                        }
                    }
                }));
            }
            if (tc > 5) {
                console.log(`[SWING SWEEP] Thresh: ${t_thresh} | Score: ${s_thresh} | trades: ${tc} | Win: ${((w/tc)*100).toFixed(1)}% | Return: ${((pnl-100000)/1000).toFixed(2)}%`);
            }
        }
    }
}

runAudit();
