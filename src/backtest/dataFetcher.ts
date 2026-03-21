import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import yahooFinance from 'yahoo-finance2';

import { getScreenerData } from '../tools/screener.js';
import { getStockLookup } from '../tools/tradingview.js';

// Global Rate Limiter Policy (Institutional Grade)
let lastRequestTime = 0;
let requestCount = 0;
let globalDelayAddon = 0; // Cumulative penalty for 429s
const BATCH_SIZE = 10; 
const COOL_DOWN = 5000; // 5s Cool down every BATCH_SIZE
const BASE_DELAY = 1000; // 1s between individual requests

const CACHE_DIR = path.resolve('backtest_cache');
if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR);
}

const httpsAgent = new https.Agent({
    rejectUnauthorized: false
});

export interface OHLCV {
    date: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    adjClose: number;
    vwap?: number;
    rsi?: number;
    atr?: number;
    sma20?: number;
    hma?: number;
    isSqueezed?: boolean;
    isBullish?: boolean;
    cmf?: number;
}

export interface HistoricalData {
    symbol: string;
    data: OHLCV[];
}

function getCachePath(symbol: string, type: string, params: string): string {
    return path.join(CACHE_DIR, `${symbol}_${type}_${params}.json`);
}

function saveToCache(symbol: string, type: string, params: string, data: any) {
    fs.writeFileSync(getCachePath(symbol, type, params), JSON.stringify(data));
}

function getFromCache(symbol: string, type: string, params: string, ttlSeconds: number = 0): any | null {
    const p = getCachePath(symbol, type, params);
    if (fs.existsSync(p)) {
        if (ttlSeconds > 0) {
            const stats = fs.statSync(p);
            const age = (Date.now() - stats.mtimeMs) / 1000;
            if (age > ttlSeconds) return null; // Expired
        }
        return JSON.parse(fs.readFileSync(p, 'utf-8'));
    }
    return null;
}

export async function fetchHistoricalData(symbol: string, start: string, end: string): Promise<HistoricalData> {
    const cache = getFromCache(symbol, 'hist', `${start}_${end}`);
    if (cache) return cache;

    // --- PHASE 1: TRADING_VIEW (PULSE) ---
    try {
        const tv = await getStockLookup(symbol);
        if (tv && tv.close) {
             // We still need Yahoo for the historical series, but we've verified the ticker exists and is active.
        }
    } catch (e) {}

    // --- PHASE 2: YAHOO FINANCE (DEEP BRAIN) ---
    try {
        const result = await yahooFinance.historical(symbol, {
            period1: start,
            period2: end,
            interval: '1d'
        });

        const data: OHLCV[] = (result as any[]).map((q: any) => ({
            date: q.date.toISOString(),
            open: q.open,
            high: q.high,
            low: q.low,
            close: q.close,
            volume: q.volume,
            adjClose: q.adjClose || q.close
        })).filter((d: OHLCV) => d.open !== null);

        const finalData = { symbol, data };
        saveToCache(symbol, 'hist', `${start}_${end}`, finalData);
        return finalData;
    } catch (e) {
        console.error(`❌ Yahoo Hist Error [${symbol}]:`, e);
        return { symbol, data: [] };
    }
}

// Note: yahoo-finance2 handles session/crumb management internally

export async function fetchIntradayData(symbol: string, range: string = '1mo', interval: string = '5m', retries: number = 2): Promise<HistoricalData> {
    const cacheKey = `${range}_${interval}`;
    const cache = getFromCache(symbol, 'intraday', cacheKey, 60); 
    if (cache) return cache;

    // --- PHASE 1: TRADING_VIEW REAL-TIME (PULSE) ---
    try {
        const tv = await getStockLookup(symbol);
        if (tv && tv.close) {
             // TradingView is excellent for current state, but we need Yahoo for the historical array for GBM.
        }
    } catch (e) {}

    // --- PHASE 2: YAHOO FINANCE (DEEP BRAIN) ---
    // Hardening Strategy: Cluster Bursting + Cool Down
    requestCount++;
    const now = Date.now();
    let waitTime = 0;

    if (requestCount % BATCH_SIZE === 0) {
        waitTime = COOL_DOWN;
        console.error(`🛡️ BATCH LIMIT REACHED. Cooling down ${COOL_DOWN}ms...`);
    } else {
        waitTime = Math.max(0, BASE_DELAY - (now - lastRequestTime));
    }

    // Add Global Penalty (Adaptive Throttling)
    waitTime += globalDelayAddon;

    if (waitTime > 0) {
        await new Promise(r => setTimeout(r, waitTime + Math.random() * 2000));
    }

    let attempt = 0;
    while (attempt <= retries) {
        try {
            const result = (await yahooFinance.chart(symbol, {
                period1: range, 
                interval: interval as any,
                includeTimestamp: true
            })) as any;

            lastRequestTime = Date.now();

            if (!result || !result.quotes) throw new Error('No quotes');
            
            if (globalDelayAddon > 0) globalDelayAddon = Math.max(0, globalDelayAddon - 500);

            const data: OHLCV[] = result.quotes.map((q: any) => ({
                date: q.date ? q.date.toISOString() : new Date().toISOString(),
                open: q.open,
                high: q.high,
                low: q.low,
                close: q.close,
                volume: q.volume,
                adjClose: q.adjClose || q.close
            })).filter((d: any) => d.open !== null);

            const finalData = { symbol, data: data };
            saveToCache(symbol, 'intraday', cacheKey, finalData);
            return finalData;

        } catch (e: any) {
            attempt++;
            const status = e.response?.status || 0;
            const message = e.message || '';
            const is429 = status === 429 || status === 403 || message.toLowerCase().includes('429');

            if (is429) {
                globalDelayAddon += 10000;
                const backoff = Math.pow(2, attempt) * 15000;
                console.warn(`🛑 YAHOO THROTTLED [${symbol}]. Global Penalty: ${globalDelayAddon}ms. Backing off ${backoff}ms...`);
                await new Promise(r => setTimeout(r, backoff));
                if (attempt <= retries) continue;
            }
            
            console.error(`❌ Yahoo API Error [${symbol}]: ${message}`);
            if (attempt > retries) break;
        }
    }
    return { symbol, data: [] };
}

