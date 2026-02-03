
import { getStockLookup } from './tools/tradingview.js';

async function main() {
    console.log('--- Testing Stock Lookup ---');
    try {
        const symbol = 'AAPL';
        console.log(`Fetching details for ${symbol}...`);
        const details = await getStockLookup(symbol);

        console.log('Success! Received details:');
        console.log(`Symbol: ${details.symbol}`);
        console.log(`Price: $${details.close}`);
        console.log(`Description: ${details.description.substring(0, 50)}...`);
        console.log('Pre-Market:', details.preMarket);
        console.log('Post-Market:', details.postMarket);
        console.log('RSI:', details.indicators.rsi);
        console.log('EMA20:', details.indicators.ema.ema20);
        console.log('MACD:', details.indicators.macd);

        if (!details.indicators.rsi) {
            console.error('FAILED: No RSI returned');
            process.exit(1);
        }

    } catch (error) {
        console.error('Test failed:', error);
        process.exit(1);
    }
}

main();
