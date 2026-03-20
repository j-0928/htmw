
import axios from 'axios';
import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';

const httpsAgent = new https.Agent({
    rejectUnauthorized: false,
});

// Cache Configuration
const CACHE_DIR = path.resolve('backtest_cache');
if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
}

interface OHLCV {
    date: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    adjClose: number;
}

interface HistoricalData {
    symbol: string;
    data: OHLCV[];
}

function getCachePath(symbol: string, type: string, params: string): string {
    return path.join(CACHE_DIR, `${symbol.toUpperCase()}_${type}_${params}.json`);
}

function saveToCache(symbol: string, type: string, params: string, data: HistoricalData) {
    if (data.data.length === 0) return;
    const cachePath = getCachePath(symbol, type, params);
    fs.writeFileSync(cachePath, JSON.stringify(data, null, 2));
}

function loadFromCache(symbol: string, type: string, params: string): HistoricalData | null {
    const cachePath = getCachePath(symbol, type, params);
    if (fs.existsSync(cachePath)) {
        try {
            return JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
        } catch {
            return null;
        }
    }
    return null;
}

/**
 * Fetch historical OHLCV data from Yahoo Finance
 */
export async function fetchHistoricalData(
    symbol: string,
    startDate: string,
    endDate: string
): Promise<HistoricalData> {
    const type = 'historical';
    const params = `${startDate}_${endDate}`;
    
    // 1. Try Cache First
    const cached = loadFromCache(symbol, type, params);
    if (cached) return cached;

    const start = Math.floor(new Date(startDate).getTime() / 1000);
    const end = Math.floor(new Date(endDate).getTime() / 1000);
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${symbol}?period1=${start}&period2=${end}&interval=1d&events=history`;

    try {
        const response = await axios.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            httpsAgent,
            timeout: 5000
        });

        if (!response.data?.chart?.result) {
            return { symbol, data: [] };
        }

        const result = response.data.chart.result[0];
        const timestamps = result.timestamp || [];
        const quote = result.indicators.quote[0];
        const adjClose = result.indicators.adjclose?.[0]?.adjclose || quote.close;

        const data: OHLCV[] = timestamps.map((ts: number, i: number) => ({
            date: new Date(ts * 1000).toISOString().split('T')[0],
            open: quote.open[i],
            high: quote.high[i],
            low: quote.low[i],
            close: quote.close[i],
            volume: quote.volume[i],
            adjClose: adjClose[i]
        })).filter((d: OHLCV) => d.open !== null && d.close !== null);

        const finalData = { symbol, data };
        saveToCache(symbol, type, params, finalData);
        return finalData;

    } catch (error: any) {
        return { symbol, data: [] };
    }
}

/**
 * Fetch Intraday 1-minute data
 */
export async function fetchIntradayData(
    symbol: string,
    range: string = '5d',
    interval: string = '1m'
): Promise<HistoricalData> {
    const type = 'intraday';
    const params = `${range}_${interval}`;

    // 1. Try Cache First
    const cached = loadFromCache(symbol, type, params);
    if (cached) return cached;

    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${symbol}?interval=${interval}&range=${range}`;

    try {
        const response = await axios.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36' },
            httpsAgent,
            timeout: 5000
        });

        if (!response.data?.chart?.result) {
            return { symbol, data: [] };
        }

        const result = response.data.chart.result[0];
        const timestamps = result.timestamp || [];
        const quote = result.indicators.quote[0];

        const data: OHLCV[] = timestamps.map((ts: number, i: number) => ({
            date: new Date(ts * 1000).toISOString(),
            open: quote.open[i],
            high: quote.high[i],
            low: quote.low[i],
            close: quote.close[i],
            volume: quote.volume[i],
            adjClose: quote.close[i]
        })).filter((d: OHLCV) => d.open !== null);

        const finalData = { symbol, data };
        saveToCache(symbol, type, params, finalData);
        return finalData;

    } catch (error: any) {
        return { symbol, data: [] };
    }
}

/**
 * Generate MOCK data for testing short strategies offline
 */
export function generateMockDownTrend(symbol: string, daysCount: number = 30): HistoricalData {
    const data: OHLCV[] = [];
    let price = 100;
    
    for (let d = 0; d < daysCount; d++) {
        const dateStr = new Date(Date.now() - (daysCount - d) * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        
        // Gap Down
        price *= 0.985; // 1.5% Gap Down
        
        for (let i = 0; i < 78; i++) {
            const time = new Date(`${dateStr}T13:30:00.000Z`); // 9:30 AM EST in UTC
            time.setMinutes(time.getMinutes() + (i * 5));
            
            let move = 0;
            let vol = 1000;
            
            if (i < 6) {
                // Opening Range
                move = (Math.random() - 0.5) * 0.2;
                vol = 5000;
            } else if (i === 6) {
                // Breakdown
                move = -0.8;
                vol = 15000; 
            } else {
                // Continuation
                move = (Math.random() - 0.55) * 0.1;
                vol = 2000;
            }
            
            const open = price;
            price += move;
            const close = price;
            const high = Math.max(open, close) + 0.05;
            const low = Math.min(open, close) - 0.05;
            
            data.push({
                date: time.toISOString(),
                open, high, low, close,
                volume: vol,
                adjClose: close
            });
        }
    }

    return { symbol, data };
}

/**
 * Fetch data for multiple symbols
 */
export async function fetchMultipleSymbols(
    symbols: string[],
    startDate: string,
    endDate: string
): Promise<Map<string, OHLCV[]>> {
    const results = new Map<string, OHLCV[]>();

    for (let i = 0; i < symbols.length; i += 5) {
        const batch = symbols.slice(i, i + 5);
        const promises = batch.map(s => fetchHistoricalData(s, startDate, endDate));
        const batchResults = await Promise.all(promises);

        for (const result of batchResults) {
            if (result.data.length > 0) {
                results.set(result.symbol, result.data);
            }
        }

        if (i + 5 < symbols.length) {
            await new Promise(resolve => setTimeout(resolve, 200));
        }
    }

    return results;
}
