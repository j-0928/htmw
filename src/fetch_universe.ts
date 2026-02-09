
import { getScreenerData } from './tools/screener.js';
import * as fs from 'fs';
import * as path from 'path';

async function fetchUniverse() {
    console.log('--- 🌎 Fetching Market Universe ---');
    try {
        const results = await getScreenerData({
            market: 'america',
            limit: 1000, // Fetch top 1000 by volume
            sort_by: 'volume',
            sort_order: 'desc',
            columns: ['name', 'close', 'volume', 'market_cap_basic'],
            filters: [
                { left: 'close', operation: 'greater', right: 5 }, // No penny stocks (<$5)
                { left: 'volume', operation: 'greater', right: 500000 }, // Liquid only
                { left: 'type', operation: 'equal', right: 'stock' }, // Stocks only (no ETFs/ADRs if distinguishable, though type filter helps)
                { left: 'subtype', operation: 'in_range', right: ['common', 'foreign'] } // Avoid warrants/preferred
            ]
        });

        if (!results || results.count === 0) {
            console.error('Failed to fetch universe.');
            return;
        }

        console.log(`Fetched ${results.count} tickers.`);

        const tickers = results.data.map((r: any) => r.ticker.replace('NASDAQ:', '').replace('NYSE:', '').replace('AMEX:', ''));
        const uniqueTickers = [...new Set(tickers)]; // Remove duplicates just in case

        console.log(`Unique tickers: ${uniqueTickers.length}`);

        const outputPath = path.resolve('src/backtest/universe.json');
        fs.writeFileSync(outputPath, JSON.stringify(uniqueTickers, null, 2));
        console.log(`Saved to ${outputPath}`);

    } catch (error) {
        console.error('Error fetching universe:', error);
    }
}

fetchUniverse();
