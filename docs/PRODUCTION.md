# Caleo — Production Infrastructure

Complete infrastructure audit and operational reference for the Caleo production environment.

---

## 1. System Overview

Caleo is an AI calendar assistant that lives in Slack. Users interact via DM, @mention, or slash commands. The bot processes natural language through Claude (Anthropic), manages Google Calendar and Microsoft Outlook events, and stores data in PostgreSQL.

### Architecture

```
Slack (Socket Mode WebSocket)
  │
  ▼
┌──────────────────────────────────┐
│  ECS Fargate                     │  src/slack/index.ts
│  Slack Bot + HTTP Server (:3000) │  Socket Mode, OAuth, billing routes
│                                  │
│  USE_REMOTE_AGENT=true ──────────┼──────┐
│  USE_REMOTE_AGENT=false ─┐       │      │
│                          │       │      │
│                   ┌──────▼─────┐ │      │
│                   │ Local Agent│ │      │
│                   └────────────┘ │      │
└──────────────────────────────────┘      │
                                          │ HTTPS POST
                                          ▼
                                 ┌─────────────────┐
                                 │ API Gateway      │
                                 │     ▼            │
                                 │ Lambda           │  src/agent/lambda-handler.ts
                                 │ (caleo-agent)    │  Claude tool-use loop
                                 └────────┬────────┘
                                          │
                         ┌────────────────┼────────────────┐
                         ▼                ▼                ▼
                  Google Calendar   Microsoft Graph   PostgreSQL (RDS)
                  API v3            API               caleo-db
```

---

## 2. AWS Infrastructure

**Account ID**: `673652690166`
**Region**: `us-east-1`

### ECS Fargate

| Resource | Value |
|----------|-------|
| Cluster | `caleo-cluster` |
| Service | `caleo-bot-service` |
| Task family | `caleo-bot` |
| Container image | ECR `caleo-bot:latest` |
| Port | 3000 |
| Health check | `GET /api/health` |

The ECS service runs the Slack bot (Socket Mode) and serves HTTP routes for OAuth callbacks, billing, and health checks.

### Lambda

| Resource | Value |
|----------|-------|
| Function | `caleo-agent` |
| Runtime | Node.js 18.x |
| Entry point | `dist/agent/lambda-handler.js` |

The Lambda function runs the Claude agent (tool-use loop) in remote mode. The ECS bot sends request context to Lambda via API Gateway, Lambda runs Claude, and returns the response.

### RDS PostgreSQL

| Setting | Value |
|---------|-------|
| Host | `caleo-db.c8pas2uged98.us-east-1.rds.amazonaws.com` |
| Port | 5432 |
| Database | `caleo` |
| User | `caleo_admin` |
| SSL | `rejectUnauthorized: false` (RDS certs) |
| Pool max | 20 connections |
| Idle timeout | 30 seconds |
| Connect timeout | 5 seconds |

### ECR

| Repository | `caleo-bot` |
|------------|-------------|
| Image tag strategy | `latest` + git SHA |

### SES (Optional)

Used for operational email notifications (admin alerts). Configured via SMTP credentials in env vars. Falls back to Ethereal test account if not configured.

| Setting | Value |
|---------|-------|
| SMTP host | `email-smtp.us-east-1.amazonaws.com` |
| Port | 587 (STARTTLS) |

---

## 3. Deployment Pipelines

### ECS Bot: `.github/workflows/deploy-bot.yml`

**Trigger**: Push to `master` when files change in `src/slack/`, `src/agent/client.ts`, `src/agent/config.ts`, `src/database/`, `src/billing/`, `src/calendar/`, `src/encryption.ts`, `src/auth/`, `src/types.ts`, `Dockerfile`, `package.json`, `package-lock.json`. Also supports `workflow_dispatch`.

**Steps**:
1. Checkout + Node 18 setup
2. `npm ci` + `npm run build` + `npm test`
3. Configure AWS credentials (OIDC federation — no long-lived keys)
4. Login to ECR
5. Build Docker image, tag with git SHA + `latest`
6. Push to ECR
7. `aws ecs update-service --force-new-deployment`

### Lambda Agent: `.github/workflows/deploy-agent.yml`

