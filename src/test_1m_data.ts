
import axios from 'axios';

async function testOneMinuteData() {
    const symbol = 'AAPL';
    const interval = '1m';
    const range = '1d'; // Just fetch 1 day to test
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=${interval}&range=${range}`;

    console.log(`Fetching 1m data for ${symbol}...`);
    try {
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });

        const result = response.data.chart.result[0];
        const timestamps = result.timestamp;
        const closes = result.indicators.quote[0].close;

        console.log(`Success! Fetched ${timestamps.length} 1-minute candles.`);
        console.log('First Candle:', new Date(timestamps[0] * 1000).toISOString(), closes[0]);
        console.log('Last Candle:', new Date(timestamps[timestamps.length - 1] * 1000).toISOString(), closes[closes.length - 1]);

    } catch (error: any) {
        console.error('Failed to fetch 1m data:', error.message);
        if (error.response) {
            console.error('Status:', error.response.status);
            console.error('Data:', JSON.stringify(error.response.data).substring(0, 200));
        }
    }
}

testOneMinuteData();
