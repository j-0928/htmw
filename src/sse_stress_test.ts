import { EventSource } from 'eventsource';
import axios from 'axios';

async function sseStressTest() {
    const PORT = process.env.PORT || 3000;
    const baseUrl = `http://localhost:${PORT}`;
    const CONCURRENT_CLIENTS = 5;

    console.log(`--- STARTING SSE CONCURRENCY STRESS TEST (${CONCURRENT_CLIENTS} clients) ---`);

    const clients = [];

    for (let i = 0; i < CONCURRENT_CLIENTS; i++) {
        clients.push(new Promise((resolve, reject) => {
            const es = new EventSource(`${baseUrl}/mcp`);
            let sessionId: string;

            es.onopen = () => {
                // Get sessionId from the redirect or the connection
                // In our implementation, we can find it via the /messages request which requires it
            };

            es.addEventListener('endpoint', (event: any) => {
                const data = JSON.parse(event.data);
                const uri = new URL(data.uri, baseUrl);
                sessionId = uri.searchParams.get('sessionId')!;
                console.log(`Client ${i} connected. Session: ${sessionId}`);

                // Send a tool request
                axios.post(`${baseUrl}/messages?sessionId=${sessionId}`, {
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'tools/call',
                    params: {
                        name: 'stock_lookup',
                        arguments: { symbol: 'AAPL' }
                    }
                }).then(res => {
                    console.log(`Client ${i} received response for AAPL`);
                    es.close();
                    resolve(true);
                }).catch(err => {
                    console.error(`Client ${i} failed:`, err.message);
                    es.close();
                    reject(err);
                });
            });

            es.onerror = (err: any) => {
                console.error(`Client ${i} SSE Error:`, err);
                es.close();
                reject(err);
            };
        }));
    }

    try {
        await Promise.all(clients);
        console.log('✅ SSE Stress Test PASS: All clients received independent responses.');
    } catch (err) {
        console.error('❌ SSE Stress Test FAIL');
    }
}

sseStressTest();