/**
 * Optimized Zero-Lag Indicators (STATEFUL & O(1))
 */
export function addIndicators(candles: OHLCV[]): OHLCV[] {
    if (candles.length === 0) return [];
    
    let cumPV = 0;
    let cumVol = 0;
    let avgGain = 0;
    let avgLoss = 0;
    let trSum = 0;
    let smaSum = 0;

    return candles.map((c, i) => {
        // 1. VWAP (O1)
        const hlcc = (c.high + c.low + c.close + c.close) / 4;
        cumPV += hlcc * c.volume;
        cumVol += c.volume;
        const vwap = cumPV / cumVol;

        // 2. RSI (Wilder's - O1)
        if (i > 0) {
            const diff = c.close - candles[i-1].close;
            const gain = Math.max(0, diff);
            const loss = Math.max(0, -diff);
            if (i < 14) { avgGain += gain; avgLoss += loss; }
            else if (i === 14) { avgGain = (avgGain + gain) / 14; avgLoss = (avgLoss + loss) / 14; }
            else { avgGain = (avgGain * 13 + gain) / 14; avgLoss = (avgLoss * 13 + loss) / 14; }
        }
        const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
        const rsi = 100 - (100 / (1 + rs));

        // 3. ATR (O1)
        const tr = i === 0 ? (c.high - c.low) : Math.max(c.high - c.low, Math.abs(c.high - candles[i-1].close), Math.abs(c.low - candles[i-1].close));
        if (i < 14) { trSum += tr; }
        else if (i === 14) { trSum = (trSum + tr) / 14; }
        else { trSum = (trSum * 13 + tr) / 14; }
        const atr = trSum;

        // 4. SMA20 (O1)
        smaSum += c.close;
        if (i >= 20) smaSum -= candles[i-20].close;
        const sma20 = smaSum / Math.min(i + 1, 20);

        return { ...c, vwap, rsi, atr, sma20 };
    });
}

/**
 * Advanced Stateful Indicators
 */
export function addAdvancedIndicators(candles: any[]): any[] {
    if (candles.length < 20) return candles;

    return candles.map((c, i) => {
        // 1. Chaikin Money Flow (CMF)
        let cmf = 0;
        const slice = candles.slice(Math.max(0, i - 19), i + 1);
        let mfvSum = 0, volSum = 0;
        slice.forEach(s => {
            const range = s.high - s.low;
            const mfm = range === 0 ? 0 : ((s.close - s.low) - (s.high - s.close)) / range;
            mfvSum += mfm * s.volume;
            volSum += s.volume;
        });
        cmf = volSum === 0 ? 0 : mfvSum / volSum;

        // 2. SuperTrend (simplified)
        const hl2 = (c.high + c.low) / 2;
        const isBullish = c.close > (hl2 - (3 * (c.atr || 1)));

        // 3. Volatility Squeeze
        let isSqueezed = false;
        if (i >= 20) {
            const priceSlice = candles.slice(i - 19, i + 1);
            const mean = priceSlice.reduce((s, x) => s + x.close, 0) / 20;
            const stdDev = Math.sqrt(priceSlice.reduce((s, x) => s + Math.pow(x.close - mean, 2), 0) / 20);
            const upperBB = mean + (2 * stdDev);
            const lowerBB = mean - (2 * stdDev);
            const upperKC = mean + (1.5 * (c.atr || 1));
            const lowerKC = mean - (1.5 * (c.atr || 1));
            isSqueezed = (upperBB < upperKC) && (lowerBB > lowerKC);
        }

        return { ...c, cmf, isBullish, isSqueezed };
    });
}

export async function fetchMultipleSymbols(symbols: string[], startDate: string, endDate: string): Promise<Map<string, OHLCV[]>> {
    const results = new Map<string, OHLCV[]>();
    for (let i = 0; i < symbols.length; i += 5) {
        const batch = symbols.slice(i, i + 5);
        const promises = batch.map(s => fetchHistoricalData(s, startDate, endDate));
        const batchResults = await Promise.all(promises);
        for (const res of batchResults) if (res.data.length > 0) results.set(res.symbol, res.data);
        if (i + 5 < symbols.length) await new Promise(r => setTimeout(r, 200));
    }
    return results;
}

export function generateMockDownTrend(symbol: string, daysCount: number = 30): HistoricalData {
    const data: OHLCV[] = [];
    let price = 100;
    for (let d = 0; d < daysCount; d++) {
        const dateStr = new Date(Date.now() - (daysCount - d) * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        price *= 0.985;
        for (let i = 0; i < 78; i++) {
            const time = new Date(`${dateStr}T13:30:00.000Z`);
            time.setMinutes(time.getMinutes() + (i * 5));
            let move = (i < 6) ? (Math.random() - 0.5) * 0.2 : (i === 6) ? -0.8 : (Math.random() - 0.55) * 0.1;
            let vol = (i < 6) ? 5000 : (i === 6) ? 15000 : 2000;
            const open = price;
            price += move;
            const close = price;
            data.push({ date: time.toISOString(), open, high: Math.max(open, close)+0.05, low: Math.min(open, close)-0.05, close, volume: vol, adjClose: close });
        }
    }
    return { symbol, data };
}
