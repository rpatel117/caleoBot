jest.mock('../database/client', () => {
  const mockQuery = jest.fn().mockResolvedValue({ rowCount: 0 });
  return { __esModule: true, default: { query: mockQuery } };
});

import pool from '../database/client';
import { CleanupService } from '../database/cleanup-service';

const mockQuery = pool.query as jest.Mock;

describe('CleanupService', () => {
  let service: CleanupService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    // Use a short interval for testing
    service = new CleanupService(1000);
  });

  afterEach(() => {
    service.stop();
    jest.useRealTimers();
  });

  test('runs cleanup queries on start', () => {
    service.start();

    // Should have run 4 cleanup queries immediately
    expect(mockQuery).toHaveBeenCalledTimes(4);
  });

  test('cleans undo_state older than 1 hour', () => {
    service.start();

    const calls = mockQuery.mock.calls.map(([q]: [string]) => q);
    expect(calls.some((q: string) => q.includes('undo_state') && q.includes('1 hour'))).toBe(true);
  });

  test('cleans rate_limit_events older than 2 minutes', () => {
    service.start();

    const calls = mockQuery.mock.calls.map(([q]: [string]) => q);
    expect(calls.some((q: string) => q.includes('rate_limit_events') && q.includes('2 minutes'))).toBe(true);
  });

  test('cleans messages older than 90 days', () => {
    service.start();

    const calls = mockQuery.mock.calls.map(([q]: [string]) => q);
    expect(calls.some((q: string) => q.includes('messages') && q.includes('90 days'))).toBe(true);
  });

  test('cleans audit_log older than 1 year', () => {
    service.start();

    const calls = mockQuery.mock.calls.map(([q]: [string]) => q);
    expect(calls.some((q: string) => q.includes('audit_log') && q.includes('1 year'))).toBe(true);
  });

  test('cleans orphaned conversations when messages are deleted', async () => {
    jest.useRealTimers();

    const localMockQuery = jest.fn()
      .mockResolvedValueOnce({ rowCount: 0 })  // undo_state
      .mockResolvedValueOnce({ rowCount: 0 })  // rate_limit_events
      .mockResolvedValueOnce({ rowCount: 5 })  // messages deleted
      .mockResolvedValueOnce({ rowCount: 0 })  // audit_log
      .mockResolvedValueOnce({ rowCount: 2 }); // orphaned conversations

    (pool as any).query = localMockQuery;

    const localService = new CleanupService(60 * 60 * 1000);
    localService.start();

    // Wait for async cleanup to complete
    await new Promise(resolve => setTimeout(resolve, 50));

    localService.stop();

    const calls = localMockQuery.mock.calls.map(([q]: [string]) => q);
    expect(calls.some((q: string) => q.includes('conversations') && q.includes('NOT IN'))).toBe(true);

    // Restore mock for other tests
    (pool as any).query = mockQuery;
    jest.useFakeTimers();
  });

  test('runs on interval', () => {
    mockQuery.mockResolvedValue({ rowCount: 0 });
    service.start();

    const initialCalls = mockQuery.mock.calls.length;

    // Advance timer by one interval
    jest.advanceTimersByTime(1000);

    expect(mockQuery.mock.calls.length).toBeGreaterThan(initialCalls);
  });

  test('stops cleanly', () => {
    mockQuery.mockResolvedValue({ rowCount: 0 });
    service.start();
    service.stop();

    const callsAfterStop = mockQuery.mock.calls.length;
    jest.advanceTimersByTime(5000);

    // No additional calls after stop
    expect(mockQuery.mock.calls.length).toBe(callsAfterStop);
  });

  test('handles query errors gracefully', () => {
    mockQuery.mockRejectedValue(new Error('connection refused'));

    // Should not throw
    expect(() => service.start()).not.toThrow();
  });
});
