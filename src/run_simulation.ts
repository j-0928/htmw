
import { MarketSimulator } from './simulation/simulator.js';
import { fetchIntradayData } from './backtest/dataFetcher.js';
import * as fs from 'fs';
import * as path from 'path';

async function runSimulation() {
    console.log('--- 🕹️ Live Market Simulation ---');

    // 1. Load Universe
    const universePath = path.resolve('src/backtest/universe.json');
    if (!fs.existsSync(universePath)) {
        console.error('Universe not found.');
        return;
    }
    const universe = JSON.parse(fs.readFileSync(universePath, 'utf-8'));

    // 2. Pick High Volatility Tickers (The "Insane Profit" Universe)
    const VOLATILE_TICKERS = [
        'NVDA', 'TSLA', 'AMD', 'META', 'AMZN', 'NFLX', 'COIN', 'MSTR', 'SMCI', 'ARM',
        'PLTR', 'MARA', 'RIOT', 'SOUN', 'AI', 'DJT', 'GME', 'CVNA', 'UPST', 'BYND'
    ];
    const selected = VOLATILE_TICKERS;

    console.log(`Selected ${selected.length} volatile tickers for simulation.`);
    // console.log(selected.join(', '));

    const sim = new MarketSimulator();

    // 3. Fetch Data
    console.log('Feeding market data...');
    let dataCount = 0;

    const BATCH_SIZE = 10;
    for (let i = 0; i < selected.length; i += BATCH_SIZE) {
        const batch = selected.slice(i, i + BATCH_SIZE);
        const promises = batch.map((sym: string) => fetchIntradayData(sym, '5d')); // 5 days history
        const results = await Promise.all(promises);

        for (const res of results) {
            if (res.data.length > 0) {
                sim.addTickerData(res.symbol, res.data);
                dataCount++;
            }
        }
        process.stdout.write('.');
    }

    console.log(`\nSuccessfully loaded data for ${dataCount} tickers.`);

    // 4. Run Simulation
    await sim.run();
}

runSimulation();
