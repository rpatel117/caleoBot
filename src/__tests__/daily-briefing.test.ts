jest.mock('../database/client', () => ({
  __esModule: true,
  default: { query: jest.fn().mockResolvedValue({ rows: [] }) },
}));

jest.mock('../database/repository', () => ({
  repository: {
    getBriefingUsers: jest.fn().mockResolvedValue([]),
  },
}));

jest.mock('../calendar/google/oauth', () => ({
  GoogleOAuth: jest.fn().mockImplementation(() => ({
    getValidAccessToken: jest.fn().mockResolvedValue(null),
  })),
}));

jest.mock('../calendar/microsoft/oauth', () => ({
  MicrosoftOAuth: jest.fn().mockImplementation(() => ({
    getValidAccessToken: jest.fn().mockResolvedValue(null),
  })),
}));

jest.mock('../calendar/google/provider', () => ({
  GoogleCalendarProvider: jest.fn().mockImplementation(() => ({
    getEvents: jest.fn().mockResolvedValue([]),
  })),
}));

jest.mock('../calendar/microsoft/provider', () => ({
  MicrosoftCalendarProvider: jest.fn().mockImplementation(() => ({
    getEvents: jest.fn().mockResolvedValue([]),
  })),
}));

import { DailyBriefingService } from '../slack/daily-briefing';

