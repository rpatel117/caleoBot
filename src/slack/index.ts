import * as dotenv from 'dotenv';
dotenv.config({ path: './config.env' });

import * as http from 'http';
import { getAgentClient } from '../agent/client';
import { UserContext, CalendarProviderType } from '../types';
import { repository } from '../database/repository';
import { EncryptionService } from '../encryption';
import { MicrosoftOAuth } from '../calendar/microsoft/oauth';
import { MicrosoftCalendarProvider } from '../calendar/microsoft/provider';
import { MicrosoftEmailProvider } from '../email/microsoft';
import { GoogleOAuth } from '../calendar/google/oauth';
import { GoogleCalendarProvider } from '../calendar/google/provider';
import { GoogleEmailProvider } from '../email/google';

const { App, ExpressReceiver } = require('@slack/bolt') as {
  App: any;
  ExpressReceiver: any;
};

// Deduplication
const processedEventIds = new Set<string>();
const processedEventTtlMs = 5 * 60 * 1000;

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function markEventAsProcessing(eventId: string): boolean {
  if (processedEventIds.has(eventId)) return false;
  processedEventIds.add(eventId);
  setTimeout(() => processedEventIds.delete(eventId), processedEventTtlMs);
  return true;
}

function normalizeMessageText(rawText: string): string {
  return rawText.replace(/<@[^>]+>/g, '').trim();
}

function splitLongMessage(text: string, chunkSize: number = 3000): string[] {
  if (text.length <= chunkSize) return [text];
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    chunks.push(text.slice(start, start + chunkSize));
    start += chunkSize;
  }
  return chunks;
}

function needsCalendarContext(message: string): boolean {
  const lower = message.toLowerCase();

  const simpleDateQuestions = [
    "what is today's date", "what's today's date", 'what is the date today',
    "what's the date today", 'what date is it', 'what time is it', "what's the time",
  ];
  if (simpleDateQuestions.some(q => lower.includes(q))) return false;

  const calendarKeywords = [
    'calendar', 'schedule', 'meeting', 'event', 'appointment', 'tomorrow',
    'yesterday', 'this week', 'next week', 'monday', 'tuesday', 'wednesday',
    'thursday', 'friday', 'saturday', 'sunday', 'when', 'available', 'free time',
    'book', 'create', 'add', 'cancel', 'reschedule', 'upcoming', 'next meeting',
    'follow up', 'followup', 'draft', 'email',
  ];
  return calendarKeywords.some(kw => lower.includes(kw));
}

// OAuth providers (singletons)
const microsoftOAuth = new MicrosoftOAuth();
const googleOAuth = new GoogleOAuth();
const encryption = new EncryptionService();

function getRedirectUri(): string {
  if (process.env.OAUTH_REDIRECT_URI) return process.env.OAUTH_REDIRECT_URI;
  const base = process.env.NGROK_URL || `http://localhost:${process.env.SLACK_PORT || 3000}`;
  return `${base}/auth/callback`;
}

// Build providers map for agent
async function buildProviders(dbUserId: string): Promise<Map<CalendarProviderType, any>> {
  const providers = new Map<CalendarProviderType, any>();

  try {
    const msToken = await microsoftOAuth.getValidAccessToken(dbUserId);
    if (msToken) {
      providers.set('microsoft', {
        calendar: new MicrosoftCalendarProvider(),
        email: new MicrosoftEmailProvider(),
        accessToken: msToken,
        providerType: 'microsoft' as CalendarProviderType,
      });
    }
  } catch (err) {
    console.error('Failed to load Microsoft provider:', err);
  }

  try {
    const gToken = await googleOAuth.getValidAccessToken(dbUserId);
    if (gToken) {
      providers.set('google', {
        calendar: new GoogleCalendarProvider(),
        email: new GoogleEmailProvider(),
        accessToken: gToken,
        providerType: 'google' as CalendarProviderType,
      });
    }
  } catch (err) {
    console.error('Failed to load Google provider:', err);
  }

  return providers;
}

async function ensureUser(client: any, slackUserId: string, teamId?: string): Promise<{
  userContext: UserContext;
  dbUserId: string;
}> {
  let name = slackUserId;
  let email = `${slackUserId}@slack.local`;
  let tz = 'America/Chicago';

  try {
    const userInfo = await client.users.info({ user: slackUserId });
    const profile = userInfo?.user?.profile || {};
    name = userInfo?.user?.real_name || userInfo?.user?.name || name;
    email = profile?.email || email;
    tz = userInfo?.user?.tz || tz;
  } catch {
    // Use fallback identity
  }

  const workspaceExternalId = teamId || 'default';
  const workspace = await repository.getOrCreateWorkspace('slack', workspaceExternalId);
  const user = await repository.createUser(workspace.id, slackUserId, name, email, tz);

  return {
    userContext: {
      userId: slackUserId,
      name,
      email,
      workspaceId: workspace.id,
      timezone: tz,
    },
    dbUserId: user.id,
  };
}

