
import { getOrbCandidates } from './dist/tools/orb_strategy.js';

async function test() {
    console.log('--- Testing ORB "Sniper" Tool ---');
    console.log('Tickers: NVDA, TSLA, AMD, META, AMZN, NFLX, COIN, MSTR, SMCI, ARM');

    try {
        const candidates = await getOrbCandidates();
        console.log(`Found ${candidates.length} active setups or recent breakouts.`);

        candidates.forEach(c => {
            console.log(`\n🎯 ${c.symbol} - ${c.breakout} Breakout`);
            console.log(`Status: Price $${c.currentPrice} vs Range High $${c.rangeHigh}`);
            console.log(`Trade: Target $${c.target.toFixed(2)}, Stop $${c.stopLoss.toFixed(2)}`);
        });

    } catch (error) {
        console.error('Error:', error);
    }
}

test();
