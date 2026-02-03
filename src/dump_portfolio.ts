
import { ApiClient } from './api.js';
import { AuthManager } from './auth.js';
import * as fs from 'fs';
import * as path from 'path';

// Load configuration
const config = {
    username: process.env.HTMW_USERNAME || '',
    password: process.env.HTMW_PASSWORD || '',
    baseUrl: 'https://app.howthemarketworks.com',
};

async function run() {
    const auth = new AuthManager(config);
    const api = new ApiClient(auth);
    await auth.login();

    console.log('Fetching /accounting/openpositions...');
    const response = await api.get('/accounting/openpositions');
    const html = await response.text();

    const dumpPath = path.resolve('debug_openpositions.html');
    fs.writeFileSync(dumpPath, html);
    console.log(`Saved to ${dumpPath}`);
}

run().catch(console.error);
