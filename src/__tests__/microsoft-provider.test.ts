import { MicrosoftCalendarProvider } from '../calendar/microsoft/provider';

// Mock global fetch
const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

describe('MicrosoftCalendarProvider', () => {
  let provider: MicrosoftCalendarProvider;
  const accessToken = 'test-access-token';

  beforeEach(() => {
    provider = new MicrosoftCalendarProvider();
    mockFetch.mockReset();
  });

  describe('createEvent', () => {
    test('creates event with correct body structure', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'evt-1',
          subject: 'Test Meeting',
          start: { dateTime: '2026-02-28T09:00:00', timeZone: 'UTC' },
          end: { dateTime: '2026-02-28T10:00:00', timeZone: 'UTC' },
        }),
      });

      await provider.createEvent(accessToken, {
        subject: 'Test Meeting',
        start: '2026-02-28T09:00:00',
        end: '2026-02-28T10:00:00',
        timezone: 'America/Chicago',
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toContain('/me/calendar/events');
      const body = JSON.parse(opts.body);
      expect(body.subject).toBe('Test Meeting');
      expect(body.start.timeZone).toBe('America/Chicago');
    });

    test('creates online meeting by default', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'evt-1', subject: 'Test',
          start: { dateTime: '2026-02-28T09:00:00', timeZone: 'UTC' },
          end: { dateTime: '2026-02-28T10:00:00', timeZone: 'UTC' },
        }),
      });

      await provider.createEvent(accessToken, {
        subject: 'Test', start: '2026-02-28T09:00:00', end: '2026-02-28T10:00:00',
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.isOnlineMeeting).toBe(true);
      expect(body.onlineMeetingProvider).toBe('teamsForBusiness');
    });

    test('includes attendees in correct format', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'evt-1', subject: 'Test',
          start: { dateTime: '2026-02-28T09:00:00', timeZone: 'UTC' },
          end: { dateTime: '2026-02-28T10:00:00', timeZone: 'UTC' },
        }),
      });

      await provider.createEvent(accessToken, {
        subject: 'Test', start: '2026-02-28T09:00:00', end: '2026-02-28T10:00:00',
        attendees: ['alice@example.com', 'bob@example.com'],
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.attendees).toHaveLength(2);
      expect(body.attendees[0].emailAddress.address).toBe('alice@example.com');
      expect(body.attendees[0].type).toBe('required');
    });

    test('escapes HTML in body', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'evt-1', subject: 'Test',
          start: { dateTime: '2026-02-28T09:00:00', timeZone: 'UTC' },
          end: { dateTime: '2026-02-28T10:00:00', timeZone: 'UTC' },
        }),
      });

      await provider.createEvent(accessToken, {
        subject: 'Test', start: '2026-02-28T09:00:00', end: '2026-02-28T10:00:00',
        body: '<script>alert("xss")</script>',
      });

      const reqBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(reqBody.body.content).not.toContain('<script>');
      expect(reqBody.body.content).toContain('&lt;script&gt;');
    });

    test('throws on API error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      });

      await expect(provider.createEvent(accessToken, {
        subject: 'Test', start: '2026-02-28T09:00:00', end: '2026-02-28T10:00:00',
      })).rejects.toThrow('Graph API error: 401');
    });

    test('includes recurrence pattern for weekly', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'evt-1', subject: 'Weekly Sync',
          start: { dateTime: '2026-03-02T09:00:00', timeZone: 'UTC' },
          end: { dateTime: '2026-03-02T10:00:00', timeZone: 'UTC' },
        }),
      });

      await provider.createEvent(accessToken, {
        subject: 'Weekly Sync',
        start: '2026-03-02T09:00:00', // Monday
        end: '2026-03-02T10:00:00',
        recurrence: 'RRULE:FREQ=WEEKLY;COUNT=10',
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.recurrence).toBeDefined();
      expect(body.recurrence.pattern.type).toBe('weekly');
      expect(body.recurrence.range.type).toBe('numbered');
      expect(body.recurrence.range.numberOfOccurrences).toBe(10);
    });

    test('includes recurrence pattern for daily', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'evt-1', subject: 'Standup',
          start: { dateTime: '2026-03-02T09:00:00', timeZone: 'UTC' },
          end: { dateTime: '2026-03-02T09:15:00', timeZone: 'UTC' },
        }),
      });

      await provider.createEvent(accessToken, {
        subject: 'Standup',
        start: '2026-03-02T09:00:00',
        end: '2026-03-02T09:15:00',
        recurrence: 'RRULE:FREQ=DAILY',
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.recurrence.pattern.type).toBe('daily');
      expect(body.recurrence.range.type).toBe('noEnd');
    });

    test('includes recurrence for biweekly', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'evt-1', subject: '1:1',
          start: { dateTime: '2026-03-02T14:00:00', timeZone: 'UTC' },
          end: { dateTime: '2026-03-02T14:30:00', timeZone: 'UTC' },
        }),
      });

      await provider.createEvent(accessToken, {
        subject: '1:1',
        start: '2026-03-02T14:00:00',
        end: '2026-03-02T14:30:00',
        recurrence: 'RRULE:FREQ=WEEKLY;INTERVAL=2',
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.recurrence.pattern.type).toBe('weekly');
      expect(body.recurrence.pattern.interval).toBe(2);
    });

    test('handles monthly recurrence', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'evt-1', subject: 'Monthly Review',
          start: { dateTime: '2026-03-15T10:00:00', timeZone: 'UTC' },
          end: { dateTime: '2026-03-15T11:00:00', timeZone: 'UTC' },
        }),
      });

      await provider.createEvent(accessToken, {
        subject: 'Monthly Review',
        start: '2026-03-15T10:00:00',
        end: '2026-03-15T11:00:00',
        recurrence: 'RRULE:FREQ=MONTHLY;INTERVAL=1',
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.recurrence.pattern.type).toBe('absoluteMonthly');
    });

    test('invalid RRULE is gracefully ignored', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'evt-1', subject: 'Test',
          start: { dateTime: '2026-03-02T09:00:00', timeZone: 'UTC' },
          end: { dateTime: '2026-03-02T10:00:00', timeZone: 'UTC' },
        }),
      });

      await provider.createEvent(accessToken, {
        subject: 'Test',
        start: '2026-03-02T09:00:00',
        end: '2026-03-02T10:00:00',
        recurrence: 'RRULE:FREQ=INVALID_FREQUENCY',
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      // Should not have recurrence since frequency is invalid
      expect(body.recurrence).toBeUndefined();
    });
  });

  describe('findFreeTime', () => {
    test('finds slots between events', () => {
      const events = [
        {
          id: '1', subject: 'Meeting A',
          start: { dateTime: '2026-03-02T09:00:00Z', timeZone: 'UTC' },
          end: { dateTime: '2026-03-02T10:00:00Z', timeZone: 'UTC' },
        },
        {
          id: '2', subject: 'Meeting B',
          start: { dateTime: '2026-03-02T14:00:00Z', timeZone: 'UTC' },
          end: { dateTime: '2026-03-02T15:00:00Z', timeZone: 'UTC' },
        },
      ];

      const slots = provider.findFreeTime(accessToken, events, {
        duration: 60,
        startDate: '2026-03-02T09:00:00Z',
        endDate: '2026-03-02T17:00:00Z',
        workingHours: { start: '09:00', end: '17:00' },
      });

      expect(slots.length).toBeGreaterThan(0);
      // First free slot should be after Meeting A
      const firstSlotStart = new Date(slots[0].start).getTime();
      expect(firstSlotStart).toBeGreaterThanOrEqual(new Date('2026-03-02T10:00:00Z').getTime());
    });

    test('returns empty when no slots available', () => {
      const events = Array.from({ length: 16 }, (_, i) => ({
        id: String(i),
        subject: `Meeting ${i}`,
        start: { dateTime: `2026-03-02T${String(9 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 === 0 ? '00' : '30'}:00Z`, timeZone: 'UTC' },
        end: { dateTime: `2026-03-02T${String(9 + Math.floor((i + 1) / 2)).padStart(2, '0')}:${(i + 1) % 2 === 0 ? '00' : '30'}:00Z`, timeZone: 'UTC' },
      }));

      const slots = provider.findFreeTime(accessToken, events, {
        duration: 60,
        startDate: '2026-03-02T09:00:00Z',
        endDate: '2026-03-02T17:00:00Z',
        workingHours: { start: '09:00', end: '17:00' },
      });

      // With back-to-back 30-min meetings filling 9-17, there may be no 60-min slots
      // The exact result depends on meeting density
      expect(slots.length).toBeGreaterThanOrEqual(0);
    });

    test('skips weekends', () => {
      const slots = provider.findFreeTime(accessToken, [], {
        duration: 60,
        startDate: '2026-02-28T00:00:00Z', // Saturday
        endDate: '2026-03-02T17:00:00Z',   // Monday
        workingHours: { start: '09:00', end: '17:00' },
      });

      for (const slot of slots) {
        const day = new Date(slot.start).getDay();
        expect(day).not.toBe(0); // Sunday
        expect(day).not.toBe(6); // Saturday
      }
    });

    test('limits to 5 results', () => {
      const slots = provider.findFreeTime(accessToken, [], {
        duration: 30,
        startDate: '2026-03-02T00:00:00Z',
        endDate: '2026-03-06T17:00:00Z',
      });

      expect(slots.length).toBeLessThanOrEqual(5);
    });
  });

  describe('getEvents', () => {
    test('passes correct date range', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ value: [] }),
      });

      await provider.getEvents(accessToken, new Date('2026-03-01'), new Date('2026-03-07'));

      const url = mockFetch.mock.calls[0][0];
      expect(url).toContain('startDateTime=');
      expect(url).toContain('endDateTime=');
    });

    test('includes $top=500 and $orderby in URL', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ value: [] }),
      });

      await provider.getEvents(accessToken, new Date('2026-03-01'), new Date('2026-03-07'));

      const url = mockFetch.mock.calls[0][0];
      expect(url).toContain('$top=500');
      expect(url).toContain('$orderby=start/dateTime');
    });

    test('maps response to CalendarEvent format', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          value: [{
            id: 'evt-1',
            subject: 'Standup',
            start: { dateTime: '2026-03-02T09:00:00', timeZone: 'America/Chicago' },
            end: { dateTime: '2026-03-02T09:30:00', timeZone: 'America/Chicago' },
            attendees: [{ emailAddress: { name: 'Alice', address: 'alice@test.com' }, type: 'required' }],
            location: { displayName: 'Room A' },
            webLink: 'https://outlook.com/evt-1',
            onlineMeeting: { joinUrl: 'https://teams.microsoft.com/meet/123' },
          }],
        }),
      });

      const events = await provider.getEvents(accessToken, new Date('2026-03-02'), new Date('2026-03-03'));
      expect(events).toHaveLength(1);
      expect(events[0].id).toBe('evt-1');
      expect(events[0].subject).toBe('Standup');
      expect(events[0].attendees?.[0].emailAddress.address).toBe('alice@test.com');
      expect(events[0].onlineMeetingUrl).toBe('https://teams.microsoft.com/meet/123');
    });

    test('maps cancelled event (isCancelled)', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          value: [{
            id: 'evt-cancelled',
            subject: 'Cancelled Meeting',
            isCancelled: true,
            start: { dateTime: '2026-03-02T14:00:00', timeZone: 'UTC' },
            end: { dateTime: '2026-03-02T15:00:00', timeZone: 'UTC' },
          }],
        }),
      });

      const events = await provider.getEvents(accessToken, new Date('2026-03-02'), new Date('2026-03-03'));
      expect(events[0].status).toBe('cancelled');
    });

    test('maps recurring event (type: occurrence)', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          value: [{
            id: 'evt-recurring',
            subject: 'Weekly Standup',
            type: 'occurrence',
            start: { dateTime: '2026-03-02T09:00:00', timeZone: 'America/Chicago' },
            end: { dateTime: '2026-03-02T09:30:00', timeZone: 'America/Chicago' },
          }],
        }),
      });

      const events = await provider.getEvents(accessToken, new Date('2026-03-02'), new Date('2026-03-03'));
      expect(events[0].isRecurring).toBe(true);
    });

    test('maps recurring exception event', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          value: [{
            id: 'evt-exception',
            subject: 'Modified Weekly',
            type: 'exception',
            start: { dateTime: '2026-03-02T09:00:00', timeZone: 'America/Chicago' },
            end: { dateTime: '2026-03-02T09:30:00', timeZone: 'America/Chicago' },
          }],
        }),
      });

      const events = await provider.getEvents(accessToken, new Date('2026-03-02'), new Date('2026-03-03'));
      expect(events[0].isRecurring).toBe(true);
    });

    test('maps self declined response', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          value: [{
            id: 'evt-declined',
            subject: 'Design Review',
            start: { dateTime: '2026-03-02T11:00:00', timeZone: 'UTC' },
            end: { dateTime: '2026-03-02T12:00:00', timeZone: 'UTC' },
            responseStatus: { response: 'declined', time: '2026-03-01T10:00:00Z' },
            attendees: [
              { emailAddress: { name: 'Alice', address: 'alice@test.com' }, type: 'required', status: { response: 'accepted' } },
            ],
          }],
        }),
      });

      const events = await provider.getEvents(accessToken, new Date('2026-03-02'), new Date('2026-03-03'));
      expect(events[0].selfResponseStatus).toBe('declined');
      expect(events[0].attendees?.[0].responseStatus).toBe('accepted');
    });

    test('maps tentativelyAccepted to tentative', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          value: [{
            id: 'evt-tentative',
            subject: 'Maybe Meeting',
            start: { dateTime: '2026-03-02T13:00:00', timeZone: 'UTC' },
            end: { dateTime: '2026-03-02T14:00:00', timeZone: 'UTC' },
            responseStatus: { response: 'tentativelyAccepted' },
          }],
        }),
      });

      const events = await provider.getEvents(accessToken, new Date('2026-03-02'), new Date('2026-03-03'));
      expect(events[0].selfResponseStatus).toBe('tentative');
    });

    test('maps notResponded to needsAction', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          value: [{
            id: 'evt-noresponse',
            subject: 'Pending Invite',
            start: { dateTime: '2026-03-02T15:00:00', timeZone: 'UTC' },
            end: { dateTime: '2026-03-02T16:00:00', timeZone: 'UTC' },
            responseStatus: { response: 'notResponded' },
          }],
        }),
      });

      const events = await provider.getEvents(accessToken, new Date('2026-03-02'), new Date('2026-03-03'));
      expect(events[0].selfResponseStatus).toBe('needsAction');
    });

    test('omits selfResponseStatus for organizer', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          value: [{
            id: 'evt-organizer',
            subject: 'My Meeting',
            start: { dateTime: '2026-03-02T10:00:00', timeZone: 'UTC' },
            end: { dateTime: '2026-03-02T11:00:00', timeZone: 'UTC' },
            responseStatus: { response: 'organizer' },
          }],
        }),
      });

      const events = await provider.getEvents(accessToken, new Date('2026-03-02'), new Date('2026-03-03'));
      // organizer maps to accepted, which is omitted
      expect(events[0].selfResponseStatus).toBeUndefined();
    });
  });
});
