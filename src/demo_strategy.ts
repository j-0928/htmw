
import 'dotenv/config';
import { getScreenerData } from './tools/screener.js';
import { executeTrade } from './tools/executeTrade.js';
import { getPortfolio } from './tools/getPortfolio.js';
import { ApiClient } from './api.js';
import { AuthManager } from './auth.js';
import { getQuote } from './tools/lookup.js';

// Configuration
const config = {
    username: process.env.HTMW_USERNAME || '',
    password: process.env.HTMW_PASSWORD || '',
    baseUrl: 'https://app.howthemarketworks.com',
};

// Initialize API
const auth = new AuthManager(config);
const api = new ApiClient(auth);

async function runAutonomousTrader() {
    console.log('--- 🤖 Autonomous Trader Started ---');

    try {
        await auth.login();

        // 1. Check Buying Power
        console.log('\nchecking portfolio...');
        const portfolio = await getPortfolio(api);
        const buyingPower = portfolio.buyingPower;
        console.log(`Current Buying Power: $${buyingPower.toFixed(2)}`);

        if (buyingPower < 50) {
            console.log('Insufficient funds to trade. Exiting.');
            return;
        }

        // 2. Scan for High MomentumStocks
        // Criteria: RSI > 70 (Strong Momentum), High Relative Volume
        console.log('\nScanning for opportunities (RSI > 70, RelVol > 1.5)...');
        const screenerResults = await getScreenerData({
            market: 'america',
            limit: 5,
            sort_by: 'relative_volume_10d_calc',
            sort_order: 'desc',
            filters: [
                { left: 'RSI', operation: 'greater', right: 70 },
                { left: 'relative_volume_10d_calc', operation: 'greater', right: 1.5 },
                { left: 'close', operation: 'greater', right: 5 } // Avoid penny stocks
            ]
        });

        if (screenerResults.count === 0) {
            console.log('No stocks met criteria.');
            return;
        }

        console.log(`Found ${screenerResults.count} candidates.`);
        const bestCandidate = screenerResults.data[0];
        console.log(`Top Candidate: ${bestCandidate.ticker} ($${bestCandidate.close})`);
        console.log(`RSI: ${bestCandidate.RSI}, Rel Vol: ${bestCandidate.relative_volume_10d_calc}`);

        // 3. Analyze & Validate
        const symbol = bestCandidate.ticker.split(':')[1]; // Remove 'NASDAQ:' prefix
        console.log(`\nValidating quote for ${symbol}...`);
        const quote = await getQuote(api, symbol);

        if (!quote || quote.lastPrice === 0) {
            console.log('Invalid quote data. Aborting trade.');
            return;
        }

        console.log(`Current Ask: $${quote.ask}, Bid: $${quote.bid}`);

        // 4. Calculate Position Logic
        // Buy max 5% of buying power or 10 shares, whichever is less
        const riskAmount = buyingPower * 0.05;
        const potentialShares = Math.floor(riskAmount / quote.lastPrice);
        const quantity = Math.min(potentialShares, 10);

        if (quantity < 1) {
            console.log(`Not enough capital for ${symbol} at $${quote.lastPrice}. Needed: $${quote.lastPrice}, Have dedicated: $${riskAmount.toFixed(2)}`);
            // Fallback: Buy 1 share if total BP allows
            if (buyingPower > quote.lastPrice) {
                console.log('Buying 1 share as fallback...');
            } else {
                return;
            }
        }

        const tradeQty = Math.max(quantity, 1);
        console.log(`\nEXECUTING TRADE: Buy ${tradeQty} ${symbol} @ Market`);

        // 5. Execute Buy Order
        const tradeResult = await executeTrade(api, {
            symbol: symbol,
            action: 'buy',
            quantity: tradeQty,
            orderType: 'market',
            duration: 'day'
        });

        console.log('Trade Result:', JSON.stringify(tradeResult, null, 2));

        if (tradeResult.message && tradeResult.message.includes('success')) {
            console.log(`\n✅ Successfully bought ${tradeQty} ${symbol}.`);

            // 6. Place Stop Loss (Simulation)
            const stopPrice = quote.lastPrice * 0.95; // 5% Stop Loss
            console.log(`Placing Stop Loss at $${stopPrice.toFixed(2)}...`);
            const stopResult = await executeTrade(api, {
                symbol: symbol,
                action: 'sell',
                quantity: tradeQty,
                orderType: 'stop',
                stopPrice: Number(stopPrice.toFixed(2)),
                duration: 'gtc' // Good Till Cancelled
            });
            console.log('Stop Loss Result:', JSON.stringify(stopResult, null, 2));
        }

    } catch (error) {
        console.error('Bot Error:', error);
    }
}

runAutonomousTrader();
