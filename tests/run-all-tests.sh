#!/bin/bash

# Run all duplicate message tests
# Prerequisites: Bot must be running on http://localhost:3978

set -e

BOT_URL="${BOT_URL:-http://localhost:3978/api/messages}"
export BOT_URL

echo "🧪 Running Duplicate Messages Test Suite"
echo "Bot URL: $BOT_URL"
echo ""

# Check if bot is running
if ! curl -s "$BOT_URL" > /dev/null 2>&1; then
    echo "❌ Error: Bot is not running at $BOT_URL"
    echo "   Please start the bot first: npm start"
    exit 1
fi

echo "✅ Bot is running"
echo ""

# Run all tests
TESTS=(
    "duplicate-rapid-fire.test.ts"
    "teams-retry-simulation.test.ts"
    "concurrent-processing.test.ts"
    "error-handler-duplication.test.ts"
    "card-action-isolation.test.ts"
    "welcome-card-deduplication.test.ts"
    "activity-id-edge-cases.test.ts"
)

PASSED=0
FAILED=0

for test in "${TESTS[@]}"; do
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "Running: $test"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    
    if npx tsx "tests/$test"; then
        echo "✅ PASSED: $test"
        ((PASSED++))
    else
        echo "❌ FAILED: $test"
        ((FAILED++))
    fi
    
    echo ""
    sleep 1  # Brief pause between tests
done

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Test Summary"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Passed: $PASSED"
echo "Failed: $FAILED"
echo "Total:  $((PASSED + FAILED))"
echo ""

if [ $FAILED -eq 0 ]; then
    echo "✅ All tests passed!"
    exit 0
else
    echo "❌ Some tests failed. Please review the output above."
    exit 1
fi

