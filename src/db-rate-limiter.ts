import { Pool } from 'pg';

/**
 * Database-backed sliding-window rate limiter.
 * Uses an atomic CTE to INSERT + COUNT in a single query,
 * ensuring consistency across multiple ECS tasks / Lambda instances.
 */
export class DbRateLimiter {
  private pool: Pool;
  private readonly maxRequests: number;
  private readonly windowMs: number;

  constructor(pool: Pool, maxRequests: number, windowMs: number) {
    this.pool = pool;
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }

  /**
   * Check if the key is allowed to proceed. If allowed, records the request atomically.
   * Returns { allowed, retryAfterMs } — retryAfterMs is 0 when allowed.
   */
  async check(key: string): Promise<{ allowed: boolean; retryAfterMs: number }> {
    const windowStart = new Date(Date.now() - this.windowMs);

    const result = await this.pool.query(
      `WITH recent AS (
        SELECT created_at
        FROM rate_limit_events
        WHERE key = $1 AND created_at > $2
        ORDER BY created_at ASC
      ),
      counted AS (
        SELECT COUNT(*)::int AS cnt,
               MIN(created_at) AS oldest
        FROM recent
      ),
      inserted AS (
        INSERT INTO rate_limit_events (key)
        SELECT $1
        WHERE (SELECT cnt FROM counted) < $3
        RETURNING created_at
      )
      SELECT
        (SELECT cnt FROM counted) AS current_count,
        (SELECT oldest FROM counted) AS oldest_in_window,
        EXISTS(SELECT 1 FROM inserted) AS did_insert`,
      [key, windowStart.toISOString(), this.maxRequests]
    );

    const row = result.rows[0];
    const didInsert = row?.did_insert ?? false;

    if (didInsert) {
      return { allowed: true, retryAfterMs: 0 };
    }

    // Rate limited — calculate retry time based on when the oldest entry in the window expires
    const oldest = row?.oldest_in_window ? new Date(row.oldest_in_window).getTime() : Date.now();
    const retryAfterMs = Math.max(oldest + this.windowMs - Date.now(), 1);
    return { allowed: false, retryAfterMs };
  }
}
