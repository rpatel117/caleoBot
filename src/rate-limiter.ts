/**
 * In-memory sliding-window rate limiter.
 * Tracks timestamps of recent actions per key and enforces limits.
 */
export class RateLimiter {
  private windows: Map<string, number[]> = new Map();
  private readonly maxRequests: number;
  private readonly windowMs: number;

  constructor(maxRequests: number, windowMs: number) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }

  /**
   * Check if the key is allowed to proceed. If allowed, records the request.
   * Returns { allowed, retryAfterMs } — retryAfterMs is 0 when allowed.
   */
  check(key: string): { allowed: boolean; retryAfterMs: number } {
    const now = Date.now();
    const cutoff = now - this.windowMs;

    let timestamps = this.windows.get(key);
    if (!timestamps) {
      timestamps = [];
      this.windows.set(key, timestamps);
    }

    // Prune expired entries
    while (timestamps.length > 0 && timestamps[0] <= cutoff) {
      timestamps.shift();
    }

    if (timestamps.length >= this.maxRequests) {
      const oldestInWindow = timestamps[0];
      const retryAfterMs = oldestInWindow + this.windowMs - now;
      return { allowed: false, retryAfterMs: Math.max(retryAfterMs, 1) };
    }

    timestamps.push(now);
    return { allowed: true, retryAfterMs: 0 };
  }

  /** Periodically clean up keys with no recent activity to prevent memory leaks. */
  cleanup(): void {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    for (const [key, timestamps] of this.windows) {
      while (timestamps.length > 0 && timestamps[0] <= cutoff) {
        timestamps.shift();
      }
      if (timestamps.length === 0) {
        this.windows.delete(key);
      }
    }
  }
}
