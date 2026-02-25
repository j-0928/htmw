import 'dotenv/config';
import { runLoseBot } from './lose_bot.js';
import { ApiClient } from './api.js';
import { AuthManager } from './auth.js';
import type { Config } from './types.js';

const config: Config = {
    username: process.env.HTMW_USERNAME || '',
    password: process.env.HTMW_PASSWORD || '',
    baseUrl: 'https://app.howthemarketworks.com',
};

async function test() {
    console.error('Initializing auth...');
    const auth = new AuthManager(config);
    await auth.login();
    const api = new ApiClient(auth);

    console.error('Triggering runLoseBot()...');
    const start = Date.now();
    const output = await runLoseBot(api);
    const end = Date.now();

    console.log(`\n\n--- FINAL OUTPUT (${((end - start) / 1000).toFixed(2)}s) ---`);
    console.log(output);
}

test().catch(console.error);
