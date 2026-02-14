/**
 * Test 3: Concurrent Processing
 * Purpose: Test race conditions
 * 
 * This test sends the same message from multiple "clients" simultaneously
 * to test for race conditions in message deduplication.
 */

import * as http from 'http';

const BOT_URL = process.env.BOT_URL || 'http://localhost:3978/api/messages';
const TEST_MESSAGE = 'concurrent test';
const MESSAGE_ID = `test-concurrent-${Date.now()}`;
const NUM_CLIENTS = 5;

interface TestResult {
    clientId: number;
    statusCode: number;
    responseTime: number;
    timestamp: number;
}

async function sendMessageFromClient(clientId: number): Promise<TestResult> {
    return new Promise((resolve, reject) => {
        const startTime = Date.now();
        
        const postData = JSON.stringify({
            type: 'message',
            id: `${MESSAGE_ID}-client-${clientId}`, // Different IDs per client
            timestamp: new Date().toISOString(),
            channelId: 'msteams',
            from: {
                id: `test-user-concurrent-${clientId}`,
                name: `Test User ${clientId}`
            },
            conversation: {
                id: 'test-conversation-concurrent',
                conversationType: 'personal'
            },
            text: TEST_MESSAGE
        });

        const options = {
            hostname: new URL(BOT_URL).hostname,
            port: new URL(BOT_URL).port || 3978,
            path: new URL(BOT_URL).pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.on('end', () => {
                const responseTime = Date.now() - startTime;
                resolve({
                    clientId,
                    statusCode: res.statusCode || 0,
                    responseTime,
                    timestamp: Date.now()
                });
            });
        });

        req.on('error', (error) => {
            reject(error);
        });

        req.write(postData);
        req.end();
    });
}

async function runTest() {
    console.log('🧪 Test 3: Concurrent Processing');
    console.log(`Sending same message from ${NUM_CLIENTS} clients simultaneously...\n`);

    const startTime = Date.now();
    const promises: Promise<TestResult>[] = [];

    // Send from all clients simultaneously
    for (let i = 0; i < NUM_CLIENTS; i++) {
        promises.push(sendMessageFromClient(i + 1));
    }

    try {
        const results = await Promise.all(promises);
        const endTime = Date.now();
        const totalDuration = endTime - startTime;

        console.log(`✅ All requests completed in ${totalDuration}ms\n`);

        // Analyze results
        const statusCodes = new Map<number, number>();
        let totalResponseTime = 0;

        results.forEach((result) => {
            console.log(`Client ${result.clientId}: Status ${result.statusCode}, Response time ${result.responseTime}ms`);
            
            const count = statusCodes.get(result.statusCode) || 0;
            statusCodes.set(result.statusCode, count + 1);
            totalResponseTime += result.responseTime;
        });

        const avgResponseTime = totalResponseTime / results.length;

        console.log(`\n📊 Results:`);
        console.log(`   Total clients: ${NUM_CLIENTS}`);
        console.log(`   Total duration: ${totalDuration}ms`);
        console.log(`   Average response time: ${avgResponseTime.toFixed(2)}ms`);
        console.log(`   Status code distribution:`);
        statusCodes.forEach((count, code) => {
            console.log(`     ${code}: ${count} requests`);
        });

        // Verification
        const successCount = statusCodes.get(200) || 0;
        if (successCount === NUM_CLIENTS) {
            console.log(`\n✅ PASS: All ${NUM_CLIENTS} requests returned 200 OK`);
            console.log(`   Note: Check bot logs to verify messages were processed correctly`);
            process.exit(0);
        } else {
            console.log(`\n❌ FAIL: Only ${successCount}/${NUM_CLIENTS} requests succeeded`);
            process.exit(1);
        }
    } catch (error) {
        console.error('❌ Test failed with error:', error);
        process.exit(1);
    }
}

// Run the test
runTest();


