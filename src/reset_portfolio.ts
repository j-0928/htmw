
import 'dotenv/config';
import { AuthManager } from './auth.js';
import { ApiClient } from './api.js';
import { getPortfolio } from './tools/getPortfolio.js';
import { executeTrade } from './tools/executeTrade.js';
import { db, initDb } from './db/index.js';
import { trades } from './db/schema.js';
import { eq } from 'drizzle-orm';

async function reset() {
    console.log('🧹 [RESET] Initializing Portfolio Clear...');
    
    const config = {
        username: process.env.HTMW_USERNAME || '',
        password: process.env.HTMW_PASSWORD || '',
        baseUrl: 'https://app.howthemarketworks.com',
    };

    const auth = new AuthManager(config);
    const api = new ApiClient(auth);
    await auth.login();
    try {
        await initDb();
        console.log('🗄️ [RESET] Clearing Database `trades` table...');
        await db.delete(trades);
    } catch (e) {
        console.warn('⚠️ [RESET] Database reset failed (likely no local DB). Skipping DB clear, proceeding with HTMW.');
    }

    // 1. Fetch live portfolio
    const portfolio = await getPortfolio(api);
    const positions = (portfolio.positions || []).filter((p: any) => p.symbol);
    
    console.log(`🔎 [RESET] Found ${positions.length} active positions.`);

    // 2. Clear all on HTMW
    for (const pos of positions) {
        console.log(`❌ [RESET] Closing ${pos.symbol} (${pos.shares} shares)...`);
        try {
            const result = await executeTrade(api, {
                symbol: pos.symbol,
                action: (pos.shares > 0) ? 'sell' : 'cover',
                quantity: Math.abs(pos.shares),
                orderType: 'market',
                duration: 'day'
            });
            console.log(`   ✅ ${pos.symbol}: ${result.message}`);
        } catch (e) {
            console.error(`   ❌ Failed to close ${pos.symbol}: ${e}`);
        }
    }

    console.log('✨ [RESET] HTMW Portfolio is now 100% CLEAR.');
    process.exit(0);
}

reset().catch(console.error);
