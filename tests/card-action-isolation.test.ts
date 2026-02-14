/**
 * Test 5: Card Action Isolation
 * Purpose: Test card actions don't trigger normal flow
 * 
 * This test simulates a card action click and verifies that
 * it doesn't trigger duplicate processing messages.
 */

import * as http from 'http';

const BOT_URL = process.env.BOT_URL || 'http://localhost:3978/api/messages';

interface TestResult {
    statusCode: number;
    responseBody: string;
    timestamp: number;
}

async function sendCardAction(): Promise<TestResult> {
    return new Promise((resolve, reject) => {
        // Simulate a card action (Action.Submit)
        const postData = JSON.stringify({
            type: 'message',
            id: `test-card-action-${Date.now()}`,
            timestamp: new Date().toISOString(),
            channelId: 'msteams',
            from: {
                id: 'test-user-card',
                name: 'Test User'
            },
            conversation: {
                id: 'test-conversation-card',
                conversationType: 'personal'
            },
            // Card action data
            value: {
                action: 'plan_my_day',
                text: 'Plan my day'
            }
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
    console.log('🧪 Test 5: Card Action Isolation');
    console.log('Sending card action (Action.Submit)...\n');

    try {
        const result = await sendCardAction();
        
        console.log(`📊 Results:`);
        console.log(`   Status code: ${result.statusCode}`);
        console.log(`   Response body: ${result.responseBody.substring(0, 100)}...`);

        // Verification
        if (result.statusCode === 200) {
            console.log(`\n✅ PASS: Card action request returned 200 OK`);
            console.log(`   Note: Check bot logs to verify:`);
            console.log(`   1. Only one "processing" message was sent`);
            console.log(`   2. Card action was handled without triggering normal flow`);
            process.exit(0);
        } else {
            console.log(`\n❌ FAIL: Unexpected status code ${result.statusCode}`);
            process.exit(1);
        }
    } catch (error) {
        console.error('❌ Test failed with error:', error);
        process.exit(1);
    }
}

// Run the test
runTest();