// Setup
const signingSecret = getRequiredEnv('SLACK_SIGNING_SECRET');
const botToken = getRequiredEnv('SLACK_BOT_TOKEN');
const socketMode = (process.env.SLACK_SOCKET_MODE || 'true').toLowerCase() === 'true';
const appToken = socketMode ? getRequiredEnv('SLACK_APP_TOKEN') : undefined;
const agentClient = getAgentClient();

// Build the Slack app differently depending on socket mode
let app: any;
let receiver: any;

if (socketMode) {
  // Socket Mode: no custom receiver, Slack handles the connection
  app = new App({
    token: botToken,
    signingSecret,
    socketMode: true,
    appToken,
  });
} else {
  // HTTP mode: use ExpressReceiver for routes
  receiver = new ExpressReceiver({
    signingSecret,
    endpoints: '/slack/events',
  });
  app = new App({
    token: botToken,
    receiver,
  });
}

// --- HTTP server for health check + OAuth callback (runs regardless of mode) ---
const httpPort = Number(process.env.SLACK_PORT || process.env.PORT || 3000);

const httpServer = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://localhost:${httpPort}`);

  if (url.pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'OK', service: 'caleo-slack-bot', socketMode }));
    return;
  }

  if (url.pathname === '/auth/callback') {
    try {
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');

      if (!code || !state) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Missing code or state parameter' }));
        return;
      }

      const stateData = JSON.parse(Buffer.from(state, 'base64').toString());
      const { userId: slackUserId, workspaceId, provider } = stateData;
      const redirectUri = getRedirectUri();

      let tokens;
      if (provider === 'google') {
        tokens = await googleOAuth.exchangeCode(code, redirectUri);
      } else {
        tokens = await microsoftOAuth.exchangeCode(code, redirectUri);
      }

      const workspace = await repository.getOrCreateWorkspace('slack', workspaceId);
      const user = await repository.createUser(workspace.id, slackUserId);

      const encryptedAccess = encryption.encrypt(tokens.accessToken);
      const encryptedRefresh = tokens.refreshToken ? encryption.encrypt(tokens.refreshToken) : undefined;

      await repository.storeToken(
        user.id,
        provider || 'microsoft',
        encryptedAccess,
        tokens.expiresAt,
        tokens.scopes,
        encryptedRefresh
      );

      const providerName = provider === 'google' ? 'Google Calendar' : 'Microsoft Outlook';
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<html><body style="font-family:sans-serif;text-align:center;padding:40px">
        <h2>Connected to ${providerName}!</h2>
        <p>You can close this window and return to Slack.</p>
      </body></html>`);
    } catch (error) {
      console.error('OAuth callback error:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }));
    }
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

// Message processing
async function processUserMessage(args: {
  client: any;
  userId: string;
  teamId?: string;
  channel: string;
  threadTs?: string;
  text: string;
}): Promise<void> {
  const normalizedText = normalizeMessageText(args.text);
  if (!normalizedText) return;

  console.log(`Processing message from ${args.userId}: "${normalizedText}"`);

  const { userContext, dbUserId } = await ensureUser(args.client, args.userId, args.teamId);
  console.log(`User ensured: dbUserId=${dbUserId}, name=${userContext.name}`);

  let providers = new Map<CalendarProviderType, any>();

  if (needsCalendarContext(normalizedText)) {
    providers = await buildProviders(dbUserId);

    if (providers.size === 0) {
      const redirectUri = getRedirectUri();
      const msUrl = microsoftOAuth.generateAuthUrl(args.userId, userContext.workspaceId, redirectUri);
      const gUrl = googleOAuth.generateAuthUrl(args.userId, userContext.workspaceId, redirectUri);

      await args.client.chat.postMessage({
        channel: args.channel,
        thread_ts: args.threadTs,
        text: 'I need calendar access to help with that. Please connect a provider:',
        blocks: [
          {
            type: 'section',
            text: { type: 'mrkdwn', text: 'I need calendar access to help with that. Please connect a provider:' },
          },
          {
            type: 'actions',
            elements: [
              {
                type: 'button',
                text: { type: 'plain_text', text: 'Connect Microsoft Outlook' },
                url: msUrl,
                action_id: 'connect_microsoft',
              },
              {
                type: 'button',
                text: { type: 'plain_text', text: 'Connect Google Calendar' },
                url: gUrl,
                action_id: 'connect_google',
              },
            ],
          },
        ],
      });
      return;
    }
  }

  // Fetch conversation history from DB
  const conversation = await repository.getOrCreateConversation(dbUserId, args.channel, args.threadTs);
  const dbMessages = await repository.getMessages(conversation.id, 20);
  const conversationHistory = dbMessages.map(m => ({ role: m.role, content: m.content }));

  await args.client.chat.postMessage({
    channel: args.channel,
    thread_ts: args.threadTs,
    text: 'Caleo is processing your request...',
  });

  await repository.createMessage(conversation.id, 'user', normalizedText);

  console.log('Calling agent...');
  const response = await agentClient.processMessage(
    normalizedText,
    userContext,
    providers,
    conversationHistory,
    dbUserId
  );
  console.log(`Agent responded (${response.length} chars)`);

  await repository.createMessage(conversation.id, 'assistant', response);

  const chunks = splitLongMessage(response);
  for (const chunk of chunks) {
    await args.client.chat.postMessage({
      channel: args.channel,
      thread_ts: args.threadTs,
      text: chunk,
    });
  }

  // Onboarding hint: if this is the user's first message and they have no calendar connected
  if (conversationHistory.length === 0 && !needsCalendarContext(normalizedText)) {
    const tokens = await repository.getTokensByUser(dbUserId);
    if (tokens.length === 0) {
      await args.client.chat.postMessage({
        channel: args.channel,
        thread_ts: args.threadTs,
        text: 'Tip: I can also manage your calendar! Use /caleo-auth to connect Microsoft Outlook or Google Calendar.',
      });
    }
  }
}

// /caleo command
app.command('/caleo', async ({ command, ack, client, body }: any) => {
  await ack();
  try {
    const commandText = command.text?.trim() || 'What can you do?';
    console.log(`/caleo command from ${command.user_id}: "${commandText}"`);
    await processUserMessage({
      client,
      userId: command.user_id,
      teamId: body?.team_id,
      channel: command.channel_id,
      text: commandText,
    });
  } catch (error) {
    console.error('/caleo command error:', error);
    await client.chat.postMessage({
      channel: command.channel_id,
      text: `Sorry, something went wrong: ${error instanceof Error ? error.message : 'Unknown error'}`,
    });
  }
});

// /caleo-auth command
app.command('/caleo-auth', async ({ command, ack, respond, client, body }: any) => {
  await ack();
  const { dbUserId, userContext } = await ensureUser(client, command.user_id, body?.team_id);
  const tokens = await repository.getTokensByUser(dbUserId);
  const connectedProviders = tokens.map((t: any) => t.provider);

  const redirectUri = getRedirectUri();
  const elements: any[] = [];

  if (!connectedProviders.includes('microsoft')) {
    elements.push({
      type: 'button',
      text: { type: 'plain_text', text: 'Connect Microsoft Outlook' },
      url: microsoftOAuth.generateAuthUrl(command.user_id, userContext.workspaceId, redirectUri),
      action_id: 'connect_microsoft',
    });
  }

  if (!connectedProviders.includes('google')) {
    elements.push({
      type: 'button',
      text: { type: 'plain_text', text: 'Connect Google Calendar' },
      url: googleOAuth.generateAuthUrl(command.user_id, userContext.workspaceId, redirectUri),
      action_id: 'connect_google',
    });
  }

  if (elements.length === 0) {
    await respond(`Your connected providers: ${connectedProviders.join(', ')}. All available providers are connected.`);
    return;
  }

  const statusText = connectedProviders.length > 0
    ? `Connected: ${connectedProviders.join(', ')}. Connect more:`
    : 'Connect a calendar provider to get started:';

  await respond({
    text: statusText,
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: statusText } },
      { type: 'actions', elements },
    ],
  });
});

// Handle button action acknowledgment
app.action('connect_microsoft', async ({ ack }: any) => { await ack(); });
app.action('connect_google', async ({ ack }: any) => { await ack(); });

// App mentions
app.event('app_mention', async ({ event, body, client }: any) => {
  const eventId = body?.event_id || `mention:${event?.channel}:${event?.ts}`;
  if (!markEventAsProcessing(eventId)) return;

  await processUserMessage({
    client,
    userId: event.user,
    teamId: body?.team_id,
    channel: event.channel,
    threadTs: event.thread_ts || event.ts,
    text: event.text || '',
  });
});

// DMs
app.event('message', async ({ event, body, client }: any) => {
  if (event?.subtype || event?.bot_id) return;
  if (event?.channel_type !== 'im') return;

  const eventId = body?.event_id || `dm:${event?.channel}:${event?.ts}`;
  if (!markEventAsProcessing(eventId)) return;

  await processUserMessage({
    client,
    userId: event.user,
    teamId: body?.team_id,
    channel: event.channel,
    threadTs: undefined,
    text: event.text || '',
  });
});

app.error((error: any) => {
  console.error('Slack app error:', error);
});

async function start(): Promise<void> {
  // Start the HTTP server for health check + OAuth
  httpServer.listen(httpPort, () => {
    console.log(`HTTP server on port ${httpPort} (health check + OAuth callback)`);
  });

  // Start the Slack app (Socket Mode connects via WebSocket, not the HTTP port)
  await app.start();

  console.log(`Caleo Slack bot is running`);
  console.log(`Health check: http://localhost:${httpPort}/api/health`);
  console.log(`OAuth callback: http://localhost:${httpPort}/auth/callback`);
  console.log(`Mode: ${socketMode ? 'Socket Mode' : 'HTTP Events API'}`);
}

start().catch((error) => {
  console.error('Failed to start Slack bot:', error);
  process.exit(1);
});
