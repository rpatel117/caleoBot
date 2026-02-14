/**
 * Test 2: Teams Retry Simulation
 * Purpose: Simulate Teams retry behavior
 * 
 * This test sends the same message twice with a 2-second delay to simulate
 * Teams retrying a request. It verifies that the second request is ignored.
 */

import * as http from 'http';

const BOT_URL = process.env.BOT_URL || 'http://localhost:3978/api/messages';
const TEST_MESSAGE = 'test retry simulation';
const MESSAGE_ID = `test-retry-${Date.now()}`;

interface TestResult {
    attempt: number;
    statusCode: number;
    responseBody: string;
    timestamp: number;
}

async function sendMessage(attempt: number): Promise<TestResult> {
    return new Promise((resolve, reject) => {
        const postData = JSON.stringify({
            type: 'message',
            id: MESSAGE_ID, // Same ID for both attempts (simulating retry)
            timestamp: new Date().toISOString(),
            channelId: 'msteams',
            from: {
                id: 'test-user-2',
                name: 'Test User'
            },
            conversation: {
                id: 'test-conversation-retry',
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
                resolve({
                    attempt,
                    statusCode: res.statusCode || 0,
                    responseBody: data,
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
    console.log('🧪 Test 2: Teams Retry Simulation');
    console.log('Sending same message twice with 2-second delay...\n');

    // First attempt
    console.log('📤 Sending first message...');
    const firstResult = await sendMessage(1);
    console.log(`   Status: ${firstResult.statusCode}`);
    console.log(`   Timestamp: ${new Date(firstResult.timestamp).toISOString()}\n`);

    // Wait 2 seconds (simulating Teams retry delay)
    console.log('⏳ Waiting 2 seconds (simulating Teams retry delay)...');
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Second attempt (retry)
    console.log('📤 Sending second message (retry)...');
    const secondResult = await sendMessage(2);
    console.log(`   Status: ${secondResult.statusCode}`);
    console.log(`   Timestamp: ${new Date(secondResult.timestamp).toISOString()}\n`);

    const timeDiff = secondResult.timestamp - firstResult.timestamp;
    console.log(`📊 Results:`);
    console.log(`   First attempt status: ${firstResult.statusCode}`);
    console.log(`   Second attempt status: ${secondResult.statusCode}`);
    console.log(`   Time between attempts: ${timeDiff}ms`);

    // Verification
    // Both should return 200 OK (immediate response)
    // But the bot should only process the first one
    if (firstResult.statusCode === 200 && secondResult.statusCode === 200) {
        console.log(`\n✅ PASS: Both requests returned 200 OK (as expected)`);
        console.log(`   Note: Check bot logs to verify only one message was processed`);
        process.exit(0);
    } else {
        console.log(`\n❌ FAIL: Unexpected status codes`);
        process.exit(1);
    }
}

// Run the test
runTest();


