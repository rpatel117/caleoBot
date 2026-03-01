/**
 * Tests for new agent tools: focus time, undo, impact scoring, recurring meetings, audit log.
 * Tests the tool execution logic directly without calling the Anthropic API.
 */

// Mock the database module before any imports
jest.mock('../database/client', () => ({
  __esModule: true,
  default: { query: jest.fn(), connect: jest.fn() },
}));

jest.mock('../database/repository', () => {
  // In-memory undo store for tests to simulate DB behavior
  let undoStore: Record<string, any> = {};
  const mockRepo = {
    getPreferences: jest.fn().mockResolvedValue({
      work_hours_start: '09:00',
      work_hours_end: '17:00',
      default_duration_minutes: 30,
      buffer_minutes: 5,
    }),
    getUserSettings: jest.fn().mockResolvedValue({
      focus_time_goal_hours: 6,
      no_meeting_days: [0, 6], // Sun, Sat
      status_sync_enabled: false,
    }),
    logAction: jest.fn().mockResolvedValue({}),
    getWorkspacePlan: jest.fn().mockResolvedValue('pro'),
    getMonthlyUsage: jest.fn().mockResolvedValue({ meetingsCreated: 0 }),
    saveUndoState: jest.fn().mockImplementation(async (userId: string, channelId: string, state: any) => {
      undoStore[`${userId}:${channelId}`] = state;
    }),
    getUndoState: jest.fn().mockImplementation(async (userId: string, channelId: string) => {
      return undoStore[`${userId}:${channelId}`] || null;
    }),
    clearUndoState: jest.fn().mockImplementation(async (userId: string, channelId: string) => {
      delete undoStore[`${userId}:${channelId}`];
    }),
    _resetUndoStore: () => { undoStore = {}; },
  };
  return {
    repository: mockRepo,
    Repository: jest.fn(() => mockRepo),
  };
});

// Mock Anthropic SDK to avoid real API calls
jest.mock('@anthropic-ai/sdk', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      messages: {
        create: jest.fn().mockResolvedValue({
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: 'Mock response' }],
          usage: { input_tokens: 100, output_tokens: 50 },
        }),
      },
    })),
  };
});

import { AnthropicAgent, AgentContext } from '../agent/anthropic-agent';
import { repository } from '../database/repository';

function makeContext(overrides: Partial<AgentContext> = {}): AgentContext {
  const mockCalendar = {
    getEvents: jest.fn().mockResolvedValue([]),
    createEvent: jest.fn().mockResolvedValue({
      id: 'new-evt-123',
      subject: 'Focus Time',
      webLink: 'https://calendar.test/evt',
      onlineMeetingUrl: null,
      start: { dateTime: '2026-03-02T09:00:00', timeZone: 'America/Chicago' },
      end: { dateTime: '2026-03-02T11:00:00', timeZone: 'America/Chicago' },
    }),
    updateEvent: jest.fn().mockResolvedValue({}),
    deleteEvent: jest.fn().mockResolvedValue(undefined),
    findFreeTime: jest.fn().mockReturnValue([
      { start: '2026-03-02T09:00:00Z', end: '2026-03-02T11:00:00Z' },
      { start: '2026-03-02T13:00:00Z', end: '2026-03-02T15:00:00Z' },
    ]),
    checkAvailability: jest.fn().mockResolvedValue({ available: true, conflicts: [] }),
  };

  const providers = new Map();
  providers.set('google', {
    calendar: mockCalendar,
    accessToken: 'test-token',
    providerType: 'google',
  });

  return {
    userContext: {
      userId: 'U123',
      name: 'Test User',
      email: 'test@example.com',
      workspaceId: 'ws-1',
      timezone: 'America/Chicago',
    },
    providers,
    dbUserId: 'db-user-1',
    slackChannelId: 'C123',
    slackThreadTs: '1234567890.123456',
    actionsPerformed: { meetingsCreated: 0, meetingsUpdated: 0, meetingsDeleted: 0 },
    userType: 'developer',
    workspaceId: 'ws-1',
    ...overrides,
  };
}

