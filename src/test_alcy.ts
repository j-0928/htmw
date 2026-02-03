import { getStockLookup } from './tools/tradingview.js';

async function test() {
    console.log('Testing stock lookup for ALCY...');
    try {
        const details = await getStockLookup('ALCY');
        console.log('Stock Lookup Successful:');
        console.log(JSON.stringify(details, null, 2));
    } catch (error) {
        console.error('Test failed:', error);
    }
}

test();
