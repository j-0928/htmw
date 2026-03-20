
export interface Candle {
    date: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

export interface IndicatorState {
    vwap: number;
    rsi: number;
    atr: number;
    isBullish: boolean;
    cmf: number;
}

export interface PositionState {
    symbol: string;
    side: 'LONG' | 'SHORT';
    entryPrice: number;
    sl: number;
    maxP: number;
    minP: number;
    isSwing: boolean;
}

/**
 * Institutional Elite Sniper v4 Strategy
 * O(1) Zero-Lag Math
 */
export class EliteStrategyV4 {
    static calculateEliteIndicators(candles: Candle[]): (Candle & IndicatorState)[] {
        let cpv = 0, cv = 0, ag = 0, al = 0, trs = 0;
        return candles.map((c, i) => {
            const h = (c.high + c.low + c.close + c.close) / 4;
            cpv += h * c.volume;
            cv += c.volume;
            const vwap = cpv / cv;

            if (i > 0) {
                const d = c.close - candles[i - 1].close;
                ag = (ag * 13 + Math.max(0, d)) / 14;
                al = (al * 13 + Math.max(0, -d)) / 14;
            }
            const rsi = 100 - (100 / (1 + (al === 0 ? 100 : ag / al)));

            const tr = i === 0 ? (c.high - c.low) : Math.max(c.high - c.low, Math.abs(c.high - candles[i - 1].close), Math.abs(c.low - candles[i-1].close));
            trs = (trs * 13 + tr) / 14;
            const atr = trs;

            const isBullish = c.close > ((c.high + c.low) / 2 - (3 * atr));

            // Simplified CMF for O(1)
            const r = c.high - c.low;
            const mfv = (r === 0 ? 0 : ((c.close - c.low) - (c.high - c.close)) / r) * c.volume;
            // Note: Real CMF is a 20-day sum, for simulation we use the EMA of MFV/Vol
            const cmf = mfv / (c.volume || 1); 

            return { ...c, vwap, rsi, atr, isBullish, cmf };
        });
    }

    static checkSetup(candles: (Candle & IndicatorState)[], rangeHigh: number, rangeLow: number, avgVol: number): 'LONG' | 'SHORT' | null {
        if (candles.length < 21) return null;
        const c = candles[candles.length - 1];

        let sL = 0, sS = 0;
        // 6-Factor Confluence
        if (c.close > rangeHigh) sL++; if (c.volume > avgVol * 3) sL++; if (c.close > c.vwap) sL++; if (c.rsi < 70) sL++; if (c.cmf > 0) sL++; if (c.isBullish) sL++;
        if (c.close < rangeLow) sS++; if (c.volume > avgVol * 3) sS++; if (c.close < c.vwap) sS++; if (c.rsi > 30) sS++; if (c.cmf < 0) sS++; if (!c.isBullish) sS++;

        if (sL >= 6) return 'LONG';
        if (sS >= 6) return 'SHORT';
        return null;
    }

    static checkExit(c: Candle & IndicatorState, pos: PositionState, isEOD: boolean): { exitPrice: number, reason: string, wasSwing: boolean } | null {
        const atr = c.atr;
        
        if (pos.side === 'LONG') {
            pos.maxP = Math.max(pos.maxP, c.high);
            const trail = pos.maxP - (atr * 3.5);
            const currentSL = Math.max(pos.sl, trail);
            if (c.low <= currentSL) return { exitPrice: currentSL, reason: 'TRAILING_STOP', wasSwing: false };
        } else {
            pos.minP = Math.min(pos.minP, c.low);
            const trail = pos.minP + (atr * 3.5);
            const currentSL = Math.min(pos.sl, trail);
            if (c.high >= currentSL) return { exitPrice: currentSL, reason: 'TRAILING_STOP', wasSwing: false };
        }

        if (isEOD) {
            // Swing Hold Criteria
            const isBullishHold = pos.side === 'LONG' ? (c.close > c.vwap && c.close > pos.entryPrice * 1.02) : (c.close < c.vwap && c.close < pos.entryPrice * 0.98);
            if (isBullishHold) {
                return { exitPrice: 0, reason: 'SWING_HOLD', wasSwing: true }; // 0 means don't exit
            }
            return { exitPrice: c.close, reason: 'EOD_CLOSE', wasSwing: false };
        }

        return null;
    }
}
