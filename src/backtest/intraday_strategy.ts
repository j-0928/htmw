
interface Candle {
    date: string;
    open: number;
    high: number;
    highTime?: string;
    low: number;
    lowTime?: string;
    close: number;
    volume: number;
}

interface IntradayTrade {
    symbol: string;
    entryTime: string;
    exitTime: string;
    side: 'LONG' | 'SHORT';
    entryPrice: number;
    exitPrice: number;
    quantity: number;
    pnl: number;
    pnlPercent: number;
    reason: string;
    maxRunup: number;
    maxDrawdown: number;
}

interface ORBParams {
    rangeMinutes: number; // e.g. 15 for 15m ORB
    profitTargetR: number; // Risk multiple (e.g. 2R)
    stopLossR: number; // Risk multiple (e.g. 1R, usually range height)
    useTrailingStop: boolean;
    trailingStopPercent?: number;
    maxHoldMinutes: number;
}

/**
 * Group 1-minute candles into daily sessions
 */
function groupCandlesByDay(data: Candle[]): Record<string, Candle[]> {
    const groups: Record<string, Candle[]> = {};
    for (const candle of data) {
        const day = candle.date.split('T')[0];
        if (!groups[day]) groups[day] = [];
        groups[day].push(candle);
    }
    return groups;
}

/**
 * Backtest ORB Strategy on a single day's 1-minute data
 */
function backtestDay(
    symbol: string,
    dailyData: Candle[],
    params: ORBParams
): IntradayTrade | null {
    if (dailyData.length < params.rangeMinutes + 1) return null;

    // 1. Define Opening Range
    const openingRange = dailyData.slice(0, params.rangeMinutes);
    const rangeHigh = Math.max(...openingRange.map(c => c.high));
    const rangeLow = Math.min(...openingRange.map(c => c.low));
    const rangeHeight = rangeHigh - rangeLow;

    // Filter: Ignore tiny ranges (avoid chop) or huge ranges (avoid volatility exhaust)
    if (rangeHeight === 0) return null;

    let inPosition = false;
    let entryPrice = 0;
    let stopPrice = 0;
    let targetPrice = 0;
    let side: 'LONG' | 'SHORT' = 'LONG'; // Default, logic below
    let entryTime = '';
    let quantity = 100; // Simulating 100 shares

    // 2. Iterate through rest of day
    for (let i = params.rangeMinutes; i < dailyData.length; i++) {
        const candle = dailyData[i];

        if (!inPosition) {
            // Check Breakout
            // Buy Stop at Range High
            if (candle.high > rangeHigh) {
                // Breakout Long
                side = 'LONG';
                entryPrice = rangeHigh + 0.01; // Slippage
                entryTime = candle.date;
                stopPrice = rangeLow; // Stop at low of range (Classic ORB)
                // Adjust stop if risk is too high?
                targetPrice = entryPrice + (rangeHeight * params.profitTargetR);
                inPosition = true;
                // Check if candle also hit stop/target same minute?
                // Assume fill at break, check close/high/low for exit
            }
            // Short logic could go here (candle.low < rangeLow)
        } else {
            // Manage Trade
            // Check Stop
            if (candle.low <= stopPrice) {
                return {
                    symbol,
                    entryTime,
                    exitTime: candle.date,
                    side,
                    entryPrice,
                    exitPrice: stopPrice,
                    quantity,
                    pnl: (stopPrice - entryPrice) * quantity,
                    pnlPercent: ((stopPrice - entryPrice) / entryPrice) * 100,
                    reason: 'STOP_LOSS',
                    maxRunup: 0,
                    maxDrawdown: 0 // Todo: calc
                };
            }

            // Check Target
            if (candle.high >= targetPrice) {
                return {
                    symbol,
                    entryTime,
                    exitTime: candle.date,
                    side,
                    entryPrice,
                    exitPrice: targetPrice,
                    quantity,
                    pnl: (targetPrice - entryPrice) * quantity,
                    pnlPercent: ((targetPrice - entryPrice) / entryPrice) * 100,
                    reason: 'TARGET_HIT',
                    maxRunup: 0,
                    maxDrawdown: 0
                };
            }

            // Time Exit
            const minsHeld = i - params.rangeMinutes; // Approximation
            // Need accurate time diff ideally
            // If just using index diff:
            if (i >= params.rangeMinutes + params.maxHoldMinutes) {
                return {
                    symbol,
                    entryTime,
                    exitTime: candle.date,
                    side,
                    entryPrice,
                    exitPrice: candle.close,
                    quantity,
                    pnl: (candle.close - entryPrice) * quantity,
                    pnlPercent: ((candle.close - entryPrice) / entryPrice) * 100,
                    reason: 'TIME_EXIT',
                    maxRunup: 0,
                    maxDrawdown: 0
                };
            }
        }
    }

    // EOD Exit
    if (inPosition) {
        const lastCandle = dailyData[dailyData.length - 1];
        return {
            symbol,
            entryTime,
            exitTime: lastCandle.date,
            side,
            entryPrice,
            exitPrice: lastCandle.close,
            quantity,
            pnl: (lastCandle.close - entryPrice) * quantity,
            pnlPercent: ((lastCandle.close - entryPrice) / entryPrice) * 100,
            reason: 'EOD_EXIT',
            maxRunup: 0,
            maxDrawdown: 0
        };
    }

    return null;
}

/**
 * Run Intraday Backtest
 */
export function backtestIntraday(
    data: Candle[],
    symbol: string,
    params: ORBParams
): IntradayTrade[] {
    const days = groupCandlesByDay(data);
    const trades: IntradayTrade[] = [];

    for (const dayDate in days) {
        const trade = backtestDay(symbol, days[dayDate], params);
        if (trade) trades.push(trade);
    }

    return trades;
}

export const ORB_DEFAULT_PARAMS: ORBParams = {
    rangeMinutes: 15,
    profitTargetR: 2.0, // Aim for 2x Risk
    stopLossR: 1.0,     // Stop at range low
    useTrailingStop: false,
    maxHoldMinutes: 60  // "Within the hour"
};
