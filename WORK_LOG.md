# Caleo Bot - Work Log (Session: Feb 13-14, 2026)

## Overview

Implemented the full 3-phase Caleo Agent Enhancement plan (Smart Prompt, Preferences, Billing) and then diagnosed/fixed critical bugs in OAuth flow, workspace ID architecture, timezone handling, and provider loading.

---

## Phase 1: Quick Wins (COMPLETE)

### 1A. maxTokens bump — `src/agent/config.ts`
- Changed `maxTokens: 1024` → `maxTokens: 4096`

### 1B. Slack thread URL in calendar descriptions — `src/agent/anthropic-agent.ts`
- `create_meeting` tool now appends `Scheduled from Slack: https://slack.com/archives/{channelId}/p{threadTs}` to event body

### 1C. DB schema — `src/database/schema.sql`
- Added 4 new tables: `user_preferences`, `user_balances`, `usage_logs`, `stripe_events`
- Migrated on both local PostgreSQL and RDS

---

## Phase 2: Dynamic System Prompt + New Tools (COMPLETE)

### 2A. Dynamic system prompt — `src/agent/config.ts`
- `buildSystemPrompt(ctx: DynamicPromptContext)` generates context-aware prompts
- Interfaces: `DynamicPromptContext`, `FormattedCalendarSnapshot`, `UserPreferences`, `DayEventsSnapshot`
- Prompt covers: current context, multi-day calendar schedule, meeting creation/deletion/update protocols, time parsing rules, Slack user resolution, calendar intelligence, availability rules, response style, billing awareness
- Static `AGENT_INSTRUCTIONS` kept as deprecated fallback for Lambda

### 2B. Calendar context injection — `src/slack/index.ts`
- Pre-fetches 7 days of events (±3 days from today) in a single Google Calendar API call
- Buckets events by day and injects into system prompt
- Agent sees full schedule context without needing tool calls for recent dates
- Helper: `fetchMultiDayEvents()`, `getTimezoneDay()`, `getWeekEventCount()`

### 2C. New file: `src/agent/calendar-context.ts`
- `formatTimeRange(startIso, endIso, tz)` — "2:00 PM - 3:00 PM"
- `formatEventsForPrompt(events, tz)` — converts CalendarEvent[] to prompt snapshots
- `computeFreeTimeGaps(events, tz, workStart, workEnd)` — free slots >= 30min
- `detectConflicts(events, tz)` — overlapping event pairs

### 2D. Updated agent interface — `src/agent/client.ts`
- Added `systemPrompt?: string` and `SlackContext` to `IAgentClient.processMessage()`
- Return type changed from `string` to `AgentResponse`
- Both `LocalAgentClient` and `RemoteAgentClient` updated

### 2E. Expanded AgentContext — `src/agent/anthropic-agent.ts`
- Added: `slackClient`, `slackChannelId`, `slackThreadTs` to `AgentContext`
- New return type: `AgentResponse { text, totalUsage: { inputTokens, outputTokens }, toolIterations }`
- Token usage accumulated across all tool loop iterations

### 2F. New tools in `src/agent/anthropic-agent.ts`
- `resolve_slack_user` — resolves `<@U12345>` via Slack `users.info` API
- `get_preferences` — returns user's work hours, default duration, buffer, preferred provider
- `update_preferences` — upserts changes to `user_preferences` table

### 2G. Repository methods — `src/database/repository.ts`
- `getPreferences(userId)` — returns row or defaults
- `updatePreferences(userId, updates)` — upsert with dynamic SET clause

---

## Phase 3: Stripe Billing (COMPLETE)

### 3A. Token usage tracking — `src/agent/anthropic-agent.ts`
- Accumulates `response.usage.input_tokens` / `output_tokens` across all iterations

### 3B. New file: `src/billing/usage-tracker.ts`
- Haiku 4.5 pricing: Input $0.80/MTok, Output $4.00/MTok
- `calculateCostCents(usage)` — rounds up to whole cents with `Math.ceil`
- `formatBalanceForDisplay(balanceCents)` — "$1.23" format
- `LOW_BALANCE_THRESHOLD_CENTS = 50`

### 3C. New file: `src/billing/stripe.ts`
- `createCheckoutSession()` — creates Stripe Checkout for $5/$10/$20 presets
- `constructWebhookEvent()` — verifies Stripe webhook signature

### 3D. New file: `src/billing/lambda-handler.ts`
- `GET /billing/checkout` — creates Stripe session, redirects
- `POST /billing/webhook` — handles `checkout.session.completed`, credits balance (idempotent)
- `GET /billing/success` / `GET /billing/cancel` — HTML confirmation pages

### 3E. Repository methods — `src/database/repository.ts`
- `getBalance(userId)` — auto-creates row with $1.00 free starting balance
- `creditBalance(userId, amountCents)` — atomic increment
- `deductBalance(userId, amountCents)` — atomic decrement with `Math.ceil` safety
- `createUsageLog(params)` — per-conversation token usage
- `checkStripeEventProcessed(stripeEventId)` / `markStripeEventProcessed(...)` — idempotency

### 3F. Balance gating — `src/slack/index.ts`
- Before agent call: check balance, block if <= 0 with `/caleo-billing` prompt
- After agent call: calculate cost, deduct, log usage
- Low balance warning appended to response if below $0.50

### 3G. `/caleo-billing` command — `src/slack/index.ts`
- Shows current balance + lifetime usage
- 3 buttons: Add $5 / $10 / $20 linking to Stripe checkout

---

## Bug Fixes (COMPLETE)

### Fix 1: Lambda placeholder credentials
- **Problem**: `caleo-oauth-callback` Lambda had `"your_google_client_id_here"` placeholder env vars
- **Fix**: Updated Lambda env vars with real Google OAuth credentials via `aws lambda update-function-configuration`

