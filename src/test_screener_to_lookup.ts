import { getTradingViewScreener, getStockLookup } from './tools/tradingview.js';

async function test() {
    console.log('--- Finding Momentum Stocks ---');
    try {
        const momentumStocks = await getTradingViewScreener(-1, 'momentum');
        console.log(`Found ${momentumStocks.length} momentum stocks.`);

        const results = [];
        // Pull detail for each stock
        for (const stock of momentumStocks) {
            console.log(`Fetching details for ${stock.symbol}...`);
            try {
                const details = await getStockLookup(stock.symbol);
                results.push(details);
            } catch (err) {
                console.error(`Failed to fetch ${stock.symbol}:`, err instanceof Error ? err.message : err);
            }
        }

        console.log('\n--- Summary of Momentum Stocks with Technicals ---');
        results.forEach(r => {
            console.log(`${r.symbol.padEnd(8)} | Price: ${r.close.toString().padEnd(8)} | RSI: ${r.indicators.rsi?.toFixed(2).padEnd(6)} | EMA20: ${r.indicators.ema.ema20?.toFixed(2)}`);
        });

        // Show full detail for the top one as a sample
        if (results.length > 0) {
            console.log('\n--- Sample Full Detail (First Item) ---');
            console.log(JSON.stringify(results[0], null, 2));
        }

    } catch (error) {
        console.error('Test failed:', error);
    }
}

test();
