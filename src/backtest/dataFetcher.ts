
import axios from 'axios';

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

/**
 * Fetch historical OHLCV data from Yahoo Finance
 * @param symbol Stock ticker (e.g., "AAPL")
 * @param startDate Start date (YYYY-MM-DD)
 * @param endDate End date (YYYY-MM-DD)
 */
export async function fetchHistoricalData(
    symbol: string,
    startDate: string,
    endDate: string
): Promise<HistoricalData> {
    const start = Math.floor(new Date(startDate).getTime() / 1000);
    const end = Math.floor(new Date(endDate).getTime() / 1000);

    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?period1=${start}&period2=${end}&interval=1d&events=history`;

    try {
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

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

        return { symbol, data };
    } catch (error: any) {
        console.error(`Failed to fetch data for ${symbol}:`, error.message);
        return { symbol, data: [] };
    }
}

/**
 * Fetch Intraday 1-minute data
 * @param symbol Stock ticker
 * @param range Range (e.g., '1d', '5d', '7d')
 */
export async function fetchIntradayData(
    symbol: string,
    range: string = '5d',
    interval: string = '1m'
): Promise<HistoricalData> {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=${interval}&range=${range}`;

    try {
        const response = await axios.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });

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
            adjClose: quote.close[i] // No adj close for intraday usually
        })).filter((d: OHLCV) => d.open !== null);

        return { symbol, data };
    } catch (error: any) {
        console.error(`Failed to fetch intraday data for ${symbol}`);
        return { symbol, data: [] };
    }
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

    // Batch in groups of 5 to avoid rate limiting
    for (let i = 0; i < symbols.length; i += 5) {
        const batch = symbols.slice(i, i + 5);
        const promises = batch.map(s => fetchHistoricalData(s, startDate, endDate));
        const batchResults = await Promise.all(promises);

        for (const result of batchResults) {
            if (result.data.length > 0) {
                results.set(result.symbol, result.data);
            }
        }

        // Small delay between batches
        if (i + 5 < symbols.length) {
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }

    return results;
}

// S&P 500 top 100 by market cap (representative sample)
export const SP500_SAMPLE = [
    'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA', 'BRK-B', 'UNH', 'JNJ',
    'V', 'XOM', 'JPM', 'PG', 'MA', 'HD', 'CVX', 'LLY', 'ABBV', 'MRK',
    'PFE', 'AVGO', 'KO', 'PEP', 'COST', 'TMO', 'WMT', 'BAC', 'DIS', 'CSCO',
    'ABT', 'MCD', 'CRM', 'ACN', 'ADBE', 'VZ', 'NKE', 'DHR', 'NFLX', 'INTC',
    'WFC', 'TXN', 'NEE', 'UPS', 'PM', 'RTX', 'BMY', 'QCOM', 'T', 'MS'
];
