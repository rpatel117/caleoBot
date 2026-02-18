import { CalendarProviderType } from '../types';
import { CalendarEvent, CalendarProvider, AttendeeAvailability, CreateEventParams } from './types';
import { GoogleOAuth } from './google/oauth';
import { MicrosoftOAuth } from './microsoft/oauth';
import { GoogleCalendarProvider } from './google/provider';
import { MicrosoftCalendarProvider } from './microsoft/provider';
import { Repository } from '../database/repository';

// ---------- Types ----------

export interface ResolvedAttendee {
  email: string;
  isCaleoUser: boolean;
  dbUserId?: string;
  displayName?: string;
  timezone?: string;
  providers: CalendarProviderType[];
}

export interface FederatedAvailabilityResult {
  available: boolean;
  conflicts: Array<{ subject: string; start: string; end: string; source: string }>;
  attendees: Array<AttendeeAvailability & { source: 'own_token' | 'organizer_api' | 'unknown' }>;
}

export interface CrossOrgCreateResult {
  organizerEvent: CalendarEvent;
  attendeeResults: Array<{ email: string; success: boolean; eventId?: string; error?: string }>;
  standardInviteEmails: string[];
  onlineMeetingUrl?: string;
}

// ---------- Service ----------

export class CrossOrgService {
  private googleOAuth: GoogleOAuth;
  private microsoftOAuth: MicrosoftOAuth;
  private repository: Repository;

  constructor(deps: {
    googleOAuth: GoogleOAuth;
    microsoftOAuth: MicrosoftOAuth;
    repository: Repository;
  }) {
    this.googleOAuth = deps.googleOAuth;
    this.microsoftOAuth = deps.microsoftOAuth;
    this.repository = deps.repository;
  }

  /**
   * Resolve a list of attendee emails into Caleo users vs external users.
   * Filters out the organizer's own email.
   */
  async resolveAttendees(emails: string[], organizerEmail: string): Promise<ResolvedAttendee[]> {
    const filtered = emails.filter(e => e.toLowerCase() !== organizerEmail.toLowerCase());
    if (filtered.length === 0) return [];

    const caleoUsers = await this.repository.findCaleoUsersByEmails(filtered);
    const caleoMap = new Map(caleoUsers.map(u => [u.email.toLowerCase(), u]));

    return filtered.map(email => {
      const user = caleoMap.get(email.toLowerCase());
      if (user) {
        return {
          email,
          isCaleoUser: true,
          dbUserId: user.dbUserId,
          displayName: user.displayName || undefined,
          timezone: user.timezone,
          providers: user.providers as CalendarProviderType[],
        };
      }
      return {
        email,
        isCaleoUser: false,
        providers: [],
      };
    });
  }

  /**
   * Check availability across orgs using federated token strategy:
   * - Caleo users: checked via their own tokens (full event details)
   * - External users: checked via organizer's API (limited cross-org visibility)
   */
  async checkFederatedAvailability(
    organizerToken: string,
    organizerProvider: CalendarProviderType,
    emails: string[],
    organizerEmail: string,
    start: Date,
    end: Date
  ): Promise<FederatedAvailabilityResult> {
    const resolved = await this.resolveAttendees(emails, organizerEmail);
    const caleoAttendees = resolved.filter(a => a.isCaleoUser);
    const externalAttendees = resolved.filter(a => !a.isCaleoUser);

    const allConflicts: FederatedAvailabilityResult['conflicts'] = [];
    const allAttendees: FederatedAvailabilityResult['attendees'] = [];

    // 1. Check Caleo users via their own tokens (in parallel)
    const caleoChecks = caleoAttendees.map(async (attendee) => {
      try {
        const token = await this.getTokenForUser(attendee.dbUserId!, attendee.providers);
        if (!token) {
          console.log(`[CrossOrg] No valid token for ${attendee.email}, marking unknown`);
          return {
            email: attendee.email,
            available: true,
            conflicts: [] as Array<{ start: string; end: string }>,
            source: 'unknown' as const,
          };
        }

        const provider = this.getCalendarProvider(token.provider);
        const result = await provider.checkAvailability(token.accessToken, start, end);

        // Add conflicts with source attribution
        for (const conflict of result.conflicts) {
          allConflicts.push({ ...conflict, source: `${attendee.email} (own_token)` });
        }

        return {
          email: attendee.email,
          available: result.available,
          conflicts: result.conflicts.map(c => ({ start: c.start, end: c.end })),
          source: 'own_token' as const,
        };
      } catch (err: any) {
        console.error(`[CrossOrg] Failed to check availability for ${attendee.email}:`, err?.message);
        return {
          email: attendee.email,
          available: true,
          conflicts: [] as Array<{ start: string; end: string }>,
          source: 'unknown' as const,
        };
      }
    });

    // 2. Check external users via organizer's API (batch)
    let externalResults: Array<AttendeeAvailability & { source: 'organizer_api' | 'unknown' }> = [];
    if (externalAttendees.length > 0) {
      try {
        const organizerCalendar = this.getCalendarProvider(organizerProvider);
        const externalEmails = externalAttendees.map(a => a.email);
        const result = await organizerCalendar.checkAvailability(
          organizerToken, start, end, externalEmails
        );

        // Map per-attendee results if available
        if (result.attendees) {
          externalResults = result.attendees.map(a => ({
            ...a,
            source: 'organizer_api' as const,
          }));
        } else {
          // No per-attendee breakdown — mark all as organizer_api with overall result
          externalResults = externalAttendees.map(a => ({
            email: a.email,
            available: result.available,
            conflicts: result.conflicts.map(c => ({ start: c.start, end: c.end })),
            source: 'organizer_api' as const,
          }));
        }

        for (const conflict of result.conflicts) {
          allConflicts.push({ ...conflict, source: 'organizer_api' });
        }
      } catch (err: any) {
        console.error(`[CrossOrg] Failed to check external availability:`, err?.message);
        externalResults = externalAttendees.map(a => ({
          email: a.email,
          available: true,
          conflicts: [],
          source: 'unknown' as const,
        }));
      }
    }

    // 3. Merge results
    const caleoResults = await Promise.all(caleoChecks);
    allAttendees.push(...caleoResults);
    allAttendees.push(...externalResults);

    const overallAvailable = allAttendees.every(a => a.available);

    return {
      available: overallAvailable,
      conflicts: allConflicts,
      attendees: allAttendees,
    };
  }

