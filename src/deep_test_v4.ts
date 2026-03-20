
import { fetchIntradayData } from './backtest/dataFetcher.js';
import * as fs from 'fs';
import * as path from 'path';

const VOLATILE_TICKERS = ["LBTYB","DAWN","AAOI","AXTI","SOC","BW","HIMS","SMX","RCAT","EOSE","CTMX","UMAC","SLDB","ASTI","PL","VIR","CRCL","VG","NUAI","SGML","AMPX","ARRY","ALM","HYMC","IBRX","LITE","NUVB","MDB","PDYN","FLY","UAMY","LUNR","GEMI","CSIQ","TTD","EAF","SMCI","NTSK","ASST","FIGR","ACHC","NVTS","ONDS","NBIS","TE","SEDG","OSS","RDW","BTDR","MARA","BE","PLSE","SHLS","AEVA","DNA","POET","OUST","SEI","WULF","FSLY"];

const INITIAL_CAPITAL = 100000;
const MAX_ALLOC_PER_TRADE = 25000; // 25%
const MAX_CONCURRENT_POS = 4;

interface Trade {
    symbol: string;
    entryTime: string;
    exitTime: string;
    side: 'LONG' | 'SHORT';
    pnl: number;
    returnPct: number;
    wasSwing: boolean;
}

async function startDeepTest() {
    console.log(`💎 DEEP TEST: Elite Sniper v4 (Portfolio Simulation)`);
    console.log(`Port: $${INITIAL_CAPITAL.toLocaleString()} | Alloc: 25% ($${MAX_ALLOC_PER_TRADE}) | Max Pos: ${MAX_CONCURRENT_POS}`);
    console.log(`Universe: 60 Volatile Tickers | Time: 30 Days`);

    const allSignals: any[] = [];
    
    // 1. Gather all potential signals across all tickers
    for (const sym of VOLATILE_TICKERS) {
        const data = await fetchIntradayData(sym, '1mo', '5m');
        if (!data.data || data.data.length < 50) continue;
        const sigs = extractSignals(sym, data.data);
        allSignals.push(...sigs);
    }

    // 2. Sort signals by time to simulate chronological execution
    allSignals.sort((a, b) => new Date(a.entryTime).getTime() - new Date(b.entryTime).getTime());

    // 3. Simulate Portfolio
    let cash = INITIAL_CAPITAL;
    let activePositions: any[] = [];
    const completedTrades: Trade[] = [];

    for (const sig of allSignals) {
        // Update active positions (Exit logic)
        // Note: For simulation simplicity, we process exits before new entries at each signal timestamp
        activePositions = activePositions.filter(p => {
            if (new Date(p.exitTime) <= new Date(sig.entryTime)) {
                cash += p.finalValue;
                completedTrades.push({
                    symbol: p.symbol, entryTime: p.entryTime, exitTime: p.exitTime,
                    side: p.side, pnl: p.pnl, returnPct: p.returnPct, wasSwing: p.wasSwing
                });
                return false;
            }
            return true;
        });

        // Try Entry
        if (activePositions.length < MAX_CONCURRENT_POS && cash >= MAX_ALLOC_PER_TRADE) {
            const qty = Math.floor(MAX_ALLOC_PER_TRADE / sig.entryPrice);
            if (qty > 0) {
                cash -= qty * sig.entryPrice;
                activePositions.push({ ...sig, qty, initialCost: qty * sig.entryPrice });
            }
        }
    }

    // Handle any remaining positions at the very end
    activePositions.forEach(p => {
        completedTrades.push({
            symbol: p.symbol, entryTime: p.entryTime, exitTime: p.exitTime,
            side: p.side, pnl: p.pnl, returnPct: p.returnPct, wasSwing: p.wasSwing
        });
    });

    printResults(completedTrades);
}

