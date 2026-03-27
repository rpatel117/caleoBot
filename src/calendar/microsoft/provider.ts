import {
  CalendarProvider, CalendarEvent, CreateEventParams, UpdateEventParams,
  AvailabilityResult, FreeTimeParams, TimeSlot, AttendeeAvailability,
  ResponseStatus, RsvpStatus,
} from '../types';
import { fetchWithRetry } from '../fetch-retry';

const BASE_URL = 'https://graph.microsoft.com/v1.0';

export class MicrosoftCalendarProvider implements CalendarProvider {
  async getEvents(accessToken: string, start: Date, end: Date): Promise<CalendarEvent[]> {
    const startParam = encodeURIComponent(start.toISOString());
    const endParam = encodeURIComponent(end.toISOString());
    const url = `${BASE_URL}/me/calendar/events?startDateTime=${startParam}&endDateTime=${endParam}&$top=500&$orderby=start/dateTime`;

    const response = await fetchWithRetry(url, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Graph API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json() as any;
    return (data.value || []).map((event: any) => this.mapEvent(event));
  }

  async createEvent(accessToken: string, params: CreateEventParams): Promise<CalendarEvent> {
    const body: any = {
      subject: params.subject,
      start: {
        dateTime: params.start,
        timeZone: params.timezone || 'UTC',
      },
      end: {
        dateTime: params.end,
        timeZone: params.timezone || 'UTC',
      },
      isOnlineMeeting: params.isOnlineMeeting ?? true,
      onlineMeetingProvider: (params.isOnlineMeeting ?? true) ? 'teamsForBusiness' : undefined,
      responseRequested: true,
      body: {
        contentType: 'html',
        content: params.body
          ? `<p>${this.escapeHtml(params.body)}</p><p>You have been invited to this meeting.</p>`
          : '<p>You have been invited to this meeting.</p>',
      },
    };

    if (params.recurrence) {
      // Convert RRULE to Microsoft Graph recurrence pattern
      const msRecurrence = this.parseRRuleToGraphPattern(params.recurrence, params.start);
      if (msRecurrence) {
        body.recurrence = msRecurrence;
        // When using recurrence, Microsoft Graph requires start/end without explicit timezone object
        // The recurrence range handles the dates
      }
    }

    if (params.attendees?.length) {
      body.attendees = params.attendees.map(email => ({
        emailAddress: { address: email, name: email.split('@')[0] },
        type: 'required',
      }));
    }

    if (params.location) {
      body.location = { displayName: params.location };
    }

    console.log(`[Microsoft] Creating event "${params.subject}" with ${params.attendees?.length || 0} attendees: ${JSON.stringify(params.attendees)}`);

    const response = await fetchWithRetry(`${BASE_URL}/me/calendar/events`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Prefer': 'outlook.timezone="UTC"',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Graph API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json() as any;
    console.log(`[Microsoft] Event created: ${data.id}, attendees in response: ${data.attendees?.length || 0}, onlineMeeting: ${!!data.onlineMeeting?.joinUrl}`);
    return this.mapEvent(data);
  }

  async updateEvent(accessToken: string, eventId: string, updates: UpdateEventParams): Promise<CalendarEvent> {
    const body: any = {};

    if (updates.subject) body.subject = updates.subject;
    if (updates.start) {
      body.start = { dateTime: updates.start, timeZone: updates.timezone || 'UTC' };
    }
    if (updates.end) {
      body.end = { dateTime: updates.end, timeZone: updates.timezone || 'UTC' };
    }
    if (updates.attendees) {
      body.attendees = updates.attendees.map(email => ({
        emailAddress: { address: email },
        type: 'required',
      }));
    }
    if (updates.location) {
      body.location = { displayName: updates.location };
    }
    if (updates.body) {
      body.body = { content: updates.body, contentType: 'text' };
    }

    console.log(`[Microsoft] Updating event ${eventId} with ${updates.attendees?.length || 0} attendees`);

    const response = await fetchWithRetry(`${BASE_URL}/me/calendar/events/${encodeURIComponent(eventId)}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Prefer': 'outlook.timezone="UTC"',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Graph API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json() as any;
    console.log(`[Microsoft] Event updated: ${data.id}, attendees: ${data.attendees?.length || 0}`);
    return this.mapEvent(data);
  }

  async deleteEvent(accessToken: string, eventId: string): Promise<void> {
    console.log(`[Microsoft] Deleting event ${eventId}`);

    const response = await fetchWithRetry(`${BASE_URL}/me/calendar/events/${encodeURIComponent(eventId)}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Graph API error: ${response.status} - ${errorText}`);
    }
  }

  async rsvpEvent(accessToken: string, eventId: string, status: RsvpStatus): Promise<void> {
    // Microsoft Graph has dedicated endpoints for accept/decline/tentativelyAccept
    const actionMap: Record<RsvpStatus, string> = {
      accepted: 'accept',
      declined: 'decline',
      tentative: 'tentativelyAccept',
    };
    const action = actionMap[status];
    console.log(`[Microsoft] RSVP event ${eventId} → ${action}`);

    const response = await fetchWithRetry(`${BASE_URL}/me/calendar/events/${encodeURIComponent(eventId)}/${action}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sendResponse: true }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Graph API error: ${response.status} - ${errorText}`);
    }
    console.log(`[Microsoft] RSVP successful: ${eventId} → ${status}`);
  }

  async checkAvailability(accessToken: string, start: Date, end: Date, attendees?: string[]): Promise<AvailabilityResult> {
    if (attendees?.length) {
      try {
        return await this.getScheduleAvailability(accessToken, start, end, attendees);
      } catch (error: any) {
        console.warn('[Microsoft] getSchedule failed, falling back to event-based check:', error?.message);
        // Fall through to event-based check
      }
    }

    const events = await this.getEvents(accessToken, start, end);
    const conflicts = events.map(event => ({
      subject: event.subject,
      start: event.start.dateTime,
      end: event.end.dateTime,
    }));

    return {
      available: conflicts.length === 0,
      conflicts,
    };
  }

  private async getScheduleAvailability(
    accessToken: string, start: Date, end: Date, attendees: string[]
  ): Promise<AvailabilityResult> {
    const body = {
      schedules: attendees,
      startTime: { dateTime: start.toISOString(), timeZone: 'UTC' },
      endTime: { dateTime: end.toISOString(), timeZone: 'UTC' },
      availabilityViewInterval: 15,
    };

    const response = await fetchWithRetry(`${BASE_URL}/me/calendar/getSchedule`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Graph getSchedule error: ${response.status} - ${errorText}`);
    }

    const data = await response.json() as any;
    const schedules = data.value || [];
    const conflicts: Array<{ subject: string; start: string; end: string }> = [];
    const attendeeResults: AttendeeAvailability[] = [];

    for (const schedule of schedules) {
      const email = schedule.scheduleId || '';
      const items = schedule.scheduleItems || [];
      const calConflicts: Array<{ start: string; end: string }> = [];

      for (const item of items) {
        if (item.status === 'free') continue;
        const busyStart = item.start?.dateTime || '';
        const busyEnd = item.end?.dateTime || '';
        conflicts.push({
          subject: item.subject || `Busy (${email})`,
          start: busyStart,
          end: busyEnd,
        });
        calConflicts.push({ start: busyStart, end: busyEnd });
      }

      attendeeResults.push({
        email,
        available: calConflicts.length === 0,
        conflicts: calConflicts,
      });
    }

    // Also check the requesting user's own calendar
    const ownEvents = await this.getEvents(accessToken, start, end);
    for (const event of ownEvents) {
      conflicts.push({
        subject: event.subject,
        start: event.start.dateTime,
        end: event.end.dateTime,
      });
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

        slotStart += 30 * 60 * 1000; // 30-minute increments
      }

      current.setDate(current.getDate() + 1);
      current.setHours(0, 0, 0, 0);
    }

