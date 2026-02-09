
/**
 * Gap Fill Strategy Implementation
 * 
 * Entry Criteria:
 * - Stock gaps DOWN > threshold% from previous close at open
 * - RSI(14) > minRSI (not already oversold)
 * - Volume > minVolume
 * - Price > minPrice
 * 
 * Exit Criteria:
 * - Gap is filled (price reaches previous close) -> WIN
 * - End of day close -> Partial win/loss based on move
 * - Stop loss triggered (price drops > stopLoss% from entry)
 */

interface OHLCV {
    date: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    adjClose: number;
}

interface StrategyParams {
    gapThreshold: number;      // Minimum gap down % (e.g., 2 = 2%)
    minRSI: number;            // Minimum RSI to avoid catching falling knife
    minVolume: number;         // Minimum avg volume
    minPrice: number;          // Minimum stock price ($)
    stopLoss: number;          // Stop loss % (e.g., 3 = 3%)
    holdDays: number;          // Max days to hold if gap not filled
    useSMAFilter?: boolean;    // Only take trades above SMA?
    smaPeriod?: number;        // SMA period (default 200)
    useMarketFilter?: boolean; // Only take trades if market (SPY) > SMA200?
}

interface Trade {
    symbol: string;
    entryDate: string;
    exitDate: string;
    entryPrice: number;
    exitPrice: number;
    gapPercent: number;
    pnlPercent: number;
    won: boolean;
    exitReason: 'gap_filled' | 'stop_loss' | 'time_exit' | 'eod_close';
}

interface BacktestResult {
    totalTrades: number;
    wins: number;
    losses: number;
    winRate: number;
    avgWinPercent: number;
    avgLossPercent: number;
    profitFactor: number;
    totalReturn: number;
    maxDrawdown: number;
    trades: Trade[];
}

/**
 * Calculate RSI (14-period by default)
 */
export function calculateRSI(data: OHLCV[], period: number = 14): number[] {
    const rsi: number[] = new Array(data.length).fill(0);

    if (data.length < period + 1) return rsi;

    let gains = 0;
    let losses = 0;

    // Initial average gain/loss
    for (let i = 1; i <= period; i++) {
        const change = data[i].close - data[i - 1].close;
        if (change > 0) gains += change;
        else losses -= change;
    }

    let avgGain = gains / period;
    let avgLoss = losses / period;

    for (let i = period; i < data.length; i++) {
        if (i > period) {
            const change = data[i].close - data[i - 1].close;
            if (change > 0) {
                avgGain = (avgGain * (period - 1) + change) / period;
                avgLoss = (avgLoss * (period - 1)) / period;
            } else {
                avgGain = (avgGain * (period - 1)) / period;
                avgLoss = (avgLoss * (period - 1) - change) / period;
            }
        }

        const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
        rsi[i] = 100 - (100 / (1 + rs));
    }

    return rsi;
}

/**
 * Calculate average volume over lookback period
 */
export function calculateAvgVolume(data: OHLCV[], index: number, lookback: number = 20): number {
    if (index < lookback) return 0;

    let sum = 0;
    for (let i = index - lookback; i < index; i++) {
        sum += data[i].volume;
    }
    return sum / lookback;
}

/**
 * Calculate SMA over lookback period
 */
export function calculateSMA(data: OHLCV[], index: number, period: number): number {
    if (index < period) return 0;

    let sum = 0;
    for (let i = index - period; i < index; i++) {
        sum += data[i].close;
    }
    return sum / period;
}

/**
 * Run Gap Fill strategy backtest on single symbol
 */
