import { GoogleCalendarProvider } from '../calendar/google/provider';

const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

describe('GoogleCalendarProvider', () => {
  let provider: GoogleCalendarProvider;
  const accessToken = 'test-google-token';

  beforeEach(() => {
    provider = new GoogleCalendarProvider();
    mockFetch.mockReset();
  });

  describe('createEvent', () => {
    test('maps subject to summary', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'g-evt-1', summary: 'Test',
          start: { dateTime: '2026-03-02T09:00:00-06:00', timeZone: 'America/Chicago' },
          end: { dateTime: '2026-03-02T10:00:00-06:00', timeZone: 'America/Chicago' },
        }),
      });

      await provider.createEvent(accessToken, {
        subject: 'Test',
        start: '2026-03-02T09:00:00',
        end: '2026-03-02T10:00:00',
        timezone: 'America/Chicago',
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.summary).toBe('Test');
    });

    test('includes attendees as email objects', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'g-evt-1', summary: 'Test',
          start: { dateTime: '2026-03-02T09:00:00' },
          end: { dateTime: '2026-03-02T10:00:00' },
        }),
      });

      await provider.createEvent(accessToken, {
        subject: 'Test', start: '2026-03-02T09:00:00', end: '2026-03-02T10:00:00',
        attendees: ['alice@test.com'],
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.attendees).toEqual([{ email: 'alice@test.com' }]);
    });

    test('includes recurrence as RRULE array', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'g-evt-1', summary: 'Weekly',
          start: { dateTime: '2026-03-02T09:00:00' },
          end: { dateTime: '2026-03-02T10:00:00' },
        }),
      });

      await provider.createEvent(accessToken, {
        subject: 'Weekly', start: '2026-03-02T09:00:00', end: '2026-03-02T10:00:00',
        recurrence: 'RRULE:FREQ=WEEKLY;COUNT=5',
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.recurrence).toEqual(['RRULE:FREQ=WEEKLY;COUNT=5']);
    });

    test('creates Google Meet conference when isOnlineMeeting=true', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'g-evt-1', summary: 'Test',
          start: { dateTime: '2026-03-02T09:00:00' },
          end: { dateTime: '2026-03-02T10:00:00' },
        }),
      });

      await provider.createEvent(accessToken, {
        subject: 'Test', start: '2026-03-02T09:00:00', end: '2026-03-02T10:00:00',
        isOnlineMeeting: true,
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.conferenceData).toBeDefined();
      expect(body.conferenceData.createRequest.conferenceSolutionKey.type).toBe('hangoutsMeet');

      // URL should include conferenceDataVersion=1
      expect(mockFetch.mock.calls[0][0]).toContain('conferenceDataVersion=1');
    });

    test('sends updates to all attendees', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'g-evt-1', summary: 'Test',
          start: { dateTime: '2026-03-02T09:00:00' },
          end: { dateTime: '2026-03-02T10:00:00' },
        }),
      });

      await provider.createEvent(accessToken, {
        subject: 'Test', start: '2026-03-02T09:00:00', end: '2026-03-02T10:00:00',
      });

      expect(mockFetch.mock.calls[0][0]).toContain('sendUpdates=all');
    });

    test('no recurrence when not specified', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'g-evt-1', summary: 'One-time',
          start: { dateTime: '2026-03-02T09:00:00' },
          end: { dateTime: '2026-03-02T10:00:00' },
        }),
      });

      await provider.createEvent(accessToken, {
        subject: 'One-time', start: '2026-03-02T09:00:00', end: '2026-03-02T10:00:00',
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.recurrence).toBeUndefined();
    });
  });

  describe('deleteEvent', () => {
    test('calls DELETE with correct event ID', async () => {
      mockFetch.mockResolvedValue({ ok: true, status: 204 });

      await provider.deleteEvent(accessToken, 'evt-to-delete');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toContain('evt-to-delete');
      expect(opts.method).toBe('DELETE');
    });

    test('URL-encodes event ID', async () => {
      mockFetch.mockResolvedValue({ ok: true, status: 204 });

      await provider.deleteEvent(accessToken, 'evt/with/slashes');

      expect(mockFetch.mock.calls[0][0]).toContain('evt%2Fwith%2Fslashes');
    });
  });

  describe('mapEvent', () => {
    test('maps Google event to CalendarEvent format', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          items: [{
            id: 'g-1',
            summary: 'Google Meet',
            start: { dateTime: '2026-03-02T09:00:00-06:00', timeZone: 'America/Chicago' },
            end: { dateTime: '2026-03-02T10:00:00-06:00', timeZone: 'America/Chicago' },
            attendees: [
              { email: 'alice@test.com', displayName: 'Alice', organizer: true },
              { email: 'bob@test.com', displayName: 'Bob', optional: true },
            ],
            location: 'Room A',
            description: 'Weekly sync',
            htmlLink: 'https://calendar.google.com/event?id=g-1',
            hangoutLink: 'https://meet.google.com/abc-defg-hij',
          }],
        }),
      });

      const events = await provider.getEvents(accessToken, new Date('2026-03-02'), new Date('2026-03-03'));
      expect(events).toHaveLength(1);
      expect(events[0].subject).toBe('Google Meet');
      expect(events[0].attendees?.[0].type).toBe('organizer');
      expect(events[0].attendees?.[1].type).toBe('optional');
      expect(events[0].onlineMeetingUrl).toBe('https://meet.google.com/abc-defg-hij');
      expect(events[0].webLink).toBe('https://calendar.google.com/event?id=g-1');
      expect(events[0].location?.displayName).toBe('Room A');
    });

    test('handles event with no title', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          items: [{
            id: 'g-2',
            start: { dateTime: '2026-03-02T09:00:00' },
            end: { dateTime: '2026-03-02T10:00:00' },
          }],
        }),
      });

      const events = await provider.getEvents(accessToken, new Date('2026-03-02'), new Date('2026-03-03'));
      expect(events[0].subject).toBe('No Title');
    });
  });

  describe('checkAvailability', () => {
    test('uses freeBusy API', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          calendars: {
            primary: { busy: [] },
            'alice@test.com': { busy: [{ start: '2026-03-02T10:00:00Z', end: '2026-03-02T11:00:00Z' }] },
          },
        }),
      });

      const result = await provider.checkAvailability(
        accessToken,
        new Date('2026-03-02T09:00:00Z'),
        new Date('2026-03-02T17:00:00Z'),
        ['alice@test.com']
      );

      expect(result.available).toBe(false);
      expect(result.conflicts).toHaveLength(1);
      expect(result.attendees).toHaveLength(1);
      expect(result.attendees?.[0].email).toBe('alice@test.com');
      expect(result.attendees?.[0].available).toBe(false);
    });

    test('falls back to event-based check when freeBusy fails', async () => {
      // First call (freeBusy) fails, second call (getEvents) succeeds
      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 403, text: async () => 'Forbidden' })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            items: [{
              id: 'e1', summary: 'Busy',
              start: { dateTime: '2026-03-02T10:00:00Z' },
              end: { dateTime: '2026-03-02T11:00:00Z' },
            }],
          }),
        });

      const result = await provider.checkAvailability(
        accessToken,
        new Date('2026-03-02T09:00:00Z'),
        new Date('2026-03-02T17:00:00Z')
      );

      expect(result.conflicts).toHaveLength(1);
    });
  });
});
