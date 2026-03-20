
import { drizzle } from 'drizzle-orm/node-postgres';
import pkg from 'pg';
const { Pool } = pkg;
import * as schema from './schema.js';
import * as dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
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
    } catch (e) {
        console.error("❌ Database Connection Failed:", e);
        // Fallback or warning
    }
}
