import { DbRateLimiter } from '../db-rate-limiter';

// Mock pg Pool
const mockQuery = jest.fn();
const mockPool = { query: mockQuery } as any;

describe('DbRateLimiter', () => {
  let limiter: DbRateLimiter;

  beforeEach(() => {
    jest.clearAllMocks();
    limiter = new DbRateLimiter(mockPool, 3, 60_000);
  });

  test('allows request when under limit', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ current_count: 1, oldest_in_window: null, did_insert: true }],
    });

    const result = await limiter.check('user1');
    expect(result.allowed).toBe(true);
    expect(result.retryAfterMs).toBe(0);
  });

  test('blocks request when at limit', async () => {
    const oldestTime = new Date(Date.now() - 30_000).toISOString();
    mockQuery.mockResolvedValueOnce({
      rows: [{ current_count: 3, oldest_in_window: oldestTime, did_insert: false }],
    });

    const result = await limiter.check('user1');
    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });

  test('passes correct parameters to query', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ current_count: 0, oldest_in_window: null, did_insert: true }],
    });

    await limiter.check('test-key');

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [query, params] = mockQuery.mock.calls[0];
    expect(query).toContain('rate_limit_events');
    expect(params[0]).toBe('test-key');
    expect(params[2]).toBe(3); // maxRequests
  });

  test('retryAfterMs is at least 1 when blocked', async () => {
    // Oldest entry just now — should still have retryAfterMs >= 1
    mockQuery.mockResolvedValueOnce({
      rows: [{ current_count: 3, oldest_in_window: new Date().toISOString(), did_insert: false }],
    });

    const result = await limiter.check('user1');
    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBeGreaterThanOrEqual(1);
  });

  test('handles null oldest_in_window gracefully', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ current_count: 3, oldest_in_window: null, did_insert: false }],
    });

    const result = await limiter.check('user1');
    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBeGreaterThanOrEqual(1);
  });

  test('propagates database errors', async () => {
    mockQuery.mockRejectedValueOnce(new Error('connection refused'));

    await expect(limiter.check('user1')).rejects.toThrow('connection refused');
  });
});
