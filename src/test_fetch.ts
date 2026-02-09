
import { fetchIntradayData } from './backtest/dataFetcher.js';

async function testFetch() {
    console.log('Testing 1mo 5m fetch...');
    try {
        const data = await fetchIntradayData('NVDA', '1mo', '5m');
        console.log(`Fetched ${data.data.length} candles.`);
        if (data.data.length > 0) {
            console.log('First:', data.data[0].date);
            console.log('Last:', data.data[data.data.length - 1].date);
        }
    } catch (e) {
        console.error(e);
    }
}

testFetch();
