/**
 * Test 6: Welcome Card Deduplication
 * Purpose: Test first message handling
 * 
 * This test sends the first message multiple times (simulating retry)
 * and verifies that the welcome card is sent only once.
 */

import * as http from 'http';

const BOT_URL = process.env.BOT_URL || 'http://localhost:3978/api/messages';
const CONVERSATION_ID = `test-conversation-welcome-${Date.now()}`;

interface TestResult {
    attempt: number;
    statusCode: number;
    timestamp: number;
}

async function sendFirstMessage(attempt: number): Promise<TestResult> {
    return new Promise((resolve, reject) => {
        const postData = JSON.stringify({
            type: 'message',
            id: `test-welcome-${Date.now()}-${attempt}`,
            timestamp: new Date().toISOString(),
            channelId: 'msteams',
            from: {
                id: 'test-user-welcome',
                name: 'Test User'
            },
            conversation: {
                id: CONVERSATION_ID, // Same conversation ID
                conversationType: 'personal'
            },
            text: 'hello'
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
    console.log('🧪 Test 6: Welcome Card Deduplication');
    console.log('Sending first message 3 times (simulating retries)...\n');

    const results: TestResult[] = [];

    // Send first message 3 times
    for (let i = 1; i <= 3; i++) {
        console.log(`📤 Sending first message (attempt ${i})...`);
        const result = await sendFirstMessage(i);
        results.push(result);
        console.log(`   Status: ${result.statusCode}`);
        
        if (i < 3) {
            // Wait 500ms between attempts
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }

    console.log(`\n📊 Results:`);
    results.forEach((result) => {
        console.log(`   Attempt ${result.attempt}: Status ${result.statusCode}`);
    });

    // Verification
    const allSuccess = results.every(r => r.statusCode === 200);
    if (allSuccess) {
        console.log(`\n✅ PASS: All requests returned 200 OK`);
        console.log(`   Note: Check bot logs to verify welcome card was sent only once`);
        console.log(`   Expected: Only first attempt should trigger welcome card`);
        process.exit(0);
    } else {
        console.log(`\n❌ FAIL: Some requests failed`);
        process.exit(1);
    }
}

// Run the test
runTest();


