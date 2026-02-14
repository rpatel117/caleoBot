import { CalendarEvent } from '../calendar/types';
import { FormattedCalendarSnapshot } from './config';

/**
 * Format a time range for display: "2:00 PM - 3:00 PM"
 */
export function formatTimeRange(startIso: string, endIso: string, tz: string): { start: string; end: string } {
  const opts: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit', timeZone: tz };
  return {
    start: new Date(startIso).toLocaleTimeString('en-US', opts),
    end: new Date(endIso).toLocaleTimeString('en-US', opts),
  };
}

/**
 * Convert CalendarEvent[] to snapshot format for the prompt.
 */
export function formatEventsForPrompt(events: CalendarEvent[], tz: string): FormattedCalendarSnapshot[] {
  return events.map(e => {
    const { start, end } = formatTimeRange(e.start.dateTime, e.end.dateTime, tz);
    return {
      id: e.id,
      subject: e.subject,
      start,
      end,
      attendeeCount: e.attendees?.length || 0,
      hasVideoLink: !!e.onlineMeetingUrl,
    };
  });
}

/**
 * Compute free-time gaps within working hours for a given day.
 * Returns human-readable strings like "9:00 AM - 10:30 AM (1h 30m)"
 * Only includes gaps >= minGapMinutes (default 30).
 */
export function computeFreeTimeGaps(
  events: CalendarEvent[],
  tz: string,
  workStart: string = '09:00',
  workEnd: string = '17:00',
  minGapMinutes: number = 30
): string[] {
  const today = new Date();
  const dateStr = today.toLocaleDateString('en-CA', { timeZone: tz }); // YYYY-MM-DD

  const workStartDate = new Date(`${dateStr}T${workStart}:00`);
  const workEndDate = new Date(`${dateStr}T${workEnd}:00`);

  // Sort events by start time
  const sorted = events
    .filter(e => e.start?.dateTime && e.end?.dateTime)
    .map(e => ({
      start: new Date(e.start.dateTime),
      end: new Date(e.end.dateTime),
    }))
    .filter(e => e.end > workStartDate && e.start < workEndDate)
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  const gaps: string[] = [];
  let cursor = workStartDate;

  for (const event of sorted) {
    const eventStart = event.start < workStartDate ? workStartDate : event.start;
    if (eventStart > cursor) {
      const gapMinutes = (eventStart.getTime() - cursor.getTime()) / 60000;
      if (gapMinutes >= minGapMinutes) {
        const { start, end } = formatTimeRange(cursor.toISOString(), eventStart.toISOString(), tz);
        gaps.push(`${start} - ${end} (${formatDuration(gapMinutes)})`);
      }
    }
    if (event.end > cursor) {
      cursor = event.end;
    }
  }

  // Gap after last event until work end
  if (cursor < workEndDate) {
    const gapMinutes = (workEndDate.getTime() - cursor.getTime()) / 60000;
    if (gapMinutes >= minGapMinutes) {
      const { start, end } = formatTimeRange(cursor.toISOString(), workEndDate.toISOString(), tz);
      gaps.push(`${start} - ${end} (${formatDuration(gapMinutes)})`);
    }
  }

  return gaps;
}

/**
 * Detect overlapping event pairs. Returns human-readable conflict descriptions.
 */
export function detectConflicts(events: CalendarEvent[], tz: string): string[] {
  const sorted = events
    .filter(e => e.start?.dateTime && e.end?.dateTime)
    .sort((a, b) => new Date(a.start.dateTime).getTime() - new Date(b.start.dateTime).getTime());

  const conflicts: string[] = [];

  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const aEnd = new Date(sorted[i].end.dateTime);
      const bStart = new Date(sorted[j].start.dateTime);
      if (aEnd > bStart) {
        const aRange = formatTimeRange(sorted[i].start.dateTime, sorted[i].end.dateTime, tz);
        const bRange = formatTimeRange(sorted[j].start.dateTime, sorted[j].end.dateTime, tz);
        conflicts.push(
          `"${sorted[i].subject}" (${aRange.start}–${aRange.end}) overlaps with "${sorted[j].subject}" (${bRange.start}–${bRange.end})`
        );
      }
    }
  }

  return conflicts;
}

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}
