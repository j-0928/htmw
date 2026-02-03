
import axios from 'axios';

interface TradingViewResponse {
    totalCount: number;
    data: Array<{
        s: string; // symbol (e.g. "NASDAQ:AAPL")
        d: any[]; // data columns corresponding to request
    }>;
}

export interface ScreenerResult {
    symbol: string;
    description: string;
    close: number;
    change: number;
    volume: number;
    marketCap: number;
    recommendation: number; // 1 = strong buy, -1 = strong sell, etc.
}

export async function getTradingViewScreener(limit: number = 50, type: 'active' | 'momentum' = 'active'): Promise<ScreenerResult[]> {
    const url = 'https://scanner.tradingview.com/america/scan?label-product=screener-stock';

    let allResults: ScreenerResult[] = [];
    const PAGE_SIZE = 100;
    let currentOffset = 0;
    let totalToFetch = limit === -1 ? Infinity : limit;

    while (currentOffset < totalToFetch) {
        let payload: any;
        const currentLimit = Math.min(PAGE_SIZE, totalToFetch - currentOffset);

        if (type === 'active') {
            payload = {
                "filter": [
                    { "left": "type", "operation": "in_range", "right": ["stock", "dr", "fund"] },
                    { "left": "subtype", "operation": "in_range", "right": ["common", "foreign-issuer", ""] },
                    { "left": "exchange", "operation": "in_range", "right": ["AMEX", "NASDAQ", "NYSE"] },
                    { "left": "volume", "operation": "nempty" }
                ],
                "options": { "lang": "en" },
                "symbols": { "query": { "types": [] }, "tickers": [] },
                "columns": ["name", "close", "change", "volume", "market_cap_basic", "Recommend.All", "description"],
                "sort": { "sortBy": "volume", "sortOrder": "desc" },
                "range": [currentOffset, currentOffset + currentLimit]
            };
        } else {
            payload = {
                "columns": ["name", "close", "change", "volume", "market_cap_basic", "Recommend.All", "description"],
                "filter": [
                    { "left": "is_blacklisted", "operation": "equal", "right": false },
                    { "left": "change", "operation": "greater", "right": 0.01 },
                    { "left": "market_cap_basic", "operation": "egreater", "right": 300000000 },
                    { "left": "EMA21", "operation": "greater", "right": "EMA50" },
                    { "left": "average_volume_10d_calc", "operation": "greater", "right": 500000 },
                    { "left": "ADRP", "operation": "egreater", "right": 2 },
                    { "left": "relative_volume_10d_calc", "operation": "greater", "right": 1.5 },
                    { "left": "Perf.3M", "operation": "greater", "right": 10 },
                    { "left": "is_primary", "operation": "equal", "right": true }
                ],
                "options": { "lang": "en" },
                "range": [currentOffset, currentOffset + currentLimit],
                "sort": { "sortBy": "volume", "sortOrder": "desc" },
                "markets": ["america"]
            };
        }

        try {
            const response = await axios.post<TradingViewResponse>(url, payload, {
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
            });

            if (!response.data.data || response.data.data.length === 0) break;

            const pageResults: ScreenerResult[] = response.data.data.map(item => {
                const [name, close, change, volume, marketCap, recommendation, description] = item.d;
                return { symbol: name, description, close, change, volume, marketCap, recommendation };
            });

            allResults = allResults.concat(pageResults);

            if (limit === -1) {
                totalToFetch = response.data.totalCount;
            }

            currentOffset += pageResults.length;
            if (pageResults.length < currentLimit) break; // Reached end of data

        } catch (error) {
            console.error(`Error fetching TradingView ${type} screener at offset ${currentOffset}:`, error);
            throw new Error(`Failed to fetch TradingView ${type} screener data`);
        }
    }

    return allResults;
}