  /**
   * Create events across orgs:
   * - Organizer gets their event with only external attendees (prevents duplicate invites)
   * - Caleo users get native events on their own calendars via their own tokens
   * - Failed native events fall back to standard invite via organizer's event
   */
  async createCrossOrgEvent(
    organizerToken: string,
    organizerProvider: CalendarProviderType,
    organizerEmail: string,
    params: CreateEventParams & { allAttendeeEmails: string[] }
  ): Promise<CrossOrgCreateResult> {
    const resolved = await this.resolveAttendees(params.allAttendeeEmails, organizerEmail);
    const caleoAttendees = resolved.filter(a => a.isCaleoUser);
    const externalAttendees = resolved.filter(a => !a.isCaleoUser);

    // 1. Create organizer's event with ONLY external attendees
    //    (prevents duplicate invites to Caleo users who'll get native events)
    const organizerCalendar = this.getCalendarProvider(organizerProvider);
    const organizerEvent = await organizerCalendar.createEvent(organizerToken, {
      ...params,
      attendees: externalAttendees.map(a => a.email),
    });

    const standardInviteEmails = externalAttendees.map(a => a.email);
    const meetingUrl = organizerEvent.onlineMeetingUrl || organizerEvent.webLink;
    const attendeeResults: CrossOrgCreateResult['attendeeResults'] = [];

    // 2. Create native events on each Caleo attendee's calendar (in parallel)
    const nativeCreations = caleoAttendees.map(async (attendee) => {
      try {
        const token = await this.getTokenForUser(attendee.dbUserId!, attendee.providers);
        if (!token) {
          console.log(`[CrossOrg] No token for ${attendee.email}, will fall back to standard invite`);
          return { email: attendee.email, success: false, error: 'No valid token' };
        }

        const attendeeCalendar = this.getCalendarProvider(token.provider);

        // Build body with organizer attribution and meeting link
        const allEmails = [organizerEmail, ...params.allAttendeeEmails];
        const attendeeList = allEmails.map(e => `  • ${e}`).join('\n');
        let nativeBody = params.body || '';
        if (meetingUrl) {
          nativeBody += `${nativeBody ? '\n\n' : ''}Join meeting: ${meetingUrl}`;
        }
        nativeBody += `${nativeBody ? '\n\n' : ''}Organized by ${organizerEmail} via Caleo\nAttendees:\n${attendeeList}`;

        const nativeEvent = await attendeeCalendar.createEvent(token.accessToken, {
          subject: params.subject,
          start: params.start,
          end: params.end,
          location: params.location,
          body: nativeBody,
          isOnlineMeeting: false, // Don't create a second Meet/Teams link
          timezone: attendee.timezone || params.timezone,
          attendees: [], // No attendees — this is their own copy
        });

        console.log(`[CrossOrg] Native event created for ${attendee.email}: ${nativeEvent.id}`);
        return { email: attendee.email, success: true, eventId: nativeEvent.id };
      } catch (err: any) {
        console.error(`[CrossOrg] Native event creation failed for ${attendee.email}:`, err?.message);
        return { email: attendee.email, success: false, error: err?.message || 'Unknown error' };
      }
    });

    const results = await Promise.all(nativeCreations);
    attendeeResults.push(...results);

    // 3. Fallback: for failed native events, add those attendees to organizer's event
    const failedEmails = results.filter(r => !r.success).map(r => r.email);
    if (failedEmails.length > 0) {
      try {
        const currentAttendees = externalAttendees.map(a => a.email);
        const updatedAttendees = [...currentAttendees, ...failedEmails];
        await organizerCalendar.updateEvent(organizerToken, organizerEvent.id, {
          attendees: updatedAttendees,
        });
        standardInviteEmails.push(...failedEmails);
        console.log(`[CrossOrg] Added ${failedEmails.length} failed attendee(s) to organizer event as fallback`);
      } catch (err: any) {
        console.error(`[CrossOrg] Failed to add fallback attendees to organizer event:`, err?.message);
      }
    }

    return {
      organizerEvent,
      attendeeResults,
      standardInviteEmails,
      onlineMeetingUrl: organizerEvent.onlineMeetingUrl,
    };
  }

  // ---------- Helpers ----------

  private async getTokenForUser(
    dbUserId: string,
    providers: CalendarProviderType[]
  ): Promise<{ accessToken: string; provider: CalendarProviderType } | null> {
    // Try each provider the user has connected
    for (const provider of providers) {
      try {
        const oauth = provider === 'google' ? this.googleOAuth : this.microsoftOAuth;
        const token = await oauth.getValidAccessToken(dbUserId);
        if (token) {
          return { accessToken: token, provider };
        }
      } catch (err: any) {
        console.error(`[CrossOrg] Token retrieval failed for ${dbUserId}/${provider}:`, err?.message);
      }
    }
    return null;
  }

  private getCalendarProvider(provider: CalendarProviderType): CalendarProvider {
    return provider === 'google'
      ? new GoogleCalendarProvider()
      : new MicrosoftCalendarProvider();
  }
}
