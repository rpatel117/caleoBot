import * as dotenv from 'dotenv';
dotenv.config({ path: './config.env' });

import * as http from 'http';
import { getAgentClient, SlackContext } from '../agent/client';
import { UserContext, CalendarProviderType } from '../types';
import { repository } from '../database/repository';
import pool from '../database/client';
import { EncryptionService } from '../encryption';
import { MicrosoftOAuth } from '../calendar/microsoft/oauth';
import { MicrosoftCalendarProvider } from '../calendar/microsoft/provider';
import { MicrosoftEmailProvider } from '../email/microsoft';
import { GoogleOAuth } from '../calendar/google/oauth';
import { GoogleCalendarProvider } from '../calendar/google/provider';
import { GoogleEmailProvider } from '../email/google';
import { buildSystemPrompt, DynamicPromptContext, UserPreferences, DayEventsSnapshot } from '../agent/config';
import { formatEventsForPrompt, computeFreeTimeGaps, detectConflicts } from '../agent/calendar-context';
import { calculateCostCents, formatBalanceForDisplay, LOW_BALANCE_THRESHOLD_CENTS } from '../billing/usage-tracker';
import { PLAN_LIMITS } from '../billing/plans';
import { signCheckoutParams } from '../billing/checkout-signer';
import { CalendarEvent } from '../calendar/types';
import { verifyAndDecodeState } from '../auth/oauth-state';
import { RateLimiter } from '../rate-limiter';
import { DbRateLimiter } from '../db-rate-limiter';
import { createCheckoutSession, constructWebhookEvent } from '../billing/stripe';
import { verifyCheckoutParams } from '../billing/checkout-signer';
import { notifier, NotifyEvent } from '../notifications/notify';

const { App, ExpressReceiver } = require('@slack/bolt') as {
  App: any;
  ExpressReceiver: any;
};

// Deduplication
const processedEventIds = new Set<string>();
const processedEventTtlMs = 5 * 60 * 1000;

// Rate limiting: 10 messages per user per 60 seconds
// In-memory limiter used as fast path; DB limiter used in production for multi-instance consistency
const inMemoryRateLimiter = new RateLimiter(10, 60_000);
const dbRateLimiter = new DbRateLimiter(pool, 10, 60_000);

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

// Cross-org meeting service
import { CrossOrgService } from '../calendar/cross-org';
const crossOrgService = new CrossOrgService({ googleOAuth, microsoftOAuth, repository });

// Ambient services
import { StatusSyncService } from './status-sync';
import { DailyBriefingService } from './daily-briefing';
import { CleanupService } from '../database/cleanup-service';

function getRedirectUri(): string {
  if (process.env.OAUTH_REDIRECT_URI) return process.env.OAUTH_REDIRECT_URI;
  const base = process.env.NGROK_URL || `http://localhost:${process.env.SLACK_PORT || 3000}`;
  return `${base}/auth/callback`;
}

// Build providers map for agent
async function buildProviders(dbUserId: string): Promise<Map<CalendarProviderType, any>> {
  const providers = new Map<CalendarProviderType, any>();

  // First check what tokens are stored in DB
  const storedTokens = await repository.getTokensByUser(dbUserId);
  const storedProviders = storedTokens.map((t: any) => t.provider);
  console.log(`[buildProviders] user=${dbUserId}, stored tokens: [${storedProviders.join(', ') || 'none'}]`);

  try {
    const msToken = await microsoftOAuth.getValidAccessToken(dbUserId);
    if (msToken) {
      providers.set('microsoft', {
        calendar: new MicrosoftCalendarProvider(),
        email: new MicrosoftEmailProvider(),
        accessToken: msToken,
        providerType: 'microsoft' as CalendarProviderType,
      });
      console.log('[buildProviders] Microsoft provider loaded successfully');
    } else if (storedProviders.includes('microsoft')) {
      console.warn('[buildProviders] Microsoft token stored but getValidAccessToken returned null — token may be expired/revoked');
    }
  } catch (err) {
    console.error('[buildProviders] Failed to load Microsoft provider:', err);
    notifier.emit(NotifyEvent.PROVIDER_BUILD_FAILURE, `Microsoft provider failed for user ${dbUserId}`, undefined, err instanceof Error ? err : new Error(String(err)));
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
      console.log('[buildProviders] Google provider loaded successfully');
    } else if (storedProviders.includes('google')) {
      console.warn('[buildProviders] Google token stored but getValidAccessToken returned null — token may be expired/revoked');
    }
  } catch (err) {
    console.error('[buildProviders] Failed to load Google provider:', err);
    notifier.emit(NotifyEvent.PROVIDER_BUILD_FAILURE, `Google provider failed for user ${dbUserId}`, undefined, err instanceof Error ? err : new Error(String(err)));
  }

  console.log(`[buildProviders] Active providers: [${Array.from(providers.keys()).join(', ') || 'none'}]`);
  return providers;
}

async function ensureUser(client: any, slackUserId: string, teamId?: string): Promise<{
  userContext: UserContext;
  dbUserId: string;
  slackTeamId: string;
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
    slackTeamId: workspaceExternalId,
  };
}

// ---------- Calendar context helpers ----------

/**
 * Get the UTC timestamps for start/end of a day in a given timezone.
 * E.g., for America/Chicago (UTC-6), midnight CT on 2026-02-14 = 2026-02-14T06:00:00Z
 */
function getTimezoneDay(tz: string, offsetDays: number = 0): { start: Date; end: Date; dateStr: string } {
  const now = new Date();
  // Get today's date in the user's timezone
  let refDate = now;
  if (offsetDays !== 0) {
    refDate = new Date(now.getTime() + offsetDays * 24 * 60 * 60 * 1000);
  }
  const dateStr = refDate.toLocaleDateString('en-CA', { timeZone: tz }); // YYYY-MM-DD

  // Create midnight UTC on this date
  const midnightUtc = new Date(`${dateStr}T00:00:00Z`);

  // Calculate TZ offset: format the same instant in UTC and tz, diff them
  const utcFmt = midnightUtc.toLocaleString('en-US', { timeZone: 'UTC' });
  const tzFmt = midnightUtc.toLocaleString('en-US', { timeZone: tz });
  const offsetMs = new Date(utcFmt).getTime() - new Date(tzFmt).getTime();

  // Midnight in user's tz = midnight UTC + offset
  const start = new Date(midnightUtc.getTime() + offsetMs);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
  return { start, end, dateStr };
}

