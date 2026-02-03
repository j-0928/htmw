
import { getTradingViewScreener } from './tools/tradingview.js';

async function testTradingView() {
    console.log('--- Testing TradingView Screener ---');
    try {
        console.log('Fetching top 5 active stocks...');
        const active = await getTradingViewScreener(5, 'active');
        console.log(`Active: Received ${active.length} results.`);

        console.log('Fetching top 5 momentum stocks...');
        const momentum = await getTradingViewScreener(5, 'momentum');
        console.log(`Momentum (5): Received ${momentum.length} results.`);

        console.log('Fetching ENTIRE momentum list...');
        const allMomentum = await getTradingViewScreener(-1, 'momentum');
        console.log(`Full Momentum: Received ${allMomentum.length} results.`);
        console.log('Sample Full Momentum:', allMomentum[0]);

        if (allMomentum.length === 0) {
            console.error('FAILED: No momentum results returned');
            process.exit(1);
        }

        // Basic validation
        const first = active[0];
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
