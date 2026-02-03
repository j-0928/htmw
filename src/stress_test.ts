import { getStockLookup, getTradingViewScreener } from './tools/tradingview.js';

async function stressTest() {
    console.log('--- STARTING STRESS TEST ---');

    console.log('1. Concurrent Stock Lookups (20 parallel requests)...');
    const symbols = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA', 'META', 'NVDA', 'BRK.B', 'V', 'JPM', 'UNH', 'MA', 'PG', 'HD', 'DIS', 'PYPL', 'ADBE', 'NFLX', 'INTC', 'CMCSA'];

    const startTime = Date.now();
    const results = await Promise.allSettled(symbols.map(s => getStockLookup(s)));
    const endTime = Date.now();

    const passed = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;

    console.log(`Finished 20 lookups in ${endTime - startTime}ms`);
    console.log(`✅ Passed: ${passed}, ❌ Failed: ${failed}`);

    if (failed > 0) {
        console.error('Failure reasons:', results.filter(r => r.status === 'rejected').map(r => (r as PromiseRejectedResult).reason.message));
    }

    console.log('\n2. Sequential Large Screeners (3 momentum pages)...');
    const screenerStart = Date.now();
    const screenerResults = await Promise.allSettled([
        getTradingViewScreener(-1, 'momentum'),
        getTradingViewScreener(-1, 'momentum'),
        getTradingViewScreener(-1, 'momentum')
    ]);
    const screenerEnd = Date.now();

    console.log(`Finished 3 full screener fetches in ${screenerEnd - screenerStart}ms`);
    console.log(`✅ Passed: ${screenerResults.filter(r => r.status === 'fulfilled').length}, ❌ Failed: ${screenerResults.filter(r => r.status === 'rejected').length}`);
}

stressTest();
