import {
  CalendarProvider, CalendarEvent, CreateEventParams, UpdateEventParams,
  AvailabilityResult, FreeTimeParams, TimeSlot, AttendeeAvailability,
  EventStatus, ResponseStatus,
} from '../types';
import { fetchWithRetry } from '../fetch-retry';

const BASE_URL = 'https://www.googleapis.com/calendar/v3';

export class GoogleCalendarProvider implements CalendarProvider {
  async getEvents(accessToken: string, start: Date, end: Date): Promise<CalendarEvent[]> {
    const params = new URLSearchParams({
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      singleEvents: 'true',
      orderBy: 'startTime',
      maxAttendees: '100',
    });

    const response = await fetchWithRetry(`${BASE_URL}/calendars/primary/events?${params}`, {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Google Calendar API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json() as any;
    const items = data.items || [];
    // Log first event's raw attendee data for debugging response status issues
    if (items.length > 0) {
      const sample = items[0];
      const selfAtt = sample.attendees?.find((a: any) => a.self === true);
      console.log(`[Google getEvents] ${items.length} events, sample: "${sample.summary}", status=${sample.status}, selfAttendee=${JSON.stringify(selfAtt || 'none')}`);
    }
    return items.map((item: any) => this.mapEvent(item));
  }

  async createEvent(accessToken: string, params: CreateEventParams): Promise<CalendarEvent> {
    const body: any = {
      summary: params.subject,
      start: {
        dateTime: params.start,
        timeZone: params.timezone || 'UTC',
      },
      end: {
        dateTime: params.end,
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

    if (params.recurrence) {
      body.recurrence = [params.recurrence];
    }

    if (params.isOnlineMeeting) {
      body.conferenceData = {
        createRequest: {
          requestId: `caleo-${Date.now()}`,
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      };
    }

    const queryParams = new URLSearchParams({ sendUpdates: 'all' });
    if (params.isOnlineMeeting) queryParams.set('conferenceDataVersion', '1');
    const url = `${BASE_URL}/calendars/primary/events?${queryParams}`;

    console.log(`[Google] Creating event "${params.subject}" with ${params.attendees?.length || 0} attendees: ${JSON.stringify(params.attendees)}`);

    const response = await fetchWithRetry(url, {
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
    console.log(`[Google] Event created: ${data.id}, attendees in response: ${data.attendees?.length || 0}`);
    return this.mapEvent(data);
  }

  async updateEvent(accessToken: string, eventId: string, updates: UpdateEventParams): Promise<CalendarEvent> {
    const body: any = {};

    if (updates.subject) body.summary = updates.subject;
    if (updates.start) {
      body.start = { dateTime: updates.start, timeZone: updates.timezone || 'UTC' };
    }
    if (updates.end) {
      body.end = { dateTime: updates.end, timeZone: updates.timezone || 'UTC' };
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

    console.log(`[Google] Updating event ${eventId} with ${updates.attendees?.length || 0} attendees`);

    const response = await fetchWithRetry(`${BASE_URL}/calendars/primary/events/${encodeURIComponent(eventId)}?sendUpdates=all`, {
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
    console.log(`[Google] Deleting event ${eventId}`);

    const response = await fetchWithRetry(`${BASE_URL}/calendars/primary/events/${encodeURIComponent(eventId)}?sendUpdates=all`, {
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

    const response = await fetchWithRetry('https://www.googleapis.com/calendar/v3/freeBusy', {
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
    const attendeeResults: AttendeeAvailability[] = [];

    for (const calId of Object.keys(calendars)) {
      const busy = calendars[calId]?.busy || [];
      const calConflicts: Array<{ start: string; end: string }> = [];
      for (const period of busy) {
        conflicts.push({
          subject: calId === 'primary' ? 'Busy' : `Busy (${calId})`,
          start: period.start,
          end: period.end,
        });
        calConflicts.push({ start: period.start, end: period.end });
      }
      // Only include non-primary calendars (attendees) in per-attendee results
      if (calId !== 'primary' && attendees?.includes(calId)) {
        attendeeResults.push({
          email: calId,
          available: calConflicts.length === 0,
          conflicts: calConflicts,
        });
      }
    }

    const result: AvailabilityResult = { available: conflicts.length === 0, conflicts };
    if (attendeeResults.length > 0) {
      result.attendees = attendeeResults;
    }
    return result;
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
    const status = this.mapGoogleEventStatus(raw.status);
    const selfAttendee = raw.attendees?.find((a: any) => a.self === true);
    const selfResponse = selfAttendee ? this.mapGoogleResponseStatus(selfAttendee.responseStatus) : undefined;

    const event: CalendarEvent = {
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
        responseStatus: this.mapGoogleResponseStatus(a.responseStatus),
      })),
      location: raw.location ? { displayName: raw.location } : undefined,
      body: raw.description ? { content: raw.description } : undefined,
      webLink: raw.htmlLink,
      onlineMeetingUrl: raw.hangoutLink || raw.conferenceData?.entryPoints?.[0]?.uri,
    };

    if (status && status !== 'confirmed') event.status = status;
    if (selfResponse && selfResponse !== 'accepted') event.selfResponseStatus = selfResponse;
    if (raw.recurringEventId) event.isRecurring = true;

    return event;
  }

  private mapGoogleEventStatus(status: string | undefined): EventStatus | undefined {
    switch (status) {
      case 'cancelled': return 'cancelled';
      case 'tentative': return 'tentative';
      case 'confirmed': return 'confirmed';
      default: return undefined;
    }
  }

  private mapGoogleResponseStatus(status: string | undefined): ResponseStatus | undefined {
    switch (status) {
      case 'accepted': return 'accepted';
      case 'declined': return 'declined';
      case 'tentative': return 'tentative';
      case 'needsAction': return 'needsAction';
      default: return undefined;
    }
  }
}
