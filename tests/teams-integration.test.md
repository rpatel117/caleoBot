# Manual Teams Integration Test Guide

This guide provides step-by-step manual test cases to verify that duplicate messages are completely eliminated in real Teams scenarios.

## Prerequisites

1. Bot is running locally on `http://localhost:3978`
2. ngrok is running and exposing the bot
3. Bot manifest is side-loaded in Microsoft Teams
4. You have access to the bot in Teams (personal chat)

## Test Cases

### Test Case 1: First Message - Welcome Card

**Steps:**
1. Open a new conversation with the bot in Teams
2. Send message: `hello`
3. Wait for response

**Expected Results:**
- ✅ Only ONE welcome card appears
- ✅ No duplicate "processing" messages
- ✅ No duplicate welcome cards

**Verification:**
- Check Teams chat - should see exactly 1 welcome card
- Check bot logs - should see "Welcome card sent to user" only once

---

### Test Case 2: Immediate Retry - No Duplicates

**Steps:**
1. Send message: `help`
2. Immediately (within 1 second) send the same message again: `help`
3. Wait for responses

**Expected Results:**
- ✅ Only ONE response to each message
- ✅ Second message is either ignored or processed separately (not duplicate)
- ✅ No duplicate "processing" messages

**Verification:**
- Check Teams chat - should see 2 distinct responses (one per message)
- Check bot logs - should see both messages logged, but no duplicates

---

### Test Case 3: Card Button Click - Single Processing Message

**Steps:**
1. If welcome card is visible, click a button (e.g., "Plan my day")
2. If no welcome card, send a message that triggers a card with buttons
3. Click a button on the card

**Expected Results:**
- ✅ Only ONE "Caleo is processing your request..." message
- ✅ Only ONE final response
- ✅ No duplicate processing messages

**Verification:**
- Check Teams chat - should see exactly 1 processing message, then 1 response
- Check bot logs - should see "Processing message sent" only once

---

### Test Case 4: Rapid Fire Messages

**Steps:**
1. Rapidly send 5 different messages within 2 seconds:
   - `help`
   - `what can you do`
   - `show my calendar`
   - `plan my day`
   - `hello`
2. Wait for all responses

**Expected Results:**
- ✅ Exactly 5 responses (one per message)
- ✅ No duplicate responses
- ✅ Each message gets exactly one "processing" message (if applicable)

**Verification:**
- Check Teams chat - count responses, should be exactly 5
- Check bot logs - should see 5 distinct messages processed

---

### Test Case 5: Error Scenario - Single Error Message

**Steps:**
1. Send a message that might trigger an error (e.g., invalid calendar request without auth)
2. Observe error handling

**Expected Results:**
- ✅ Only ONE error message
- ✅ Not both from error handler AND catch block
- ✅ No duplicate error messages

**Verification:**
- Check Teams chat - should see exactly 1 error message
- Check bot logs - should see error logged, but only one error message sent

---

### Test Case 6: Suggestion Click - No Duplicates

**Steps:**
1. Send message: `help`
2. Wait for response with suggestion chips
3. Click one of the suggestion chips
4. Wait for response

**Expected Results:**
- ✅ Only ONE response to the clicked suggestion
- ✅ No duplicate processing messages
- ✅ Suggestion click is treated as a new message (not duplicate)

**Verification:**
- Check Teams chat - should see 1 response to suggestion click
- Check bot logs - should see suggestion click logged and processed once

---

### Test Case 7: Long-Running Request - No Retry Duplicates

**Steps:**
1. Send a message that takes a long time to process (e.g., complex calendar query)
2. Wait for response (may take 10-30 seconds)

**Expected Results:**
- ✅ Only ONE "processing" message
- ✅ Only ONE final response
- ✅ Teams doesn't retry and cause duplicates

**Verification:**
- Check Teams chat - should see 1 processing message, then 1 response
- Check bot logs - should see message processed only once
- Check for any retry attempts in logs (should be none)

---

### Test Case 8: Network Interruption Simulation

**Steps:**
1. Send a message
2. Immediately (within 1 second) disconnect and reconnect network
3. Wait for response

**Expected Results:**
- ✅ Only ONE response when network reconnects
- ✅ No duplicate responses due to retry
- ✅ Message is processed only once

**Verification:**
- Check Teams chat - should see exactly 1 response
- Check bot logs - should see message processed only once

---

## Success Criteria

All test cases must pass with:
- ✅ No duplicate messages in Teams chat
- ✅ No duplicate processing messages
- ✅ No duplicate error messages
- ✅ Each user action results in exactly one bot response
- ✅ Bot logs show no duplicate processing

## Troubleshooting

If duplicates are observed:

1. **Check bot logs** for:
   - "Duplicate message ignored" messages
   - Multiple "Processing message sent" for same message ID
   - Multiple responses for same message ID

2. **Check Teams behavior**:
   - Is Teams retrying requests?
   - Are there network issues causing retries?
   - Is the bot responding fast enough (< 3 seconds)?

3. **Verify fixes are applied**:
   - Immediate 200 OK response
   - Atomic message ID deduplication
   - Processing flags working
   - Error handler guards in place

## Reporting Issues

If duplicates are found, report:
1. Which test case failed
2. Screenshot of Teams chat showing duplicates
3. Bot logs showing duplicate processing
4. Message IDs from logs
5. Timestamp of when duplicates occurred


