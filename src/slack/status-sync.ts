import { repository } from '../database/repository';
import { GoogleOAuth } from '../calendar/google/oauth';
import { GoogleCalendarProvider } from '../calendar/google/provider';
import { MicrosoftOAuth } from '../calendar/microsoft/oauth';
import { MicrosoftCalendarProvider } from '../calendar/microsoft/provider';
import { CalendarEvent } from '../calendar/types';

interface StatusSyncDeps {
  slackClient: any;
  googleOAuth: GoogleOAuth;
  microsoftOAuth: MicrosoftOAuth;
}

export class StatusSyncService {
  private deps: StatusSyncDeps;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  // Track who currently has a Caleo-set status so we can clear it when the meeting ends
  private activeStatuses = new Map<string, { emoji: string; expiresAt: number }>();

  constructor(deps: StatusSyncDeps) {
    this.deps = deps;
  }

  start(): void {
    this.intervalHandle = setInterval(() => this.tick(), 60_000);
    console.log('[StatusSync] Service started (60s interval)');
  }

  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  private async tick(): Promise<void> {
    try {
      const users = await repository.getActiveStatusSyncUsers();
      const now = Date.now();

      for (const user of users) {
        try {
          await this.syncUser(user, now);
        } catch (err: any) {
          console.error(`[StatusSync] Error for ${user.slack_user_id}:`, err?.message);
        }
      }

      // Clear expired statuses for users who no longer appear in the active list
      for (const [slackUserId, status] of this.activeStatuses) {
        if (status.expiresAt < now) {
          await this.clearStatus(slackUserId);
          this.activeStatuses.delete(slackUserId);
        }
      }
    } catch (err: any) {
      console.error('[StatusSync] tick error:', err?.message);
    }
  }

  private async syncUser(user: any, now: number): Promise<void> {
    const tz = user.timezone || 'America/Chicago';
    const dbUserId = user.db_user_id;
    const slackUserId = user.slack_user_id;

    const currentEvent = await this.getCurrentEvent(dbUserId, tz, now);

    if (currentEvent) {
      const endTime = new Date(currentEvent.end.dateTime).getTime();
      const showTitle = user.show_event_titles;
      const statusText = showTitle ? currentEvent.subject : 'In a meeting';
      const statusEmoji = ':calendar:';

      // Only update if not already set or if the meeting changed
      const existing = this.activeStatuses.get(slackUserId);
      if (!existing || existing.expiresAt !== endTime) {
        await this.setStatus(slackUserId, statusText, statusEmoji, Math.floor(endTime / 1000));
        this.activeStatuses.set(slackUserId, { emoji: statusEmoji, expiresAt: endTime });
      }
    } else {
      // No current meeting — clear status if we set one
      if (this.activeStatuses.has(slackUserId)) {
        await this.clearStatus(slackUserId);
        this.activeStatuses.delete(slackUserId);
      }
    }
  }

  private async getCurrentEvent(dbUserId: string, tz: string, now: number): Promise<CalendarEvent | null> {
    // Check a window of -5 min to +5 min around now
    const windowStart = new Date(now - 5 * 60_000);
    const windowEnd = new Date(now + 5 * 60_000);

    const events = await this.getEvents(dbUserId, windowStart, new Date(now + 4 * 60 * 60_000));
    if (!events || events.length === 0) return null;

    // Find an event that's currently happening
    for (const event of events) {
      const start = new Date(event.start.dateTime).getTime();
      const end = new Date(event.end.dateTime).getTime();
      if (start <= now && end > now) {
        return event;
      }
    }
    return null;
  }

  private async getEvents(dbUserId: string, start: Date, end: Date): Promise<CalendarEvent[]> {
    try {
      const token = await this.deps.googleOAuth.getValidAccessToken(dbUserId);
      if (token) {
        const provider = new GoogleCalendarProvider();
        return await provider.getEvents(token, start, end);
      }
    } catch {}

    try {
      const token = await this.deps.microsoftOAuth.getValidAccessToken(dbUserId);
      if (token) {
        const provider = new MicrosoftCalendarProvider();
        return await provider.getEvents(token, start, end);
      }
    } catch {}

    return [];
  }

  private async setStatus(slackUserId: string, text: string, emoji: string, expirationUnix: number): Promise<void> {
    try {
      await this.deps.slackClient.users.profile.set({
        user: slackUserId,
        profile: JSON.stringify({
          status_text: text,
          status_emoji: emoji,
          status_expiration: expirationUnix,
        }),
      });
    } catch (err: any) {
      console.error(`[StatusSync] Failed to set status for ${slackUserId}:`, err?.message);
    }
  }

  private async clearStatus(slackUserId: string): Promise<void> {
    try {
      await this.deps.slackClient.users.profile.set({
        user: slackUserId,
        profile: JSON.stringify({
          status_text: '',
          status_emoji: '',
          status_expiration: 0,
        }),
      });
    } catch (err: any) {
      console.error(`[StatusSync] Failed to clear status for ${slackUserId}:`, err?.message);
    }
  }
}
