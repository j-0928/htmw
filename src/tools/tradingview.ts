
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

export async function getTradingViewScreener(limit: number = 50): Promise<ScreenerResult[]> {
    const url = 'https://scanner.tradingview.com/america/scan?label-product=screener-stock';

    // Payload for "Most Active" stocks (high volume), usually a good default
    const payload = {
        "filter": [
            { "left": "type", "operation": "in_range", "right": ["stock", "dr", "fund"] },
            { "left": "subtype", "operation": "in_range", "right": ["common", "foreign-issuer", ""] },
            { "left": "exchange", "operation": "in_range", "right": ["AMEX", "NASDAQ", "NYSE"] },
            { "left": "volume", "operation": "nempty" }
        ],
        "options": { "lang": "en" },
        "symbols": { "query": { "types": [] }, "tickers": [] },
        "columns": [
            "name",                 // 0
            "close",                // 1
            "change",               // 2
            "volume",               // 3
            "market_cap_basic",     // 4
            "Recommend.All",        // 5
            "description",          // 6
            "type",                 // 7
            "subtype"               // 8
        ],
        "sort": { "sortBy": "volume", "sortOrder": "desc" },
        "range": [0, limit]
    };

    try {
        const response = await axios.post<TradingViewResponse>(url, payload, {
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });

        const results: ScreenerResult[] = response.data.data.map(item => {
            const [
                name,
                close,
                change,
                volume,
                marketCap,
                recommendation,
                description
            ] = item.d;

            return {
                symbol: name,
                description,
                close,
                change,
                volume,
                marketCap,
                recommendation
            };
        });

        return results;

    } catch (error) {
        console.error('Error fetching TradingView screener:', error);
        throw new Error('Failed to fetch TradingView screener data');
    }
}