export interface StockDetails extends ScreenerResult {
    open: number;
    high: number;
    low: number;
    changeAbs: number;
    preMarket: {
        price: number | null;
        change: number | null;
        volume: number | null;
    };
    postMarket: {
        price: number | null;
        change: number | null;
        volume: number | null;
    };
    indicators: {
        rsi: number | null;
        macd: { macd: number | null; signal: number | null };
        stoch: { k: number | null; d: number | null };
        ema: { [key: string]: number | null };
        sma: { [key: string]: number | null };
        awesomeOscillator: number | null;
        cci: number | null;
        adx: { adx: number | null; plusDI: number | null; minusDI: number | null };
    };
    pivots: {
        middle: number | null;
        r1: number | null;
        s1: number | null;
    };
}

export async function getStockLookup(symbol: string): Promise<StockDetails> {
    const url = 'https://scanner.tradingview.com/america/scan';

    // We assume the symbol passed is just the ticker (e.g. "AAPL")
    // If it contains a colon, it's already exchange-prefixed
    const ticker = symbol.includes(':') ? symbol.split(':')[1] : symbol;

    const payload = {
        "filter": [
            { "left": "name", "operation": "equal", "right": ticker }
        ],
        "options": { "lang": "en" },
        "markets": ["america"],
        "columns": [
            "name",                 // 0
            "close",                // 1
            "change",               // 2
            "volume",               // 3
            "market_cap_basic",     // 4
            "Recommend.All",        // 5
            "description",          // 6
            "open",                 // 7
            "high",                 // 8
            "low",                  // 9
            "change_abs",           // 10
            "premarket_close",       // 11
            "premarket_change",      // 12
            "premarket_volume",      // 13
            "postmarket_close",      // 14
            "postmarket_change",     // 15
            "postmarket_volume",     // 16
            "RSI",                  // 17
            "MACD.macd",            // 18
            "MACD.signal",          // 19
            "Stoch.K",              // 20
            "Stoch.D",              // 21
            "EMA10", "EMA20", "EMA50", "EMA100", "EMA200", // 22, 23, 24, 25, 26
            "SMA10", "SMA20", "SMA50", "SMA100", "SMA200", // 27, 28, 29, 30, 31
            "AO",                   // 32
            "CCI20",                // 33
            "ADX",                  // 34
            "ADX+DI",               // 35
            "ADX-DI",               // 36
            "Pivot.M.Classic.Middle", // 37
            "Pivot.M.Classic.R1",     // 38
            "Pivot.M.Classic.S1"      // 39
        ],
        "range": [0, 1]
    };

    try {
        const response = await axios.post<TradingViewResponse>(url, payload, {
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });

        if (!response.data.data || response.data.data.length === 0) {
            throw new Error(`Symbol ${symbol} not found`);
        }

        const data = response.data.data[0].d;

        return {
            symbol: data[0],
            close: data[1],
            change: data[2],
            volume: data[3],
            marketCap: data[4],
            recommendation: data[5],
            description: data[6],
            open: data[7],
            high: data[8],
            low: data[9],
            changeAbs: data[10],
            preMarket: {
                price: data[11],
                change: data[12],
                volume: data[13]
            },
            postMarket: {
                price: data[14],
                change: data[15],
                volume: data[16]
            },
            indicators: {
                rsi: data[17],
                macd: { macd: data[18], signal: data[19] },
                stoch: { k: data[20], d: data[21] },
                ema: {
                    ema10: data[22], ema20: data[23], ema50: data[24], ema100: data[25], ema200: data[26]
                },
                sma: {
                    sma10: data[27], sma20: data[28], sma50: data[29], sma100: data[30], sma200: data[31]
                },
                awesomeOscillator: data[32],
                cci: data[33],
                adx: { adx: data[34], plusDI: data[35], minusDI: data[36] }
            },
            pivots: {
                middle: data[37],
                r1: data[38],
                s1: data[39]
            }
        };

    } catch (error) {
        console.error(`Error fetching detailed lookup for ${symbol}:`, error);
        throw new Error(`Failed to fetch detailed stock info for ${symbol}`);
    }
}