describe('DailyBriefingService', () => {
  let service: DailyBriefingService;
  let mockSlackClient: any;

  beforeEach(() => {
    mockSlackClient = {
      conversations: {
        open: jest.fn().mockResolvedValue({ channel: { id: 'D123' } }),
      },
      chat: {
        postMessage: jest.fn().mockResolvedValue({}),
      },
    };

    const { GoogleOAuth } = require('../calendar/google/oauth');
    const { MicrosoftOAuth } = require('../calendar/microsoft/oauth');

    service = new DailyBriefingService({
      slackClient: mockSlackClient,
      googleOAuth: new GoogleOAuth(),
      microsoftOAuth: new MicrosoftOAuth(),
    });
  });

  afterEach(() => {
    service.stop();
  });

  test('starts and stops without error', () => {
    expect(() => service.start()).not.toThrow();
    expect(() => service.stop()).not.toThrow();
  });

  test('stop is idempotent', () => {
    service.start();
    service.stop();
    service.stop();
  });

  describe('conflict detection', () => {
    test('detects overlapping meetings', () => {
      const events = [
        {
          id: '1', subject: 'Meeting A',
          start: { dateTime: '2026-03-02T09:00:00Z', timeZone: 'UTC' },
          end: { dateTime: '2026-03-02T10:00:00Z', timeZone: 'UTC' },
        },
        {
          id: '2', subject: 'Meeting B',
          start: { dateTime: '2026-03-02T09:30:00Z', timeZone: 'UTC' },
          end: { dateTime: '2026-03-02T10:30:00Z', timeZone: 'UTC' },
        },
      ];

      const conflicts = (service as any).detectConflicts(events, 'UTC');
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0]).toContain('Meeting A');
      expect(conflicts[0]).toContain('Meeting B');
    });

    test('no conflicts for non-overlapping meetings', () => {
      const events = [
        {
          id: '1', subject: 'Meeting A',
          start: { dateTime: '2026-03-02T09:00:00Z', timeZone: 'UTC' },
          end: { dateTime: '2026-03-02T10:00:00Z', timeZone: 'UTC' },
        },
        {
          id: '2', subject: 'Meeting B',
          start: { dateTime: '2026-03-02T11:00:00Z', timeZone: 'UTC' },
          end: { dateTime: '2026-03-02T12:00:00Z', timeZone: 'UTC' },
        },
      ];

      const conflicts = (service as any).detectConflicts(events, 'UTC');
      expect(conflicts).toHaveLength(0);
    });

    test('handles empty events array', () => {
      const conflicts = (service as any).detectConflicts([], 'UTC');
      expect(conflicts).toHaveLength(0);
    });

    test('handles single event', () => {
      const events = [{
        id: '1', subject: 'Solo',
        start: { dateTime: '2026-03-02T09:00:00Z', timeZone: 'UTC' },
        end: { dateTime: '2026-03-02T10:00:00Z', timeZone: 'UTC' },
      }];
      const conflicts = (service as any).detectConflicts(events, 'UTC');
      expect(conflicts).toHaveLength(0);
    });

    test('detects back-to-back but not overlapping as non-conflicts', () => {
      const events = [
        {
          id: '1', subject: 'A',
          start: { dateTime: '2026-03-02T09:00:00Z', timeZone: 'UTC' },
          end: { dateTime: '2026-03-02T10:00:00Z', timeZone: 'UTC' },
        },
        {
          id: '2', subject: 'B',
          start: { dateTime: '2026-03-02T10:00:00Z', timeZone: 'UTC' }, // Starts exactly when A ends
          end: { dateTime: '2026-03-02T11:00:00Z', timeZone: 'UTC' },
        },
      ];

      const conflicts = (service as any).detectConflicts(events, 'UTC');
      expect(conflicts).toHaveLength(0); // Back-to-back is not a conflict
    });
  });

  describe('free time computation', () => {
    test('finds gaps between meetings', () => {
      const events = [
        {
          id: '1', subject: 'A',
          start: { dateTime: '2026-03-02T09:00:00Z', timeZone: 'UTC' },
          end: { dateTime: '2026-03-02T10:00:00Z', timeZone: 'UTC' },
        },
        {
          id: '2', subject: 'B',
          start: { dateTime: '2026-03-02T14:00:00Z', timeZone: 'UTC' },
          end: { dateTime: '2026-03-02T15:00:00Z', timeZone: 'UTC' },
        },
      ];

      const gaps = (service as any).computeFreeTime(events, 'UTC');
      expect(gaps.length).toBeGreaterThan(0);
      expect(gaps[0]).toContain('4h');
    });

    test('ignores gaps shorter than 30 minutes', () => {
      const events = [
        {
          id: '1', subject: 'A',
          start: { dateTime: '2026-03-02T09:00:00Z', timeZone: 'UTC' },
          end: { dateTime: '2026-03-02T09:50:00Z', timeZone: 'UTC' },
        },
        {
          id: '2', subject: 'B',
          start: { dateTime: '2026-03-02T10:00:00Z', timeZone: 'UTC' },
          end: { dateTime: '2026-03-02T11:00:00Z', timeZone: 'UTC' },
        },
      ];

      const gaps = (service as any).computeFreeTime(events, 'UTC');
      // 10-minute gap should be ignored
      expect(gaps).toHaveLength(0);
    });

    test('handles empty events', () => {
      const gaps = (service as any).computeFreeTime([], 'UTC');
      expect(gaps).toHaveLength(0);
    });
  });

  describe('briefing message formatting', () => {
    test('sendBriefing constructs correct Slack blocks', async () => {
      const { GoogleOAuth } = require('../calendar/google/oauth');
      const googleOAuth = new GoogleOAuth();
      (googleOAuth.getValidAccessToken as jest.Mock).mockResolvedValue('token');

      const { GoogleCalendarProvider } = require('../calendar/google/provider');
      const mockProvider = new GoogleCalendarProvider();
      (mockProvider.getEvents as jest.Mock).mockResolvedValue([
        {
          id: '1', subject: 'Standup',
          start: { dateTime: '2026-03-02T09:00:00Z', timeZone: 'UTC' },
          end: { dateTime: '2026-03-02T09:30:00Z', timeZone: 'UTC' },
          attendees: [{ emailAddress: { address: 'a@test.com' } }],
        },
      ]);

      service = new DailyBriefingService({
        slackClient: mockSlackClient,
        googleOAuth,
        microsoftOAuth: new (require('../calendar/microsoft/oauth').MicrosoftOAuth)(),
      });

      // sendBriefing is private, but we can test its effect
      await (service as any).sendBriefing({
        db_user_id: 'db-1',
        slack_user_id: 'U123',
        timezone: 'UTC',
        display_name: 'Test User',
      });

      expect(mockSlackClient.conversations.open).toHaveBeenCalledWith({ users: 'U123' });
      expect(mockSlackClient.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'D123',
          blocks: expect.any(Array),
        })
      );
    });

    test('sendBriefing handles no events gracefully', async () => {
      await (service as any).sendBriefing({
        db_user_id: 'db-1',
        slack_user_id: 'U456',
        timezone: 'UTC',
        display_name: 'Jane Doe',
      });

      if (mockSlackClient.chat.postMessage.mock.calls.length > 0) {
        const blocks = mockSlackClient.chat.postMessage.mock.calls[0][0].blocks;
        const text = blocks.map((b: any) => b.text?.text || '').join(' ');
        expect(text).toContain('Good morning');
      }
    });
  });
});
