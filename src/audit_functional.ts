import { getPortfolio } from './tools/getPortfolio.js';
import { getQuote, searchSymbol } from './tools/lookup.js';
import { getTradingViewScreener, getStockLookup } from './tools/tradingview.js';
import { discoverTournaments } from './tools/getRankings.js';
import { AuthManager } from './auth.js';
import { ApiClient } from './api.js';

async function audit() {
    console.log('--- STARTING COMPREHENSIVE AUDIT ---');
    const config = {
        username: process.env.HTMW_USERNAME || '',
        password: process.env.HTMW_PASSWORD || '',
        baseUrl: 'https://app.howthemarketworks.com',
    };
    const auth = new AuthManager(config);
    const api = new ApiClient(auth);
    // Removed manual login() call to avoid redundant/suspicious attempts.
    // ensureAuthenticated() will be called lazily by the tools.

    const tests = [
        {
            name: 'Portfolio', fn: async () => {
                const p = await getPortfolio(api);
                if (p.cashBalance === 0 && p.portfolioValue === 0) throw new Error('Returned empty data (Login likely failed)');
                return p;
            }
        },
        { name: 'Quote (AAPL)', fn: () => getQuote(api, 'AAPL') },
        { name: 'Search (Tesla)', fn: () => searchSymbol(api, 'Tesla') },
        { name: 'Tournaments', fn: () => discoverTournaments(api) },
        { name: 'TV Screener (Active)', fn: () => getTradingViewScreener(10, 'active') },
        { name: 'TV Screener (Momentum)', fn: () => getTradingViewScreener(10, 'momentum') },
        { name: 'Detailed Lookup (MSFT)', fn: () => getStockLookup('MSFT') },
    ];

    for (const test of tests) {
        process.stdout.write(`Testing ${test.name.padEnd(25)}... `);
        try {
            await test.fn();
            console.log('✅ PASS');
        } catch (err) {
            console.log(`❌ FAIL: ${err instanceof Error ? err.message : err}`);
        }
    }
}

audit();
