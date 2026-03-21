
import fs from 'fs';
import fs from 'fs';
import path from 'path';
import YahooFinance from 'yahoo-finance2';
const yahooFinance = new (YahooFinance as any)();

console.log('🚀 Minimal Audit Start');

const UNIVERSE_PATH = path.resolve('src/backtest/universe.json');
const tickers = JSON.parse(fs.readFileSync(UNIVERSE_PATH, 'utf-8')).slice(0, 10);

async function check() {
    for (const sym of tickers) {
        try {
            console.log(`Checking ${sym}...`);
            const res = await yahooFinance.chart(sym, { period1: '2026-02-20', interval: '1d' });
            console.log(`✅ ${sym}: ${res.quotes.length} days`);
        } catch (e) {
            console.log(`❌ ${sym}: ${e.message}`);
        }
    }
}

check();
