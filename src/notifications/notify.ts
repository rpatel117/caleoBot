import * as nodemailer from 'nodemailer';
import { NotifyEvent, NotifySeverity, EVENT_SEVERITY, NotifyItem } from './types';
import { createTransport } from './email-transport';
import { renderImmediateEmail, renderHourlyDigestEmail, renderDailyDigestEmail } from './templates';

const DEDUP_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const HOURLY_MS = 60 * 60 * 1000;

class NotificationService {
  private transport: nodemailer.Transporter | null = null;
  private hourlyTimer: ReturnType<typeof setInterval> | null = null;
  private dailyTimer: ReturnType<typeof setInterval> | null = null;
  private hourlyQueue: NotifyItem[] = [];
  private dailyQueue: NotifyItem[] = [];
  private recentCritical = new Map<string, number>(); // fingerprint → timestamp
  private isEthereal = false;

  get adminEmail(): string {
    return process.env.ADMIN_NOTIFY_EMAIL || '';
  }

  get fromEmail(): string {
    return process.env.NOTIFY_FROM_EMAIL || 'caleo-alerts@caleo.bot';
  }

  get enabled(): boolean {
    return !!this.adminEmail;
  }

  async start(): Promise<void> {
    if (!this.enabled) {
      console.log('[Notifications] Disabled — ADMIN_NOTIFY_EMAIL not set');
      return;
    }

    try {
      this.transport = await createTransport();
      this.isEthereal = !process.env.SES_SMTP_USER;
      console.log('[Notifications] Service started');
    } catch (err) {
      console.error('[Notifications] Failed to create transport:', err);
      return;
    }

    // Hourly digest flush
    this.hourlyTimer = setInterval(() => this.flushHourlyDigest(), HOURLY_MS);

    // Daily digest at 8 AM CT — calculate ms until next 8 AM
    this.scheduleDailyDigest();
  }

  stop(): void {
    // Flush remaining batches before stopping
    this.flushHourlyDigest();
    this.flushDailyDigest();

    if (this.hourlyTimer) clearInterval(this.hourlyTimer);
    if (this.dailyTimer) clearTimeout(this.dailyTimer);
    this.hourlyTimer = null;
    this.dailyTimer = null;
    console.log('[Notifications] Service stopped');
  }

  emit(event: NotifyEvent, message: string, details?: string, error?: Error): void {
    try {
      if (!this.enabled || !this.transport) return;

      const severity = EVENT_SEVERITY[event];
      const item: NotifyItem = { event, severity, message, details, error, timestamp: new Date() };

      switch (severity) {
        case NotifySeverity.CRITICAL:
          this.handleCritical(item);
          break;
        case NotifySeverity.WARNING:
          this.hourlyQueue.push(item);
          break;
        case NotifySeverity.INFO:
          this.dailyQueue.push(item);
          break;
      }
    } catch {
      // emit() NEVER throws — fire-and-forget
    }
  }

  private handleCritical(item: NotifyItem): void {
    const fingerprint = `${item.event}:${item.message}`;
    const lastSent = this.recentCritical.get(fingerprint);
    const now = Date.now();

    if (lastSent && now - lastSent < DEDUP_WINDOW_MS) {
      return; // dedup: same critical within 5 min window
    }

    this.recentCritical.set(fingerprint, now);
    this.sendImmediate(item);

    // Cleanup old dedup entries
    for (const [key, ts] of this.recentCritical) {
      if (now - ts > DEDUP_WINDOW_MS) this.recentCritical.delete(key);
    }
  }

  private async sendImmediate(item: NotifyItem): Promise<void> {
    try {
      const { subject, html } = renderImmediateEmail(item);
      const info = await this.transport!.sendMail({
        from: this.fromEmail,
        to: this.adminEmail,
        subject,
        html,
      });
      if (this.isEthereal) {
        console.log(`[Notifications] Ethereal preview: ${nodemailer.getTestMessageUrl(info)}`);
      }
    } catch (err) {
      console.error('[Notifications] Failed to send immediate email:', err);
    }
  }

  async flushHourlyDigest(): Promise<void> {
    if (this.hourlyQueue.length === 0) return;
    const items = this.hourlyQueue.splice(0);

    try {
      const { subject, html } = renderHourlyDigestEmail(items);
      const info = await this.transport!.sendMail({
        from: this.fromEmail,
        to: this.adminEmail,
        subject,
        html,
      });
      if (this.isEthereal) {
        console.log(`[Notifications] Ethereal preview (hourly): ${nodemailer.getTestMessageUrl(info)}`);
      }
    } catch (err) {
      console.error('[Notifications] Failed to send hourly digest:', err);
    }
  }

  async flushDailyDigest(): Promise<void> {
    if (this.dailyQueue.length === 0) return;
    const items = this.dailyQueue.splice(0);

    try {
      const { subject, html } = renderDailyDigestEmail(items);
      const info = await this.transport!.sendMail({
        from: this.fromEmail,
        to: this.adminEmail,
        subject,
        html,
      });
      if (this.isEthereal) {
        console.log(`[Notifications] Ethereal preview (daily): ${nodemailer.getTestMessageUrl(info)}`);
      }
    } catch (err) {
      console.error('[Notifications] Failed to send daily digest:', err);
    }
  }

  private scheduleDailyDigest(): void {
    const now = new Date();
    // Next 8 AM CT
    const ctString = now.toLocaleString('en-US', { timeZone: 'America/Chicago' });
    const ctNow = new Date(ctString);
    const target = new Date(ctString);
    target.setHours(8, 0, 0, 0);
    if (ctNow >= target) {
      target.setDate(target.getDate() + 1);
    }
    const msUntil = target.getTime() - ctNow.getTime();

    this.dailyTimer = setTimeout(() => {
      this.flushDailyDigest();
      // After first fire, set up recurring daily interval
      this.dailyTimer = setInterval(() => this.flushDailyDigest(), 24 * 60 * 60 * 1000);
    }, msUntil);
  }

  // Exposed for testing
  _getHourlyQueue(): NotifyItem[] { return this.hourlyQueue; }
  _getDailyQueue(): NotifyItem[] { return this.dailyQueue; }
  _getRecentCritical(): Map<string, number> { return this.recentCritical; }
  _setTransport(t: nodemailer.Transporter): void { this.transport = t; }
}

export const notifier = new NotificationService();
export { NotifyEvent } from './types';
