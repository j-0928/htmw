
import { pgTable, serial, text, doublePrecision, timestamp, integer, boolean } from 'drizzle-orm/pg-core';

export const trades = pgTable('trades', {
    id: serial('id').primaryKey(),
    symbol: text('symbol').notNull(),
    side: text('side').notNull(), // LONG or SHORT
    entryPrice: doublePrecision('entry_price').notNull(),
    exitPrice: doublePrecision('exit_price'),
    quantity: integer('quantity').notNull(),
    initialQty: integer('initial_qty').notNull(),
    stopLoss: doublePrecision('stop_loss').notNull(),
    target1: doublePrecision('target1').notNull(),
    status: text('status').notNull().default('OPEN'), // OPEN, CLOSED, SCALED_OUT
    pnl: doublePrecision('pnl'),
    returnPercent: doublePrecision('return_percent'),
    entryTime: timestamp('entry_time').defaultNow(),
    exitTime: timestamp('exit_time'),
    isMultiDay: boolean('is_multi_day').default(false)
});

export const signals = pgTable('signals', {
    id: serial('id').primaryKey(),
    symbol: text('symbol').notNull(),
    side: text('side').notNull(),
    convictionScore: integer('conviction_score').notNull(),
    reason: text('reason'),
    timestamp: timestamp('timestamp').defaultNow(),
    wasExecuted: boolean('was_executed').default(false)
});

export const dailyMetrics = pgTable('daily_metrics', {
    id: serial('id').primaryKey(),
    date: text('date').notNull().unique(),
    equity: doublePrecision('equity').notNull(),
    winRate: doublePrecision('win_rate'),
    totalTrades: integer('total_trades')
});

export const watchlist = pgTable('watchlist', {
    id: serial('id').primaryKey(),
    symbol: text('symbol').notNull().unique(),
    side: text('side').notNull(),
    score: integer('score').notNull(),
    reason: text('reason'),
    discoveryTime: timestamp('discovery_time').defaultNow()
});
