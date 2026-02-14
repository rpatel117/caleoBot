import {
  CalendarProvider, CalendarEvent, CreateEventParams, UpdateEventParams,
  AvailabilityResult, FreeTimeParams, TimeSlot,
} from '../types';

const BASE_URL = 'https://www.googleapis.com/calendar/v3';

export class GoogleCalendarProvider implements CalendarProvider {
  async getEvents(accessToken: string, start: Date, end: Date): Promise<CalendarEvent[]> {
    const params = new URLSearchParams({
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      singleEvents: 'true',
      orderBy: 'startTime',
    });

    const response = await fetch(`${BASE_URL}/calendars/primary/events?${params}`, {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Google Calendar API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json() as any;
    return (data.items || []).map((item: any) => this.mapEvent(item));
  }

  async createEvent(accessToken: string, params: CreateEventParams): Promise<CalendarEvent> {
    const body: any = {
      summary: params.subject,
      start: {
        dateTime: params.start.toISOString(),
        timeZone: params.timezone || 'UTC',
      },
      end: {
        dateTime: params.end.toISOString(),
        timeZone: params.timezone || 'UTC',
      },
    };

    if (params.attendees?.length) {
      body.attendees = params.attendees.map(email => ({ email }));
    }

    if (params.location) {
      body.location = params.location;
    }

    if (params.body) {
      body.description = params.body;
    }

    if (params.isOnlineMeeting) {
      body.conferenceData = {
        createRequest: {
          requestId: `caleo-${Date.now()}`,
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      };
    }

    const url = params.isOnlineMeeting
      ? `${BASE_URL}/calendars/primary/events?conferenceDataVersion=1`
      : `${BASE_URL}/calendars/primary/events`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Google Calendar API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json() as any;
    return this.mapEvent(data);
  }

  async updateEvent(accessToken: string, eventId: string, updates: UpdateEventParams): Promise<CalendarEvent> {
    const body: any = {};

    if (updates.subject) body.summary = updates.subject;
    if (updates.start) {
      body.start = { dateTime: updates.start.toISOString(), timeZone: 'UTC' };
    }
    if (updates.end) {
      body.end = { dateTime: updates.end.toISOString(), timeZone: 'UTC' };
    }
    if (updates.attendees) {
      body.attendees = updates.attendees.map(email => ({ email }));
    }
    if (updates.location) {
      body.location = updates.location;
    }
    if (updates.body) {
      body.description = updates.body;
    }

    const response = await fetch(`${BASE_URL}/calendars/primary/events/${eventId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Google Calendar API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json() as any;
    return this.mapEvent(data);
  }

  async deleteEvent(accessToken: string, eventId: string): Promise<void> {
    const response = await fetch(`${BASE_URL}/calendars/primary/events/${eventId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });

    if (!response.ok && response.status !== 204) {
      const errorText = await response.text();
      throw new Error(`Google Calendar API error: ${response.status} - ${errorText}`);
    }
  }

  async checkAvailability(accessToken: string, start: Date, end: Date, attendees?: string[]): Promise<AvailabilityResult> {
    // Use freeBusy API for proper availability checking
    const body = {
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      items: [{ id: 'primary' }],
    };

    if (attendees?.length) {
      (body.items as any[]).push(...attendees.map(email => ({ id: email })));
    }

    const response = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      // Fallback to event-based availability check
      const events = await this.getEvents(accessToken, start, end);
      const conflicts = events.map(e => ({
        subject: e.subject,
        start: e.start.dateTime,
        end: e.end.dateTime,
      }));
      return { available: conflicts.length === 0, conflicts };
    }

    const data = await response.json() as any;
    const calendars = data.calendars || {};
    const conflicts: Array<{ subject: string; start: string; end: string }> = [];

    for (const calId of Object.keys(calendars)) {
      const busy = calendars[calId]?.busy || [];
      for (const period of busy) {
        conflicts.push({
          subject: calId === 'primary' ? 'Busy' : `Busy (${calId})`,
          start: period.start,
          end: period.end,
        });
      }
    }

    return { available: conflicts.length === 0, conflicts };
  }

  findFreeTime(accessToken: string, events: CalendarEvent[], params: FreeTimeParams): TimeSlot[] {
    const slots: TimeSlot[] = [];
    const startDate = new Date(params.startDate);
    const endDate = new Date(params.endDate);
    const durationMs = params.duration * 60 * 1000;
    const workStart = params.workingHours?.start || '09:00';
    const workEnd = params.workingHours?.end || '17:00';

    const busyPeriods = events.map(e => ({
      start: new Date(e.start.dateTime).getTime(),
      end: new Date(e.end.dateTime).getTime(),
    })).sort((a, b) => a.start - b.start);

    const current = new Date(startDate);
    while (current < endDate) {
      if (current.getDay() === 0 || current.getDay() === 6) {
        current.setDate(current.getDate() + 1);
        current.setHours(0, 0, 0, 0);
        continue;
      }

      const [startH, startM] = workStart.split(':').map(Number);
      const [endH, endM] = workEnd.split(':').map(Number);

      const dayStart = new Date(current);
      dayStart.setHours(startH, startM, 0, 0);
      const dayEnd = new Date(current);
      dayEnd.setHours(endH, endM, 0, 0);

      let slotStart = dayStart.getTime();

      while (slotStart + durationMs <= dayEnd.getTime()) {
        const slotEnd = slotStart + durationMs;
        const hasConflict = busyPeriods.some(
          busy => busy.start < slotEnd && busy.end > slotStart
        );

        if (!hasConflict) {
          slots.push({
            start: new Date(slotStart).toISOString(),
            end: new Date(slotEnd).toISOString(),
          });
          if (slots.length >= 5) return slots;
        }

        slotStart += 30 * 60 * 1000;
      }

      current.setDate(current.getDate() + 1);
      current.setHours(0, 0, 0, 0);
    }

    return slots;
  }

  private mapEvent(raw: any): CalendarEvent {
    return {
      id: raw.id,
      subject: raw.summary || 'No Title',
      start: {
        dateTime: raw.start?.dateTime || raw.start?.date || '',
        timeZone: raw.start?.timeZone || 'UTC',
      },
      end: {
        dateTime: raw.end?.dateTime || raw.end?.date || '',
        timeZone: raw.end?.timeZone || 'UTC',
      },
      attendees: raw.attendees?.map((a: any) => ({
        emailAddress: {
          name: a.displayName || a.email || '',
          address: a.email || '',
        },
        type: a.organizer ? 'organizer' : (a.optional ? 'optional' : 'required'),
      })),
      location: raw.location ? { displayName: raw.location } : undefined,
      body: raw.description ? { content: raw.description } : undefined,
      webLink: raw.htmlLink,
      onlineMeetingUrl: raw.hangoutLink || raw.conferenceData?.entryPoints?.[0]?.uri,
    };
  }
}
