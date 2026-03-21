
import * as fs from 'fs';
import * as path from 'path';
import { fetchIntradayData } from './backtest/dataFetcher.js';
import { fileURLToPath } from 'url';
import type { ApiClient } from './api.js';
import { executeTrade } from './tools/executeTrade.js';
import { getPortfolio } from './tools/getPortfolio.js';
import { db, initDb } from './db/index.js';
import { trades, signals, dailyMetrics } from './db/schema.js';
import { eq, and, sql, desc } from 'drizzle-orm';
import { EliteStrategyV4, Candle, PositionState } from './core/strategy_v4.js';
import { watchlist as watchlistTable } from './db/schema.js';

// --- CONFIG ---
const VOLATILE_TICKERS = ["LBTYB","DAWN","AAOI","AXTI","SOC","BW","HIMS","SMX","RCAT","EOSE","CTMX","UMAC","SLDB","ASTI","PL","VIR","CRCL","VG","NUAI","SGML","AMPX","ARRY","ALM","HYMC","IBRX","LITE","NUVB","MDB","PDYN","FLY","UAMY","LUNR","GEMI","CSIQ","TTD","EAF","SMCI","NTSK","ASST","FIGR","ACHC","NVTS","ONDS","NBIS","TE","SEDG","OSS","RDW","BTDR","MARA","BE","PLSE","SHLS","AEVA","DNA","POET","OUST","SEI","WULF","FSLY"];
const MAX_POS_PCT = 0.25; 
const MAX_OPEN_TRADES = 10;
// --------------

interface Position {
    symbol: string;
    side: 'LONG' | 'SHORT';
    entryPrice: number;
    quantity: number;
    initialQty: number; 
    stopLoss: number;
    target1: number; 
    timestamp: string;
    status: 'OPEN' | 'CLOSED';
    scaledOut: boolean;
    pnl?: number;
    rangeHeight: number;
}

export async function runTradeBot(api: ApiClient, afterHours: boolean = false): Promise<string> {
    const output: string[] = [];
    const log = (msg: string) => {
        output.push(msg);
        console.error(`[TRADE BOT] ${msg}`);
    };

    log(`--- 🤖 ELITE SNIPER v4 (${afterHours ? 'AFTER HOURS ALPHA' : 'MARKET OPEN'}) ---`);
    await initDb();
    
    if (afterHours) {
        return await runAfterHoursAnalysis(api, log);
    }

    // 1. Fetch LIVE portfolio
    let cashAvailable = 100000;
    const heldSymbols = new Set<string>();
    let portfolioPositions: any[] = [];

    try {
        const portfolio = await getPortfolio(api);
        cashAvailable = portfolio.buyingPower || portfolio.cashBalance || 100000;
        portfolioPositions = portfolio.positions || [];
        portfolioPositions.forEach((pos: any) => {
            if (pos.symbol) heldSymbols.add(pos.symbol.toUpperCase());
        });
        log(`💰 Cash Available: $${cashAvailable.toFixed(2)} | Portfolio Value: $${(portfolio.portfolioValue || 100000).toFixed(2)}`);
    } catch (e) {
        log(`⚠️ Could not fetch portfolio, using defaults.`);
    }

    // 2. Sync DB with Account (Manage Open Positions)
    const dbOpenTrades = await db.select().from(trades).where(eq(trades.status, 'OPEN'));
    log(`Checking ${dbOpenTrades.length} active trades in DB...`);

    for (const trade of dbOpenTrades) {
        if (!heldSymbols.has(trade.symbol.toUpperCase())) {
            log(`⚠️ ${trade.symbol} not in account. Closing in DB.`);
            await db.update(trades).set({ status: 'CLOSED', exitTime: new Date() }).where(eq(trades.id, trade.id));
            continue;
        }
        
        const pos: Position = {
            symbol: trade.symbol,
            side: trade.side as 'LONG' | 'SHORT',
            entryPrice: trade.entryPrice,
            quantity: trade.quantity,
            initialQty: trade.initialQty,
            stopLoss: trade.stopLoss,
            target1: trade.target1,
            timestamp: trade.entryTime?.toISOString() || '',
            status: 'OPEN',
            scaledOut: trade.quantity < trade.initialQty,
            rangeHeight: 0
        };

        await checkPosition(api, trade.symbol, pos, log);
        
        await db.update(trades).set({
            quantity: pos.quantity,
            stopLoss: pos.stopLoss,
            status: pos.status,
            pnl: pos.pnl
        }).where(eq(trades.id, trade.id));
    }

    // 3. Scan for New Signals (Use Dynamic Watchlist)
    if (dbOpenTrades.length < MAX_OPEN_TRADES) {
        const slotsAvailable = MAX_OPEN_TRADES - dbOpenTrades.length;
        const dbWatchlist = await db.select().from(watchlistTable).orderBy(desc(watchlistTable.score)).limit(60);
        
        log(`🔎 Scanning ${dbWatchlist.length || VOLATILE_TICKERS.length} Tickers [Slots: ${slotsAvailable}] for Conviction-Based entries...`);
        const livePortValue = (portfolioPositions.length > 0 || cashAvailable > 0) ? (portfolioPositions.reduce((s,p) => s + (p.marketValue || 0), 0) + cashAvailable) : 100000;
        
        const candidates = dbWatchlist.length > 0 
            ? dbWatchlist.map(w => ({ symbol: w.symbol, score: w.score }))
            : VOLATILE_TICKERS.map(s => ({ symbol: s, score: 100 })); // Default 100 for volatile list

        let tradesExecutedThisCycle = 0;
        for (const entry of candidates) {
            const { symbol, score } = entry;
            if (heldSymbols.has(symbol.toUpperCase())) continue;
            
            // Conviction-Based Sizing: Size = (NAV * 0.25) * (Score / 100)
            const symbolCap = livePortValue * MAX_POS_PCT;
            const amountPerTrade = symbolCap * (score / 100);
            
            log(`📈 Conviction Scaling [${symbol}]: Investing $${amountPerTrade.toFixed(2)} (Score: ${score} | Cap: $${symbolCap.toFixed(2)})`);

            const signal = await checkSetup(symbol, log);
            if (signal) {
                const success = await triggerTrade(api, symbol, signal, amountPerTrade, log);
                if (success) {
                    tradesExecutedThisCycle++;
                    if (tradesExecutedThisCycle >= slotsAvailable) break; 
                }
            }
        }
    }

    log('--- 🤖 CYCLE COMPLETE ---');
    return output.join('\n');
}

