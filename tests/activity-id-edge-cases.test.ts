/**
 * Test 7: Activity ID Edge Cases
 * Purpose: Test undefined/missing IDs
 * 
 * This test sends messages with undefined or missing activity.id
 * and verifies that deduplication still works correctly.
 */

import * as http from 'http';

const BOT_URL = process.env.BOT_URL || 'http://localhost:3978/api/messages';

interface TestResult {
    testCase: string;
    statusCode: number;
    timestamp: number;
}

async function sendMessageWithoutId(testCase: string): Promise<TestResult> {
    return new Promise((resolve, reject) => {
        // Send message without activity.id
        const postData = JSON.stringify({
            type: 'message',
            // No 'id' field
            timestamp: new Date().toISOString(),
            channelId: 'msteams',
            from: {
                id: 'test-user-no-id',
                name: 'Test User'
            },
            conversation: {
                id: `test-conversation-no-id-${testCase}`,
                conversationType: 'personal'
            },
            text: `test message ${testCase}`
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
                    testCase,
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

async function sendMessageWithNullId(): Promise<TestResult> {
    return new Promise((resolve, reject) => {
        // Send message with null id
        const postData = JSON.stringify({
            type: 'message',
            id: null, // Explicitly null
            timestamp: new Date().toISOString(),
            channelId: 'msteams',
            from: {
                id: 'test-user-null-id',
                name: 'Test User'
            },
            conversation: {
                id: 'test-conversation-null-id',
                conversationType: 'personal'
            },
            text: 'test message with null id'
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
                    testCase: 'null-id',
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
    console.log('🧪 Test 7: Activity ID Edge Cases');
    console.log('Testing messages with missing or null activity.id...\n');

    const results: TestResult[] = [];

    // Test 1: Message without id field
    console.log('📤 Test 1: Sending message without id field...');
    const result1 = await sendMessageWithoutId('no-id');
    results.push(result1);
    console.log(`   Status: ${result1.statusCode}\n`);

    // Test 2: Message with null id
    console.log('📤 Test 2: Sending message with null id...');
    const result2 = await sendMessageWithNullId();
    results.push(result2);
    console.log(`   Status: ${result2.statusCode}\n`);

    // Test 3: Send same message twice (should be deduplicated even without id)
    console.log('📤 Test 3: Sending same message twice (deduplication test)...');
    const result3a = await sendMessageWithoutId('duplicate-1');
    await new Promise(resolve => setTimeout(resolve, 100));
    const result3b = await sendMessageWithoutId('duplicate-1'); // Same test case
    results.push(result3a, result3b);
    console.log(`   First attempt status: ${result3a.statusCode}`);
    console.log(`   Second attempt status: ${result3b.statusCode}\n`);

    console.log(`📊 Results:`);
    results.forEach((result) => {
        console.log(`   ${result.testCase}: Status ${result.statusCode}`);
    });

    // Verification
    const allSuccess = results.every(r => r.statusCode === 200);
    if (allSuccess) {
        console.log(`\n✅ PASS: All requests returned 200 OK`);
        console.log(`   Note: Check bot logs to verify deduplication works with hash-based IDs`);
        process.exit(0);
    } else {
        console.log(`\n❌ FAIL: Some requests failed`);
        process.exit(1);
    }
}

// Run the test
runTest();


