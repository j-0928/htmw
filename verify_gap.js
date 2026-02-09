
import { getGapCandidates } from './dist/tools/gap_strategy.js';

async function test() {
    console.log('--- Testing Gap Strategy Screener ---');
    try {
        const candidates = await getGapCandidates();
        console.log(`Found ${candidates.length} candidates.`);

        if (candidates.length > 0) {
            console.log('Top Candidate:', JSON.stringify(candidates[0], null, 2));
        } else {
            console.log('No candidates found (this is normal if conditions are strict or market is closed/quiet).');
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

test();
