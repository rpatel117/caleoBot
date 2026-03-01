# Caleo Bot - Claude Code Context

## Project
Caleo is an AI calendar assistant Slack bot supporting Google Calendar and Microsoft Outlook. Built with TypeScript, Anthropic Claude Haiku 4.5, Slack Bolt, and PostgreSQL.

## Build & Run
- `npm run build` — TypeScript compilation (`tsc`)
- `npm run dev` — Development with nodemon
- `npm start` — Production: `node dist/slack/index.js`
- Entry point: `src/slack/index.ts` (Slack bot), `src/agent/lambda-handler.ts` (AWS Lambda)

## Deployment
- **Slack bot**: AWS ECS Fargate — cluster `caleo-cluster`, service `caleo-bot-service`, ECR `caleo-bot`, region `us-east-1`
- **Lambda agent**: AWS Lambda `caleo-agent`, region `us-east-1`
- **CI/CD**: GitHub Actions — `deploy-bot.yml` (ECS) and `deploy-agent.yml` (Lambda) trigger on push to `master`
- **Docker**: `Dockerfile` — node:18-alpine, copies `dist/` + `node_modules/`, runs `node dist/slack/index.js`
- **Azure** (`caleo-bot-prod`) is the OLD MS Teams implementation — do NOT use or reference

## Database
- **Local**: `postgres://rpate@localhost:5432/caleo`
- **Production (RDS)**: `caleo-db.c8pas2uged98.us-east-1.rds.amazonaws.com`, user `caleo_admin`
- **psql binary**: `/opt/homebrew/opt/postgresql@16/bin/psql`
- **Schema**: `src/database/schema.sql` — production DB must be migrated manually (no auto-migration)
- **Repository**: `src/database/repository.ts` (singleton exported as `repository`)
- **SSL config**: `rejectUnauthorized: false` in production (RDS certs)
- **Pool**: max 20 connections, 30s idle timeout, 5s connection timeout

## Architecture
- `src/agent/anthropic-agent.ts` — Tool-use loop with 16 tools, `AgentContext` interface
- `src/agent/client.ts` — `IAgentClient` interface, `LocalAgentClient` (direct) and `RemoteAgentClient` (Lambda)
- `src/agent/config.ts` — `buildSystemPrompt()` dynamic prompt, `AGENT_CONFIG` (Haiku 4.5, 4096 tokens)
- `src/calendar/` — Provider abstraction: `types.ts`, `google/`, `microsoft/`
- `src/calendar/cross-org.ts` — `CrossOrgService` for federated availability and native event creation across orgs
- `src/billing/` — Stripe checkout, webhook handler, usage tracking, plan limits
- `src/slack/index.ts` — Slack app, OAuth flow, message processing, billing routes (`/billing/*`)
- `src/database/` — `schema.sql`, `repository.ts`, `client.ts` (pg pool)
- `src/encryption.ts` — AES-256-GCM with backward CryptoJS compatibility
- `src/auth/oauth-state.ts` — HMAC-SHA256 signed OAuth state

## HTTP Routes (ECS, port 3000)
- `GET /api/health` — Health check
- `GET /auth/callback` — OAuth redirect handler (Google + Microsoft)
- `GET /billing/checkout` — Stripe checkout redirect (HMAC-signed params)
- `POST /billing/webhook` — Stripe webhook (signature verified)
- `GET /billing/success` — Post-payment success page
- `GET /billing/cancel` — Post-payment cancel page

## Key Patterns
- OAuth singletons: `GoogleOAuth`, `MicrosoftOAuth` handle token refresh automatically
- Times sent to calendar APIs are local (no Z suffix, no offset) — timezone passed separately
- `CrossOrgService` is optional in `AgentContext` — undefined means fallback to standard single-provider behavior
- All cross-org operations gracefully degrade on failure
- Billing: developers bypass all checks; members have balance gating and plan limits
- Free plan: 10 meetings/month, 50 messages/month. Pro: unlimited.
- Rate limiting: 10 messages per user per 60 seconds (in-memory)

## Env Vars (Production — ECS Task Definition)
See `env.template` for full list. Critical ones:
- `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `SLACK_APP_TOKEN` — Slack app credentials
- `DATABASE_URL` — RDS connection string
- `ENCRYPTION_KEY` — 64-char hex, used for token encryption + checkout signing + OAuth state
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` — Google OAuth
- `MICROSOFT_APP_ID`, `MICROSOFT_APP_PASSWORD` — Microsoft OAuth
- `OAUTH_REDIRECT_URI` — Must match Google/Azure console registrations
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `BILLING_BASE_URL` — Stripe billing
- `USE_REMOTE_AGENT=true`, `AGENT_ENDPOINT` — Lambda agent URL
- `NODE_ENV=production`

## Security Notes — CRITICAL
- **ALL production secrets were exposed** via ECS task definition dump (2026-02-28). The following MUST be rotated before launch:
  - `ANTHROPIC_API_KEY`
  - `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, `SLACK_SIGNING_SECRET`
  - `GOOGLE_CLIENT_SECRET`
  - `ENCRYPTION_KEY`
  - `DATABASE_URL` password (RDS `caleo_admin`)
  - Stripe keys (not yet in task def but may be in git history)
- Secrets were also historically committed to git (`.env`, `config.env`)
- `.gitignore` now excludes both files; they are NOT currently tracked
- History cleanup requires `git filter-repo` + force push (not yet done)
- **After rotating, move all secrets to AWS Secrets Manager** — currently plaintext in ECS task definition
