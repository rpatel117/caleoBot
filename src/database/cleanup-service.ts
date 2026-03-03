import pool from './client';

/**
 * Periodic cleanup service for stale database records.
 * Runs hourly and removes:
 *   - undo_state older than 1 hour
 *   - rate_limit_events older than 2 minutes
 *   - messages older than 90 days
 *   - audit_log older than 1 year
 *
 * After deleting old messages, also removes orphaned conversations
 * (conversations with zero remaining messages) so the agent treats
 * returning users as starting a fresh session.
 */
export class CleanupService {
  private timer: NodeJS.Timeout | null = null;
  private readonly intervalMs: number;

  constructor(intervalMs: number = 60 * 60 * 1000) {
    this.intervalMs = intervalMs;
  }

  start(): void {
    // Run immediately on start, then on interval
    this.runCleanup();
    this.timer = setInterval(() => this.runCleanup(), this.intervalMs);
    console.log('[CleanupService] Started (interval: every hour)');
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log('[CleanupService] Stopped');
    }
  }

  private async runCleanup(): Promise<void> {
    try {
      const results = await Promise.allSettled([
        this.cleanUndoState(),
        this.cleanRateLimitEvents(),
        this.cleanOldMessages(),
        this.cleanOldAuditLog(),
      ]);

      for (const [i, result] of results.entries()) {
        if (result.status === 'rejected') {
          const labels = ['undo_state', 'rate_limit_events', 'messages', 'audit_log'];
          console.error(`[CleanupService] Failed to clean ${labels[i]}:`, result.reason);
        }
      }
    } catch (err) {
      console.error('[CleanupService] Cleanup cycle failed:', err);
    }
  }

  private async cleanUndoState(): Promise<void> {
    const result = await pool.query(
      `DELETE FROM undo_state WHERE created_at < NOW() - INTERVAL '1 hour'`
    );
    if (result.rowCount && result.rowCount > 0) {
      console.log(`[CleanupService] Deleted ${result.rowCount} expired undo_state rows`);
    }
  }

  private async cleanRateLimitEvents(): Promise<void> {
    const result = await pool.query(
      `DELETE FROM rate_limit_events WHERE created_at < NOW() - INTERVAL '2 minutes'`
    );
    if (result.rowCount && result.rowCount > 0) {
      console.log(`[CleanupService] Deleted ${result.rowCount} expired rate_limit_events rows`);
    }
  }

  private async cleanOldMessages(): Promise<void> {
    const result = await pool.query(
      `DELETE FROM messages WHERE created_at < NOW() - INTERVAL '90 days'`
    );
    if (result.rowCount && result.rowCount > 0) {
      console.log(`[CleanupService] Deleted ${result.rowCount} old messages (>90 days)`);

      // Clean orphaned conversations (no remaining messages)
      const orphaned = await pool.query(
        `DELETE FROM conversations
         WHERE id NOT IN (SELECT DISTINCT conversation_id FROM messages)`
      );
      if (orphaned.rowCount && orphaned.rowCount > 0) {
        console.log(`[CleanupService] Deleted ${orphaned.rowCount} orphaned conversations`);
      }
    }
  }

  private async cleanOldAuditLog(): Promise<void> {
    const result = await pool.query(
      `DELETE FROM audit_log WHERE created_at < NOW() - INTERVAL '1 year'`
    );
    if (result.rowCount && result.rowCount > 0) {
      console.log(`[CleanupService] Deleted ${result.rowCount} old audit_log entries (>1 year)`);
    }
  }
}
