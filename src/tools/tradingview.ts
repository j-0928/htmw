
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