**Trigger**: Push to `master` when files change in `src/agent/`, `src/calendar/`, `src/email/`, `src/database/`, `src/billing/`, `src/encryption.ts`, `src/auth/`, `src/types.ts`, `package.json`, `package-lock.json`.

**Steps**:
1. Checkout + Node 18 setup
2. `npm ci` + `npm run build` + `npm test`
3. Package: zip `dist/` (excluding `slack/`) + `node_modules/` (excluding `@slack/*`, `nodemon/*`)
4. Configure AWS credentials (OIDC federation)
5. `aws lambda update-function-code --zip-file fileb://lambda.zip`

### Manual Lambda Deploy

```bash
scripts/deploy-lambda.sh [function-name]
# Default function: caleo-agent
```

### OIDC Federation

Both pipelines use `aws-actions/configure-aws-credentials@v4` with:
- Role: `arn:aws:iam::673652690166:role/caleo-github-actions-role`
- No long-lived AWS access keys stored in GitHub

---

## 4. Docker & Container

### Dockerfile

```dockerfile
FROM public.ecr.aws/docker/library/node:18-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY dist/ ./dist/
RUN addgroup -g 1001 nodejs && adduser -u 1001 -G nodejs -S nodejs
USER nodejs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://localhost:3000/api/health || exit 1
CMD ["node", "dist/slack/index.js"]
```

Key points:
- Alpine base for minimal image size
- Non-root user (`nodejs:1001`)
- Only production dependencies (`--omit=dev`)
- Built-in health check at `/api/health`
- Pre-compiled TypeScript (`dist/`) — no source code in image

---

## 5. Database Schema

### Tables (13)

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `workspaces` | Slack workspace registry | `external_id`, `plan`, `stripe_customer_id` |
| `users` | Slack users | `workspace_id` (FK), `external_id`, `email`, `timezone`, `user_type` |
| `oauth_tokens` | Encrypted calendar tokens | `user_id` (FK), `provider`, `access_token`, `refresh_token`, `expires_at` |
| `conversations` | Chat sessions per channel/thread | `user_id` (FK), `channel_id`, `thread_ts` |
| `messages` | Chat history | `conversation_id` (FK), `role`, `content` |
| `user_preferences` | Work hours, defaults | `user_id` (FK), `work_hours_start/end`, `default_duration_minutes`, `buffer_minutes` |
| `user_balances` | Billing credit balances | `user_id` (FK), `balance_cents`, `lifetime_spent_cents` |
| `usage_logs` | Per-conversation token usage | `user_id` (FK), `input_tokens`, `output_tokens`, `cost_cents` |
| `stripe_events` | Webhook idempotency | `stripe_event_id` (unique), `event_type`, `amount_cents` |
| `workspace_usage` | Monthly plan limit tracking | `workspace_id` (FK), `period` (YYYY-MM), `meetings_created`, `messages_sent` |
| `user_settings` | Ambient feature toggles | `user_id` (FK), `status_sync_enabled`, `daily_briefing_enabled`, `focus_time_goal_hours` |
| `audit_log` | Calendar modification log | `user_id` (FK), `action`, `event_id`, `provider`, `details` (JSONB) |
| `undo_state` | Undo support for calendar ops | `user_id` (FK), `channel_id`, `action`, `event_id`, `previous_state` (JSONB) |

### Indexes

| Index | Table | Columns |
|-------|-------|---------|
| `idx_users_external_id` | users | `external_id` |
| `idx_users_email_lower` | users | `LOWER(email)` |
| `idx_oauth_tokens_user_provider` | oauth_tokens | `user_id, provider` |
| `idx_conversations_user_id` | conversations | `user_id` |
| `idx_messages_conversation_id` | messages | `conversation_id` |
| `idx_usage_logs_user_id` | usage_logs | `user_id` |
| `idx_stripe_events_stripe_id` | stripe_events | `stripe_event_id` |
| `idx_workspace_usage_ws_period` | workspace_usage | `workspace_id, period` |
| `idx_audit_log_user` | audit_log | `user_id, created_at DESC` |
| `idx_undo_state_user_channel` | undo_state | `user_id, channel_id` |

### Connection Config

```
Pool max:        20 connections
Idle timeout:    30 seconds
Connect timeout: 5 seconds
SSL:             rejectUnauthorized: false (RDS)
```

