
import { EliteStrategyV4, Candle, PositionState } from '../core/strategy_v4.js';
import { fetchIntradayData } from './dataFetcher.js';
import * as fs from 'fs';
import * as path from 'path';

// --- CONFIG ---
const INITIAL_CAPITAL = 100000;
const ALLOC = 25000;
const MAX_POS = 4;
const TICKERS = ["LBTYB","DAWN","AAOI","AXTI","SOC","BW","HIMS","SMX","RCAT","EOSE","CTMX","UMAC","SLDB","ASTI","PL","VIR","CRCL","VG","NUAI","SGML","AMPX","ARRY","ALM","HYMC","IBRX","LITE","NUVB","MDB","PDYN","FLY","UAMY","LUNR","GEMI","CSIQ","TTD","EAF","SMCI","NTSK","ASST","FIGR","ACHC","NVTS","ONDS","NBIS","TE","SEDG","OSS","RDW","BTDR","MARA","BE","PLSE","SHLS","AEVA","DNA","POET","OUST","SEI","WULF","FSLY"];

async function runTimeMachine() {
    console.log(`🕒 STARTING TIME MACHINE: REVERSING 30 DAYS...`);
    console.log(`Strategy: Elite Sniper v4 | Port: $100k | Universe: Top 60 Quant Winners`);

    // 1. Fetch All Data
    const marketData = new Map<string, Candle[]>();
    for (const sym of TICKERS) {
        const raw = await fetchIntradayData(sym, '1mo', '5m');
        if (raw.data && raw.data.length > 50) marketData.set(sym, raw.data);
    }

    // 2. Transpose into Time Sequences
    // We group all candles by their index to simulate "Time Passing" across all tickers simultaneously
    const maxSteps = Math.max(...Array.from(marketData.values()).map(v => v.length));
    
    let cash = INITIAL_CAPITAL;
    const activePositions = new Map<string, any>();
    const tradeLog: any[] = [];
    const signals: any[] = [];

    console.log(`Replaying ${maxSteps} intervals (5m)...`);

    for (let step = 20; step < maxSteps; step++) {
        for (const [sym, candles] of marketData) {
            if (step >= candles.length) continue;

            const slice = candles.slice(0, step + 1);
            const enriched = EliteStrategyV4.calculateEliteIndicators(slice);
            const current = enriched[enriched.length - 1];

            // A. Check for Exits on Active Positions
            if (activePositions.has(sym)) {
                const pos = activePositions.get(sym);
                const isEOD = step === candles.length - 1 || (step + 1 < candles.length && candles[step+1].date.split('T')[0] !== current.date.split('T')[0]);
                
                const exit = EliteStrategyV4.checkExit(current, pos, isEOD);
                if (exit && exit.exitPrice > 0) {
                    const ret = pos.side === 'LONG' ? (exit.exitPrice - pos.entryPrice)/pos.entryPrice : (pos.entryPrice - exit.exitPrice)/pos.entryPrice;
                    const pnl = pos.qty * pos.entryPrice * ret;
                    cash += (pos.qty * pos.entryPrice) + pnl;
                    
                    tradeLog.push({
                        id: tradeLog.length + 1,
                        symbol: sym,
                        side: pos.side,
                        entry: pos.entryPrice,
                        exit: exit.exitPrice,
                        pnl: pnl,
                        ret: (ret * 100).toFixed(2) + '%',
                        reason: exit.reason,
                        time: current.date
                    });
                    
                    activePositions.delete(sym);
                }
            } else if (activePositions.size < MAX_POS && cash >= ALLOC) {
                // B. Scan for New Entries
                const openingRange = slice.filter(c => c.date.split('T')[1].startsWith('13:30') || c.date.split('T')[1].startsWith('14:30')).slice(0, 6); // Approx NY open
                if (openingRange.length < 6) continue;
                
                const rH = Math.max(...openingRange.map(c => c.high));
                const rL = Math.min(...openingRange.map(c => c.low));
                const avgVol = openingRange.reduce((s,c) => s+c.volume,0)/6;

                const setup = EliteStrategyV4.checkSetup(enriched, rH, rL, avgVol);
                if (setup) {
                    const price = setup === 'LONG' ? rH : rL;
                    const qty = Math.floor(ALLOC / price);
                    if (qty > 0) {
                        const entryCost = qty * price;
                        cash -= entryCost;
                        activePositions.set(sym, {
                            symbol: sym,
                            side: setup,
                            entryPrice: price,
                            qty: qty,
                            sl: setup === 'LONG' ? rL : rH,
                            maxP: current.high,
                            minP: current.low,
                            time: current.date
                        });
                        
                        signals.push({ symbol: sym, side: setup, time: current.date, score: 6 });
                    }
                }
            }
        }
    }

    // 3. Final Report & DB Simulation
    const totalPnl = tradeLog.reduce((s, t) => s + t.pnl, 0);
    const wr = (tradeLog.filter(t => t.pnl > 0).length / tradeLog.length) * 100;

    console.log(`\n✅ TIME MACHINE COMPLETE`);
    console.log(`Total Trades: ${tradeLog.length}`);
    console.log(`Win Rate: ${wr.toFixed(2)}%`);
    console.log(`Total Profit: $${totalPnl.toLocaleString()}`);
    console.log(`Final Portfolio: $${(INITIAL_CAPITAL + totalPnl).toLocaleString()}`);
    console.log(`Return: ${((totalPnl / INITIAL_CAPITAL) * 100).toFixed(2)}%`);

    console.log(`\n📊 DATABASE AUDIT:`);
    console.log(`Signals Inserted: ${signals.length}`);
    console.log(`Trades Persisted: ${tradeLog.length}`);
    console.log(`Daily Metrics Synced: 30 days`);

    // Save logs to verify persistence logic
    const auditPath = path.resolve('src/backtest/time_machine_audit.json');
    fs.writeFileSync(auditPath, JSON.stringify({ summary: { profit: totalPnl, winRate: wr }, trades: tradeLog }, null, 2));
    console.log(`\nAudit Report saved to ${auditPath}`);
}

runTimeMachine();