interface DayEvents {
  dateStr: string;  // YYYY-MM-DD
  label: string;    // "yesterday", "today", "tomorrow", etc.
  events: CalendarEvent[];
}

async function fetchMultiDayEvents(
  providers: Map<CalendarProviderType, any>,
  tz: string,
  daysBack: number = 3,
  daysForward: number = 3
): Promise<DayEvents[]> {
  for (const [, prov] of providers) {
    if (!prov.calendar || !prov.accessToken) continue;
    try {
      // Get the full range: daysBack ago to daysForward from now
      const rangeStart = getTimezoneDay(tz, -daysBack);
      const rangeEnd = getTimezoneDay(tz, daysForward);
      console.log(`[fetchMultiDayEvents] Querying: ${rangeStart.start.toISOString()} to ${rangeEnd.end.toISOString()} (tz=${tz})`);
      const allEvents = await prov.calendar.getEvents(prov.accessToken, rangeStart.start, rangeEnd.end);
      console.log(`[fetchMultiDayEvents] Got ${allEvents.length} total events across ${daysBack + daysForward + 1} days`);

      // Bucket events by day
      const dayLabels: Record<number, string> = {
        [-3]: '3 days ago', [-2]: '2 days ago', [-1]: 'yesterday',
        [0]: 'today', [1]: 'tomorrow', [2]: 'in 2 days', [3]: 'in 3 days',
      };

      const results: DayEvents[] = [];
      for (let offset = -daysBack; offset <= daysForward; offset++) {
        const { start, end, dateStr } = getTimezoneDay(tz, offset);
        const dayEvents = allEvents.filter((e: CalendarEvent) => {
          const eventStart = new Date(e.start.dateTime);
          return eventStart >= start && eventStart <= end;
        });
        results.push({
          dateStr,
          label: dayLabels[offset] || `${Math.abs(offset)} days ${offset > 0 ? 'from now' : 'ago'}`,
          events: dayEvents,
        });
      }
      return results;
    } catch (err) {
      console.error('Failed to fetch multi-day events for prompt:', err);
    }
  }
  return [];
}

function getWeekEventCount(multiDayEvents: DayEvents[]): number {
  return multiDayEvents.reduce((sum, day) => sum + day.events.length, 0);
}

function dbPrefsToPromptPrefs(dbPrefs: any): UserPreferences {
  return {
    workHoursStart: dbPrefs.work_hours_start || '09:00',
    workHoursEnd: dbPrefs.work_hours_end || '17:00',
    defaultDurationMinutes: dbPrefs.default_duration_minutes || 30,
    bufferMinutes: dbPrefs.buffer_minutes || 0,
    preferredProvider: dbPrefs.preferred_provider || undefined,
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

  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');

  if (url.pathname === '/api/health') {
    try {
      const dbHealthy = await Promise.race([
        repository.testConnection(),
        new Promise<boolean>((_, reject) =>
          setTimeout(() => reject(new Error('Health check timeout')), 5000)
        ),
      ]).catch(() => false);
      // Check Slack WebSocket connectivity (socket mode only)
      const slackConnected = !socketMode || (app?.client?.token ? true : false);
      const healthy = dbHealthy && slackConnected;

      const status = healthy ? 'healthy' : 'degraded';
      const statusCode = healthy ? 200 : 503;

      res.writeHead(statusCode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status,
        service: 'caleo-slack-bot',
        database: dbHealthy ? 'connected' : 'unreachable',
        slack: slackConnected ? 'connected' : 'disconnected',
        socketMode,
        timestamp: new Date().toISOString(),
      }));
    } catch {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'degraded',
        service: 'caleo-slack-bot',
        database: 'unreachable',
        slack: 'unknown',
        socketMode,
        timestamp: new Date().toISOString(),
      }));
    }
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

      let stateData;
      try {
        stateData = verifyAndDecodeState(state);
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Invalid or tampered state parameter' }));
        return;
      }
      const { userId: slackUserId, workspaceId, provider } = stateData;
      const redirectUri = getRedirectUri();

      console.log(`[OAuth Callback] provider=${provider}, redirectUri=${redirectUri}, slackUserId=${slackUserId}`);
      console.log(`[OAuth Callback] code length=${code.length}, state provider=${provider}`);

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
      notifier.emit(NotifyEvent.NEW_USER_SIGNUP, `${providerName} connected`, `slackUser=${slackUserId}, workspace=${workspaceId}`);
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<html><body style="font-family:sans-serif;text-align:center;padding:40px">
        <h2>Connected to ${providerName}!</h2>
        <p>You can close this window and return to Slack.</p>
      </body></html>`);
    } catch (error) {
      console.error('OAuth callback error:', error);
      notifier.emit(NotifyEvent.OAUTH_CALLBACK_FAILURE, 'OAuth callback failed', undefined, error instanceof Error ? error : new Error(String(error)));
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: false,
        error: 'Calendar connection failed',
      }));
    }
    return;
  }

  // --- Billing routes ---

  if (url.pathname === '/billing/checkout' && req.method === 'GET') {
    try {
      const amountCents = parseInt(url.searchParams.get('amount') || '0', 10);
      const userId = url.searchParams.get('user') || '';
      const dbUserId = url.searchParams.get('dbUser') || '';
      const ts = parseInt(url.searchParams.get('ts') || '0', 10);
      const sig = url.searchParams.get('sig') || '';

      if (!amountCents || !userId || !dbUserId || !ts || !sig) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing required parameters' }));
        return;
      }
      if (![500, 1000, 2000].includes(amountCents)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid amount' }));
        return;
      }
      if (!verifyCheckoutParams(amountCents, userId, dbUserId, ts, sig)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid signature — use /caleo-billing in Slack' }));
        return;
      }

      const baseUrl = process.env.BILLING_BASE_URL || process.env.NGROK_URL || `http://localhost:${httpPort}`;
      const checkoutUrl = await createCheckoutSession({
        userId, dbUserId, amountCents,
        successUrl: `${baseUrl}/billing/success`,
        cancelUrl: `${baseUrl}/billing/cancel`,
      });

      res.writeHead(302, { Location: checkoutUrl });
      res.end();
    } catch (error) {
      console.error('Billing checkout error:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Checkout failed' }));
    }
    return;
  }

  if (url.pathname === '/billing/webhook' && req.method === 'POST') {
    try {
      const MAX_WEBHOOK_BODY = 65536; // 64KB max for Stripe webhooks
      const chunks: Buffer[] = [];
      let totalSize = 0;
      for await (const chunk of req) {
        totalSize += (chunk as Buffer).length;
        if (totalSize > MAX_WEBHOOK_BODY) {
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Payload too large' }));
          return;
        }
        chunks.push(chunk as Buffer);
      }
      const rawBody = Buffer.concat(chunks).toString('utf-8');
      const signature = req.headers['stripe-signature'] as string || '';

      const stripeEvent = constructWebhookEvent(rawBody, signature);

      if (stripeEvent.type === 'checkout.session.completed') {
        const session = stripeEvent.data.object as any;
        const eventDbUserId = session.metadata?.dbUserId;
        const amountCents = parseInt(session.metadata?.amountCents || '0', 10);
        const ALLOWED_AMOUNTS = [500, 1000, 2000];

        if (eventDbUserId && ALLOWED_AMOUNTS.includes(amountCents)) {
          const credited = await repository.creditBalanceIfNotProcessed(stripeEvent.id, stripeEvent.type, eventDbUserId, amountCents);
          if (credited) {
            const balance = await repository.getBalance(eventDbUserId);
            console.log(`[Stripe] Credited ${(amountCents / 100).toFixed(2)} to ${eventDbUserId}. Balance: ${(balance.balance_cents / 100).toFixed(2)}`);
            notifier.emit(NotifyEvent.BILLING_PAYMENT, `$${(amountCents / 100).toFixed(2)} payment received`, `user=${eventDbUserId}, newBalance=$${(balance.balance_cents / 100).toFixed(2)}`);
          }
        }
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ received: true }));
    } catch (error) {
      console.error('Stripe webhook error:', error);
      notifier.emit(NotifyEvent.STRIPE_WEBHOOK_ERROR, 'Stripe webhook failed', undefined, error instanceof Error ? error : new Error(String(error)));
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Webhook verification failed' }));
    }
    return;
  }

  if (url.pathname === '/billing/success') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<!DOCTYPE html><html><head><title>Payment Successful</title>