### Migration

No auto-migration. Schema changes are applied manually:

```bash
/opt/homebrew/opt/postgresql@16/bin/psql $DATABASE_URL -f src/database/schema.sql
```

All statements use `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS`, so re-running is safe.

---

## 6. Application Architecture

### Entry Points

| Entry Point | Runtime | File |
|-------------|---------|------|
| Slack bot | ECS Fargate | `src/slack/index.ts` |
| Agent (remote) | Lambda | `src/agent/lambda-handler.ts` |

### HTTP Routes (port 3000)

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/health` | Health check |
| `GET` | `/auth/callback` | OAuth redirect handler (Google + Microsoft) |
| `GET` | `/billing/checkout` | Stripe checkout redirect (HMAC-signed params) |
| `POST` | `/billing/webhook` | Stripe webhook (signature verified) |
| `GET` | `/billing/success` | Post-payment success page |
| `GET` | `/billing/cancel` | Post-payment cancel page |

### Slack Commands

| Command | Purpose |
|---------|---------|
| `/caleo` | Natural language calendar queries |
| `/caleo-auth` | Connect Google Calendar or Microsoft Outlook |
| `/caleo-billing` | View balance, add credits, manage plan |
| `/caleo-settings` | Configure work hours, focus time, preferences |
| `/caleo-privacy` | View or delete stored data |

### Slack Events

| Event | Behavior |
|-------|----------|
| `message.im` | Process DMs through Claude agent |
| `app_mention` | Process @mentions through Claude agent |

### Agent Tools (20)

| Tool | Purpose |
|------|---------|
| `get_current_time` | Current time in user's timezone |
| `get_user_info` | User profile and preferences |
| `get_today_events` | Today's calendar events |
| `get_week_events` | This week's calendar events |
| `get_calendar_events` | Events for arbitrary date range |
| `create_meeting` | Create calendar event |
| `update_meeting` | Update existing event |
| `delete_meeting` | Delete calendar event |
| `check_availability` | Check free/busy for attendees |
| `find_free_time` | Find available time slots |
| `find_mutual_free_time` | Find mutual availability across attendees |
| `draft_followup_email` | Draft post-meeting email |
| `list_providers` | List connected calendar providers |
| `resolve_slack_user` | Resolve @mention to user profile |
| `search_people` | Search directory + calendar history for people |
| `get_preferences` | Get user scheduling preferences |
| `update_preferences` | Update user preferences |
| `create_focus_time` | Block focus time on calendar |
| `get_focus_time_stats` | Weekly focus time progress |
| `undo_last_change` | Undo last calendar modification |

### Ambient Services

| Service | Description |
|---------|-------------|
| StatusSync | Syncs Slack status with current calendar event (opt-in via `/caleo-settings`) |
| DailyBriefing | Sends morning schedule summary via DM (opt-in, configurable time) |

### Notification Service

Email-based operational alerts via SES SMTP. Three severity tiers:

| Tier | Delivery | Events |
|------|----------|--------|
| CRITICAL | Immediate | Unhandled errors, OAuth callback failures, Stripe webhook errors, bot startup failures, DB connection failures |
| WARNING | Hourly batch | Provider build failures, new user signups, token expiry warnings, low balance, payments, rate limit hits |
| INFO | Daily digest | Daily usage statistics |

---

## 7. Environment Variables

### Required

| Variable | Purpose | Format |
|----------|---------|--------|
| `ANTHROPIC_API_KEY` | Claude API access | Anthropic API key |
| `SLACK_BOT_TOKEN` | Slack bot token | Slack bot token |
| `SLACK_SIGNING_SECRET` | Slack request verification | hex string |
| `SLACK_APP_TOKEN` | Socket Mode connection | Slack app-level token |
| `DATABASE_URL` | PostgreSQL connection | `postgres://user:pass@host:5432/caleo` |
| `ENCRYPTION_KEY` | AES-256-GCM key + HMAC signing | 64-char hex |

### OAuth (required for calendar features)

| Variable | Purpose |
|----------|---------|
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `MICROSOFT_APP_ID` | Azure AD app client ID |
| `MICROSOFT_APP_PASSWORD` | Azure AD app client secret |
| `OAUTH_REDIRECT_URI` | Must match Google Cloud Console + Azure AD registrations |

