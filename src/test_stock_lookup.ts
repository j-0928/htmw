
import { getStockLookup } from './tools/tradingview.js';

async function testStockLookup() {
    const symbol = 'AAPL';
    console.log(`Testing stock lookup for ${symbol}...`);
    try {
        const details = await getStockLookup(symbol);
        console.log('Stock Lookup Successful:');
        console.log(JSON.stringify(details, null, 2));

        // Basic validations
        if (details.symbol !== symbol) {
            console.error(`Error: Symbol mismatch. Expected ${symbol}, got ${details.symbol}`);
        }
        if (typeof details.close !== 'number') {
            console.error('Error: Close price is not a number');
        }
        if (!details.indicators || typeof details.indicators.rsi !== 'number') {
            // RSI might be null if not enough data, but usually it should be there for AAPL
            console.warn('Warning: RSI indicator not found or not a number');
        }

        console.log('\n--- Extended Hours Check ---');
        console.log('Pre-market:', details.preMarket);
        console.log('Post-market:', details.postMarket);

    } catch (error) {
        console.error('Test failed:', error);
    }
}

testStockLookup();
