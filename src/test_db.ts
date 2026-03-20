
import { initDb, db } from './db/index.js';
import { signals } from './db/schema.js';

async function test() {
    console.log("🚀 Testing Database Connection...");
    await initDb();
    
    try {
        console.log("📡 Attempting to insert a test signal...");
        await db.insert(signals).values({
            symbol: 'TEST',
            side: 'LONG',
            convictionScore: 6,
            reason: 'Database Connection Test',
            wasExecuted: false
        });
        console.log("✅ Signal inserted successfully.");
        
        const res = await db.select().from(signals).limit(1);
        console.log("📖 Query Result:", res);
        
        console.log("🎉 Database Verification PASSED.");
    } catch (e) {
        console.error("❌ Database Verification FAILED:", e);
    }
    process.exit(0);
}

test();