<style>body{font-family:-apple-system,sans-serif;text-align:center;padding:60px 20px;background:#f8faf9}
h1{color:#2d7a4f}p{color:#555;font-size:18px}.icon{font-size:64px}</style></head><body>
<div class="icon">&#10003;</div><h1>Payment Successful!</h1>
<p>Your Caleo balance has been topped up.</p>
<p>You can close this window and return to Slack.</p></body></html>`);
    return;
  }

  if (url.pathname === '/billing/cancel') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<!DOCTYPE html><html><head><title>Payment Cancelled</title>
<style>body{font-family:-apple-system,sans-serif;text-align:center;padding:60px 20px;background:#faf8f8}
h1{color:#888}p{color:#555;font-size:18px}.icon{font-size:64px}</style></head><body>
<div class="icon">&#10007;</div><h1>Payment Cancelled</h1>
<p>No charge was made. You can close this window and return to Slack.</p>
<p>Use <code>/caleo-billing</code> in Slack to try again.</p></body></html>`);
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

// Contextual processing message based on user intent
function getProcessingMessage(text: string): string {
  const lower = text.toLowerCase();
  if (/\b(schedule|set up|book|create)\b.*\b(meeting|call|sync|event)\b/.test(lower)) {
    return 'Scheduling a meeting...';
  }
  if (/\b(find|look\s?up|search|who\s+is)\b/.test(lower) && /\b[A-Z][a-z]+\b/.test(text)) {
    return 'Searching your organization...';
  }
  if (/\b(cancel|delete|remove)\b.*\b(meeting|event|call)\b/.test(lower)) {
    return 'Looking up the meeting...';
  }
  if (/\b(reschedule|move|change|update)\b.*\b(meeting|event|call|time)\b/.test(lower)) {
    return 'Checking your calendar...';
  }
  if (/\b(free|available|availability|open|busy)\b/.test(lower)) {
    return 'Checking availability...';
  }
  if (/\b(today|tomorrow|this week|next week|calendar|agenda|schedule)\b/.test(lower)) {
    return 'Pulling up your calendar...';
  }
  return 'Working on it...';
}

// Message processing
async function processUserMessage(args: {
  client: any;
  userId: string;
  teamId?: string;
  channel: string;
  threadTs?: string;
  replyTs?: string;
  text: string;
}): Promise<void> {
  const normalizedText = normalizeMessageText(args.text);
  if (!normalizedText) return;

  // --- Rate limiting (before any DB lookups) ---
  // Use DB-backed limiter in production for consistency across ECS tasks; fall back to in-memory
  let rateCheck: { allowed: boolean; retryAfterMs: number };
  try {
    rateCheck = await dbRateLimiter.check(args.userId);
  } catch {
    rateCheck = inMemoryRateLimiter.check(args.userId);
  }
  if (!rateCheck.allowed) {
    notifier.emit(NotifyEvent.RATE_LIMIT_HIT, `Rate limit hit by user ${args.userId}`, `channel=${args.channel}`);
    const waitSec = Math.ceil(rateCheck.retryAfterMs / 1000);
    await args.client.chat.postMessage({
      channel: args.channel,
      thread_ts: args.replyTs ?? args.threadTs,
      text: `Slow down! You're sending messages too fast. Try again in ${waitSec}s.`,
    });
    return;
  }

  console.log(`Processing message from ${args.userId}: "${normalizedText}"`);

  const { userContext, dbUserId, slackTeamId } = await ensureUser(args.client, args.userId, args.teamId);
  console.log(`User ensured: dbUserId=${dbUserId}, name=${userContext.name}`);

  // --- User type & billing checks ---
  const userType = await repository.getUserType(dbUserId);
  const balance = await repository.getBalance(dbUserId);

  // Developer users bypass all billing checks
  if (userType !== 'developer') {
    // --- Balance gating ---
    if (balance.balance_cents <= 0) {
      await args.client.chat.postMessage({
        channel: args.channel,
        thread_ts: args.replyTs ?? args.threadTs,
        text: `You're out of Caleo credits (balance: ${formatBalanceForDisplay(balance.balance_cents)}). Use \`/caleo-billing\` to add more.`,
      });
      return;
    }

    // --- Plan limit gating (atomic increment-and-check) ---
    const plan = await repository.getWorkspacePlan(userContext.workspaceId);
    const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.free;
    const messageCheck = await repository.incrementUsageWithLimit(
      userContext.workspaceId,
      'message_sent',
      limits.messagesPerMonth
    );
    if (!messageCheck.allowed) {
      await args.client.chat.postMessage({
        channel: args.channel,
        thread_ts: args.replyTs ?? args.threadTs,
        text: `You've reached your free plan limit of ${limits.messagesPerMonth} messages this month. Upgrade to Pro to continue. Use \`/caleo-upgrade\` to learn more.`,
      });
      return;
    }
  }

  // Always load providers — the agent needs to know what's connected regardless of message content
  const providers = await buildProviders(dbUserId);

  // Only prompt for auth if the user explicitly asks about calendar stuff and has nothing connected
  if (providers.size === 0 && needsCalendarContext(normalizedText)) {
    const redirectUri = getRedirectUri();
    const msUrl = microsoftOAuth.generateAuthUrl(args.userId, slackTeamId, redirectUri);
    const gUrl = googleOAuth.generateAuthUrl(args.userId, slackTeamId, redirectUri);

    await args.client.chat.postMessage({
      channel: args.channel,
      thread_ts: args.replyTs ?? args.threadTs,
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

  // --- Build dynamic system prompt ---
  let systemPrompt: string | undefined;
  let conversationId: string | undefined;

  try {
    const tz = userContext.timezone || 'America/Chicago';
    const now = new Date();
    const connectedProviders = Array.from(providers.keys());

    // Load preferences
    const dbPrefs = await repository.getPreferences(dbUserId);
    const preferences = dbPrefsToPromptPrefs(dbPrefs);

    // Fetch calendar context if providers available
    let multiDayEvents: DayEvents[] = [];
    let todayEvents: CalendarEvent[] = [];
    let weekEventCount = 0;
    if (providers.size > 0) {
      multiDayEvents = await fetchMultiDayEvents(providers, tz, 3, 3);
      const todayEntry = multiDayEvents.find(d => d.label === 'today');
      todayEvents = todayEntry?.events || [];
      weekEventCount = getWeekEventCount(multiDayEvents);
    }

    const formattedEvents = formatEventsForPrompt(todayEvents, tz);
    const freeTimeToday = computeFreeTimeGaps(todayEvents, tz, preferences.workHoursStart, preferences.workHoursEnd);
    const upcomingConflicts = detectConflicts(todayEvents, tz);

    // Billing context
    const isLow = balance.balance_cents <= LOW_BALANCE_THRESHOLD_CENTS;
    const billingContext = { balanceCents: balance.balance_cents, isLow };

    // Slack thread URL
    const effectiveThreadTs = args.replyTs ?? args.threadTs;
    const slackThreadUrl = effectiveThreadTs
      ? `https://slack.com/archives/${args.channel}/p${effectiveThreadTs.replace('.', '')}`
      : undefined;

    // Format multi-day events for the prompt
    const multiDaySnapshots: DayEventsSnapshot[] = multiDayEvents.map(day => ({
      dateStr: day.dateStr,
      label: day.label,
      events: formatEventsForPrompt(day.events, tz),
    }));

    const promptCtx: DynamicPromptContext = {
      userName: userContext.name,
      userEmail: userContext.email,
      userTimezone: tz,
      currentTime: now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZoneName: 'short', timeZone: tz }),
      currentDate: now.toLocaleDateString('en-CA', { timeZone: tz }),
      dayOfWeek: now.toLocaleDateString('en-US', { weekday: 'long', timeZone: tz }),
      connectedProviders,
      todayEvents: formattedEvents,
      multiDayEvents: multiDaySnapshots,
      weekEventCount,
      upcomingConflicts,
      freeTimeToday,
      preferences,
      billingContext,
      slackThreadUrl,
    };

    systemPrompt = buildSystemPrompt(promptCtx);
  } catch (err) {
    console.error('Failed to build dynamic prompt, falling back to static:', err);
    // systemPrompt stays undefined → agent falls back to AGENT_INSTRUCTIONS
  }

  // Fetch conversation history from DB
  const conversation = await repository.getOrCreateConversation(dbUserId, args.channel, args.threadTs);
  conversationId = conversation.id;
  const dbMessages = await repository.getMessages(conversation.id, 20);
  const conversationHistory = dbMessages.map(m => ({ role: m.role, content: m.content }));

  const processingText = getProcessingMessage(normalizedText);
  await args.client.chat.postMessage({
    channel: args.channel,
    thread_ts: args.replyTs ?? args.threadTs,
    text: processingText,
  });

  await repository.createMessage(conversation.id, 'user', normalizedText);

  // Build Slack context for local agent
  const slackContext: SlackContext = {
    client: args.client,
    channelId: args.channel,
    threadTs: args.replyTs ?? args.threadTs,
  };

  console.log('Calling agent...');
  const agentResponse = await agentClient.processMessage(
    normalizedText,
    userContext,
    providers,
    conversationHistory,
    dbUserId,
    systemPrompt,
    slackContext,
    userType,
    crossOrgService
  );
  console.log(`Agent responded (${agentResponse.text.length} chars, ${agentResponse.totalUsage.inputTokens}+${agentResponse.totalUsage.outputTokens} tokens)`);

  await repository.createMessage(conversation.id, 'assistant', agentResponse.text);

  // --- Track workspace usage ---
  // Message count for developers (non-developers already incremented atomically in the limit check above)
  try {
    if (userType === 'developer') {
      await repository.incrementUsage(userContext.workspaceId, 'message_sent');
    }
    if (agentResponse.actionsPerformed) {
      const ap = agentResponse.actionsPerformed;
      for (let i = 0; i < ap.meetingsCreated; i++) {
        await repository.incrementUsage(userContext.workspaceId, 'meeting_created');
      }
      for (let i = 0; i < ap.meetingsUpdated; i++) {
        await repository.incrementUsage(userContext.workspaceId, 'meeting_updated');
      }
      for (let i = 0; i < ap.meetingsDeleted; i++) {
        await repository.incrementUsage(userContext.workspaceId, 'meeting_deleted');
      }
    }
  } catch (err) {
    console.error('Failed to track workspace usage:', err);
  }

  // --- Deduct balance & log usage (skip for developers) ---
  if (userType !== 'developer') {
    const costCents = calculateCostCents(agentResponse.totalUsage, agentResponse.sonnetUsage);
    if (costCents > 0 && conversationId) {
      try {
        await repository.deductBalance(dbUserId, costCents);
        await repository.createUsageLog({
          userId: dbUserId,
          conversationId,
          inputTokens: agentResponse.totalUsage.inputTokens,
          outputTokens: agentResponse.totalUsage.outputTokens,
          costCents,
          toolIterations: agentResponse.toolIterations,
        });
      } catch (err) {
        console.error('Failed to log usage / deduct balance:', err);
      }
    }
  }

  // Send response
  let responseText = agentResponse.text;

  // Low balance warning (skip for developers)
  if (userType !== 'developer') {
    const updatedBalance = await repository.getBalance(dbUserId);
    if (updatedBalance.balance_cents > 0 && updatedBalance.balance_cents <= LOW_BALANCE_THRESHOLD_CENTS) {
      responseText += `\n\n_Your Caleo balance is low (${formatBalanceForDisplay(updatedBalance.balance_cents)}). Use \`/caleo-billing\` to add credits._`;
    }
  }

  const chunks = splitLongMessage(responseText);
  for (const chunk of chunks) {
    await args.client.chat.postMessage({
      channel: args.channel,
      thread_ts: args.replyTs ?? args.threadTs,
      text: chunk,
    });
  }

  // Onboarding hint: if this is the user's first message and they have no calendar connected
  if (conversationHistory.length === 0 && providers.size === 0) {
    const tokens = await repository.getTokensByUser(dbUserId);
    if (tokens.length === 0) {
      await args.client.chat.postMessage({
        channel: args.channel,
        thread_ts: args.replyTs ?? args.threadTs,
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
    notifier.emit(NotifyEvent.UNHANDLED_ERROR, '/caleo command error', `user=${command.user_id}`, error instanceof Error ? error : new Error(String(error)));
    await client.chat.postMessage({
      channel: command.channel_id,
      text: 'Sorry, something went wrong. Please try again.',
    });
  }
});

// /caleo-auth command
app.command('/caleo-auth', async ({ command, ack, respond, client, body }: any) => {
  await ack();
  const { dbUserId, userContext, slackTeamId } = await ensureUser(client, command.user_id, body?.team_id);
  const tokens = await repository.getTokensByUser(dbUserId);
  const connectedProviders = tokens.map((t: any) => t.provider);

  const redirectUri = getRedirectUri();
  const connectElements: any[] = [];
  const reconnectElements: any[] = [];

  // Show "Connect" for providers not yet connected
  if (!connectedProviders.includes('microsoft')) {
    connectElements.push({
      type: 'button',
      text: { type: 'plain_text', text: 'Connect Microsoft Outlook' },
      url: microsoftOAuth.generateAuthUrl(command.user_id, slackTeamId, redirectUri),
      action_id: 'connect_microsoft',
    });
  }

  if (!connectedProviders.includes('google')) {
    connectElements.push({
      type: 'button',
      text: { type: 'plain_text', text: 'Connect Google Calendar' },
      url: googleOAuth.generateAuthUrl(command.user_id, slackTeamId, redirectUri),
      action_id: 'connect_google',
    });
  }

  // Show "Reconnect" for already-connected providers (to update permissions/scopes)
  if (connectedProviders.includes('microsoft')) {
    reconnectElements.push({
      type: 'button',
      text: { type: 'plain_text', text: 'Reconnect Microsoft' },
      url: microsoftOAuth.generateAuthUrl(command.user_id, slackTeamId, redirectUri),
      action_id: 'reconnect_microsoft',
    });
  }

  if (connectedProviders.includes('google')) {
    reconnectElements.push({
      type: 'button',
      text: { type: 'plain_text', text: 'Reconnect Google' },
      url: googleOAuth.generateAuthUrl(command.user_id, slackTeamId, redirectUri),
      action_id: 'reconnect_google',
    });
  }

  const blocks: any[] = [];

  if (connectedProviders.length > 0) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*Connected:* ${connectedProviders.join(', ')}` } });
  }

  if (connectElements.length > 0) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: 'Connect a new provider:' } });
    blocks.push({ type: 'actions', elements: connectElements });
  }

  if (reconnectElements.length > 0) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: '_Reconnect to update permissions (e.g. enable people search):_' } });
    blocks.push({ type: 'actions', elements: reconnectElements });
  }

  if (blocks.length === 0) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: 'Connect a calendar provider to get started:' } });
    blocks.push({ type: 'actions', elements: [
      {
        type: 'button',
        text: { type: 'plain_text', text: 'Connect Microsoft Outlook' },
        url: microsoftOAuth.generateAuthUrl(command.user_id, slackTeamId, redirectUri),
        action_id: 'connect_microsoft',
      },
      {
        type: 'button',
        text: { type: 'plain_text', text: 'Connect Google Calendar' },
        url: googleOAuth.generateAuthUrl(command.user_id, slackTeamId, redirectUri),
        action_id: 'connect_google',
      },
    ]});
  }

  await respond({ text: 'Caleo — Calendar Connections', blocks });
});

// /caleo-billing command
app.command('/caleo-billing', async ({ command, ack, respond, client, body }: any) => {
  await ack();
  try {
    const { dbUserId } = await ensureUser(client, command.user_id, body?.team_id);
    const balance = await repository.getBalance(dbUserId);

    const baseUrl = process.env.BILLING_BASE_URL || process.env.NGROK_URL || `http://localhost:${httpPort}`;

    const makeUrl = (amount: number) => {
      const ts = Date.now();
      const sig = signCheckoutParams(amount, command.user_id, dbUserId, ts);
      return `${baseUrl}/billing/checkout?amount=${amount}&user=${command.user_id}&dbUser=${dbUserId}&ts=${ts}&sig=${sig}`;
    };

    await respond({
      text: `Caleo Billing — Balance: ${formatBalanceForDisplay(balance.balance_cents)}`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Caleo Billing*\n\nCurrent balance: *${formatBalanceForDisplay(balance.balance_cents)}*\nLifetime usage: ${formatBalanceForDisplay(balance.lifetime_spent_cents)}`,
          },
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: 'Add $5' },
              url: makeUrl(500),
              action_id: 'billing_add_5',
            },
            {
              type: 'button',
              text: { type: 'plain_text', text: 'Add $10' },
              url: makeUrl(1000),
              action_id: 'billing_add_10',
            },
            {
              type: 'button',
              text: { type: 'plain_text', text: 'Add $20' },
              url: makeUrl(2000),
              action_id: 'billing_add_20',
            },
          ],
        },
      ],
    });
  } catch (error) {
    console.error('/caleo-billing error:', error);
    await respond('Sorry, something went wrong. Please try again.');
  }
});

// /caleo-settings command
app.command('/caleo-settings', async ({ command, ack, client, body }: any) => {
  await ack();
  try {
    const { dbUserId } = await ensureUser(client, command.user_id, body?.team_id);
    const settings = await repository.getUserSettings(dbUserId);
    const prefs = await repository.getPreferences(dbUserId);

    const durationOptions = [15, 30, 45, 60].map(d => ({
      text: { type: 'plain_text' as const, text: `${d} minutes` },
      value: String(d),
    }));
    const bufferOptions = [0, 5, 10, 15].map(b => ({
      text: { type: 'plain_text' as const, text: b === 0 ? 'None' : `${b} minutes` },
      value: String(b),
    }));
    const timeOptions = [];
    for (let h = 6; h <= 22; h++) {
      for (const m of ['00', '30']) {
        const t = `${String(h).padStart(2, '0')}:${m}`;
        const label = new Date(`2026-01-01T${t}:00`).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        timeOptions.push({ text: { type: 'plain_text' as const, text: label }, value: t });
      }
    }
    const focusOptions = [0, 2, 4, 6, 8].map(h => ({
      text: { type: 'plain_text' as const, text: h === 0 ? 'Disabled' : `${h} hours/week` },
      value: String(h),
    }));
    const dayOptions = [
      { text: { type: 'plain_text' as const, text: 'Sunday' }, value: '0' },
      { text: { type: 'plain_text' as const, text: 'Monday' }, value: '1' },
      { text: { type: 'plain_text' as const, text: 'Tuesday' }, value: '2' },
      { text: { type: 'plain_text' as const, text: 'Wednesday' }, value: '3' },
      { text: { type: 'plain_text' as const, text: 'Thursday' }, value: '4' },
      { text: { type: 'plain_text' as const, text: 'Friday' }, value: '5' },
      { text: { type: 'plain_text' as const, text: 'Saturday' }, value: '6' },
    ];
    const providerOptions = [
      { text: { type: 'plain_text' as const, text: 'Auto (first connected)' }, value: 'auto' },
      { text: { type: 'plain_text' as const, text: 'Google Calendar' }, value: 'google' },
      { text: { type: 'plain_text' as const, text: 'Microsoft Outlook' }, value: 'microsoft' },
    ];

    const noMeetingDays = (settings.no_meeting_days || []).map(String);

    await client.views.open({
      trigger_id: command.trigger_id,
      view: {
        type: 'modal',
        callback_id: 'caleo_settings_modal',
        private_metadata: dbUserId,
        title: { type: 'plain_text', text: 'Caleo Settings' },
        submit: { type: 'plain_text', text: 'Save' },
        blocks: [
          { type: 'header', text: { type: 'plain_text', text: 'Work Hours' } },
          {
            type: 'section', block_id: 'work_hours_start',
            text: { type: 'mrkdwn', text: '*Start time*' },
            accessory: {
              type: 'static_select', action_id: 'work_hours_start_select',
              initial_option: timeOptions.find(o => o.value === (prefs.work_hours_start || '09:00')) || timeOptions[6],
              options: timeOptions,
            },
          },
          {
            type: 'section', block_id: 'work_hours_end',
            text: { type: 'mrkdwn', text: '*End time*' },
            accessory: {
              type: 'static_select', action_id: 'work_hours_end_select',
              initial_option: timeOptions.find(o => o.value === (prefs.work_hours_end || '17:00')) || timeOptions[22],
              options: timeOptions,
            },
          },
          { type: 'header', text: { type: 'plain_text', text: 'Meeting Defaults' } },
          {
            type: 'section', block_id: 'default_duration',
            text: { type: 'mrkdwn', text: '*Default duration*' },
            accessory: {
              type: 'static_select', action_id: 'default_duration_select',
              initial_option: durationOptions.find(o => o.value === String(prefs.default_duration_minutes || 30)) || durationOptions[1],
              options: durationOptions,
            },
          },
          {
            type: 'section', block_id: 'buffer_minutes',
            text: { type: 'mrkdwn', text: '*Buffer between meetings*' },
            accessory: {
              type: 'static_select', action_id: 'buffer_minutes_select',
              initial_option: bufferOptions.find(o => o.value === String(prefs.buffer_minutes || 0)) || bufferOptions[0],
              options: bufferOptions,
            },
          },
          { type: 'header', text: { type: 'plain_text', text: 'Slack Status Sync' } },
          {
            type: 'actions', block_id: 'status_sync',
            elements: [{
              type: 'checkboxes', action_id: 'status_sync_checks',
              options: [
                { text: { type: 'mrkdwn', text: '*Sync calendar to Slack status*' }, description: { type: 'plain_text', text: 'Shows "In a meeting" when you have events' }, value: 'status_sync_enabled' },
                { text: { type: 'mrkdwn', text: '*Show event titles in status*' }, description: { type: 'plain_text', text: 'Off = generic "In a meeting" (privacy-first)' }, value: 'show_event_titles' },
              ],
              ...(settings.status_sync_enabled || settings.show_event_titles ? {
                initial_options: [
                  ...(settings.status_sync_enabled ? [{ text: { type: 'mrkdwn', text: '*Sync calendar to Slack status*' }, description: { type: 'plain_text', text: 'Shows "In a meeting" when you have events' }, value: 'status_sync_enabled' }] : []),
                  ...(settings.show_event_titles ? [{ text: { type: 'mrkdwn', text: '*Show event titles in status*' }, description: { type: 'plain_text', text: 'Off = generic "In a meeting" (privacy-first)' }, value: 'show_event_titles' }] : []),
                ],
              } : {}),
            }],
          },
          { type: 'header', text: { type: 'plain_text', text: 'Daily Briefing' } },
          {
            type: 'actions', block_id: 'daily_briefing',
            elements: [{
              type: 'checkboxes', action_id: 'daily_briefing_check',
              options: [
                { text: { type: 'mrkdwn', text: '*Send daily schedule briefing*' }, value: 'daily_briefing_enabled' },
              ],
              ...(settings.daily_briefing_enabled ? {
                initial_options: [
                  { text: { type: 'mrkdwn', text: '*Send daily schedule briefing*' }, value: 'daily_briefing_enabled' },
                ],
              } : {}),
            }],
          },
          {
            type: 'section', block_id: 'briefing_time',
            text: { type: 'mrkdwn', text: '*Briefing delivery time*' },
            accessory: {
              type: 'static_select', action_id: 'briefing_time_select',
              initial_option: timeOptions.find(o => o.value === (settings.daily_briefing_time || '08:30')) || timeOptions[5],
              options: timeOptions,
            },
          },
          { type: 'header', text: { type: 'plain_text', text: 'Focus Time' } },
          {
            type: 'section', block_id: 'focus_goal',
            text: { type: 'mrkdwn', text: '*Weekly focus time goal*' },
            accessory: {
              type: 'static_select', action_id: 'focus_goal_select',
              initial_option: focusOptions.find(o => o.value === String(settings.focus_time_goal_hours || 0)) || focusOptions[0],
              options: focusOptions,
            },
          },
          { type: 'header', text: { type: 'plain_text', text: 'No-Meeting Days' } },
          {
            type: 'actions', block_id: 'no_meeting_days',
            elements: [{
              type: 'checkboxes', action_id: 'no_meeting_days_checks',
              options: dayOptions,
              ...(noMeetingDays.length > 0 ? {
                initial_options: dayOptions.filter(d => noMeetingDays.includes(d.value)),
              } : {}),
            }],
          },
          { type: 'header', text: { type: 'plain_text', text: 'Preferred Calendar' } },
          {
            type: 'section', block_id: 'preferred_provider',
            text: { type: 'mrkdwn', text: '*Default calendar provider*' },
            accessory: {
              type: 'static_select', action_id: 'preferred_provider_select',
              initial_option: providerOptions.find(o => o.value === (prefs.preferred_provider || 'auto')) || providerOptions[0],
              options: providerOptions,
            },
          },
        ],
      },
    });
  } catch (error) {
    console.error('/caleo-settings error:', error);
  }
});

// Handle settings modal submission
app.view('caleo_settings_modal', async ({ ack, view, body }: any) => {
  await ack();
  try {
    const dbUserId = view.private_metadata;
    const vals = view.state.values;

    // Extract values from modal
    const workHoursStart = vals.work_hours_start?.work_hours_start_select?.selected_option?.value;
    const workHoursEnd = vals.work_hours_end?.work_hours_end_select?.selected_option?.value;
    const defaultDuration = vals.default_duration?.default_duration_select?.selected_option?.value;
    const bufferMinutes = vals.buffer_minutes?.buffer_minutes_select?.selected_option?.value;
    const preferredProvider = vals.preferred_provider?.preferred_provider_select?.selected_option?.value;

    const statusSyncChecks = (vals.status_sync?.status_sync_checks?.selected_options || []).map((o: any) => o.value);
    const dailyBriefingChecks = (vals.daily_briefing?.daily_briefing_check?.selected_options || []).map((o: any) => o.value);
    const briefingTime = vals.briefing_time?.briefing_time_select?.selected_option?.value;
    const focusGoal = vals.focus_goal?.focus_goal_select?.selected_option?.value;
    const noMeetingDays = (vals.no_meeting_days?.no_meeting_days_checks?.selected_options || []).map((o: any) => parseInt(o.value, 10));

    // Update preferences
    const prefUpdates: Record<string, any> = {};
    if (workHoursStart) prefUpdates.work_hours_start = workHoursStart;
    if (workHoursEnd) prefUpdates.work_hours_end = workHoursEnd;
    if (defaultDuration) prefUpdates.default_duration_minutes = parseInt(defaultDuration, 10);
    if (bufferMinutes !== undefined) prefUpdates.buffer_minutes = parseInt(bufferMinutes, 10);
    if (preferredProvider) prefUpdates.preferred_provider = preferredProvider === 'auto' ? null : preferredProvider;

    await repository.updatePreferences(dbUserId, prefUpdates);

    // Update settings
    await repository.updateUserSettings(dbUserId, {
      status_sync_enabled: statusSyncChecks.includes('status_sync_enabled'),
      show_event_titles: statusSyncChecks.includes('show_event_titles'),
      daily_briefing_enabled: dailyBriefingChecks.includes('daily_briefing_enabled'),
      daily_briefing_time: briefingTime || '08:30',
      focus_time_goal_hours: focusGoal ? parseInt(focusGoal, 10) : 0,
      no_meeting_days: noMeetingDays,
    });

    console.log(`[Settings] Updated for ${dbUserId}`);
  } catch (error) {
    console.error('Settings modal submission error:', error);
  }
});

// /caleo-privacy command
app.command('/caleo-privacy', async ({ command, ack, respond, client, body }: any) => {
  await ack();
  try {
    const { dbUserId } = await ensureUser(client, command.user_id, body?.team_id);
    const tokens = await repository.getTokensByUser(dbUserId);
    const connectedProviders = tokens.map((t: any) => t.provider);

    const providerSections: string[] = [];

    if (connectedProviders.includes('google')) {
      providerSections.push(`*Google Calendar:*
:white_check_mark: Read your events (titles, times, attendees)
:white_check_mark: Create, update, delete events
:x: Cannot access other people's calendars directly
:x: Does not store event descriptions`);
    }

    if (connectedProviders.includes('microsoft')) {
      providerSections.push(`*Microsoft Outlook:*
:white_check_mark: Read your events (titles, times, attendees)
:white_check_mark: Create, update, delete events
:x: Cannot access other people's calendars directly
:x: Does not store event descriptions`);
    }

    if (providerSections.length === 0) {
      providerSections.push('_No calendar providers connected. Use /caleo-auth to connect._');
    }

    const blocks = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*What Caleo can access:*',
        },
      },
      ...providerSections.map(text => ({
        type: 'section',
        text: { type: 'mrkdwn', text },
      })),
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Slack:*
:white_check_mark: Read messages sent directly to Caleo
:white_check_mark: Read @mentions of Caleo in channels
:x: Cannot read other channels or DMs
:x: Does not store message history beyond your session (30 min)`,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Your data:*
\u2022 Calendar tokens: encrypted (AES-256-GCM)
\u2022 Conversation history: kept for 30 minutes, then discarded
\u2022 To revoke access: /caleo-auth \u2192 disconnect providers`,
        },
      },
    ];

    await respond({ text: 'Caleo Privacy & Permissions', blocks });
  } catch (error) {
    console.error('/caleo-privacy error:', error);
    await respond('Sorry, something went wrong. Please try again.');
  }
});

// Handle button action acknowledgment
app.action('connect_microsoft', async ({ ack }: any) => { await ack(); });
app.action('connect_google', async ({ ack }: any) => { await ack(); });
app.action('billing_add_5', async ({ ack }: any) => { await ack(); });
app.action('billing_add_10', async ({ ack }: any) => { await ack(); });
app.action('billing_add_20', async ({ ack }: any) => { await ack(); });
// Settings modal action acknowledgments
app.action('work_hours_start_select', async ({ ack }: any) => { await ack(); });
app.action('work_hours_end_select', async ({ ack }: any) => { await ack(); });
app.action('default_duration_select', async ({ ack }: any) => { await ack(); });
app.action('buffer_minutes_select', async ({ ack }: any) => { await ack(); });
app.action('status_sync_checks', async ({ ack }: any) => { await ack(); });
app.action('daily_briefing_check', async ({ ack }: any) => { await ack(); });
app.action('briefing_time_select', async ({ ack }: any) => { await ack(); });
app.action('focus_goal_select', async ({ ack }: any) => { await ack(); });
app.action('no_meeting_days_checks', async ({ ack }: any) => { await ack(); });
app.action('preferred_provider_select', async ({ ack }: any) => { await ack(); });

// App mentions
app.event('app_mention', async ({ event, body, client }: any) => {
  const eventId = body?.event_id || `mention:${event?.channel}:${event?.ts}`;
  if (!markEventAsProcessing(eventId)) return;

  try {
    await processUserMessage({
      client,
      userId: event.user,
      teamId: body?.team_id,
      channel: event.channel,
      threadTs: event.thread_ts || event.ts,
      text: event.text || '',
    });
  } catch (error) {
    console.error(`[app_mention] Unhandled error for event ${eventId}:`, error);
    notifier.emit(NotifyEvent.UNHANDLED_ERROR, `app_mention error (${eventId})`, undefined, error instanceof Error ? error : new Error(String(error)));
  }
});

// DMs
app.event('message', async ({ event, body, client }: any) => {
  if (event?.subtype || event?.bot_id) return;
  if (event?.channel_type !== 'im') return;

  const eventId = body?.event_id || `dm:${event?.channel}:${event?.ts}`;
  if (!markEventAsProcessing(eventId)) return;

  try {
    await processUserMessage({
      client,
      userId: event.user,
      teamId: body?.team_id,
      channel: event.channel,
      threadTs: undefined,
      replyTs: event.ts,
      text: event.text || '',
    });
  } catch (error) {
    console.error(`[message] Unhandled error for event ${eventId}:`, error);
    notifier.emit(NotifyEvent.UNHANDLED_ERROR, `DM message error (${eventId})`, undefined, error instanceof Error ? error : new Error(String(error)));
  }
});

app.error((error: any) => {
  console.error('Slack app error:', error);
  notifier.emit(NotifyEvent.UNHANDLED_ERROR, 'Slack app error', undefined, error instanceof Error ? error : new Error(String(error)));
});

// Ambient service instances (created after app.start so we have the slack client)
let statusSyncService: StatusSyncService | null = null;
let dailyBriefingService: DailyBriefingService | null = null;
let cleanupService: CleanupService | null = null;

async function start(): Promise<void> {
  // Start the HTTP server for health check + OAuth
  httpServer.listen(httpPort, () => {
    console.log(`HTTP server on port ${httpPort} (health check + OAuth callback)`);
  });
  httpServer.setTimeout(30000); // 30s request timeout

  // Start notification service
  await notifier.start();

  // Start the Slack app (Socket Mode connects via WebSocket, not the HTTP port)
  await app.start();

  // Start ambient services (status sync + daily briefing)
  const slackClient = app.client;
  statusSyncService = new StatusSyncService({ slackClient, googleOAuth, microsoftOAuth });
  dailyBriefingService = new DailyBriefingService({ slackClient, googleOAuth, microsoftOAuth });
  cleanupService = new CleanupService();
  statusSyncService.start();
  dailyBriefingService.start();
  cleanupService.start();

  console.log(`Caleo Slack bot is running`);
  console.log(`Health check: http://localhost:${httpPort}/api/health`);
  console.log(`OAuth callback: http://localhost:${httpPort}/auth/callback`);
  console.log(`Mode: ${socketMode ? 'Socket Mode' : 'HTTP Events API'}`);
  console.log(`Ambient services: Status Sync + Daily Briefing + Database Cleanup`);
}

// Graceful shutdown for ECS SIGTERM
function shutdown(signal: string) {
  console.log(`${signal} received — shutting down gracefully...`);
  notifier.stop();
  statusSyncService?.stop();
  dailyBriefingService?.stop();
  cleanupService?.stop();
  app.stop().catch(() => {});
  httpServer.close(() => console.log('HTTP server closed'));
  pool.end().then(() => console.log('DB pool closed')).catch(() => {});
  setTimeout(() => { console.log('Forcing exit'); process.exit(0); }, 10000);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});

start().catch((error) => {
  console.error('Failed to start Slack bot:', error);
  notifier.emit(NotifyEvent.BOT_STARTUP_FAILURE, 'Bot failed to start', undefined, error instanceof Error ? error : new Error(String(error)));
  process.exit(1);
});
