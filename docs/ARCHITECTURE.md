# Caleo Architecture

## What Is Caleo?

Caleo is a Slack-first AI calendar assistant. You talk to it in Slack (DM, @mention, or `/caleo` command), and it can:

- Answer questions using Claude (Anthropic's AI)
- Read, create, update, and delete calendar events
- Check availability and find free time
- Draft follow-up emails after meetings
- Work with **both** Microsoft Outlook and Google Calendar simultaneously

---

## How It Works (End to End)

```
You (Slack)
  │
  │  DM / @mention / /caleo command
  ▼
┌─────────────────────────────────┐
│  Slack Bot (src/slack/index.ts) │  Socket Mode (WebSocket)
│                                 │
│  1. Receive message             │
│  2. Look up / create user in DB │
│  3. Check if calendar context   │
│     needed → fetch OAuth tokens │
│  4. Send "processing..." msg    │
│  5. Call Agent                  │
│  6. Post response to Slack      │
└──────────┬──────────────────────┘
           │
           ▼
┌──────────────────────────────────┐
│  Claude Agent                    │  src/agent/anthropic-agent.ts
│  (Anthropic API with tool_use)   │
│                                  │
│  Claude reads your message and   │
│  decides which tools to call:    │
│                                  │
│  ┌────────────────────────────┐  │
│  │ 20 Tools Available:        │  │
│  │ • get_current_time         │  │
│  │ • get_user_info            │  │
│  │ • get_today_events         │  │
│  │ • get_week_events          │  │
│  │ • get_calendar_events      │  │
│  │ • create_meeting           │  │
│  │ • update_meeting           │  │
│  │ • delete_meeting           │  │
│  │ • check_availability       │  │
│  │ • find_free_time           │  │
│  │ • find_mutual_free_time    │  │
│  │ • draft_followup_email     │  │
│  │ • list_providers           │  │
│  │ • resolve_slack_user       │  │
│  │ • search_people            │  │
│  │ • get_preferences          │  │
│  │ • update_preferences       │  │
│  │ • create_focus_time        │  │
│  │ • get_focus_time_stats     │  │
│  │ • undo_last_change         │  │
│  └────────────────────────────┘  │
│                                  │
│  Tool use loop:                  │
│  send msg → Claude picks tool →  │
│  execute tool → send result →    │
│  Claude responds (or picks       │
│  another tool) → repeat until    │
│  Claude returns final text       │
└──────────┬───────────────────────┘
           │
           ▼
┌──────────────────────────────────┐
│  Calendar / Email Providers      │
│                                  │
│  Microsoft:                      │
│  ├── calendar/microsoft/         │
│  │   ├── provider.ts  (Graph API)│
│  │   └── oauth.ts     (Azure AD) │
│  └── email/microsoft.ts (drafts) │
│                                  │
│  Google:                         │
│  ├── calendar/google/            │
│  │   ├── provider.ts  (Cal API)  │
│  │   └── oauth.ts     (Google)   │
│  └── email/google.ts  (Gmail)    │
└──────────┬───────────────────────┘
           │
           ▼
┌──────────────────────────────────┐
│  PostgreSQL Database             │
│  (local Homebrew / AWS RDS)      │
│                                  │
│  Tables:                         │
│  • workspaces  (Slack teams)     │
│  • users       (Slack users)     │
│  • oauth_tokens (encrypted)      │
│  • conversations (per channel)   │
│  • messages    (chat history)    │
└──────────────────────────────────┘
```

---

## Directory Structure

```
src/
├── slack/
│   └── index.ts                 ← Main entry point. Handles all Slack interaction,
│                                  OAuth callbacks, message routing.
├── agent/
│   ├── anthropic-agent.ts       ← Claude integration. Defines 20 tools as JSON schemas,
│   │                              runs the tool_use loop, executes tools against providers.
│   ├── client.ts                ← IAgentClient interface. LocalAgentClient (in-process Claude)
│   │                              vs RemoteAgentClient (calls AWS Lambda).
│   ├── config.ts                ← Model name, max tokens, system prompt instructions.
│   └── lambda-handler.ts        ← AWS Lambda entry point (Phase 5, not used locally).
│
├── calendar/
│   ├── types.ts                 ← CalendarProvider and OAuthProvider interfaces.
│   │                              All providers implement these.
│   ├── microsoft/
│   │   ├── provider.ts          ← Microsoft Graph API calls (CRUD events, availability).
│   │   └── oauth.ts             ← Azure AD OAuth2 flow, token refresh, validation.
│   └── google/
│       ├── provider.ts          ← Google Calendar API v3 calls.
│       └── oauth.ts             ← Google OAuth2 flow, token refresh.
│
├── email/
│   ├── types.ts                 ← EmailProvider interface.
│   ├── microsoft.ts             ← Outlook draft creation via Graph API.
│   └── google.ts                ← Gmail draft creation via Gmail API.
│
├── database/
│   ├── schema.sql               ← Table definitions. Run with psql to initialize.
│   ├── client.ts                ← pg Pool connection (reads DATABASE_URL).
│   └── repository.ts            ← All SQL queries. CRUD for users, tokens,
│                                  conversations, messages. Singleton export.
│
├── encryption.ts                ← AES encrypt/decrypt for OAuth tokens at rest.
├── data-sanitizer.ts            ← Strips HTML, estimates tokens, formats events.
└── types.ts                     ← Shared types: UserContext, TokenSet, CalendarProviderType.

scripts/deploy-lambda.sh         ← Builds + zips + deploys to AWS Lambda.
```

---

## Key Concepts

### Multi-Provider Architecture

Caleo doesn't assume you use one calendar. Each user can connect **both** Microsoft and Google.
When you ask about your calendar, the agent checks which providers you have tokens for and
passes them all to Claude. Claude decides which provider to query based on context, or asks
you if it's ambiguous.

```
User says: "show my calendar"
  → Agent has Microsoft token? Build MicrosoftCalendarProvider
  → Agent has Google token? Build GoogleCalendarProvider
  → Pass both to Claude
  → Claude calls get_today_events (picks one or asks)
```

### OAuth Flow

```
1. User types /caleo-auth (or asks a calendar question with no tokens)
2. Bot posts Slack message with two buttons:
   [Connect Microsoft Outlook]  [Connect Google Calendar]
3. Button is a URL → redirects to Microsoft/Google login
4. User authorizes → redirected to http://localhost:3000/auth/callback?code=...&state=...
5. Callback decodes state (contains userId, workspaceId, provider)
6. Exchanges code for access_token + refresh_token
7. Encrypts both tokens, stores in oauth_tokens table
8. Next time user asks about calendar → tokens are fetched, decrypted, and used
```

The `state` parameter is a base64-encoded JSON with `{userId, workspaceId, provider}` so
the callback knows which OAuth provider to exchange with and which DB user to store under.

**Token refresh** happens automatically: if the access token is expired, the oauth module
tries the refresh token before giving up.

### Conversation History

Every message (user + assistant) is stored in the `messages` table, linked to a
`conversation` (scoped to user + channel + thread). When processing a new message,
the last 20 messages are fetched and passed to Claude as conversation history.
This gives Claude context for follow-up questions like "reschedule that" or
"who's in the 2pm meeting?"

### Encryption

OAuth tokens are AES-encrypted using the `ENCRYPTION_KEY` before being stored in
the database. Decrypted on-the-fly when needed for API calls. Never logged in plaintext.

---

## Running Locally

### Prerequisites
- Node.js 18+
- PostgreSQL 16 (installed via `brew install postgresql@16`)
- A Slack app with Socket Mode enabled
- An Anthropic API key with credits

### Current State
```bash
# PostgreSQL is running via:
brew services start postgresql@16

# Database "caleo" exists with all tables.
# Connection: postgresql://rpate@localhost:5432/caleo

# Build + run:
npm run build && npm run dev
# Or directly:
node dist/slack/index.js
```

### What Runs Where

| Component | Runs | Port |
|---|---|---|
| Slack Bot | Socket Mode (WebSocket to Slack) | N/A |
| HTTP server | localhost | 3000 |
| Health check | GET /api/health | 3000 |
| OAuth callback | GET /auth/callback | 3000 |
| PostgreSQL | Homebrew service | 5432 |

Socket Mode means Slack connects to your bot via WebSocket — no public URL needed
for receiving messages. But you **do** need ngrok for OAuth callbacks, because
Microsoft/Google need to redirect the user's browser to your machine.

### Testing OAuth (requires ngrok)
```bash
# Terminal 1:
ngrok http 3000

# Copy the https://xxxx.ngrok-free.dev URL
# Set NGROK_URL in config.env
# Restart the bot

# Then /caleo-auth in Slack → click a button → complete the OAuth flow
```

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Claude API key |
| `SLACK_BOT_TOKEN` | Yes | Slack bot token (xoxb-...) |
| `SLACK_SIGNING_SECRET` | Yes | Slack app signing secret |
| `SLACK_APP_TOKEN` | Yes | Slack app-level token for Socket Mode (xapp-...) |
| `SLACK_SOCKET_MODE` | No | Default `true`. Set `false` for HTTP mode |
| `SLACK_PORT` | No | Default `3000` |
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `ENCRYPTION_KEY` | Yes | 64-char hex key for token encryption |
| `NGROK_URL` | For OAuth | Public URL for OAuth callbacks |
| `MICROSOFT_APP_ID` | For Outlook | Azure AD app client ID |
| `MICROSOFT_APP_PASSWORD` | For Outlook | Azure AD app client secret |
| `GOOGLE_CLIENT_ID` | For Google | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | For Google | Google OAuth client secret |
| `USE_REMOTE_AGENT` | No | Default `false`. Set `true` to use Lambda |
| `AGENT_ENDPOINT` | For remote | API Gateway URL when using Lambda |
| `NODE_ENV` | No | `development` or `production` |

---

## AWS Deployment (Phase 5 — Future)

When ready to deploy the agent to AWS:

```
Slack Bot (local or ECS)
    │  HTTPS POST
    ▼
API Gateway (HTTP API v2)
    │
    ▼
Lambda (caleo-agent)
    ├── Anthropic API (Claude)
    ├── Microsoft Graph / Google Calendar APIs
    └── RDS PostgreSQL
```

- `src/agent/lambda-handler.ts` is the Lambda entry point
- `scripts/deploy-lambda.sh` builds, zips, and deploys
- Set `USE_REMOTE_AGENT=true` and `AGENT_ENDPOINT=https://your-api-gw.amazonaws.com/agent`
- The Slack bot sends the message + tokens to Lambda, Lambda runs Claude, returns the response

This splits the compute-heavy AI work (Lambda, scales independently) from the Slack
connection management (lightweight, always-on).

---

## What You Need To Do

1. **Add credits to Anthropic** — Done (you said it's refilled)
2. **Test basic chat** — DM the bot in Slack, it should respond via Claude
3. **Set up ngrok** — `ngrok http 3000`, update `NGROK_URL` in config.env
4. **Configure Microsoft OAuth** — Register an app in Azure AD, set `MICROSOFT_APP_ID` + `MICROSOFT_APP_PASSWORD`
5. **Test `/caleo-auth`** — Connect Microsoft, then try `/caleo show my calendar`
6. **Configure Google OAuth** — Create credentials in Google Cloud Console, set `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET`
7. **Test multi-provider** — Connect both, ask about calendars

### Slack App Configuration Checklist

At api.slack.com/apps > your app:

- [ ] **Socket Mode**: Enabled, app-level token generated
- [ ] **OAuth Scopes**: `app_mentions:read`, `chat:write`, `commands`, `im:history`, `im:write`, `users:read`, `users:read.email`
- [ ] **Event Subscriptions**: Enabled, subscribed to `message.im` and `app_mention`
- [ ] **Slash Commands**: `/caleo` (description: "Ask Caleo anything"), `/caleo-auth` (description: "Connect calendar providers")
- [ ] **Installed to workspace**

### Microsoft Azure AD App Setup

At portal.azure.com > App registrations:

- [ ] Register new app (any name)
- [ ] Redirect URI: `https://YOUR-NGROK-URL/auth/callback` (Web platform)
- [ ] API permissions: `Calendars.ReadWrite`, `User.Read`, `Mail.ReadWrite`
- [ ] Create client secret → copy into `MICROSOFT_APP_PASSWORD`
- [ ] Copy Application (client) ID → `MICROSOFT_APP_ID`

### Google Cloud Console Setup

At console.cloud.google.com > APIs & Services > Credentials:

- [ ] Create OAuth 2.0 Client ID (Web application)
- [ ] Authorized redirect URI: `https://YOUR-NGROK-URL/auth/callback`
- [ ] Enable Google Calendar API and Gmail API
- [ ] Copy Client ID → `GOOGLE_CLIENT_ID`, Client Secret → `GOOGLE_CLIENT_SECRET`