### Billing (required for paid features)

| Variable | Purpose |
|----------|---------|
| `STRIPE_SECRET_KEY` | Stripe API key |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signature verification |
| `BILLING_BASE_URL` | Base URL for checkout success/cancel redirects |

### Optional

| Variable | Default | Purpose |
|----------|---------|---------|
| `SLACK_SOCKET_MODE` | `true` | Use Socket Mode (WebSocket) |
| `SLACK_PORT` | `3000` | HTTP server port |
| `USE_REMOTE_AGENT` | `false` | Route AI processing to Lambda |
| `AGENT_ENDPOINT` | — | API Gateway URL (when remote agent enabled) |
| `NGROK_URL` | — | Public URL for OAuth callbacks (local dev only) |
| `NODE_ENV` | `development` | `development` or `production` |
| `ADMIN_NOTIFY_EMAIL` | — | Email for operational alerts (empty = disabled) |
| `NOTIFY_FROM_EMAIL` | — | From address for alert emails |
| `SES_SMTP_USER` | — | SES SMTP credentials |
| `SES_SMTP_PASS` | — | SES SMTP credentials |
| `SES_SMTP_HOST` | `email-smtp.us-east-1.amazonaws.com` | SES SMTP endpoint |

---

## 8. Security

### Encryption

**AES-256-GCM** for OAuth tokens at rest:
- 16-byte random IV per encryption
- 16-byte authentication tag
- Format: `v2:<iv>:<authTag>:<ciphertext>` (base64)
- Backward compatibility: detects and decrypts legacy CryptoJS format (PBKDF2-derived key)
- Key: first 32 bytes of `ENCRYPTION_KEY` (64-char hex)

### OAuth State Signing

**HMAC-SHA256** prevents CSRF in OAuth flow:
- State payload: `{userId, workspaceId, provider, timestamp}`
- Signed with `ENCRYPTION_KEY`
- Verified on callback — rejects tampered or expired states

### Checkout URL Signing

**HMAC-SHA256** prevents parameter tampering in Stripe checkout redirect:
- Signs: `userId`, `workspaceId`, `amountCents`, `timestamp`
- Verified before creating Stripe checkout session

### Slack Request Verification

All incoming Slack events are verified using the Slack signing secret (handled by Bolt framework).

### Stripe Webhook Security

- Signature verification using `STRIPE_WEBHOOK_SECRET`
- Idempotency via `stripe_events` table (duplicate event IDs rejected)

### Rate Limiting

- 10 messages per user per 60 seconds (in-memory `Map`)
- Cleanup interval: every 5 minutes

### Multi-Tenant Isolation

- All queries scoped by `workspace_id`
- OAuth tokens scoped by `user_id`
- Conversations scoped by `user_id` + `channel_id`

---

## 9. Billing

### Flow

```
User: /caleo-billing → "Add $5"
  │
  ▼
Bot generates HMAC-signed checkout URL
  │
  ▼
GET /billing/checkout → verify signature → create Stripe checkout session → redirect
  │
  ▼
User pays on Stripe
  │
  ▼
POST /billing/webhook → verify Stripe signature → check idempotency → credit balance
  │
  ▼
GET /billing/success → confirmation page
```

### Plan Limits

| Plan | Meetings/month | Messages/month |
|------|---------------|----------------|
| Free | 10 | 50 |
| Pro | Unlimited | Unlimited |
| Enterprise | Unlimited | Unlimited |

### Cost Calculation

| Token Type | Rate |
|------------|------|
| Input (Haiku 4.5) | $0.80 / million tokens |
| Output (Haiku 4.5) | $4.00 / million tokens |

Costs are calculated per conversation turn, rounded up to the nearest cent, and deducted from `user_balances.balance_cents`.

### Developer Bypass

Users with `user_type = 'developer'` bypass all billing checks (balance gating and plan limits).

---

## 10. Security Checklist (Pre-Launch)

### Secrets Requiring Rotation

All production secrets were exposed via an ECS task definition dump on 2026-02-28. The following MUST be rotated before launch:

