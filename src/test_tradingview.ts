
import { getTradingViewScreener } from './tools/tradingview.js';

async function testTradingView() {
    console.log('--- Testing TradingView Screener ---');
    try {
        console.log('Fetching top 5 active stocks...');
        const results = await getTradingViewScreener(5);

        if (results.length === 0) {
            console.error('FAILED: No results returned');
            process.exit(1);
        }

        console.log(`Success! Received ${results.length} results.`);
        console.log('Sample result:', results[0]);

        // Basic validation
        const first = results[0];
        if (!first.symbol || !first.volume) {
            console.error('FAILED: Missing required fields in result');
            process.exit(1);
        }

    } catch (error) {
        console.error('Test FAILED with error:', error);
        process.exit(1);
    }
}

testTradingView();