### Fix 2: Workspace ID mismatch (split-brain token storage)
- **Problem**: `ensureUser()` stored DB UUID in `userContext.workspaceId`, which was passed to OAuth state. Lambda used this UUID as `external_id`, creating a ghost workspace. Token stored under wrong user.
- **Fix**: Added `slackTeamId` to `ensureUser()` return type. Changed all `generateAuthUrl()` calls to use `slackTeamId` (e.g., "T09P39TCQR1") instead of DB UUID.
- **Data fix**: Moved token to correct user on RDS, deleted orphaned workspace/user records.

### Fix 3: Fractional cents integer error
- **Problem**: `deductBalance` failed with "invalid input syntax for type integer: 0.3" because `calculateCostCents` returned fractional cents.
- **Fix**: Changed to `Math.ceil(totalDollars * 100)` and added `Math.ceil` safety in `deductBalance`.

### Fix 4: Google OAuth diagnostic logging
- **File**: `src/calendar/google/oauth.ts`
- Added `.trim()` on env vars in constructor
- Added startup diagnostic logging (client_id prefix/suffix, secret length)
- Added `generateAuthUrl` / `exchangeCode` logging with redacted credentials

### Fix 5: Timezone-aware date calculations
- **Problem**: `fetchTodayEvents` and `get_today_events` used `new Date(year, month, day)` which creates dates in the SERVER's local timezone. A 4pm CT meeting was outside the query window when server TZ differed.
- **Fix**: New `getTimezoneDay(tz, offsetDays)` function that:
  1. Gets the date string in user's timezone via `toLocaleDateString('en-CA', { timeZone: tz })`
  2. Computes UTC offset by comparing `toLocaleString` in UTC vs target TZ
  3. Returns correct UTC start/end for midnight-to-midnight in user's timezone
- Applied in both `src/slack/index.ts` and `src/agent/anthropic-agent.ts`

### Fix 6: Provider loading gate (ROOT CAUSE of "no events" bug)
- **Problem**: `needsCalendarContext()` keyword check controlled whether providers were loaded. Messages like "Are you sure? Verify." have no calendar keywords → providers never loaded → system prompt said "Connected providers: none" → agent told user to connect calendar even though Google was connected.
- **Fix**: Providers are now ALWAYS loaded for every message. `needsCalendarContext()` only gates the "prompt to connect" UX when the user has NO providers at all.
- **Before**: `if (hasCalendarIntent) { providers = await buildProviders(dbUserId); }`
- **After**: `const providers = await buildProviders(dbUserId);`

### Fix 7: Tool execution logging
- **File**: `src/agent/anthropic-agent.ts`
- Added `[Agent] Initial response: stop_reason=..., blocks=...` log
- Added `[Tool Call] tool_name {...inputs}` and `[Tool Result] tool_name: {...}` logs
- Added `[fetchMultiDayEvents] Querying: ... to ...` logs

---

## Files Changed Summary

| File | Lines Changed | What |
|------|--------------|------|
| `src/agent/config.ts` | +189 | `buildSystemPrompt()`, interfaces, maxTokens bump |
| `src/agent/anthropic-agent.ts` | +189 | AgentResponse, expanded context, 3 new tools, token tracking, TZ fix, tool logging |
| `src/agent/client.ts` | +44/-12 | SlackContext, AgentResponse, systemPrompt param |
| `src/agent/lambda-handler.ts` | +13 | systemPrompt passthrough, AgentResponse |
| `src/agent/calendar-context.ts` | NEW | formatTimeRange, computeFreeTimeGaps, detectConflicts |
| `src/slack/index.ts` | +382/-42 | Multi-day context, always-load providers, balance gating, /caleo-billing, TZ fix |
| `src/database/repository.ts` | +148 | 8 new methods (preferences, balances, usage, stripe) |
| `src/database/schema.sql` | +47 | 4 new tables |
| `src/billing/usage-tracker.ts` | NEW | Cost calculation, formatting |
| `src/billing/stripe.ts` | NEW | Stripe checkout + webhook |
| `src/billing/lambda-handler.ts` | NEW | Billing API routes |
| `src/calendar/google/oauth.ts` | +54 | Diagnostic logging, .trim() |
| `package.json` | +3 | stripe dependency |
| `env.template` | +5 | Stripe env vars |

---

## Current State (as of session end)

- **Bot is running locally** (PID on port 3000) with Socket Mode, connected to RDS
- **All 3 phases implemented** and compiling clean
- **Key bug fixes applied** but the latest round of fixes (always-load providers, multi-day context, timezone fix) has NOT been tested by user yet
- **Not yet deployed** to ECS/Lambda — push to `master` triggers GitHub Actions deploy

## Remaining Work / Known Issues

1. **Test the latest fixes** — the always-load-providers fix and multi-day context injection need user verification
2. **Deploy to ECS** — push to master or `aws ecs update-service --force-new-deployment`
3. **Deploy to Lambda** — agent code changes need Lambda redeployment
4. **Stripe env vars not set** — `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `BILLING_BASE_URL` need to be added to ECS task definition and Lambda
5. **GitHub Actions IAM role** — deploy-bot.yml references `arn:aws:iam::673652690166:role/caleo-github-actions-role` (note double colon — may need fixing)
6. **`config.env` still points DATABASE_URL to localhost** — for local dev with RDS, DATABASE_URL must be set via environment variable (see AWS Secrets Manager or ECS task definition)
7. **Microsoft OAuth** — still has placeholder credentials in config.env
8. **`NODE_TLS_REJECT_UNAUTHORIZED=0`** — used for local→RDS SSL; ECS should have proper certs