async function runAfterHoursAnalysis(api: ApiClient, log: (msg: string) => void): Promise<string> {
    log('🌌 Starting Lightning Branch After-Hours Quant Analysis...');
    
    // 1. Get Universe (Top 200 high-alpha tickers)
    const universe = VOLATILE_TICKERS.slice(0, 100); // Placeholder for 1000
    log(`🔎 Analyzing ${universe.length} high-potential tickers...`);
    
    const candidates: { symbol: string, side: string, score: number, reason: string }[] = [];
    
    for (let i = 0; i < universe.length; i++) {
        const symbol = universe[i];
        if (i % 5 === 0) log(`Processing ticker ${i+1}/${universe.length}...`);
        
        try {
            const raw = await fetchIntradayData(symbol, '5d', '15m');
            if (!raw.data || raw.data.length < 50) continue;
            
            // Institutional Branch Check (Relative Volatility + Trend)
            const closes = raw.data.map(d => d.close);
            const meanPrice = closes.slice(-20).reduce((p, c) => p + c) / 20;
            const vol = Math.sqrt(closes.slice(-20).reduce((s, x) => s + Math.pow(x - meanPrice, 2), 0) / 20);
            const trend = closes[closes.length - 1] - closes[closes.length - 20];
            
            const relativeVol = vol / meanPrice;

            if (relativeVol > 0.005) { // 0.5% Relative Volatility Threshold
                const move = (relativeVol * 250).toFixed(1); // Projected Move %
                const duration = relativeVol > 0.015 ? '1-3 Day Runner' : '1-Week Accumulation';
                const tag = trend > 0 ? 'High-Beta Momentum' : 'Mean Reversion Alpha';
                
                candidates.push({
                    symbol,
                    side: trend > 0 ? 'LONG' : 'SHORT',
                    score: Math.min(6, Math.floor(relativeVol * 400)), // Scale score to 0-6
                    reason: `${trend > 0 ? '+' : '-'}${move}% projected voltality branch. ${duration}. ${tag}.`
                });
                log(`🎯 Match: ${symbol} (Vol: ${(relativeVol * 100).toFixed(2)}% | Move: ${move}% | ${duration})`);
            }
        } catch (e) {
            log(`❌ Skip ${symbol}: Processing error`);
        }
    }
    
    // 2. Update DB Watchlist
    log(`💾 Saving Top ${candidates.length} candidates to Dynamic Watchlist...`);
    await db.delete(watchlistTable);
    for (const cand of candidates.slice(0, 60)) {
        await db.insert(watchlistTable).values(cand).onConflictDoUpdate({
            target: watchlistTable.symbol,
            set: { score: cand.score, reason: cand.reason }
        });
    }
    
    log(`✅ After-Hours Analysis Complete. ${candidates.length} tickers prepped for Market Open.`);
    return 'After-Hours Analysis Success';
}

