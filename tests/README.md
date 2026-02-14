# Duplicate Messages Test Suite

This test suite verifies that all duplicate message issues have been fixed with 100% certainty.

## Running the Tests

### Prerequisites

1. Bot must be running on `http://localhost:3978`
2. Set `BOT_URL` environment variable if bot is running elsewhere:
   ```bash
   export BOT_URL=http://your-bot-url:3978/api/messages
   ```

### Run Individual Tests

```bash
# Test 1: Rapid fire messages
npx ts-node tests/duplicate-rapid-fire.test.ts

# Test 2: Teams retry simulation
npx ts-node tests/teams-retry-simulation.test.ts

# Test 3: Concurrent processing
npx ts-node tests/concurrent-processing.test.ts

# Test 4: Error handler duplication
npx ts-node tests/error-handler-duplication.test.ts

# Test 5: Card action isolation
npx ts-node tests/card-action-isolation.test.ts

# Test 6: Welcome card deduplication
npx ts-node tests/welcome-card-deduplication.test.ts

# Test 7: Activity ID edge cases
npx ts-node tests/activity-id-edge-cases.test.ts
```

### Run All Tests

```bash
# Run all automated tests
./tests/run-all-tests.sh

# Or manually:
for test in tests/*.test.ts; do
  echo "Running $test..."
  npx ts-node "$test"
  echo ""
done
```

### Manual Teams Integration Test

See `tests/teams-integration.test.md` for step-by-step manual test cases in Microsoft Teams.

## Test Descriptions

### Test 1: Rapid Fire Messages
Sends 10 identical messages within 1 second and verifies only 1 response per message.

### Test 2: Teams Retry Simulation
Sends the same message twice with a 2-second delay to simulate Teams retry behavior.

### Test 3: Concurrent Processing
Sends the same message from multiple "clients" simultaneously to test race conditions.

### Test 4: Error Handler Duplication
Triggers an error and verifies only one error message is sent (not from both error handler and catch block).

### Test 5: Card Action Isolation
Simulates a card action click and verifies it doesn't trigger duplicate processing messages.

### Test 6: Welcome Card Deduplication
Sends the first message multiple times and verifies the welcome card is sent only once.

### Test 7: Activity ID Edge Cases
Tests messages with undefined or missing activity.id to verify hash-based deduplication works.

## Expected Results

All tests should:
- ✅ Return 200 OK status codes
- ✅ Process each message exactly once
- ✅ Send exactly one response per message
- ✅ Not generate duplicate messages

## Troubleshooting

If tests fail:

1. **Check bot is running**: `curl http://localhost:3978/api/health`
2. **Check bot logs** for duplicate processing indicators
3. **Verify fixes are applied** in `src/index.ts`:
   - Immediate 200 OK response
   - Atomic message ID deduplication
   - Processing flags
   - Error handler guards

## Success Criteria

For 100% certainty that duplicates are eliminated:
- ✅ All automated tests pass
- ✅ Manual Teams integration tests pass
- ✅ Bot logs show no duplicate processing
- ✅ Teams chat shows no duplicate messages


