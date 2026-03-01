# Caleo Slack Local Setup

This project now has a Slack runtime entrypoint at `src/slack/index.ts` that reuses the existing agent and calendar services.

## 1) Create a Slack app

1. Go to https://api.slack.com/apps and create a new app.
2. Enable **Socket Mode** and create an app-level token with `connections:write`.
3. Under **OAuth & Permissions**, add bot scopes:
   - `app_mentions:read`
   - `chat:write`
   - `commands`
   - `im:history`
   - `users:read`
   - `users:read.email`
4. Under **Event Subscriptions**:
   - Enable events.
   - Add bot events: `app_mention`, `message.im`.
5. Under **Slash Commands**, create:
   - `/caleo` — Ask Caleo anything
   - `/caleo-auth` — Connect calendar providers
   - `/caleo-billing` — Manage billing and add credits
   - `/caleo-settings` — Configure preferences (work hours, focus time, etc.)
   - `/caleo-privacy` — View or delete your stored data
6. Install the app to your workspace.

## 2) Configure environment

Add these variables in `config.env` (or `.env` if you prefer):

```env
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...
SLACK_APP_TOKEN=xapp-...
SLACK_SOCKET_MODE=true
SLACK_PORT=3000
```

Calendar OAuth still uses a browser redirect. Keep:

```env
NGROK_URL=https://your-ngrok-subdomain.ngrok-free.app
MICROSOFT_APP_ID=...
MICROSOFT_APP_PASSWORD=...
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

## 3) Run locally

```bash
npm install
npm run build
npm start
```

If you use Microsoft calendar auth locally, expose port `3000`:

```bash
ngrok http 3000
```

Then set `NGROK_URL` to your current ngrok URL and ensure your Microsoft app redirect URI includes:

```text
https://<your-ngrok-url>/auth/callback
```

## 4) Test in Slack

1. DM the bot: `show my calendar`.
2. If prompted, run `/caleo-auth` and open the auth link.
3. Try `/caleo find free time for 30 minutes tomorrow afternoon`.

## Notes

- Socket Mode means Slack events do not require ngrok.
- ngrok is only needed for the OAuth callback (Google + Microsoft) while running locally.
