
import { logInfo, logError } from '../logger.js';
import { analyzeOrb } from '../tools/orb_strategy.js';

interface Candle {
    date: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

interface Position {
    symbol: string;
    side: 'LONG' | 'SHORT';
    entryPrice: number;
    quantity: number;
    stopLoss: number;
    target: number;
    entryTime: string;
}

interface TradeResult {
    symbol: string;
    entryTime: string;
    exitTime: string;
    side: 'LONG' | 'SHORT';
    pnl: number;
    returnPercent: number;
    reason: string;
}

export class MarketSimulator {
    private tickers: Map<string, Candle[]> = new Map();
    private positions: Position[] = [];
    private tradeHistory: TradeResult[] = [];
    private currentTimeIdx: number = 0;
    private cash: number = 100000; // $100k starting capital
    private equity: number = 100000;

    // Simulation Config
    private slippage = 0.05;
    private commission = 0.00;
    private amountPerTrade = 50000; // $50k per trade (Aggressive Cash Utilization)
    private useTrailingStop = false;
    private trailingStopPercent = 0.01;
    private tradesToday: Map<string, number> = new Map(); // Track trades per symbol per day
    private currentDay: string = '';

    public addTickerData(symbol: string, data: Candle[]) {
        this.tickers.set(symbol, data);
    }

    public async run() {
        console.log('--- 🟢 Starting Market Simulation ---');
        console.log(`Tickers: ${this.tickers.size}`);

        // Find max length to iterate
        let maxLen = 0;
        this.tickers.forEach(data => {
            if (data.length > maxLen) maxLen = data.length;
        });

        // Time Loop (Minute by Minute)
        for (let i = 0; i < maxLen; i++) {
            this.currentTimeIdx = i;

            // Track Day Change to reset limits
            const date = this.getDateAtIdx(i);
            if (date && date !== this.currentDay) {
                this.currentDay = date;
                this.tradesToday.clear();
            }

            // 1. Process Open Positions (Check Stops/Targets on NEW candles)
            this.managePositions(i);

            // 2. Scan for New Setups (on CLOSED candles up to i)
            this.scanForSetups(i);

            // Logging progress
            if (i % 60 === 0 && i > 0) {
                // console.log(`Simulated ${i} minutes... Equity: $${this.equity.toFixed(2)}`);
            }
        }

        console.log('--- 🔴 Simulation Ended ---');
        this.generateReport();
    }

    private managePositions(idx: number) {
        for (let i = this.positions.length - 1; i >= 0; i--) {
            const pos = this.positions[i];
            const data = this.tickers.get(pos.symbol);
            if (!data || idx >= data.length) continue;

            const candle = data[idx];
            let exitPrice = 0;
            let reason = '';

            if (pos.side === 'LONG') {
                if (candle.low <= pos.stopLoss) {
                    exitPrice = pos.stopLoss - this.slippage;
                    reason = 'STOP_LOSS';
                } else if (candle.high >= pos.target) {
                    exitPrice = pos.target;
                    reason = 'TARGET_HIT';
                } else if (idx === data.length - 1) {
                    exitPrice = candle.close;
                    reason = 'EOD_EXIT';
                }
                else if (this.getTimeDiffMinutes(pos.entryTime, candle.date) >= 120) {
                    exitPrice = candle.close;
                    reason = 'TIME_EXIT';
                }
            } else {
                if (candle.high >= pos.stopLoss) {
                    exitPrice = pos.stopLoss + this.slippage;
                    reason = 'STOP_LOSS';
                } else if (candle.low <= pos.target) {
                    exitPrice = pos.target;
                    reason = 'TARGET_HIT';
                } else if (idx === data.length - 1) {
                    exitPrice = candle.close;
                    reason = 'EOD_EXIT';
                }
                else if (this.getTimeDiffMinutes(pos.entryTime, candle.date) >= 120) {
                    exitPrice = candle.close;
                    reason = 'TIME_EXIT';
                }
            }

            if (exitPrice > 0) {
                this.closePosition(i, exitPrice, candle.date, reason);
            }
        }
    }

