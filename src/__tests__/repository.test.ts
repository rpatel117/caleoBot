/**
 * Repository tests using mocked pg pool.
 * Tests the SQL query building and parameter passing logic.
 */

const mockQuery = jest.fn();
const mockConnect = jest.fn();
const mockClientQuery = jest.fn();
const mockRelease = jest.fn();

jest.mock('../database/client', () => ({
  __esModule: true,
  default: {
    query: mockQuery,
    connect: mockConnect.mockResolvedValue({
      query: mockClientQuery,
      release: mockRelease,
    }),
  },
}));

jest.mock('../agent/config', () => ({
  AGENT_CONFIG: { sessionTimeoutMinutes: 30, dmSessionTimeoutMinutes: 5 },
}));

jest.mock('../billing/plans', () => ({
  PLAN_LIMITS: { free: { meetingsPerMonth: 10, messagesPerMonth: 50 } },
}));

import { Repository } from '../database/repository';

describe('Repository', () => {
  let repo: Repository;

  beforeEach(() => {
    repo = new Repository();
    jest.clearAllMocks();
  });

  describe('getUserSettings', () => {
    test('returns stored settings when they exist', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{
          user_id: 'user-1',
          status_sync_enabled: true,
          show_event_titles: false,
          daily_briefing_enabled: true,
          daily_briefing_time: '09:00',
          focus_time_goal_hours: 4,
          no_meeting_days: [5],
        }],
      });

      const result = await repo.getUserSettings('user-1');
      expect(result.status_sync_enabled).toBe(true);
      expect(result.show_event_titles).toBe(false);
      expect(result.focus_time_goal_hours).toBe(4);
      expect(result.no_meeting_days).toEqual([5]);
    });

    test('returns defaults when no settings exist', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await repo.getUserSettings('user-new');
      expect(result.status_sync_enabled).toBe(false);
      expect(result.show_event_titles).toBe(false);
      expect(result.daily_briefing_enabled).toBe(true);
      expect(result.daily_briefing_time).toBe('08:30');
      expect(result.focus_time_goal_hours).toBe(0);
      expect(result.no_meeting_days).toEqual([]);
    });
  });

  describe('updateUserSettings', () => {
    test('upserts settings with correct SQL', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ user_id: 'user-1', status_sync_enabled: true }],
      });

      await repo.updateUserSettings('user-1', {
        status_sync_enabled: true,
        daily_briefing_time: '07:00',
      });

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain('INSERT INTO user_settings');
      expect(sql).toContain('ON CONFLICT (user_id) DO UPDATE');
      expect(params[0]).toBe('user-1');
      expect(params).toContain(true); // status_sync_enabled
      expect(params).toContain('07:00'); // daily_briefing_time
    });

    test('only includes allowed fields', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{}] });

      await repo.updateUserSettings('user-1', {
        status_sync_enabled: true,
        malicious_field: 'drop table users', // Should be ignored
      });

      const [sql] = mockQuery.mock.calls[0];
      expect(sql).not.toContain('malicious_field');
    });
  });

  describe('getActiveStatusSyncUsers', () => {
    test('queries users with status sync enabled', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { db_user_id: 'u1', slack_user_id: 'U111', timezone: 'America/Chicago' },
          { db_user_id: 'u2', slack_user_id: 'U222', timezone: 'America/New_York' },
        ],
      });

      const result = await repo.getActiveStatusSyncUsers();
      expect(result).toHaveLength(2);
      const [sql] = mockQuery.mock.calls[0];
      expect(sql).toContain('status_sync_enabled = true');
    });
  });

  describe('logAction', () => {
    test('inserts audit log with all fields', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 'log-1' }] });

      await repo.logAction({
        userId: 'user-1',
        action: 'create_meeting',
        eventId: 'evt-123',
        provider: 'google',
        details: { subject: 'Team Sync', attendees: ['alice@test.com'] },
        slackChannel: 'C123',
        slackThreadTs: '1234.5678',
      });

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain('INSERT INTO audit_log');
      expect(params[0]).toBe('user-1');
      expect(params[1]).toBe('create_meeting');
      expect(params[2]).toBe('evt-123');
      expect(params[3]).toBe('google');
      expect(JSON.parse(params[4])).toEqual({ subject: 'Team Sync', attendees: ['alice@test.com'] });
    });

    test('handles null optional fields', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 'log-2' }] });

      await repo.logAction({
        userId: 'user-1',
        action: 'delete_meeting',
      });

      const params = mockQuery.mock.calls[0][1];
      expect(params[2]).toBeNull(); // eventId
      expect(params[3]).toBeNull(); // provider
      expect(params[4]).toBeNull(); // details
      expect(params[5]).toBeNull(); // slackChannel
      expect(params[6]).toBeNull(); // slackThreadTs
    });
  });

  describe('getAuditLog', () => {
    test('returns audit entries sorted by created_at DESC', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { id: 'log-2', action: 'delete_meeting', created_at: '2026-03-02' },
          { id: 'log-1', action: 'create_meeting', created_at: '2026-03-01' },
        ],
      });

      const result = await repo.getAuditLog('user-1', 10);
      expect(result).toHaveLength(2);
      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain('ORDER BY created_at DESC');
      expect(params[0]).toBe('user-1');
      expect(params[1]).toBe(10);
    });
  });

  describe('getPreferences', () => {
    test('returns stored preferences', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{
          work_hours_start: '08:00',
          work_hours_end: '18:00',
          default_duration_minutes: 45,
          buffer_minutes: 10,
          preferred_provider: 'google',
        }],
      });

      const result = await repo.getPreferences('user-1');
      expect(result.work_hours_start).toBe('08:00');
      expect(result.buffer_minutes).toBe(10);
    });

    test('returns defaults when no preferences exist', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await repo.getPreferences('user-new');
      expect(result.work_hours_start).toBe('09:00');
      expect(result.work_hours_end).toBe('17:00');
      expect(result.default_duration_minutes).toBe(30);
      expect(result.buffer_minutes).toBe(0);
      expect(result.preferred_provider).toBeNull();
    });
  });

  describe('updatePreferences', () => {
    test('only updates allowed fields', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{}] });

      await repo.updatePreferences('user-1', {
        work_hours_start: '08:00',
        sql_injection: "'; DROP TABLE users; --",
      });

      const [sql] = mockQuery.mock.calls[0];
      expect(sql).not.toContain('sql_injection');
      expect(sql).toContain('work_hours_start');
    });
  });

  describe('balance operations', () => {
    test('getBalance auto-creates row with $1.00 starting balance', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // SELECT
        .mockResolvedValueOnce({ rows: [{ balance_cents: 100, lifetime_spent_cents: 0 }] }); // INSERT

      const result = await repo.getBalance('new-user');
      expect(result.balance_cents).toBe(100);
    });

    test('deductBalance uses atomic check', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ balance_cents: 50 }], rowCount: 1 });

      const success = await repo.deductBalance('user-1', 30);
      expect(success).toBe(true);

      const [sql] = mockQuery.mock.calls[0];
      expect(sql).toContain('balance_cents >= $2'); // Atomic check
    });

    test('deductBalance fails when insufficient balance', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const success = await repo.deductBalance('user-1', 999);
      expect(success).toBe(false);
    });

    test('deductBalance rounds up to nearest cent', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ balance_cents: 99 }], rowCount: 1 });

      await repo.deductBalance('user-1', 0.5);
      const params = mockQuery.mock.calls[0][1];
      expect(params[1]).toBe(1); // 0.5 rounded up to 1
    });
  });

  describe('creditBalanceIfNotProcessed', () => {
    test('uses transaction for atomic credit + dedup', async () => {
      mockClientQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 'new' }] }) // INSERT stripe_events
        .mockResolvedValueOnce({}) // UPDATE balance
        .mockResolvedValueOnce({}); // COMMIT

      const result = await repo.creditBalanceIfNotProcessed('stripe-evt-1', 'checkout.session.completed', 'user-1', 500);
      expect(result).toBe(true);
      expect(mockClientQuery).toHaveBeenCalledTimes(4);
    });

    test('skips already-processed events', async () => {
      mockClientQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // INSERT returns empty (conflict)
        .mockResolvedValueOnce({}); // ROLLBACK

      const result = await repo.creditBalanceIfNotProcessed('stripe-evt-1', 'checkout.session.completed', 'user-1', 500);
      expect(result).toBe(false);
    });

    test('rolls back on error', async () => {
      mockClientQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockRejectedValueOnce(new Error('DB error'));

      await expect(repo.creditBalanceIfNotProcessed('stripe-evt-1', 'checkout.session.completed', 'user-1', 500)).rejects.toThrow('DB error');

      // Should have called ROLLBACK
      const rollbackCall = mockClientQuery.mock.calls.find((c: any) => c[0] === 'ROLLBACK');
      expect(rollbackCall).toBeDefined();
    });
  });

  describe('cross-org lookups', () => {
    test('findCaleoUsersByEmails normalizes to lowercase', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{
          db_user_id: 'u1',
          email: 'alice@test.com',
          display_name: 'Alice',
          timezone: 'UTC',
          providers: ['google'],
        }],
      });

      await repo.findCaleoUsersByEmails(['Alice@Test.COM']);
      const params = mockQuery.mock.calls[0][1];
      expect(params[0]).toEqual(['alice@test.com']);
    });

    test('findCaleoUsersByEmails handles empty array', async () => {
      const result = await repo.findCaleoUsersByEmails([]);
      expect(result).toEqual([]);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    test('searchUsersByName uses LIKE with lowercase', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await repo.searchUsersByName('Alice', 5);
      const [sql, params] = mockQuery.mock.calls[0];
      expect(params[0]).toBe('%alice%');
      expect(sql).toContain('LOWER(display_name)');
    });
  });
});
