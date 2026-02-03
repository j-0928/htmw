
import { ApiClient } from './api.js';
import { AuthManager } from './auth.js';
import { searchSymbol, getQuote } from './tools/lookup.js';
import { getOpenOrders, cancelOrder } from './tools/orders.js';
import { getPortfolio } from './tools/getPortfolio.js';
import { getRankings } from './tools/getRankings.js';
import { executeTrade } from './tools/executeTrade.js';
import type { Config } from './types.js';

// Load configuration
const config: Config = {
    username: process.env.HTMW_USERNAME || '',
    password: process.env.HTMW_PASSWORD || '',
    baseUrl: 'https://app.howthemarketworks.com',
};

async function main() {
    console.log('Logging in...');
    const auth = new AuthManager(config);
    const api = new ApiClient(auth);

    if (!await auth.login()) {
        console.error('Login failed');
        return;
    }
    console.log('Login success.');

    try {
        console.log('\n--- Testing Lookup (searchSymbol) ---');
        const searchResults = await searchSymbol(api, 'Apple');
        console.log(`Found ${searchResults.length} results for "Apple":`);
        console.table(searchResults.slice(0, 3));

        console.log('\n--- Testing Quote (getQuote) ---');
        const quote = await getQuote(api, 'AAPL');
        console.log('AAPL Quote:', quote);

        console.log('\n--- Testing Portfolio (getPortfolio) ---');
        const portfolio = await getPortfolio(api);
        console.log('Portfolio Value:', portfolio.portfolioValue);
        console.log('Positions:', portfolio.positions.length);

        console.log('\n--- Testing Rankings (getRankings) ---');
        const rankings = await getRankings(api);
        console.log('Contest:', rankings.contestName);
        console.log('Your Rank:', rankings.userRank);
        console.log('Top Rankings:', rankings.topRankings.length);

        console.log('\n--- Testing Orders (getOpenOrders) ---');
        const orders = await getOpenOrders(api);
        console.log(`Found ${orders.length} open orders:`);
        if (orders.length > 0) console.table(orders);

        if (orders.length > 0) {
            console.log('\n--- Testing Cancel (cancelOrder) ---');
            const targetOrder = orders[0];
            console.log(`Cancelling order ${targetOrder.orderId} (${targetOrder.symbol})...`);
            const cancelRes = await cancelOrder(api, targetOrder.orderId);
            console.log('Cancel Result:', JSON.stringify(cancelRes, null, 2));
        } else {
            // Testing Trade (executeTrade)
            console.log('\n--- Testing Trade (executeTrade) ---');
            const tradeRes = await executeTrade(api, {
                symbol: 'MSFT',
                action: 'buy',
                quantity: 1,
                orderType: 'market'
            });
            console.log('Trade Result:', JSON.stringify(tradeRes, null, 2));
        }

    } catch (error) {
        console.error('Audit verification failed:', error);
    }
}

main().catch(console.error);
