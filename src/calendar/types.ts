export interface CalendarEvent {
  id: string;
  subject: string;
  start: {
    dateTime: string;
    timeZone: string;
  };
  end: {
    dateTime: string;
    timeZone: string;
  };
  attendees?: Array<{
    emailAddress: {
      name: string;
      address: string;
    };
    type: string;
  }>;
  location?: {
    displayName: string;
  };
  body?: {
    content: string;
  };
  webLink?: string;
  onlineMeetingUrl?: string;
}

export interface CreateEventParams {
  subject: string;
  start: Date;
  end: Date;
  attendees?: string[];
  location?: string;
  body?: string;
  isOnlineMeeting?: boolean;
  timezone?: string;
}

export interface UpdateEventParams {
  subject?: string;
  start?: Date;
  end?: Date;
  attendees?: string[];
  location?: string;
  body?: string;
}

export interface AttendeeAvailability {
  email: string;
  available: boolean;
  conflicts: Array<{ start: string; end: string }>;
}

export interface AvailabilityResult {
  available: boolean;
  conflicts: Array<{
    subject: string;
    start: string;
    end: string;
  }>;
  attendees?: AttendeeAvailability[];
}

export interface FreeTimeParams {
  duration: number; // minutes
  startDate: string;
  endDate: string;
  workingHours?: {
    start: string; // "09:00"
    end: string; // "17:00"
  };
}

export interface TimeSlot {
  start: string;
  end: string;
}

export interface CalendarProvider {
  getEvents(accessToken: string, start: Date, end: Date): Promise<CalendarEvent[]>;
  createEvent(accessToken: string, event: CreateEventParams): Promise<CalendarEvent>;
  updateEvent(accessToken: string, eventId: string, updates: UpdateEventParams): Promise<CalendarEvent>;
  deleteEvent(accessToken: string, eventId: string): Promise<void>;
  checkAvailability(accessToken: string, start: Date, end: Date, attendees?: string[]): Promise<AvailabilityResult>;
  findFreeTime(accessToken: string, events: CalendarEvent[], params: FreeTimeParams): TimeSlot[];
}

export interface OAuthProvider {
  generateAuthUrl(userId: string, workspaceId: string, redirectUri: string): string;
  exchangeCode(code: string, redirectUri: string): Promise<import('../types').TokenSet>;
  refreshToken(refreshToken: string): Promise<import('../types').TokenSet>;
  validateToken(accessToken: string): Promise<boolean>;
}