    return slots;
  }

  private parseRRuleToGraphPattern(rrule: string, startDate: string): any | null {
    try {
      const parts: Record<string, string> = {};
      const rule = rrule.replace('RRULE:', '');
      for (const part of rule.split(';')) {
        const [key, val] = part.split('=');
        if (key && val) parts[key] = val;
      }

      const freq = parts.FREQ;
      if (!freq) return null;

      const dayMap: Record<string, string> = {
        MO: 'monday', TU: 'tuesday', WE: 'wednesday', TH: 'thursday',
        FR: 'friday', SA: 'saturday', SU: 'sunday',
      };

      const pattern: any = { interval: parseInt(parts.INTERVAL || '1', 10) };
      const range: any = { startDate: startDate.split('T')[0] };

      switch (freq) {
        case 'DAILY': pattern.type = 'daily'; break;
        case 'WEEKLY':
          pattern.type = 'weekly';
          pattern.daysOfWeek = parts.BYDAY
            ? parts.BYDAY.split(',').map(d => dayMap[d] || d.toLowerCase())
            : [dayMap[['SU','MO','TU','WE','TH','FR','SA'][new Date(startDate).getDay()]]];
          break;
        case 'MONTHLY': pattern.type = 'absoluteMonthly'; pattern.dayOfMonth = new Date(startDate).getDate(); break;
        default: return null;
      }

      if (parts.COUNT) {
        range.type = 'numbered';
        range.numberOfOccurrences = parseInt(parts.COUNT, 10);
      } else if (parts.UNTIL) {
        range.type = 'endDate';
        range.endDate = parts.UNTIL.replace(/T.*/, '').replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');
      } else {
        range.type = 'noEnd';
      }

      return { pattern, range };
    } catch {
      return null;
    }
  }

  private escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  private mapEvent(raw: any): CalendarEvent {
    const selfResponse = this.mapMsResponseStatus(raw.responseStatus?.response);

    const event: CalendarEvent = {
      id: raw.id,
      subject: raw.subject || 'No Title',
      start: {
        dateTime: raw.start?.dateTime || '',
        timeZone: raw.start?.timeZone || 'UTC',
      },
      end: {
        dateTime: raw.end?.dateTime || '',
        timeZone: raw.end?.timeZone || 'UTC',
      },
      attendees: raw.attendees?.map((a: any) => ({
        emailAddress: {
          name: a.emailAddress?.name || a.emailAddress?.address || '',
          address: a.emailAddress?.address || '',
        },
        type: a.type || 'required',
        responseStatus: this.mapMsResponseStatus(a.status?.response),
      })),
      location: raw.location?.displayName ? { displayName: raw.location.displayName } : undefined,
      body: raw.body?.content ? { content: raw.body.content } : undefined,
      webLink: raw.webLink,
      onlineMeetingUrl: raw.onlineMeeting?.joinUrl,
    };

    if (raw.isCancelled) event.status = 'cancelled';
    if (selfResponse && selfResponse !== 'accepted') event.selfResponseStatus = selfResponse;
    if (raw.type === 'occurrence' || raw.type === 'exception') event.isRecurring = true;

    return event;
  }

  private mapMsResponseStatus(response: string | undefined): ResponseStatus | undefined {
    switch (response) {
      case 'accepted': return 'accepted';
      case 'declined': return 'declined';
      case 'tentativelyAccepted': return 'tentative';
      case 'notResponded': return 'needsAction';
      case 'organizer': return 'accepted';
      case 'none': return 'none';
      default: return undefined;
    }
  }
}
