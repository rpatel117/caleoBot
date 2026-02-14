/**
 * Data Sanitization Utility
 * Strips unnecessary data from Microsoft Graph API responses to reduce token usage
 */

export interface SanitizedEvent {
  id: string;
  subject: string;
  start: string;
  end: string;
  location?: string;
  attendees?: string[];
  isOnline?: boolean;
  organizer?: string;
}

export interface SanitizedUser {
  id: string;
  displayName: string;
  email: string;
  jobTitle?: string;
  department?: string;
}

export class DataSanitizer {
  /**
   * Sanitize calendar events to include only essential information
   */
  static sanitizeEvents(events: any[]): SanitizedEvent[] {
    return events.map(event => {
      const sanitized: SanitizedEvent = {
        id: event.id || '',
        subject: event.subject || 'No Title',
        start: this.formatDateTime(event.start?.dateTime),
        end: this.formatDateTime(event.end?.dateTime),
      };

      // Add location if present and meaningful
      if (event.location?.displayName && 
          event.location.displayName !== 'Microsoft Teams Meeting' &&
          event.location.displayName !== 'Home') {
        sanitized.location = event.location.displayName;
      }

      // Add attendees (just email addresses, limit to 5 to save tokens)
      if (event.attendees && event.attendees.length > 0) {
        sanitized.attendees = event.attendees
          .slice(0, 5) // Limit to 5 attendees
          .map((attendee: any) => attendee.emailAddress?.address)
          .filter(Boolean);
      }

      // Check if it's an online meeting
      if (event.onlineMeeting?.joinUrl || 
          event.location?.displayName === 'Microsoft Teams Meeting' ||
          event.location?.displayName === 'Online - Microsoft Teams') {
        sanitized.isOnline = true;
      }

      // Add organizer if present
      if (event.organizer?.emailAddress?.address) {
        sanitized.organizer = event.organizer.emailAddress.address;
      }

      return sanitized;
    });
  }

  /**
   * Sanitize user profile data
   */
  static sanitizeUser(user: any): SanitizedUser {
    return {
      id: user.id || '',
      displayName: user.displayName || user.givenName + ' ' + user.surname || 'Unknown',
      email: user.mail || user.userPrincipalName || '',
      jobTitle: user.jobTitle || undefined,
      department: user.department || undefined,
    };
  }

  /**
   * Sanitize email data
   */
  static sanitizeEmails(emails: any[]): any[] {
    return emails.map(email => ({
      id: email.id,
      subject: email.subject,
      from: email.from?.emailAddress?.address,
      receivedDateTime: this.formatDateTime(email.receivedDateTime),
      isRead: email.isRead,
      hasAttachments: email.hasAttachments,
      importance: email.importance,
    }));
  }

  /**
   * Format datetime to a readable format
   */
  private static formatDateTime(dateTime: string | undefined): string {
    if (!dateTime) return '';
    
    try {
      const date = new Date(dateTime);
      return date.toISOString();
    } catch {
      return dateTime;
    }
  }

  /**
   * Strip HTML content from event bodies
   */
  static stripHtml(html: string): string {
    if (!html) return '';
    
    // Remove HTML tags
    let text = html.replace(/<[^>]*>/g, '');
    
    // Decode HTML entities
    text = text
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ');
    
    // Clean up whitespace
    text = text.replace(/\s+/g, ' ').trim();
    
    // Limit length to prevent token bloat
    return text.length > 200 ? text.substring(0, 200) + '...' : text;
  }

  /**
   * Get minimal event data for basic calendar queries
   */
  static getMinimalEvents(events: any[]): any[] {
    return events.map(event => ({
      subject: event.subject,
      start: this.formatDateTime(event.start?.dateTime),
      end: this.formatDateTime(event.end?.dateTime),
      location: event.location?.displayName || null,
      attendeeCount: event.attendees?.length || 0,
    }));
  }

  /**
   * Get detailed event data for specific queries
   */
  static getDetailedEvents(events: any[]): SanitizedEvent[] {
    return this.sanitizeEvents(events);
  }

  /**
   * Estimate token count for debugging
   */
  static estimateTokens(data: any): number {
    const jsonString = JSON.stringify(data);
    // Rough estimation: 1 token ≈ 4 characters
    return Math.ceil(jsonString.length / 4);
  }
}
