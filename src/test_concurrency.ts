import { EventSource } from 'eventsource';

async function testConcurrency() {
    const baseUrl = 'http://localhost:3000';
    console.log('--- Testing Concurrency ---');

    try {
        // Shared logic to wait for specific JSON-RPC response ID
        const waitForResponse = (es: EventSource, requestId: number | string): Promise<any> => {
            return new Promise((resolve, reject) => {
                const listener = (event: any) => {
                    try {
                        const data = JSON.parse(event.data);
                        if (data.id === requestId) {
                            es.removeEventListener('message', listener);
                            resolve(data);
                        }
                    } catch (e) {
                        // ignore parse errors for other messages
                    }
                };
                es.addEventListener('message', listener);

                // Timeout
                setTimeout(() => {
                    es.removeEventListener('message', listener);
                    reject(new Error(`Timeout waiting for response to ID ${requestId}`));
                }, 10000);
            });
        };

        // 1. Establish Session 1
        console.log('Establishing Session 1...');
        const es1 = new EventSource(`${baseUrl}/mcp`);
        let sessionId1: string = '';

        const session1Ready = new Promise<void>((resolve, reject) => {
            es1.addEventListener('endpoint', (event: any) => {
                const data = event.data;
                const match = data.match(/sessionId=([^&]+)/);
                if (match) {
                    sessionId1 = match[1];
                    console.log(`Session 1 Established: ${sessionId1}`);
                    resolve();
                }
            });
            es1.onerror = (err: any) => reject(`ES1 Error: ${err}`);
        });

        // 2. Establish Session 2
        console.log('Establishing Session 2...');
        const es2 = new EventSource(`${baseUrl}/mcp`);
        let sessionId2: string = '';

        const session2Ready = new Promise<void>((resolve, reject) => {
            es2.addEventListener('endpoint', (event: any) => {
                const data = event.data;
                const match = data.match(/sessionId=([^&]+)/);
                if (match) {
                    sessionId2 = match[1];
                    console.log(`Session 2 Established: ${sessionId2}`);
                    resolve();
                }
            });
            es2.onerror = (err: any) => reject(`ES2 Error: ${err}`);
        });

        await Promise.all([session1Ready, session2Ready]);

        console.log('Both sessions established. Sending requests...');

        const reqId1 = 1;
        const reqId2 = 2; // Use distinct IDs just in case, though sessions are separate

        // Prepare listeners BEFORE sending requests
        const respPromise1 = waitForResponse(es1, reqId1);
        const respPromise2 = waitForResponse(es2, reqId2);

        // 3. Send Tool Call for Session 1 (List Tools)
        fetch(`${baseUrl}/messages?sessionId=${sessionId1}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: reqId1,
                method: 'tools/list'
            })
        }).then(async res => {
            const text = await res.text();
            console.log(`Sent Req 1, status: ${res.status}, body: ${text}`);
        });

        // 4. Send Tool Call for Session 2 (List Tools)
        fetch(`${baseUrl}/messages?sessionId=${sessionId2}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: reqId2,
                method: 'tools/list'
            })
        }).then(async res => {
            const text = await res.text();
            console.log(`Sent Req 2, status: ${res.status}, body: ${text}`);
        });

        console.log('Waiting for responses via SSE...');
        const [res1, res2] = await Promise.all([respPromise1, respPromise2]);

        console.log('Response 1:', JSON.stringify(res1).substring(0, 100) + '...');
        console.log('Response 2:', JSON.stringify(res2).substring(0, 100) + '...');

        es1.close();
        es2.close();
        console.log('--- Concurrency Test Passed ---');
        process.exit(0);

    } catch (error) {
        console.error('Concurrency Test Failed:', error);
        process.exit(1);
    }
}

testConcurrency();