async function checkPosition(api: ApiClient, symbol: string, pos: Position, log: (msg: string) => void) {
    const raw = await fetchIntradayData(symbol, '1d', '5m');
    if (!raw.data || raw.data.length < 5) return;

    const enriched = EliteStrategyV4.calculateEliteIndicators(raw.data as Candle[]);
    const current = enriched[enriched.length - 1];
    if (!current) return;
    
    // NY Close Time Check
    const time = current.date.split('T')[1];
    const isEOD = time >= '15:55:00';

    const strategyPos: PositionState = {
        symbol: pos.symbol,
        side: pos.side,
        entryPrice: pos.entryPrice,
        sl: pos.stopLoss,
        maxP: pos.entryPrice, 
        minP: pos.entryPrice,
        isSwing: false
    };

    const exit = EliteStrategyV4.checkExit(current, strategyPos, isEOD);
    
    if (exit) {
        if (exit.exitPrice > 0) {
            log(`🎯 [ELITE EXIT] ${symbol} @ $${exit.exitPrice.toFixed(2)} | Reason: ${exit.reason}`);
            try {
                await executeTrade(api, {
                    symbol,
                    action: pos.side === 'LONG' ? 'sell' : 'cover',
                    quantity: pos.quantity,
                    orderType: 'market',
                    duration: 'day'
                });
                pos.status = 'CLOSED';
                pos.pnl = pos.side === 'LONG' ? (exit.exitPrice - pos.entryPrice) * pos.quantity : (pos.entryPrice - exit.exitPrice) * pos.quantity;
            } catch (e) { log(`   ❌ Exit failed: ${e}`); }
        } else if (exit.wasSwing) {
            log(`💎 [SWING HOLD] ${symbol} carry forward. Alpha confirmed.`);
        }
    }
}

async function checkSetup(symbol: string, log: (msg: string) => void): Promise<'LONG' | 'SHORT' | null> {
    const raw = await fetchIntradayData(symbol, '1d', '5m');
    if (!raw.data || raw.data.length < 21) return null;

    const enriched = EliteStrategyV4.calculateEliteIndicators(raw.data as Candle[]);
    const openingRange = raw.data.slice(0, 6);
    const rH = Math.max(...openingRange.map(c => c.high));
    const rL = Math.min(...openingRange.map(c => c.low));
    const avgVol = openingRange.reduce((s,c) => s+c.volume, 0)/6;

    const setup = EliteStrategyV4.checkSetup(enriched, rH, rL, avgVol);
    if (setup) {
        log(`🔥 [ELITE SIGNAL] ${symbol} ${setup} confirmed by 6-Factor Confluence.`);
    }
    return setup;
}

async function triggerTrade(api: ApiClient, symbol: string, side: 'LONG' | 'SHORT', amountPerTrade: number, log: (msg: string) => void): Promise<boolean> {
    const raw = await fetchIntradayData(symbol, '1d', '5m');
    if (!raw.data || raw.data.length === 0) return false;
    const price = raw.data[raw.data.length - 1].close;
    const qty = Math.floor(amountPerTrade / price);
    
    if (qty <= 0) return false;

    log(`🚀 [EXECUTE] ${side} ${qty} shares of ${symbol} @ ~$${price}`);
    
    try {
        const result = await executeTrade(api, {
            symbol,
            action: side === 'LONG' ? 'buy' : 'short',
            quantity: qty,
            orderType: 'market',
            duration: 'day'
        });
        
        if (result.success) {
            // --- VERIFICATION LAYER ---
            log(`⏳ Verifying fulfillment on HTMW...`);
            await new Promise(r => setTimeout(r, 3000)); // Wait for HTMW processing
            
            const portfolio = await getPortfolio(api);
            const isFilled = portfolio.positions.some(p => p.symbol.toUpperCase() === symbol.toUpperCase());
            
            if (isFilled) {
                log(`   🎯 [VERIFIED] Trade filled on HTMW backend.`);
            } else {
                log(`   ⚠️ [PENDING] Order placed but not yet filled (check Open Orders).`);
            }
            // --------------------------

            await db.insert(trades).values({
                symbol,
                side,
                entryPrice: price,
                quantity: qty,
                initialQty: qty,
                stopLoss: side === 'LONG' ? price * 0.98 : price * 1.02, 
                target1: side === 'LONG' ? price * 1.05 : price * 0.95,
                status: 'OPEN'
            });

            await db.insert(signals).values({
                symbol,
                side,
                convictionScore: 6,
                reason: 'Lightning Branch Quant Alpha',
                wasExecuted: true
            });

            log(`   ✅ Trade Persisted.`);
            return true;
        } else {
            log(`   ❌ Trade Failed: ${result.message}`);
            return false;
        }
    } catch (e) { log(`   ❌ API Error: ${e}`); return false; }
}
