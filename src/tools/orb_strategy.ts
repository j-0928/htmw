
import { fetchIntradayData } from '../backtest/dataFetcher.js';
import { logInfo, logError } from '../logger.js';

const VOLATILE_TICKERS = ['NVDA', 'TSLA', 'AMD', 'META', 'AMZN', 'NFLX', 'COIN', 'MSTR', 'SMCI', 'ARM'];

interface OrbCandidate {
    symbol: string;
    currentPrice: number;
    rangeHigh: number;
    rangeLow: number;
    breakout: 'LONG' | 'SHORT' | 'NONE';
    stopLoss: number;
    target: number;
    timestamp: string;
}

/**
 * Analyze candles for ORB setup
 */
export function analyzeOrb(candles: any[], symbol: string): OrbCandidate | null {
    if (candles.length < 31) return null; // Need 30m range + 1 candle breakout

    const openParam = 30; // 30 minute range

    const openingRange = candles.slice(0, openParam);
    const rangeHigh = Math.max(...openingRange.map((c: any) => c.high));
    const rangeLow = Math.min(...openingRange.map((c: any) => c.low));
    const currentObj = candles[candles.length - 1];
    const currentPrice = currentObj.close; // Latest close

    let breakout: 'LONG' | 'SHORT' | 'NONE' = 'NONE';
    let target = 0;
    let stop = 0;

    // Check for breakout
    if (currentPrice > rangeHigh) {
        breakout = 'LONG';
        stop = rangeLow;
        // Target 1R for high win rate
        target = currentPrice + (rangeHigh - rangeLow);
    } else if (currentPrice < rangeLow) {
        breakout = 'SHORT';
        stop = rangeHigh;
        target = currentPrice - (rangeHigh - rangeLow);
    }

    if (breakout !== 'NONE') {
        return {
            symbol,
            currentPrice,
            rangeHigh,
            rangeLow,
            breakout,
            stopLoss: stop,
            target,
            timestamp: currentObj.date
        };
    }
    return null;
}

/**
 * Scan for Opening Range Breakout (ORB) Candidates caused by "Insane Volatility"
 * Default: 30-minute ORB (Backtested Win Rate 75%)
 */
export async function getOrbCandidates(symbols: string[] = VOLATILE_TICKERS): Promise<OrbCandidate[]> {
    logInfo('ORB_SNIPER', `Scanning ${symbols.length} tickers for 30m ORB setups...`);

    // Check if market is open long enough (at least 30 mins)
    // Yahoo data returns timestamps in UTC.
    // Market Open: 9:30 AM ET = 13:30 UTC / 14:30 UTC depending on DST.
    // We'll simplisticly check if we have >= 30 candles for today.

    const candidates: OrbCandidate[] = [];

    // Parallel fetch
    const promises = symbols.map(async (sym) => {
        try {
            const data = await fetchIntradayData(sym, '1d');
            return analyzeOrb(data.data, sym);
        } catch (e) {
            logError('ORB_SNIPER', `Failed scan for ${sym}`, e);
            return null;
        }
    });

    const results = await Promise.all(promises);
    const valid = results.filter(r => r !== null) as OrbCandidate[];

    logInfo('ORB_SNIPER', `Found ${valid.length} ORB candidates.`);
    return valid;
}
