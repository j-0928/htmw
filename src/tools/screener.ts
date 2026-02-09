
import axios from 'axios';
import { logInfo, logError, logDebug } from '../logger.js';

const SCANNER_URL = 'https://scanner.tradingview.com/{market}/scan';

// Headers exactly matching the Python client to avoid blocking
const HEADERS = {
    'authority': 'scanner.tradingview.com',
    'sec-ch-ua': '" Not A;Brand";v="99", "Chromium";v="98", "Google Chrome";v="98"',
    'accept': 'text/plain, */*; q=0.01',
    // 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8', // Let Axios set JSON content-type
    'sec-ch-ua-mobile': '?0',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/98.0.4758.102 Safari/537.36',
    'sec-ch-ua-platform': '"Windows"',
    'origin': 'https://www.tradingview.com',
    'sec-fetch-site': 'same-site',
    'sec-fetch-mode': 'cors',
    'sec-fetch-dest': 'empty',
    'referer': 'https://www.tradingview.com/',
    'accept-language': 'en-US,en;q=0.9,it;q=0.8',
};

// Default columns to fetch if not specified
const DEFAULT_COLUMNS = [
    'name', 'close', 'volume', 'market_cap_basic', 'change', 'Recommend.All', 'RSI', 'MACD.macd', 'MACD.signal'
];

interface ScreenerQuery {
    market?: string;
    columns?: string[];
    limit?: number;
    sort_by?: string;
    sort_order?: 'asc' | 'desc';
    filters?: any[]; // Allow raw JSON filter array for advanced usage
}

/**
 * Get data from TradingView Screener API
 */
export async function getScreenerData(args: ScreenerQuery) {
    const market = args.market || 'america';
    const limit = args.limit || 50;
    const url = SCANNER_URL.replace('{market}', market);

    const payload: any = {
        markets: [market],
        symbols: { query: { types: [] }, tickers: [] },
        options: { lang: 'en' },
        columns: args.columns || DEFAULT_COLUMNS,
        sort: {
            sortBy: args.sort_by || 'volume',
            sortOrder: args.sort_order || 'desc'
        },
        range: [0, limit]
    };

    // Only add filter if it exists and is not empty
    if (args.filters && args.filters.length > 0) {
        payload.filter = args.filters;
    }

    logDebug('SCREENER', `Querying ${market} market, limit ${limit}`);

    try {
        const response = await axios.post(url, payload, { headers: HEADERS, timeout: 10000 });
        const data = response.data;

        if (!data || typeof data.totalCount === 'undefined') {
            throw new Error('Invalid response format from Screener API');
        }

        const totalCount = data.totalCount;
        const rows = data.data || [];

        logInfo('SCREENER', `Found ${totalCount} results, returning ${rows.length}`);

        // Map response to a cleaner object
        const mappedResults = rows.map((row: any) => {
            const result: any = { ticker: row.s };
            const cols = payload.columns;
            row.d.forEach((val: any, index: number) => {
                if (index < cols.length) {
                    result[cols[index]] = val;
                }
            });
            return result;
        });

        return {
            totalCount,
            count: mappedResults.length,
            data: mappedResults
        };

    } catch (e: any) {
        // Enhanced error logging
        if (e.response) {
            logError('SCREENER', `API Error ${e.response.status}: ${JSON.stringify(e.response.data)}`, e);
            throw new Error(`Screener API failed (${e.response.status}): ${JSON.stringify(e.response.data)}`);
        }
        logError('SCREENER', 'Failed to fetch screener data', e);
        throw new Error(`Screener API failed: ${e.message}`);
    }
}