- [ ] `ANTHROPIC_API_KEY`
- [ ] `SLACK_BOT_TOKEN`
- [ ] `SLACK_APP_TOKEN`
- [ ] `SLACK_SIGNING_SECRET`
- [ ] `GOOGLE_CLIENT_SECRET`
- [ ] `ENCRYPTION_KEY` (rotate key, then re-encrypt all OAuth tokens with new key)
- [ ] `DATABASE_URL` password (change RDS `caleo_admin` password)
- [ ] Stripe keys (check git history for exposure)

### Post-Rotation

- [ ] Move all secrets to **AWS Secrets Manager** — currently plaintext in ECS task definition
- [ ] Update ECS task definition to reference Secrets Manager ARNs
- [ ] Update Lambda environment variables to reference Secrets Manager

### Git History

`.env` and `config.env` are excluded by `.gitignore` and are not currently tracked. If they were ever committed historically, run `git filter-repo` + force push to remove them from history.

### Database SSL

Currently using `rejectUnauthorized: false` for RDS connections. For hardened SSL:
- Download the RDS CA bundle
- Set `ssl: { ca: fs.readFileSync('rds-combined-ca-bundle.pem') }` in the pool config

---

## 11. Operational Thresholds

| Parameter | Value | Location |
|-----------|-------|----------|
| Agent model | Claude Haiku 4.5 | `src/agent/config.ts` |
| Max output tokens | 4,096 | `src/agent/config.ts` |
| Temperature | 0.7 | `src/agent/config.ts` |
| Max conversation history | 20 messages | `src/agent/config.ts` |
| Session timeout (channels) | 30 minutes | `src/agent/config.ts` |
| Session timeout (DMs) | 5 minutes | `src/agent/config.ts` |
| People search lookback | 90 days | `src/agent/config.ts` |
| DB pool max | 20 connections | `src/database/client.ts` |
| DB idle timeout | 30 seconds | `src/database/client.ts` |
| DB connect timeout | 5 seconds | `src/database/client.ts` |
| Rate limit | 10 messages/user/60s | `src/slack/index.ts` |
| Free plan: meetings | 10/month | `src/billing/plans.ts` |
| Free plan: messages | 50/month | `src/billing/plans.ts` |
| Low balance threshold | $0.50 | `src/billing/usage-tracker.ts` |
| Default balance (new users) | $1.00 | `src/database/schema.sql` |
| Event dedup TTL | 5 minutes | `src/slack/index.ts` |
| Rate limiter cleanup | Every 5 minutes | `src/slack/index.ts` |

---

## 12. Known Gaps & Recommendations

### No Row-Level Security (RLS)

The database relies on application-level enforcement (all queries include `WHERE workspace_id = $1` or `WHERE user_id = $1`). There is no PostgreSQL RLS policy. A bug in the repository layer could expose cross-tenant data.

**Recommendation**: Add RLS policies on `users`, `oauth_tokens`, `conversations`, `messages`, and `user_settings`.

### In-Memory Rate Limiting

Rate limiting uses an in-memory `Map` in the ECS container. If the service scales to multiple ECS tasks, each task has its own rate limiter — users could exceed limits by hitting different containers.

**Recommendation**: Move rate limiting to Redis or DynamoDB for shared state across replicas.

### No Undo State Cleanup

The `undo_state` table grows indefinitely. Old entries (>1 hour) are never cleaned up.

**Recommendation**: Add a scheduled cleanup job or TTL-based deletion.

### No Conversation Cleanup

The `messages` table grows indefinitely. Old conversations are never archived or pruned.

**Recommendation**: Add a periodic job to archive or delete messages older than 90 days.

### No CloudWatch Metrics or Alarms

No custom CloudWatch metrics, dashboards, or alarms are configured. The notification service provides email alerts but there is no infrastructure-level monitoring.

**Recommendation**: Add CloudWatch alarms for ECS CPU/memory, RDS connections, Lambda errors/duration, and API Gateway 5xx rates.

### No CI/CD Approval Gates

Both GitHub Actions workflows deploy directly on push to `master` — no manual approval step, no staging environment.

**Recommendation**: Add a staging environment and require manual approval for production deploys.

### No Health Check Beyond HTTP Ping

The `/api/health` endpoint returns 200 OK without checking database connectivity, Slack WebSocket status, or Anthropic API availability.

**Recommendation**: Add dependency checks to the health endpoint (at minimum: database ping).
