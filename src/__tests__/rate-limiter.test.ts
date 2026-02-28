import { RateLimiter } from '../rate-limiter';

describe('RateLimiter', () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    limiter = new RateLimiter(3, 1000); // 3 requests per 1 second
  });

  test('allows requests within limit', () => {
    expect(limiter.check('user1').allowed).toBe(true);
    expect(limiter.check('user1').allowed).toBe(true);
    expect(limiter.check('user1').allowed).toBe(true);
  });

  test('blocks requests exceeding limit', () => {
    limiter.check('user1');
    limiter.check('user1');
    limiter.check('user1');
    const result = limiter.check('user1');
    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });

  test('different keys are independent', () => {
    limiter.check('user1');
    limiter.check('user1');
    limiter.check('user1');
    expect(limiter.check('user1').allowed).toBe(false);
    expect(limiter.check('user2').allowed).toBe(true);
  });

  test('allows requests after window expires', async () => {
    const shortLimiter = new RateLimiter(1, 50); // 1 request per 50ms
    shortLimiter.check('user1');
    expect(shortLimiter.check('user1').allowed).toBe(false);

    await new Promise(resolve => setTimeout(resolve, 60));
    expect(shortLimiter.check('user1').allowed).toBe(true);
  });

  test('retryAfterMs is at least 1 when blocked', () => {
    limiter.check('user1');
    limiter.check('user1');
    limiter.check('user1');
    const result = limiter.check('user1');
    expect(result.retryAfterMs).toBeGreaterThanOrEqual(1);
  });

  test('cleanup removes expired entries', async () => {
    const shortLimiter = new RateLimiter(1, 50);
    shortLimiter.check('user1');
    shortLimiter.check('user2');

    await new Promise(resolve => setTimeout(resolve, 60));
    shortLimiter.cleanup();

    // After cleanup, both should be allowed again
    expect(shortLimiter.check('user1').allowed).toBe(true);
    expect(shortLimiter.check('user2').allowed).toBe(true);
  });

  test('cleanup does not remove active entries', () => {
    limiter.check('user1');
    limiter.check('user1');
    limiter.check('user1');

    limiter.cleanup();
    expect(limiter.check('user1').allowed).toBe(false);
  });

  // Edge cases
  test('handles zero-length window gracefully', () => {
    const zeroLimiter = new RateLimiter(1, 0);
    zeroLimiter.check('user1');
    // With 0ms window, all previous entries are "expired"
    expect(zeroLimiter.check('user1').allowed).toBe(true);
  });

  test('handles empty key', () => {
    expect(limiter.check('').allowed).toBe(true);
  });

  test('handles special characters in key', () => {
    expect(limiter.check('user@#$%^&*()').allowed).toBe(true);
  });

  test('sliding window allows burst recovery', async () => {
    const slidingLimiter = new RateLimiter(2, 100);
    slidingLimiter.check('u1'); // t=0
    slidingLimiter.check('u1'); // t=0

    expect(slidingLimiter.check('u1').allowed).toBe(false);

    await new Promise(resolve => setTimeout(resolve, 110));
    // Both original entries expired
    expect(slidingLimiter.check('u1').allowed).toBe(true);
    expect(slidingLimiter.check('u1').allowed).toBe(true);
    expect(slidingLimiter.check('u1').allowed).toBe(false);
  });
});
