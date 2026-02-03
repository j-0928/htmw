
import { ApiClient } from './api.js';
import { AuthManager } from './auth.js';
import * as fs from 'fs';
import * as path from 'path';

async function run() {
    const auth = new AuthManager({
        username: process.env.HTMW_USERNAME!,
        password: process.env.HTMW_PASSWORD!,
        baseUrl: 'https://app.howthemarketworks.com'
    });
    const api = new ApiClient(auth);
    await auth.login();

    console.log('Fetching /trading/orderhistory...');
    const response = await api.get('/trading/orderhistory');
    const html = await response.text();

    const dumpPath = path.resolve('debug_orderhistory.html');
    fs.writeFileSync(dumpPath, html);
    console.log(`Saved to ${dumpPath}`);
}

run().catch(console.error);
