
import { drizzle } from 'drizzle-orm/node-postgres';
import pkg from 'pg';
const { Pool } = pkg;
import * as schema from './schema.js';
import * as dotenv from 'dotenv';

dotenv.config();

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
    console.error("❌ CRITICAL: DATABASE_URL environment variable is MISSING.");
} else {
    console.log(`✅ DATABASE_URL detected (length: ${dbUrl.length})`);
}

const pool = new Pool({
    connectionString: dbUrl,
    ssl: {
        rejectUnauthorized: false
    }
});

export const db = drizzle(pool, { schema });

/**
 * Initialize Database (Migrate tables if needed)
 * In a production app, we'd use drizzle-kit push/migrate,
 * but for this bot, we can use a simple initialization.
 */
export async function initDb() {
    try {
        console.log("🗄️ Initializing Database connection...");
        await pool.query('SELECT 1');
        console.log("✅ Database Connected.");

        // Fail-safe table creation for watchlist
        await pool.query(`
            CREATE TABLE IF NOT EXISTS "watchlist" (
                "id" SERIAL PRIMARY KEY,
                "symbol" TEXT NOT NULL UNIQUE,
                "side" TEXT NOT NULL,
                "score" INTEGER NOT NULL,
                "reason" TEXT,
                "discovery_time" TIMESTAMP DEFAULT NOW()
            );
        `);
        console.log("📋 Watchlist table verified.");
    } catch (e) {
        console.error("❌ Database Initialization Failed:", e);
    }
}