export function backtestGapFill(
    data: OHLCV[],
    symbol: string,
    params: StrategyParams,
    marketTrendMap?: Map<string, boolean>
): Trade[] {
    const trades: Trade[] = [];
    const rsi = calculateRSI(data);

    // Start from day 20 to have enough data for indicators
    for (let i = 20; i < data.length - params.holdDays; i++) {
        const prevDay = data[i - 1];
        const today = data[i];

        // Calculate gap %
        const gapPercent = ((today.open - prevDay.close) / prevDay.close) * 100;

        // Check entry conditions: gap DOWN > threshold
        if (gapPercent >= -params.gapThreshold) continue; // Not a gap down

        // RSI filter
        if (rsi[i - 1] < params.minRSI) continue; // Already oversold

        // Volume filter
        const avgVol = calculateAvgVolume(data, i);
        if (avgVol < params.minVolume) continue;

        // Price filter
        if (today.open < params.minPrice) continue;

        // SMA Filter (if enabled): Only buy if price > SMA
        if (params.useSMAFilter) {
            const sma = calculateSMA(data, i, params.smaPeriod || 200);
            if (today.close < sma) continue;
        }

        // Market Filter (if enabled): Only buy if market is in uptrend
        if (params.useMarketFilter && marketTrendMap) {
            const isUptrend = marketTrendMap.get(today.date);
            if (isUptrend === false) continue; // Skip if market is downtrend or unknown (conservative)
        }

        // Entry: buy at open + small slippage
        const entryPrice = today.open * 1.001; // 0.1% slippage
        const targetPrice = prevDay.close; // Gap fill target
        const stopPrice = entryPrice * (1 - params.stopLoss / 100);

        let exitPrice = 0;
        let exitDate = '';
        let exitReason: Trade['exitReason'] = 'time_exit';

        // Check for exit over holding period
        for (let j = 0; j <= params.holdDays && i + j < data.length; j++) {
            const checkDay = data[i + j];

            // Check if gap filled (intraday high reached target)
            if (checkDay.high >= targetPrice) {
                exitPrice = targetPrice;
                exitDate = checkDay.date;
                exitReason = 'gap_filled';
                break;
            }

            // Check stop loss (intraday low hit stop)
            if (checkDay.low <= stopPrice) {
                exitPrice = stopPrice;
                exitDate = checkDay.date;
                exitReason = 'stop_loss';
                break;
            }

            // End of holding period
            if (j === params.holdDays || j === 0) {
                exitPrice = checkDay.close;
                exitDate = checkDay.date;
                exitReason = j === 0 ? 'eod_close' : 'time_exit';
            }
        }

        if (exitPrice > 0) {
            const pnlPercent = ((exitPrice - entryPrice) / entryPrice) * 100;
            trades.push({
                symbol,
                entryDate: today.date,
                exitDate,
                entryPrice,
                exitPrice,
                gapPercent,
                pnlPercent,
                won: pnlPercent > 0,
                exitReason
            });
        }
    }

    return trades;
}

/**
 * Aggregate backtest results across all trades
 */
export function aggregateResults(trades: Trade[]): BacktestResult {
    if (trades.length === 0) {
        return {
            totalTrades: 0,
            wins: 0,
            losses: 0,
            winRate: 0,
            avgWinPercent: 0,
            avgLossPercent: 0,
            profitFactor: 0,
            totalReturn: 0,
            maxDrawdown: 0,
            trades: []
        };
    }

    const wins = trades.filter(t => t.won);
    const losses = trades.filter(t => !t.won);

    const avgWinPercent = wins.length > 0
        ? wins.reduce((sum, t) => sum + t.pnlPercent, 0) / wins.length
        : 0;

    const avgLossPercent = losses.length > 0
        ? Math.abs(losses.reduce((sum, t) => sum + t.pnlPercent, 0) / losses.length)
        : 0;

    const totalWins = wins.reduce((sum, t) => sum + t.pnlPercent, 0);
    const totalLosses = Math.abs(losses.reduce((sum, t) => sum + t.pnlPercent, 0));

    const profitFactor = totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Infinity : 0;

    // Calculate cumulative return and max drawdown
    let cumulative = 100;
    let peak = 100;
    let maxDrawdown = 0;

    for (const trade of trades) {
        cumulative *= (1 + trade.pnlPercent / 100);
        peak = Math.max(peak, cumulative);
        const drawdown = (peak - cumulative) / peak * 100;
        maxDrawdown = Math.max(maxDrawdown, drawdown);
    }

    return {
        totalTrades: trades.length,
        wins: wins.length,
        losses: losses.length,
        winRate: (wins.length / trades.length) * 100,
        avgWinPercent,
        avgLossPercent,
        profitFactor,
        totalReturn: cumulative - 100,
        maxDrawdown,
        trades
    };
}

export const DEFAULT_PARAMS: StrategyParams = {
    gapThreshold: 2.0,    // 2% gap down
    minRSI: 30,           // RSI above 30
    minVolume: 500000,    // 500k avg volume
    minPrice: 10,         // $10 minimum
    stopLoss: 3.0,        // 3% stop loss
    holdDays: 1,          // Exit by end of next day if not filled
    useSMAFilter: false,
    smaPeriod: 200,
    useMarketFilter: false
};
