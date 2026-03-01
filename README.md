# Caleo

AI calendar assistant for Slack. Connects to Google Calendar and Microsoft Outlook, powered by Claude (Anthropic).

## What It Does

Talk to Caleo in Slack via DM, @mention, or `/caleo` command:

- View, create, update, and delete calendar events
- Check availability and find free time across attendees
- Schedule meetings with automatic conflict detection
- Create focus time blocks and track weekly focus goals
- Draft follow-up emails after meetings
- Works with both Google Calendar and Microsoft Outlook simultaneously

## Quick Start

```bash
# Install
npm install

# Configure
cp env.template config.env   # fill in values

# Build and run
npm run build
npm start
```

See [docs/SLACK_LOCAL_SETUP.md](docs/SLACK_LOCAL_SETUP.md) for full local development setup.

## Architecture

```
Slack (Socket Mode)
  |
  v
ECS Fargate (src/slack/index.ts)    <-- Slack bot, OAuth, billing routes
  |
  v
Lambda (src/agent/lambda-handler.ts) <-- Claude agent with 20 tools
  |
  +-- Google Calendar API
  +-- Microsoft Graph API
  +-- PostgreSQL (RDS)
```

- **Slack bot**: ECS Fargate (`caleo-cluster`), deployed via GitHub Actions
- **Agent**: AWS Lambda (`caleo-agent`), deployed via GitHub Actions
- **Database**: PostgreSQL on RDS (13 tables)
- **CI/CD**: GitHub Actions with OIDC federation (no long-lived AWS keys)

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for detailed architecture and [docs/PRODUCTION.md](docs/PRODUCTION.md) for full infrastructure documentation.

## Slack Commands

| Command | Description |
|---------|-------------|
| `/caleo` | Ask Caleo anything |
| `/caleo-auth` | Connect Google Calendar or Microsoft Outlook |
| `/caleo-billing` | Manage billing and add credits |
| `/caleo-settings` | Configure work hours, focus time, preferences |
| `/caleo-privacy` | View or delete your stored data |

## Tech Stack

- **Runtime**: Node.js 18, TypeScript
- **AI**: Claude Haiku 4.5 (Anthropic) with tool use
- **Slack**: Bolt framework, Socket Mode
- **Calendar**: Google Calendar API v3, Microsoft Graph API
- **Database**: PostgreSQL (raw SQL, no ORM)
- **Billing**: Stripe (checkout + webhooks)
- **Infra**: AWS ECS Fargate, Lambda, RDS, ECR, SES

## Scripts

| Script | Description |
|--------|-------------|
| `npm run build` | TypeScript compilation |
| `npm run dev` | Development with nodemon |
| `npm start` | Production: `node dist/slack/index.js` |
| `npm test` | Run test suite |
| `scripts/deploy-lambda.sh` | Manual Lambda deployment |

## Docs

- [Architecture](docs/ARCHITECTURE.md) — How the system works end-to-end
- [Local Setup](docs/SLACK_LOCAL_SETUP.md) — Slack app creation and local dev
- [Production](docs/PRODUCTION.md) — Full infrastructure audit and deployment guide
