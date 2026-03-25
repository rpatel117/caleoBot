# Smart Model Router — Sonnet + Haiku Hybrid

**Date**: 2026-03-25
**Status**: Implemented, pending deploy

---

## What Changed

Caleo now uses a **two-model architecture** for AI agent calls:

- **Sonnet 4.5** (`claude-sonnet-4-5-20241022`) — used for the **initial routing call** that decides which tools to invoke
- **Haiku 4.5** (`claude-haiku-4-5-20251001`) — used for all **subsequent tool-loop iterations** (processing tool results, making additional tool calls)

This gives Sonnet's superior reasoning and tool-calling intelligence for the critical "what should I do?" decision, while keeping the per-iteration cost at Haiku levels.

## Why

Haiku was occasionally failing to call `get_calendar_events` for dates outside the pre-loaded 6-day calendar window. It would see "no events in the pre-loaded context" and generalize to "the entire calendar is empty" instead of fetching the requested date range. Sonnet handles this correctly.

## Files Modified

### `src/agent/config.ts`
- Added `sonnetModel: 'claude-sonnet-4-5-20241022'` to `AGENT_CONFIG`
- Strengthened the tool usage instruction to explicitly state the date boundaries of the pre-loaded calendar:
  - Old: "covers a few surrounding days"
  - New: "covers ONLY {firstDate} through {lastDate}. You have ZERO information about any other dates."
  - Added: "NEVER say 'no events' or 'your calendar is clear' for dates you haven't fetched — that is a hallucination."

### `src/agent/anthropic-agent.ts`
- Initial API call now uses `AGENT_CONFIG.sonnetModel` (Sonnet)
- Tool-loop iterations continue using `AGENT_CONFIG.model` (Haiku)
- Added `sonnetUsage` field to `AgentResponse` interface to track Sonnet token usage separately
- Added log lines showing which model is used: `[Agent] Initial call: model=...` and `[Agent] Tool iteration N: model=...`

### `src/billing/usage-tracker.ts`
- Added Sonnet pricing constants: $3.00/MTok input, $15.00/MTok output
- Updated `calculateCostCents()` to accept optional `sonnetUsage` parameter
- Blended cost calculation: Haiku tokens × Haiku rates + Sonnet tokens × Sonnet rates
- Backward compatible — existing single-argument calls still work

### `src/agent/lambda-handler.ts`
- Lambda response now includes `sonnetUsage` so ECS can calculate blended cost

### `src/agent/client.ts`
- `RemoteAgentClient` now parses `sonnetUsage` from Lambda response and passes it through

### `src/slack/index.ts`
- Cost calculation call now passes `sonnetUsage`: `calculateCostCents(totalUsage, sonnetUsage)`

### `src/__tests__/config.test.ts`
- Updated test expectations to match new tool usage instruction wording

## Cost Impact

### Per-message estimate (2 tool calls)

| Component | Model | Tokens | Cost |
|-----------|-------|--------|------|
| Initial routing (system prompt + user message + tool defs) | Sonnet | ~6,500 in / ~200 out | $0.0225 |
| Tool iteration 1 (process results) | Haiku | ~1,000 in / ~300 out | $0.002 |
| Tool iteration 2 (final response) | Haiku | ~1,500 in / ~300 out | $0.0024 |
| **Total** | | | **$0.027** |
| **Charged (ceil to cent)** | | | **$0.03** |

vs pure Haiku at ~$0.02/message. **~50% cost increase per message**, but with significantly better tool-calling reliability.

### Impact on free trial
- Pure Haiku: ~150 messages per $3.00 trial
- Hybrid: ~100 messages per $3.00 trial

## Architecture

```
User message arrives
        │
        ▼
┌─────────────────────────┐
│  Sonnet (initial call)   │  ← "What tools should I call?"
│  - Reads system prompt   │
│  - Sees calendar context │
│  - Decides: call         │
│    get_calendar_events   │
│    for March 31st        │
└──────────┬──────────────┘
           │ tool_use response
           ▼
    Execute tool (fetch Google Calendar API)
           │ tool result
           ▼
┌─────────────────────────┐
│  Haiku (iteration 1)     │  ← "Process results, respond or call more tools"
│  - Sees March 31st events│
│  - Generates response    │
└──────────┬──────────────┘
           │ end_turn
           ▼
    Response to user
```

## Verification

- All 17 existing test suites pass (303 tests)
- `billing.test.ts` — all cost calculation tests pass with new blended signature
- `config.test.ts` — all prompt tests pass with updated tool instruction wording
