import { buildSystemPrompt, AGENT_CONFIG, DynamicPromptContext } from '../agent/config';

describe('Agent Config', () => {
  describe('AGENT_CONFIG', () => {
    test('uses Haiku 4.5 model', () => {
      expect(AGENT_CONFIG.model).toBe('claude-haiku-4-5-20251001');
    });

    test('max tokens is reasonable', () => {
      expect(AGENT_CONFIG.maxTokens).toBe(4096);
      expect(AGENT_CONFIG.maxTokens).toBeGreaterThan(0);
      expect(AGENT_CONFIG.maxTokens).toBeLessThanOrEqual(8192);
    });

    test('session timeout is 30 minutes', () => {
      expect(AGENT_CONFIG.sessionTimeoutMinutes).toBe(30);
    });

    test('conversation length is capped', () => {
      expect(AGENT_CONFIG.maxConversationLength).toBe(20);
    });
  });

  describe('buildSystemPrompt', () => {
    const baseCtx: DynamicPromptContext = {
      userName: 'Rushi Patel',
      userEmail: 'rushi@test.com',
      userTimezone: 'America/Chicago',
      currentTime: '09:30 AM CST',
      currentDate: '2026-03-02',
      dayOfWeek: 'Monday',
      connectedProviders: ['google'],
      todayEvents: [],
      weekEventCount: 5,
      upcomingConflicts: [],
      freeTimeToday: [],
    };

    test('includes user first name', () => {
      const prompt = buildSystemPrompt(baseCtx);
      expect(prompt).toContain('Rushi');
    });

    test('includes timezone', () => {
      const prompt = buildSystemPrompt(baseCtx);
      expect(prompt).toContain('America/Chicago');
    });

    test('includes connected providers', () => {
      const prompt = buildSystemPrompt(baseCtx);
      expect(prompt).toContain('google');
    });

    test('includes current date and time', () => {
      const prompt = buildSystemPrompt(baseCtx);
      expect(prompt).toContain('09:30 AM CST');
      expect(prompt).toContain('2026-03-02');
      expect(prompt).toContain('Monday');
    });

    test('includes attendee resolution protocol', () => {
      const prompt = buildSystemPrompt(baseCtx);
      expect(prompt).toContain('ATTENDEE RESOLUTION');
      expect(prompt).toContain('search_people');
      expect(prompt).toContain('resolve_slack_user');
    });

    test('includes no-Z-suffix rule', () => {
      const prompt = buildSystemPrompt(baseCtx);
      expect(prompt).toContain('NEVER append "Z"');
    });

    test('includes focus time instructions', () => {
      const prompt = buildSystemPrompt(baseCtx);
      expect(prompt).toContain('FOCUS TIME');
      expect(prompt).toContain('create_focus_time');
      expect(prompt).toContain('[Caleo Focus]');
    });

    test('includes meeting impact instructions', () => {
      const prompt = buildSystemPrompt(baseCtx);
      expect(prompt).toContain('MEETING IMPACT');
      expect(prompt).toContain('tradeoff');
    });

    test('includes recurring meeting instructions', () => {
      const prompt = buildSystemPrompt(baseCtx);
      expect(prompt).toContain('RECURRING MEETINGS');
      expect(prompt).toContain('RRULE');
    });

    test('includes undo instructions', () => {
      const prompt = buildSystemPrompt(baseCtx);
      expect(prompt).toContain('UNDO');
      expect(prompt).toContain('undo_last_change');
      expect(prompt).toContain('10 minutes');
    });

    test('includes events when provided', () => {
      const ctx = {
        ...baseCtx,
        todayEvents: [{
          id: 'evt-1',
          subject: 'Team Standup',
          start: '9:00 AM',
          end: '9:30 AM',
          attendeeCount: 5,
          hasVideoLink: true,
        }],
      };
      const prompt = buildSystemPrompt(ctx);
      expect(prompt).toContain('Team Standup');
      expect(prompt).toContain('[video]');
    });

    test('shows no events message when empty', () => {
      const prompt = buildSystemPrompt(baseCtx);
      expect(prompt).toContain('No events today');
    });

    test('includes conflicts when present', () => {
      const ctx = {
        ...baseCtx,
        upcomingConflicts: ['Meeting A overlaps with Meeting B'],
      };
      const prompt = buildSystemPrompt(ctx);
      expect(prompt).toContain('CONFLICTS DETECTED');
      expect(prompt).toContain('Meeting A overlaps with Meeting B');
    });

    test('includes free time when present', () => {
      const ctx = {
        ...baseCtx,
        freeTimeToday: ['10:00 AM - 12:00 PM (2h)'],
      };
      const prompt = buildSystemPrompt(ctx);
      expect(prompt).toContain('FREE TIME TODAY');
    });

    test('includes preferences', () => {
      const ctx = {
        ...baseCtx,
        preferences: {
          workHoursStart: '08:00',
          workHoursEnd: '18:00',
          defaultDurationMinutes: 45,
          bufferMinutes: 10,
          preferredProvider: 'google',
        },
      };
      const prompt = buildSystemPrompt(ctx);
      expect(prompt).toContain('08:00');
      expect(prompt).toContain('18:00');
      expect(prompt).toContain('45 minutes');
      expect(prompt).toContain('10 minutes');
    });

    test('includes low balance warning', () => {
      const ctx = {
        ...baseCtx,
        billingContext: { balanceCents: 25, isLow: true },
      };
      const prompt = buildSystemPrompt(ctx);
      expect(prompt).toContain('BILLING NOTE');
      expect(prompt).toContain('low');
    });

    test('no billing note when balance is fine', () => {
      const ctx = {
        ...baseCtx,
        billingContext: { balanceCents: 500, isLow: false },
      };
      const prompt = buildSystemPrompt(ctx);
      expect(prompt).not.toContain('BILLING NOTE');
    });

    test('includes multi-day events', () => {
      const ctx = {
        ...baseCtx,
        multiDayEvents: [
          {
            dateStr: '2026-03-01',
            label: 'yesterday',
            events: [{ id: '1', subject: 'Yesterday Meeting', start: '9 AM', end: '10 AM', attendeeCount: 2, hasVideoLink: false }],
          },
          {
            dateStr: '2026-03-02',
            label: 'today',
            events: [],
          },
        ],
      };
      const prompt = buildSystemPrompt(ctx);
      expect(prompt).toContain('CALENDAR CONTEXT');
      expect(prompt).toContain('Yesterday Meeting');
      expect(prompt).toContain('do NOT re-fetch');
    });

    test('includes Slack thread URL when present', () => {
      const ctx = {
        ...baseCtx,
        slackThreadUrl: 'https://slack.com/archives/C123/p1234567890123456',
      };
      const prompt = buildSystemPrompt(ctx);
      expect(prompt).toContain('https://slack.com/archives/C123/p1234567890123456');
    });

    test('prompt is not excessively long (cost control)', () => {
      const prompt = buildSystemPrompt(baseCtx);
      // Base prompt grew with Focus Time, Impact Scoring, Recurring, Undo sections
      // Should still stay under ~7500 chars to keep input tokens reasonable
      expect(prompt.length).toBeLessThan(7500);
    });

    test('heavy week message for >15 events', () => {
      const ctx = { ...baseCtx, weekEventCount: 20 };
      const prompt = buildSystemPrompt(ctx);
      expect(prompt).toContain('a lot of');
    });
  });
});
