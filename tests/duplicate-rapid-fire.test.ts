/**
 * Test 1: Rapid Fire Messages
 * Purpose: Test if rapid consecutive messages cause duplicates
 * 
 * This test sends 10 identical messages within 1 second and verifies
 * that only 1 response is generated per message.
 */

import * as http from 'http';

const BOT_URL = process.env.BOT_URL || 'http://localhost:3978/api/messages';
const TEST_MESSAGE = 'hello';

interface TestResult {
    messageIndex: number;
    responseCount: number;
    responses: string[];
    timestamp: number;
}

async function sendMessage(messageIndex: number): Promise<TestResult> {
    return new Promise((resolve, reject) => {
        const postData = JSON.stringify({
            type: 'message',
            id: `test-rapid-${Date.now()}-${messageIndex}`,
            timestamp: new Date().toISOString(),
            channelId: 'msteams',
            from: {
                id: 'test-user-1',
                name: 'Test User'
            },
            conversation: {
                id: 'test-conversation-rapid',
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

        const responses: string[] = [];
        let responseCount = 0;

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.on('end', () => {
                responseCount++;
                responses.push(data);
                resolve({
                    messageIndex,
                    responseCount,
                    responses,
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
    console.log('🧪 Test 1: Rapid Fire Messages');
    console.log('Sending 10 identical messages within 1 second...\n');

    const startTime = Date.now();
    const promises: Promise<TestResult>[] = [];

    // Send 10 messages simultaneously
    for (let i = 0; i < 10; i++) {
        promises.push(sendMessage(i));
    }

    try {
        const results = await Promise.all(promises);
        const endTime = Date.now();
        const duration = endTime - startTime;

        console.log(`✅ All messages sent in ${duration}ms\n`);

        // Analyze results
        const uniqueResponses = new Set<string>();
        let totalResponses = 0;

        results.forEach((result, index) => {
            console.log(`Message ${index + 1}: ${result.responseCount} response(s)`);
            result.responses.forEach((response, respIndex) => {
                uniqueResponses.add(response);
                totalResponses++;
            });
        });

        console.log(`\n📊 Results:`);
        console.log(`   Total messages sent: 10`);
        console.log(`   Total responses received: ${totalResponses}`);
        console.log(`   Unique responses: ${uniqueResponses.size}`);

        // Verification
        if (totalResponses === 10) {
            console.log(`\n✅ PASS: Each message received exactly 1 response`);
            process.exit(0);
        } else if (totalResponses > 10) {
            console.log(`\n❌ FAIL: Received ${totalResponses} responses for 10 messages (duplicates detected!)`);
            process.exit(1);
        } else {
            console.log(`\n⚠️  WARNING: Received ${totalResponses} responses for 10 messages (some messages may have been lost)`);
            process.exit(1);
        }
    } catch (error) {
        console.error('❌ Test failed with error:', error);
        process.exit(1);
    }
}

// Run the test
runTest();


