
import type { ApiClient } from '../api.js';
import type { Quote, SymbolSearchResult } from '../types.js';

/**
 * Search for stock symbols by name or partial ticker
 */
export async function searchSymbol(api: ApiClient, query: string): Promise<SymbolSearchResult[]> {
    // Correct endpoint discovered from global.js: /quotes/searchsymbol
    // Parameters: q, exchanges, securityTypes, equitiesType
    const url = `/quotes/searchsymbol?q=${encodeURIComponent(query)}&exchanges=US&securityTypes=Equities&equitiesType=All`;
    const results = await api.getJson(url) as any[];

    if (!Array.isArray(results)) {
        return [];
    }

    // HTMW autocomplete usually returns symbols as strings or objects
    return results.map(r => {
        if (typeof r === 'string') {
            return { symbol: r, name: '', exchange: 'US', securityType: 'Stock' };
        }
        return {
            symbol: r.Symbol || r.symbol || r.Value || r.value || '',
            name: r.Name || r.name || r.Label || r.label || r.Description || '',
            exchange: r.Exchange || r.exchange || 'US',
            securityType: r.Type || r.type || 'Stock',
        };
    });
}

/**
 * Get real-time quote for a stock symbol
 */
export async function getQuote(api: ApiClient, symbol: string): Promise<Quote> {
    const url = '/trading/getprice';
    const body = new URLSearchParams();
    body.append('symbol', symbol);
    body.append('exchange', 'US');
    body.append('equitiesType', 'All');

    const response = await api.post(url, body);
    const data = await response.json() as any;

    if (!data.Success && data.ErrorMessage) {
        throw new Error(data.ErrorMessage);
    }

    // Map HTMW response to our Quote interface
    return {
        symbol: data.Symbol || symbol,
        name: data.CompanyName || '',
        lastPrice: data.UnitPrice || 0,
        change: data.DayChange || 0, // Note: might need to verify these field names
        changePercent: data.DayChangePercent || 0,
        bid: data.Bid || 0,
        ask: data.Ask || 0,
        volume: data.Volume || 0,
    };
}