function extractSignals(symbol: string, candles: any[]): any[] {
    const days = new Map<string, any[]>();
    candles.forEach(c => { const d = c.date.split('T')[0]; if (!days.has(d)) days.set(d, []); days.get(d)!.push(c); });
    
    const signals: any[] = [];
    const dayKeys = Array.from(days.keys());

    for (let dIdx = 0; dIdx < dayKeys.length; dIdx++) {
        const today = days.get(dayKeys[dIdx])!;
        if (today.length < 21) continue;

        // Indicators (Elite Sniper v4 Zero-Lag)
        const enriched = addEliteIndicators(today);
        const openingRange = enriched.slice(0, 6);
        const rangeHigh = Math.max(...openingRange.map(c => c.high));
        const rangeLow = Math.min(...openingRange.map(c => c.low));
        const avgVol = openingRange.reduce((s, c) => s + c.volume, 0) / 6;

        let entry: any = null;
        for (let i = 20; i < today.length; i++) {
            const c = enriched[i];
            if (!entry) {
                // Entry Logic (6/6 Factor for absolute precision)
                let sL = 0, sS = 0;
                if (c.close > rangeHigh) sL++; if (c.volume > avgVol * 5) sL++; if (c.close > c.vwap) sL++; if (c.rsi < 70) sL++; if (c.cmf > 0) sL++; if (c.isBullish) sL++;
                if (c.close < rangeLow) sS++; if (c.volume > avgVol * 5) sS++; if (c.close < c.vwap) sS++; if (c.rsi > 30) sS++; if (c.cmf < 0) sS++; if (!c.isBullish) sS++;

                if (sL >= 6) entry = { side: 'LONG', price: rangeHigh, time: c.date, sl: rangeLow, maxP: c.high, vwap: c.vwap };
                else if (sS >= 6) entry = { side: 'SHORT', price: rangeLow, time: c.date, sl: rangeHigh, minP: c.low, vwap: c.vwap };
            } else {
                // Exit Logic: No Target, use AGGRESSIVE Trailing Stop
                let exitPrice = 0, reason = '', wasSwing = false;
                const atr = c.atr || (c.high - c.low);

                if (entry.side === 'LONG') {
                    entry.maxP = Math.max(entry.maxP, c.high);
                    const trail = entry.maxP - (atr * 3.5);
                    const currentSL = Math.max(entry.sl, trail);
                    if (c.low <= currentSL) { exitPrice = currentSL; reason = 'TRAILING_STOP'; }
                } else {
                    entry.minP = Math.min(entry.minP, c.low);
                    const trail = entry.minP + (atr * 3.5);
                    const currentSL = Math.min(entry.sl, trail);
                    if (c.high >= currentSL) { exitPrice = currentSL; reason = 'TRAILING_STOP'; }
                }

                if (!exitPrice && i === today.length - 1) {
                    const isBullishHold = entry.side === 'LONG' ? (c.close > entry.vwap && c.close > entry.price * 1.02) : (c.close < entry.vwap && c.close < entry.price * 0.98);
                    if (isBullishHold && dIdx < dayKeys.length - 1) {
                        wasSwing = true;
                        const nextDay = days.get(dayKeys[dIdx + 1])!;
                        exitPrice = nextDay[0].open;
                        reason = 'SWING_HOLD';
                    } else {
                        exitPrice = c.close;
                        reason = 'EOD';
                    }
                }

                if (exitPrice) {
                    const ret = entry.side === 'LONG' ? (exitPrice - entry.price) / entry.price : (entry.price - exitPrice) / entry.price;
                    signals.push({
                        symbol, side: entry.side, entryTime: entry.time, exitTime: c.date,
                        entryPrice: entry.price, exitPrice, returnPct: ret * 100,
                        pnl: MAX_ALLOC_PER_TRADE * ret, wasSwing, finalValue: MAX_ALLOC_PER_TRADE * (1 + ret)
                    });
                    break;
                }
            }
        }
    }
    return signals;
}

function addEliteIndicators(candles: any[]): any[] {
    let cpv = 0, cv = 0, ag = 0, al = 0, trs = 0;
    return candles.map((c, i) => {
        const hlcc = (c.high + c.low + c.close + c.close) / 4; cpv += hlcc * c.volume; cv += c.volume;
        const vwap = cpv / cv;
        if (i > 0) { const d = c.close - candles[i-1].close; ag = (ag*13 + Math.max(0,d))/14; al = (al*13 + Math.max(0,-d))/14; }
        const rsi = 100 - (100/(1+(al===0?100:ag/al)));
        const tr = i===0?(c.high-c.low):Math.max(c.high-c.low, Math.abs(c.high-candles[i-1].close), Math.abs(c.low-candles[i-1].close));
        trs = (trs*13 + tr)/14;
        const atr = trs;
        const isBullish = c.close > ((c.high+c.low)/2 - (3*atr));
        const slice = candles.slice(Math.max(0,i-19), i+1); let mfv = 0, v = 0;
        slice.forEach(s => { const r = s.high-s.low; mfv += (r===0?0:((s.close-s.low)-(s.high-s.close))/r)*s.volume; v += s.volume; });
        return { ...c, vwap, rsi, isBullish, atr, cmf: v===0?0:mfv/v };
    });
}

function printResults(trades: Trade[]) {
    const wins = trades.filter(t => t.pnl > 0);
    const wr = (wins.length / trades.length) * 100;
    const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);
    const avgReturn = totalPnl / trades.length;
    const swings = trades.filter(t => t.wasSwing).length;
    
    // Max DD & Sharpe
    trades.sort((a,b) => new Date(a.entryTime).getTime() - new Date(b.entryTime).getTime());
    let eq = INITIAL_CAPITAL, pk = INITIAL_CAPITAL, mdd = 0;
    const returns: number[] = [];
    trades.forEach(t => { eq += t.pnl; if (eq > pk) pk = eq; mdd = Math.max(mdd, (pk-eq)/pk * 100); returns.push(t.pnl / INITIAL_CAPITAL); });

    const avgR = (eq - INITIAL_CAPITAL) / INITIAL_CAPITAL / trades.length;
    const std = Math.sqrt(returns.reduce((s,r) => s + Math.pow(r-avgR, 2), 0) / (trades.length - 1));
    const sharpe = std > 0 ? (avgR / std) * Math.sqrt(trades.length) : 0;

    console.log(`\n=== 💎 FINAL DEEP TEST RESULTS (Elite Sniper v4) ===`);
    console.log(`Total Trades: ${trades.length} | Swing Holds: ${swings}`);
    console.log(`Win Rate: ${wr.toFixed(2)}%`);
    console.log(`Total Profit: $${totalPnl.toLocaleString(undefined, {minimumFractionDigits: 2})}`);
    console.log(`Final Portfolio Value: $${(INITIAL_CAPITAL + totalPnl).toLocaleString()}`);
    console.log(`Real Simulated Return: ${((totalPnl / INITIAL_CAPITAL)*100).toFixed(2)}%`);
    console.log(`Max Drawdown: ${mdd.toFixed(2)}%`);
    console.log(`Sharpe Ratio: ${sharpe.toFixed(2)}`);
    console.log(`\n🏆 TOP 5 WINNERS:`);
    trades.sort((a,b) => b.pnl - a.pnl).slice(0, 5).forEach(t => {
        console.log(`   ${t.symbol} ${t.side}: +$${t.pnl.toFixed(2)} (${t.returnPct.toFixed(2)}%) | Swing: ${t.wasSwing}`);
    });
}

startDeepTest();