describe('Agent Tool Execution', () => {
  let agent: AnthropicAgent;

  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    agent = new AnthropicAgent();
    jest.clearAllMocks();
    // Reset the in-memory undo store used by mock repository
    (repository as any)._resetUndoStore();
  });

  // Access private executeTool via prototype
  function executeTool(name: string, input: Record<string, any>, context: AgentContext): Promise<any> {
    return (agent as any).executeTool(name, input, context);
  }

  describe('create_focus_time', () => {
    test('creates focus time event', async () => {
      const ctx = makeContext();
      const result = await executeTool('create_focus_time', { duration: 120 }, ctx);

      expect(result.success).toBe(true);
      expect(result.title).toBe('Focus Time');
      expect(result.duration).toBe(120);
      expect(result.undoAvailable).toBe(true);

      // Verify calendar API was called
      const calendar = ctx.providers.get('google')!.calendar!;
      expect(calendar.createEvent).toHaveBeenCalledTimes(1);
      const createCall = (calendar.createEvent as jest.Mock).mock.calls[0][1];
      expect(createCall.body).toContain('[Caleo Focus]');
      expect(createCall.isOnlineMeeting).toBe(false);
    });

    test('uses custom title when provided', async () => {
      const ctx = makeContext();
      const result = await executeTool('create_focus_time', { duration: 60, title: 'Deep Work' }, ctx);

      expect(result.success).toBe(true);
      expect(result.title).toBe('Deep Work');
    });

    test('fails when no calendar provider', async () => {
      const ctx = makeContext({ providers: new Map() });
      const result = await executeTool('create_focus_time', { duration: 60 }, ctx);
      expect(result.success).toBe(false);
      expect(result.error).toContain('No calendar provider');
    });

    test('fails when no free slot available', async () => {
      const ctx = makeContext();
      const calendar = ctx.providers.get('google')!.calendar!;
      (calendar.findFreeTime as jest.Mock).mockReturnValue([]);

      const result = await executeTool('create_focus_time', { duration: 120 }, ctx);
      expect(result.success).toBe(false);
      expect(result.error).toContain('No 120-minute free slot');
    });

    test('includes goal progress when user has a focus goal', async () => {
      const ctx = makeContext();
      // Mock getEvents to return a focus time block
      const calendar = ctx.providers.get('google')!.calendar!;
      (calendar.getEvents as jest.Mock).mockResolvedValue([{
        id: 'focus-1',
        subject: 'Focus Time',
        start: { dateTime: '2026-03-02T09:00:00Z' },
        end: { dateTime: '2026-03-02T11:00:00Z' },
        body: { content: '[Caleo Focus]' },
      }]);

      const result = await executeTool('create_focus_time', { duration: 60 }, ctx);
      expect(result.goalProgress).toContain('/6');
    });

    test('logs to audit log', async () => {
      const ctx = makeContext();
      await executeTool('create_focus_time', { duration: 60 }, ctx);

      // Wait for async audit log
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(repository.logAction).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'db-user-1',
          action: 'create_focus_time',
        })
      );
    });
  });

  describe('get_focus_time_stats', () => {
    test('returns zero when no focus blocks exist', async () => {
      const ctx = makeContext();
      const result = await executeTool('get_focus_time_stats', {}, ctx);
      expect(result.totalHoursBlocked).toBe(0);
      expect(result.blocksCount).toBe(0);
      expect(result.goalHours).toBe(6);
    });

    test('counts focus time blocks by tag', async () => {
      const ctx = makeContext();
      const calendar = ctx.providers.get('google')!.calendar!;
      (calendar.getEvents as jest.Mock).mockResolvedValue([
        {
          id: 'f1', subject: 'Focus Time',
          start: { dateTime: '2026-03-02T09:00:00Z' },
          end: { dateTime: '2026-03-02T11:00:00Z' },
          body: { content: '[Caleo Focus]' },
        },
        {
          id: 'f2', subject: 'Deep Work',
          start: { dateTime: '2026-03-03T14:00:00Z' },
          end: { dateTime: '2026-03-03T16:00:00Z' },
          body: { content: 'Regular meeting, not focus time' },
        },
        {
          id: 'f3', subject: 'focus time',
          start: { dateTime: '2026-03-04T09:00:00Z' },
          end: { dateTime: '2026-03-04T10:00:00Z' },
          body: { content: '' },
        },
      ]);

      const result = await executeTool('get_focus_time_stats', {}, ctx);
      // f1 matches "[Caleo Focus]", f3 matches "focus time" in subject
      expect(result.blocksCount).toBe(2);
      expect(result.totalHoursBlocked).toBe(3); // 2h + 1h
    });
  });

  describe('undo_last_change', () => {
    test('undoes a create by deleting the event', async () => {
      const ctx = makeContext();

      // First create something
      await executeTool('create_meeting', {
        subject: 'Test Meeting',
        startTime: '2026-03-02T09:00:00',
        endTime: '2026-03-02T10:00:00',
      }, ctx);
      // Allow fire-and-forget saveUndoState to settle
      await new Promise(resolve => setTimeout(resolve, 10));

      // Now undo
      const result = await executeTool('undo_last_change', {}, ctx);
      expect(result.success).toBe(true);
      expect(result.undoneAction).toBe('create');

      const calendar = ctx.providers.get('google')!.calendar!;
      expect(calendar.deleteEvent).toHaveBeenCalledWith('test-token', 'new-evt-123');
    });

    test('undoes an update by reverting to previous state', async () => {
      const ctx = makeContext();
      const calendar = ctx.providers.get('google')!.calendar!;

      // Mock getEvents to return the event being updated
      (calendar.getEvents as jest.Mock).mockResolvedValue([{
        id: 'evt-to-update',
        subject: 'Original Title',
        start: { dateTime: '2026-03-02T09:00:00Z' },
        end: { dateTime: '2026-03-02T10:00:00Z' },
      }]);

      // Update the meeting
      await executeTool('update_meeting', {
        meetingId: 'evt-to-update',
        subject: 'New Title',
      }, ctx);
      await new Promise(resolve => setTimeout(resolve, 10));

      // Undo
      const result = await executeTool('undo_last_change', {}, ctx);
      expect(result.success).toBe(true);
      expect(result.undoneAction).toBe('update');
    });

    test('undoes a delete by recreating the event', async () => {
      const ctx = makeContext();
      const calendar = ctx.providers.get('google')!.calendar!;

      // Mock getEvents to return the event being deleted
      (calendar.getEvents as jest.Mock).mockResolvedValue([{
        id: 'evt-to-delete',
        subject: 'Deleted Meeting',
        start: { dateTime: '2026-03-02T09:00:00Z' },
        end: { dateTime: '2026-03-02T10:00:00Z' },
        attendees: [{ emailAddress: { address: 'alice@test.com' } }],
      }]);

      // Delete the meeting
      await executeTool('delete_meeting', { meetingId: 'evt-to-delete' }, ctx);
      await new Promise(resolve => setTimeout(resolve, 10));

      // Undo
      const result = await executeTool('undo_last_change', {}, ctx);
      expect(result.success).toBe(true);
      expect(result.undoneAction).toBe('delete');
      expect(calendar.createEvent).toHaveBeenCalled();
    });

    test('returns error when no undo available', async () => {
      // Use a fresh context with a unique key that hasn't had any actions
      const ctx = makeContext({
        dbUserId: 'unique-user-no-history',
        slackChannelId: 'unique-channel',
      });
      const result = await executeTool('undo_last_change', {}, ctx);
      expect(result.success).toBe(false);
      expect(result.error).toContain('No recent changes');
    });

    test('undo logs to audit log', async () => {
      const ctx = makeContext();

      // Create then undo
      await executeTool('create_meeting', {
        subject: 'Test', startTime: '2026-03-02T09:00:00', endTime: '2026-03-02T10:00:00',
      }, ctx);
      await new Promise(resolve => setTimeout(resolve, 10));

      jest.clearAllMocks(); // Reset call counts
      await executeTool('undo_last_change', {}, ctx);

      await new Promise(resolve => setTimeout(resolve, 10));
      expect(repository.logAction).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'undo_create',
        })
      );
    });

    test('undo clears the undo state (no double undo)', async () => {
      const ctx = makeContext();

      await executeTool('create_meeting', {
        subject: 'Test', startTime: '2026-03-02T09:00:00', endTime: '2026-03-02T10:00:00',
      }, ctx);
      await new Promise(resolve => setTimeout(resolve, 10));

      await executeTool('undo_last_change', {}, ctx);
      const secondUndo = await executeTool('undo_last_change', {}, ctx);
      expect(secondUndo.success).toBe(false);
      expect(secondUndo.error).toContain('No recent changes');
    });
  });

  describe('create_meeting with audit log and undo', () => {
    test('stores undo state after create', async () => {
      const ctx = makeContext();
      const result = await executeTool('create_meeting', {
        subject: 'Team Sync',
        startTime: '2026-03-02T09:00:00',
        endTime: '2026-03-02T10:00:00',
        attendees: ['alice@test.com'],
      }, ctx);

      expect(result.success).toBe(true);
      expect(result.undoAvailable).toBe(true);
      expect(ctx.actionsPerformed.meetingsCreated).toBe(1);
    });

    test('logs create to audit log', async () => {
      const ctx = makeContext();
      await executeTool('create_meeting', {
        subject: 'Test',
        startTime: '2026-03-02T09:00:00',
        endTime: '2026-03-02T10:00:00',
      }, ctx);

      await new Promise(resolve => setTimeout(resolve, 10));
      expect(repository.logAction).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'db-user-1',
          action: 'create_meeting',
          provider: 'google',
        })
      );
    });

    test('passes recurrence to calendar provider', async () => {
      const ctx = makeContext();
      await executeTool('create_meeting', {
        subject: 'Weekly Sync',
        startTime: '2026-03-02T09:00:00',
        endTime: '2026-03-02T10:00:00',
        recurrence: 'RRULE:FREQ=WEEKLY;COUNT=10',
      }, ctx);

      const calendar = ctx.providers.get('google')!.calendar!;
      const createCall = (calendar.createEvent as jest.Mock).mock.calls[0][1];
      expect(createCall.recurrence).toBe('RRULE:FREQ=WEEKLY;COUNT=10');
    });

    test('strips Z suffix from times', async () => {
      const ctx = makeContext();
      await executeTool('create_meeting', {
        subject: 'Test',
        startTime: '2026-03-02T09:00:00Z',
        endTime: '2026-03-02T10:00:00Z',
      }, ctx);

      const calendar = ctx.providers.get('google')!.calendar!;
      const createCall = (calendar.createEvent as jest.Mock).mock.calls[0][1];
      expect(createCall.start).toBe('2026-03-02T09:00:00');
      expect(createCall.end).toBe('2026-03-02T10:00:00');
    });

    test('strips timezone offset from times', async () => {
      const ctx = makeContext();
      await executeTool('create_meeting', {
        subject: 'Test',
        startTime: '2026-03-02T09:00:00-06:00',
        endTime: '2026-03-02T10:00:00-06:00',
      }, ctx);

      const calendar = ctx.providers.get('google')!.calendar!;
      const createCall = (calendar.createEvent as jest.Mock).mock.calls[0][1];
      expect(createCall.start).toBe('2026-03-02T09:00:00');
    });
  });

  describe('delete_meeting with audit log', () => {
    test('logs delete to audit log', async () => {
      const ctx = makeContext();
      await executeTool('delete_meeting', { meetingId: 'evt-1' }, ctx);

      await new Promise(resolve => setTimeout(resolve, 10));
      expect(repository.logAction).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'delete_meeting',
          eventId: 'evt-1',
        })
      );
    });

    test('increments deletesPerformed counter', async () => {
      const ctx = makeContext();
      await executeTool('delete_meeting', { meetingId: 'evt-1' }, ctx);
      expect(ctx.actionsPerformed.meetingsDeleted).toBe(1);
    });
  });

  describe('impact scoring (find_free_time)', () => {
    test('returns scored slots', async () => {
      const ctx = makeContext();
      const result = await executeTool('find_free_time', {
        duration: 60,
        startDate: '2026-03-02T09:00:00Z',
        endDate: '2026-03-02T17:00:00Z',
      }, ctx);

      expect(result.freeSlots).toBeDefined();
      expect(result.freeSlots.length).toBeGreaterThan(0);
      // Each slot should have score and reason
      for (const slot of result.freeSlots) {
        expect(typeof slot.score).toBe('number');
        expect(typeof slot.reason).toBe('string');
        expect(slot.score).toBeGreaterThanOrEqual(0);
      }
    });

    test('penalizes no-meeting day slots', async () => {
      const ctx = makeContext();
      // Configure Saturday (6) as no-meeting day (already set in mock)
      const calendar = ctx.providers.get('google')!.calendar!;
      (calendar.findFreeTime as jest.Mock).mockReturnValue([
        // Return a Saturday slot
        { start: '2026-02-28T09:00:00Z', end: '2026-02-28T10:00:00Z' }, // Saturday
      ]);

      const result = await executeTool('find_free_time', {
        duration: 60,
        startDate: '2026-02-28T00:00:00Z',
        endDate: '2026-03-01T00:00:00Z',
      }, ctx);

      if (result.freeSlots.length > 0) {
        const saturdaySlot = result.freeSlots[0];
        expect(saturdaySlot.reason).toContain('no-meeting day');
        expect(saturdaySlot.score).toBeLessThan(10);
      }
    });
  });

  describe('error handling', () => {
    test('unknown tool returns error', async () => {
      const ctx = makeContext();
      const result = await executeTool('nonexistent_tool', {}, ctx);
      expect(result.error).toContain('Unknown tool');
    });

    test('get_preferences without dbUserId returns error', async () => {
      const ctx = makeContext({ dbUserId: undefined });
      const result = await executeTool('get_preferences', {}, ctx);
      expect(result.error).toContain('User not found');
    });

    test('create_meeting without provider returns helpful error', async () => {
      const ctx = makeContext({ providers: new Map() });
      const result = await executeTool('create_meeting', {
        subject: 'Test', startTime: '2026-03-02T09:00:00', endTime: '2026-03-02T10:00:00',
      }, ctx);
      expect(result.success).toBe(false);
      expect(result.error).toContain('/caleo-auth');
    });

    test('handles calendar API errors gracefully', async () => {
      const ctx = makeContext();
      const calendar = ctx.providers.get('google')!.calendar!;
      (calendar.createEvent as jest.Mock).mockRejectedValue(new Error('API error: 500'));

      const result = await executeTool('create_meeting', {
        subject: 'Test', startTime: '2026-03-02T09:00:00', endTime: '2026-03-02T10:00:00',
      }, ctx);
      expect(result.success).toBe(false);
      expect(result.error).toContain('API error');
    });

    test('handles 401 errors with re-auth suggestion', async () => {
      const ctx = makeContext();
      const calendar = ctx.providers.get('google')!.calendar!;
      const authErr: any = new Error('Unauthorized');
      authErr.status = 401;
      (calendar.getEvents as jest.Mock).mockRejectedValue(authErr);

      const result = await executeTool('get_today_events', {}, ctx);
      expect(result.error).toContain('/caleo-auth');
    });
  });

  describe('search_people calendar history fallback', () => {
    test('searches calendar event attendees when other sources find nothing', async () => {
      const ctx = makeContext();
      const calendar = ctx.providers.get('google')!.calendar!;

      // Mock getEvents to return past events with attendees
      (calendar.getEvents as jest.Mock).mockResolvedValue([
        {
          id: 'past-evt-1',
          subject: 'Rushi/Siva',
          start: { dateTime: '2026-02-17T10:00:00Z' },
          end: { dateTime: '2026-02-17T11:00:00Z' },
          attendees: [
            { emailAddress: { name: 'Siva Kumar', address: 'siva@example.com' }, type: 'required' },
            { emailAddress: { name: 'Rushi Patel', address: 'rushi@example.com' }, type: 'required' },
          ],
        },
      ]);

      const result = await executeTool('search_people', { query: 'Siva' }, ctx);

      expect(result.results.length).toBeGreaterThanOrEqual(1);
      expect(result.results[0].email).toBe('siva@example.com');
      expect(result.results[0].name).toBe('Siva Kumar');
      expect(result.results[0].source).toBe('calendar_history');
    });

    test('always searches calendar history even when other sources return results', async () => {
      const ctx = makeContext({
        slackClient: {
          users: {
            list: jest.fn().mockResolvedValue({
              members: [
                { real_name: 'Siva Slack', profile: { display_name: 'siva', email: 'siva@slack.com' }, deleted: false, is_bot: false, id: 'U999' },
              ],
            }),
          },
        },
      });
      const calendar = ctx.providers.get('google')!.calendar!;
      (calendar.getEvents as jest.Mock).mockResolvedValue([
        {
          id: 'past-evt-1', subject: 'Rushi/Siva',
          start: { dateTime: '2026-01-10T10:00:00Z' }, end: { dateTime: '2026-01-10T11:00:00Z' },
          attendees: [
            { emailAddress: { name: 'Siva Kumar', address: 'siva@example.com' }, type: 'required' },
          ],
        },
      ]);

      const result = await executeTool('search_people', { query: 'Siva' }, ctx);

      // Should call getEvents for calendar history even though Slack returned results
      expect(calendar.getEvents).toHaveBeenCalled();
      // Should have results from both Slack and calendar_history
      expect(result.results.length).toBeGreaterThanOrEqual(2);
      const sources = result.results.map((r: any) => r.source);
      expect(sources).toContain('slack');
      expect(sources).toContain('calendar_history');
    });

    test('dedup priority: Slack wins over calendar_history for same email', async () => {
      const ctx = makeContext({
        slackClient: {
          users: {
            list: jest.fn().mockResolvedValue({
              members: [
                { real_name: 'Siva Kumar', profile: { display_name: 'siva', email: 'siva@example.com' }, deleted: false, is_bot: false, id: 'U999' },
              ],
            }),
          },
        },
      });
      const calendar = ctx.providers.get('google')!.calendar!;
      (calendar.getEvents as jest.Mock).mockResolvedValue([
        {
          id: 'past-evt-1', subject: 'Meeting',
          start: { dateTime: '2026-01-10T10:00:00Z' }, end: { dateTime: '2026-01-10T11:00:00Z' },
          attendees: [
            { emailAddress: { name: 'Siva Kumar', address: 'siva@example.com' }, type: 'required' },
          ],
        },
      ]);

      const result = await executeTool('search_people', { query: 'Siva' }, ctx);

      // Same email from both sources — should be deduped to 1 result, Slack wins (appears first)
      const sivaResults = result.results.filter((r: any) => r.email === 'siva@example.com');
      expect(sivaResults.length).toBe(1);
      expect(sivaResults[0].source).toBe('slack');
    });

    test('deduplicates calendar history results by email', async () => {
      const ctx = makeContext();
      const calendar = ctx.providers.get('google')!.calendar!;

      // Return multiple events with the same attendee
      (calendar.getEvents as jest.Mock).mockResolvedValue([
        {
          id: 'evt-1', subject: 'Meeting 1',
          start: { dateTime: '2026-02-17T10:00:00Z' }, end: { dateTime: '2026-02-17T11:00:00Z' },
          attendees: [{ emailAddress: { name: 'Siva Kumar', address: 'siva@example.com' }, type: 'required' }],
        },
        {
          id: 'evt-2', subject: 'Meeting 2',
          start: { dateTime: '2026-02-18T10:00:00Z' }, end: { dateTime: '2026-02-18T11:00:00Z' },
          attendees: [{ emailAddress: { name: 'Siva Kumar', address: 'siva@example.com' }, type: 'required' }],
        },
      ]);

      const result = await executeTool('search_people', { query: 'Siva' }, ctx);

      // Should be deduplicated to 1 result
      expect(result.results.length).toBe(1);
      expect(result.results[0].email).toBe('siva@example.com');
    });

    test('handles calendar history search failure gracefully', async () => {
      const ctx = makeContext();
      const calendar = ctx.providers.get('google')!.calendar!;
      (calendar.getEvents as jest.Mock).mockRejectedValue(new Error('API timeout'));

      const result = await executeTool('search_people', { query: 'Unknown' }, ctx);

      // Should return empty results without throwing
      expect(result.results).toEqual([]);
    });
  });

  describe('search_people title matching and self-exclusion', () => {
    test('title match finds attendee when name/email do not match (Rushi/Siva scenario)', async () => {
      const ctx = makeContext();
      const calendar = ctx.providers.get('google')!.calendar!;

      // pachasx2@gmail.com has no "siva" in name or email, but the meeting title contains "Siva"
      (calendar.getEvents as jest.Mock).mockResolvedValue([
        {
          id: 'past-evt-title',
          subject: 'Rushi/Siva',
          start: { dateTime: '2026-02-17T10:00:00Z' },
          end: { dateTime: '2026-02-17T11:00:00Z' },
          attendees: [
            { emailAddress: { name: 'Rushi Patel', address: 'rushi@example.com' }, type: 'required' },
            { emailAddress: { name: '', address: 'pachasx2@gmail.com' }, type: 'required' },
          ],
        },
      ]);

      const result = await executeTool('search_people', { query: 'Siva' }, ctx);

      // Should find pachasx2@gmail.com via title match (name/email don't contain "siva")
      const emails = result.results.map((r: any) => r.email);
      expect(emails).toContain('pachasx2@gmail.com');
      // The title-match result should have source calendar_history_title_match
      const titleResult = result.results.find((r: any) => r.email === 'pachasx2@gmail.com');
      expect(titleResult.source).toBe('calendar_history_title_match');
    });

    test('self-exclusion: user own email never returned from calendar history or title match', async () => {
      const ctx = makeContext(); // user email is test@example.com
      const calendar = ctx.providers.get('google')!.calendar!;

      (calendar.getEvents as jest.Mock).mockResolvedValue([
        {
          id: 'evt-self',
          subject: 'Test Meeting',
          start: { dateTime: '2026-02-17T10:00:00Z' },
          end: { dateTime: '2026-02-17T11:00:00Z' },
          attendees: [
            { emailAddress: { name: 'Test User', address: 'test@example.com' }, type: 'required' },
            { emailAddress: { name: 'Other Person', address: 'other@example.com' }, type: 'required' },
          ],
        },
      ]);

      const result = await executeTool('search_people', { query: 'Test' }, ctx);

      // User's own email should be excluded
      const emails = result.results.map((r: any) => r.email);
      expect(emails).not.toContain('test@example.com');
      // Other attendee should still be found
      expect(emails).toContain('other@example.com');
    });

    test('large meeting skipped for title matching (>5 attendees)', async () => {
      const ctx = makeContext();
      const calendar = ctx.providers.get('google')!.calendar!;

      const manyAttendees = Array.from({ length: 8 }, (_, i) => ({
        emailAddress: { name: `Person ${i}`, address: `person${i}@example.com` },
        type: 'required',
      }));

      (calendar.getEvents as jest.Mock).mockResolvedValue([
        {
          id: 'big-meeting',
          subject: 'Siva Team Standup',
          start: { dateTime: '2026-02-17T10:00:00Z' },
          end: { dateTime: '2026-02-17T11:00:00Z' },
          attendees: manyAttendees,
        },
      ]);

      const result = await executeTool('search_people', { query: 'Siva' }, ctx);

      // No results — name/email don't match "Siva", and title match is skipped for >5 attendees
      expect(result.results.length).toBe(0);
    });

    test('searchSummary is present in result', async () => {
      const ctx = makeContext();
      const result = await executeTool('search_people', { query: 'Nobody' }, ctx);

      expect(result.searchSummary).toBeDefined();
      expect(typeof result.searchSummary).toBe('string');
      expect(result.searchSummary).toContain('Searched:');
      expect(result.searchSummary).toContain('calendar history');
    });

    test('direct name match wins dedup over title match for same email', async () => {
      const ctx = makeContext();
      const calendar = ctx.providers.get('google')!.calendar!;

      (calendar.getEvents as jest.Mock).mockResolvedValue([
        {
          id: 'evt-name-match',
          subject: 'Regular Meeting',
          start: { dateTime: '2026-02-17T10:00:00Z' },
          end: { dateTime: '2026-02-17T11:00:00Z' },
          attendees: [
            { emailAddress: { name: 'Siva Kumar', address: 'siva@example.com' }, type: 'required' },
          ],
        },
        {
          id: 'evt-title-match',
          subject: 'Rushi/Siva',
          start: { dateTime: '2026-02-18T10:00:00Z' },
          end: { dateTime: '2026-02-18T11:00:00Z' },
          attendees: [
            { emailAddress: { name: 'Siva Kumar', address: 'siva@example.com' }, type: 'required' },
          ],
        },
      ]);

      const result = await executeTool('search_people', { query: 'Siva' }, ctx);

      // Name match runs first, so dedup should prefer calendar_history over calendar_history_title_match
      const sivaResults = result.results.filter((r: any) => r.email === 'siva@example.com');
      expect(sivaResults.length).toBe(1);
      expect(sivaResults[0].source).toBe('calendar_history');
    });
  });

  describe('meeting limit enforcement', () => {
    test('blocks create when free plan limit reached', async () => {
      const ctx = makeContext({ userType: 'member' });
      (repository.getWorkspacePlan as jest.Mock).mockResolvedValue('free');
      (repository.getMonthlyUsage as jest.Mock).mockResolvedValue({ meetingsCreated: 10 });

      const result = await executeTool('create_meeting', {
        subject: 'Over Limit', startTime: '2026-03-02T09:00:00', endTime: '2026-03-02T10:00:00',
      }, ctx);

      expect(result.success).toBe(false);
      expect(result.error).toContain('free plan limit');
    });

    test('allows create for developer users regardless of limits', async () => {
      const ctx = makeContext({ userType: 'developer' });
      const result = await executeTool('create_meeting', {
        subject: 'Dev Meeting', startTime: '2026-03-02T09:00:00', endTime: '2026-03-02T10:00:00',
      }, ctx);
      expect(result.success).toBe(true);
    });
  });
});