    private scanForSetups(idx: number) {
        // We need at least 30 mins of history to form the range
        if (idx < 30) return;

        this.tickers.forEach((data, symbol) => {
            // Check bounds
            if (idx >= data.length) return;

            // Check if we already have a position
            if (this.positions.find(p => p.symbol === symbol)) return;

            // Check if we already traded today
            if ((this.tradesToday.get(symbol) || 0) >= 1) return;

            // ORB Logic matching Backtest (Buy Stop)

            const currentCandle = data[idx];
            const currentDay = currentCandle.date.split('T')[0];

            // Optimization: Find index of first candle of today
            let startOfToday = idx;
            // Backtrack only a max of 400 candles (1 day) to avoid perf kill
            let limit = 400;
            while (startOfToday > 0 && limit > 0 && data[startOfToday - 1].date.startsWith(currentDay)) {
                startOfToday--;
                limit--;
            }

            // Check if we are at least 30 mins into the day
            if (idx - startOfToday < 30) return;

            const openingRange = data.slice(startOfToday, startOfToday + 30);
            const rangeHigh = Math.max(...openingRange.map(c => c.high));
            const rangeLow = Math.min(...openingRange.map(c => c.low));

            // Check Breakout on CURRENT candle (idx)
            let breakout: 'LONG' | 'SHORT' | 'NONE' = 'NONE';
            let entryPrice = 0;
            let stop = 0;
            let target = 0;

            if (currentCandle.high > rangeHigh) {
                breakout = 'LONG';
                entryPrice = rangeHigh + this.slippage;
                stop = rangeLow;
                target = entryPrice + (rangeHigh - rangeLow);
            } else if (currentCandle.low < rangeLow) {
                breakout = 'SHORT';
                entryPrice = rangeLow - this.slippage;
                stop = rangeHigh;
                target = entryPrice - (rangeHigh - rangeLow);
            }

            if (breakout !== 'NONE') {
                this.openPosition({
                    symbol,
                    breakout,
                    currentPrice: entryPrice,
                    stopLoss: stop,
                    target
                }, currentCandle.date);
            }
        });
    }

    private openPosition(setup: any, time: string) {
        // Strict Cash Check
        if (this.cash < this.amountPerTrade) {
            // Can't afford trade
            return;
        }

        const quantity = Math.floor(this.amountPerTrade / setup.currentPrice);
        if (quantity === 0) return;

        this.cash -= (quantity * setup.currentPrice);

        this.positions.push({
            symbol: setup.symbol,
            side: setup.breakout,
            entryPrice: setup.currentPrice,
            quantity,
            stopLoss: setup.stopLoss,
            target: setup.target,
            entryTime: time
        });

        const count = this.tradesToday.get(setup.symbol) || 0;
        this.tradesToday.set(setup.symbol, count + 1);
    }

    private getDateAtIdx(idx: number): string | null {
        for (const [sym, data] of this.tickers) {
            if (data[idx]) return data[idx].date.split('T')[0];
        }
        return null;
    }

    private closePosition(index: number, price: number, time: string, reason: string) {
        const pos = this.positions[index];
        const pnl = pos.side === 'LONG'
            ? (price - pos.entryPrice) * pos.quantity
            : (pos.entryPrice - price) * pos.quantity;

        const returnPercent = (pnl / (pos.entryPrice * pos.quantity)) * 100;

        this.tradeHistory.push({
            symbol: pos.symbol,
            entryTime: pos.entryTime,
            exitTime: time,
            side: pos.side,
            pnl,
            returnPercent,
            reason
        });

        this.positions.splice(index, 1);

        // Instant Settlement: Return Principal + Profit
        this.equity += pnl;
        const principal = pos.entryPrice * pos.quantity;
        this.cash += (principal + pnl);
    }

    private getTimeDiffMinutes(d1: string, d2: string): number {
        return (new Date(d2).getTime() - new Date(d1).getTime()) / 60000;
    }

    private generateReport() {
        console.log('\n=== 📊 Simulation Report ===');
        console.log(`Ending Equity: $${this.equity.toFixed(2)} (Start: $100,000)`);
        console.log(`Total Trades: ${this.tradeHistory.length}`);

        const wins = this.tradeHistory.filter(t => t.pnl > 0);
        const winRate = this.tradeHistory.length > 0 ? (wins.length / this.tradeHistory.length * 100) : 0;

        console.log(`Win Rate: ${winRate.toFixed(2)}%`);
        console.log(`Net Profit: $${(this.equity - 100000).toFixed(2)}`);
    }
}
