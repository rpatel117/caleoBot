import { repository } from '../database/repository';
import { GoogleOAuth } from '../calendar/google/oauth';
import { GoogleCalendarProvider } from '../calendar/google/provider';
import { MicrosoftOAuth } from '../calendar/microsoft/oauth';
import { MicrosoftCalendarProvider } from '../calendar/microsoft/provider';
import { CalendarEvent } from '../calendar/types';

interface BriefingDeps {
  slackClient: any;
  googleOAuth: GoogleOAuth;
  microsoftOAuth: MicrosoftOAuth;
}

export class DailyBriefingService {
  private deps: BriefingDeps;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private cleanupHandle: ReturnType<typeof setInterval> | null = null;
  private sentToday = new Set<string>(); // "userId:date" keys to avoid double-sends

  constructor(deps: BriefingDeps) {
    this.deps = deps;
  }

  start(): void {
    // Check every 60 seconds
    this.intervalHandle = setInterval(() => this.tick(), 60_000);
    // Reset sent tracker at midnight UTC
    this.cleanupHandle = setInterval(() => this.sentToday.clear(), 60 * 60_000);
    console.log('[DailyBriefing] Service started');
  }

  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    if (this.cleanupHandle) {
      clearInterval(this.cleanupHandle);
      this.cleanupHandle = null;
    }
  }

  private async tick(): Promise<void> {
    try {
      // Get current HH:MM in every possible timezone, find matching users
      // Simpler approach: query all briefing-enabled users, check if their local time matches
      const allUsers = await repository.getBriefingUsers('__all__').catch(() => []);
      // Actually, let's just check the common times and query for exact match
      const now = new Date();

      // Get all unique briefing times users have configured
      // For efficiency, just get all briefing-enabled users and filter locally
      const result = await this.getAllBriefingUsers();
      for (const user of result) {
        const key = `${user.db_user_id}:${now.toISOString().slice(0, 10)}`;
        if (this.sentToday.has(key)) continue;

        const userTime = this.getUserLocalTime(user.timezone || 'America/Chicago');
        const briefingTime = user.daily_briefing_time || '08:30';

        if (userTime === briefingTime) {
          this.sentToday.add(key);
          this.sendBriefing(user).catch(err => {
            console.error(`[DailyBriefing] Failed for ${user.slack_user_id}:`, err?.message);
          });
        }
      }
    } catch (err: any) {
      console.error('[DailyBriefing] tick error:', err?.message);
    }
  }

  private async getAllBriefingUsers(): Promise<any[]> {
    // Query all users with daily_briefing_enabled = true
    const result = await (await import('../database/client')).default.query(
      `SELECT us.*, u.external_id AS slack_user_id, u.timezone, u.display_name, u.id AS db_user_id
       FROM user_settings us
       JOIN users u ON u.id = us.user_id
       WHERE us.daily_briefing_enabled = true`
    );
    return result.rows;
  }

  private getUserLocalTime(tz: string): string {
    const now = new Date();
    const hours = now.toLocaleString('en-US', { timeZone: tz, hour: '2-digit', hour12: false });
    const minutes = now.toLocaleString('en-US', { timeZone: tz, minute: '2-digit' });
    const h = parseInt(hours, 10);
    const m = parseInt(minutes, 10);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  private async sendBriefing(user: any): Promise<void> {
    const tz = user.timezone || 'America/Chicago';
    const events = await this.getTodayEvents(user.db_user_id, tz);
    const firstName = (user.display_name || 'there').split(' ')[0];
    const dayName = new Date().toLocaleDateString('en-US', { weekday: 'long', timeZone: tz });

    const blocks: any[] = [];

    // Header
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Good morning, ${firstName}!* Here's your ${dayName}:` },
    });

    if (events.length === 0) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: 'No meetings today. Enjoy your free day!' },
      });
    } else {
      // Total meeting time
      let totalMinutes = 0;
      const eventLines: string[] = [];
      for (const e of events) {
        const start = new Date(e.start.dateTime);
        const end = new Date(e.end.dateTime);
        totalMinutes += (end.getTime() - start.getTime()) / 60_000;
        const startStr = start.toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' });
        const endStr = end.toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' });
        const attendeeCount = e.attendees?.length || 0;
        let line = `${startStr} - ${endStr} -- ${e.subject}`;
        if (attendeeCount > 0) line += ` (${attendeeCount} attendees)`;
        eventLines.push(line);
      }

      const hours = Math.floor(totalMinutes / 60);
      const mins = Math.round(totalMinutes % 60);
      const timeStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;

      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `*${events.length} meeting${events.length > 1 ? 's' : ''} today* (${timeStr} total)\n${eventLines.map(l => `\u2022 ${l}`).join('\n')}` },
      });

      // Detect conflicts
      const conflicts = this.detectConflicts(events, tz);
      if (conflicts.length > 0) {
        blocks.push({
          type: 'section',
          text: { type: 'mrkdwn', text: `*${conflicts.length} conflict${conflicts.length > 1 ? 's' : ''}:* ${conflicts.join(', ')}` },
        });
      }

      // Free time
      const freeBlocks = this.computeFreeTime(events, tz);
      if (freeBlocks.length > 0) {
        blocks.push({
          type: 'section',
          text: { type: 'mrkdwn', text: `*Free time:* ${freeBlocks.join(', ')}` },
        });
      }
    }

    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: 'Reply here to schedule, reschedule, or ask me anything.' }],
    });

    // Send DM
    try {
      const dmResult = await this.deps.slackClient.conversations.open({ users: user.slack_user_id });
      const dmChannel = dmResult?.channel?.id;
      if (dmChannel) {
        await this.deps.slackClient.chat.postMessage({
          channel: dmChannel,
          text: `Good morning, ${firstName}! Here's your ${dayName} schedule.`,
          blocks,
        });
        console.log(`[DailyBriefing] Sent to ${user.slack_user_id}`);
      }
    } catch (err: any) {
      console.error(`[DailyBriefing] Failed to DM ${user.slack_user_id}:`, err?.message);
    }
  }

  private async getTodayEvents(dbUserId: string, tz: string): Promise<CalendarEvent[]> {
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-CA', { timeZone: tz });
    const midnightUtc = new Date(`${dateStr}T00:00:00Z`);
    const utcFmt = midnightUtc.toLocaleString('en-US', { timeZone: 'UTC' });
    const tzFmt = midnightUtc.toLocaleString('en-US', { timeZone: tz });
    const offsetMs = new Date(utcFmt).getTime() - new Date(tzFmt).getTime();
    const start = new Date(midnightUtc.getTime() + offsetMs);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);

    // Try Google first, then Microsoft
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

  private detectConflicts(events: CalendarEvent[], tz: string): string[] {
    const conflicts: string[] = [];
    const sorted = [...events].sort(
      (a, b) => new Date(a.start.dateTime).getTime() - new Date(b.start.dateTime).getTime()
    );
    for (let i = 0; i < sorted.length - 1; i++) {
      const endA = new Date(sorted[i].end.dateTime).getTime();
      const startB = new Date(sorted[i + 1].start.dateTime).getTime();
      if (startB < endA) {
        conflicts.push(`${sorted[i].subject} overlaps with ${sorted[i + 1].subject}`);
      }
    }
    return conflicts;
  }

  private computeFreeTime(events: CalendarEvent[], tz: string): string[] {
    const sorted = [...events].sort(
      (a, b) => new Date(a.start.dateTime).getTime() - new Date(b.start.dateTime).getTime()
    );
    const gaps: string[] = [];
    const fmt = (d: Date) => d.toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' });

    for (let i = 0; i < sorted.length - 1; i++) {
      const endA = new Date(sorted[i].end.dateTime);
      const startB = new Date(sorted[i + 1].start.dateTime);
      const gapMinutes = (startB.getTime() - endA.getTime()) / 60_000;
      if (gapMinutes >= 30) {
        const hours = Math.floor(gapMinutes / 60);
        const mins = Math.round(gapMinutes % 60);
        const timeStr = hours > 0 ? (mins > 0 ? `${hours}h ${mins}m` : `${hours}h`) : `${mins}m`;
        gaps.push(`${fmt(endA)}-${fmt(startB)} (${timeStr})`);
      }
    }
    return gaps;
  }
}
