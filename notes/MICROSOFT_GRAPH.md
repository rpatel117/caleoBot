# Microsoft Graph Integration Guide

## 🎯 Overview

This guide covers the complete integration of Microsoft Graph API with Caleo Bot, including authentication, permissions, and calendar operations.

## 🔐 Authentication Setup

### 1. Azure App Registration

#### Create App Registration
1. Go to [Azure Portal](https://portal.azure.com)
2. Navigate to **Azure Active Directory** → **App registrations**
3. Click **"New registration"**
4. Fill in:
   - **Name**: Caleo Bot
   - **Supported account types**: Accounts in this organizational directory only
   - **Redirect URI**: Web - `http://localhost:3978/auth/callback`

#### Configure API Permissions
Add these **Delegated permissions**:
- `Calendars.ReadWrite` - Read and write user calendars
- `User.Read.All` - Read user profiles
- `offline_access` - Maintain access to resources
- `OnlineMeetings.ReadWrite` - Read and write online meetings
- `People.Read` - Read people in organization

#### Generate Client Secret
1. Go to **Certificates & secrets**
2. Click **"New client secret"**
3. Copy the secret value (you won't see it again)

### 2. Bot Framework Registration

#### Register with Bot Framework
1. Go to [Bot Framework Portal](https://dev.botframework.com)
2. Click **"Create a bot"**
3. Choose **"Use existing app registration"**
4. Enter your App ID and secret
5. Set messaging endpoint: `https://your-ngrok-url.ngrok-free.dev/api/messages`

## 🔧 Implementation

### Authentication Flow

```typescript
// Teams SSO Service
class TeamsSSOService {
  async getAuthStatus(userContext: UserContext): Promise<AuthStatus> {
    // Check if user has valid token
    const token = await this.getStoredToken(userContext.userId);
    
    if (!token || this.isTokenExpired(token)) {
      return {
        authenticated: false,
        needsAuth: true,
        authUrl: this.generateAuthUrl(userContext)
      };
    }
    
    return {
      authenticated: true,
      needsAuth: false
    };
  }
  
  async exchangeCodeForToken(code: string, userContext: UserContext): Promise<void> {
    // Exchange authorization code for access token
    const tokenResponse = await this.requestToken(code);
    
    // Store token securely
    await this.storeToken(userContext.userId, tokenResponse);
  }
}
```

### Graph Service Implementation

```typescript
// Graph Service
class GraphService {
  async getCalendarEvents(userContext: UserContext, startDate: Date, endDate: Date): Promise<CalendarEvent[]> {
    const accessToken = await this.teamsSSO.getAccessToken(userContext);
    
    if (!accessToken) {
      throw new Error('User not authenticated');
    }
    
    const response = await fetch(
      `https://graph.microsoft.com/v1.0/me/calendar/events?startDateTime=${startDate.toISOString()}&endDateTime=${endDate.toISOString()}`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    if (!response.ok) {
      throw new Error(`Graph API error: ${response.status}`);
    }
    
    const data = await response.json();
    return data.value;
  }
}
```

## 📅 Calendar Operations

### Get Calendar Events

```typescript
// Get events for next 7 days
const startDate = new Date();
const endDate = new Date();
endDate.setDate(endDate.getDate() + 7);

const events = await graphService.getCalendarEvents(userContext, startDate, endDate);
```

### Create Calendar Event

```typescript
async createCalendarEvent(userContext: UserContext, eventData: CreateEventData): Promise<CalendarEvent> {
  const accessToken = await this.teamsSSO.getAccessToken(userContext);
  
  const response = await fetch('https://graph.microsoft.com/v1.0/me/calendar/events', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      subject: eventData.subject,
      start: {
        dateTime: eventData.startDateTime,
        timeZone: eventData.timeZone
      },
      end: {
        dateTime: eventData.endDateTime,
        timeZone: eventData.timeZone
      },
      attendees: eventData.attendees?.map(email => ({
        emailAddress: { address: email },
        type: 'required'
      }))
    })
  });
  
  return await response.json();
}
```

### Update Calendar Event

```typescript
async updateCalendarEvent(userContext: UserContext, eventId: string, updates: Partial<CalendarEvent>): Promise<CalendarEvent> {
  const accessToken = await this.teamsSSO.getAccessToken(userContext);
  
  const response = await fetch(`https://graph.microsoft.com/v1.0/me/calendar/events/${eventId}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(updates)
  });
  
  return await response.json();
}
```

### Delete Calendar Event

```typescript
async deleteCalendarEvent(userContext: UserContext, eventId: string): Promise<void> {
  const accessToken = await this.teamsSSO.getAccessToken(userContext);
  
  await fetch(`https://graph.microsoft.com/v1.0/me/calendar/events/${eventId}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${accessToken}`
    }
  });
}
```

## 🕐 Time Zone Handling

### Convert UTC to Local Time

```typescript
function convertToLocalTime(utcDateTime: string, timeZone: string = 'America/Chicago'): string {
  const date = new Date(utcDateTime);
  return date.toLocaleString('en-US', {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short'
  });
}

// Usage
const localTime = convertToLocalTime('2025-10-03T23:00:00.000Z', 'America/Chicago');
// Output: "Fri, Oct 3, 06:00 PM CDT"
```

### Handle Graph API Date Format

```typescript
function parseGraphDateTime(dateTime: string): Date {
  // Graph API returns dates with 7 decimal places, need to fix for JavaScript
  const fixedDateTime = dateTime.replace(/(\.\d{7})Z$/, '.000Z');
  return new Date(fixedDateTime);
}
```

## 🔍 Error Handling

### Common Graph API Errors

```typescript
class GraphAPIError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: any
  ) {
    super(message);
    this.name = 'GraphAPIError';
  }
}

async function handleGraphAPIError(response: Response): Promise<never> {
  const errorData = await response.json();
  
  switch (response.status) {
    case 401:
      throw new GraphAPIError(401, 'Unauthorized', 'Authentication required');
    case 403:
      throw new GraphAPIError(403, 'Forbidden', 'Insufficient permissions');
    case 404:
      throw new GraphAPIError(404, 'NotFound', 'Resource not found');
    case 429:
      throw new GraphAPIError(429, 'TooManyRequests', 'Rate limit exceeded');
    default:
      throw new GraphAPIError(response.status, 'Unknown', 'Unknown error occurred');
  }
}
```

### Retry Logic

```typescript
async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  delay: number = 1000
): Promise<T> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt === maxRetries) {
        throw error;
      }
      
      if (error instanceof GraphAPIError && error.status === 429) {
        // Rate limited, wait longer
        await new Promise(resolve => setTimeout(resolve, delay * attempt));
      } else {
        // Other error, wait and retry
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw new Error('Max retries exceeded');
}
```

## 📊 Data Models

### Calendar Event

```typescript
interface CalendarEvent {
  id: string;
  subject: string;
  body: {
    contentType: 'text' | 'html';
    content: string;
  };
  start: {
    dateTime: string;
    timeZone: string;
  };
  end: {
    dateTime: string;
    timeZone: string;
  };
  attendees: Attendee[];
  organizer: {
    emailAddress: {
      name: string;
      address: string;
    };
  };
  location?: {
    displayName: string;
    locationType: 'default' | 'conferenceRoom' | 'home' | 'office';
  };
  isOnlineMeeting: boolean;
  onlineMeetingUrl?: string;
  showAs: 'free' | 'tentative' | 'busy' | 'oof' | 'workingElsewhere';
  importance: 'low' | 'normal' | 'high';
  sensitivity: 'normal' | 'personal' | 'private' | 'confidential';
}
```

### Attendee

```typescript
interface Attendee {
  type: 'required' | 'optional' | 'resource';
  status: {
    response: 'none' | 'organizer' | 'tentativelyAccepted' | 'accepted' | 'declined';
    time: string;
  };
  emailAddress: {
    name: string;
    address: string;
  };
}
```

### Create Event Data

```typescript
interface CreateEventData {
  subject: string;
  body?: {
    contentType: 'text' | 'html';
    content: string;
  };
  startDateTime: string;
  endDateTime: string;
  timeZone: string;
  attendees?: string[]; // Email addresses
  location?: string;
  isOnlineMeeting?: boolean;
  showAs?: 'free' | 'tentative' | 'busy' | 'oof' | 'workingElsewhere';
}
```

## 🧪 Testing

### Test Calendar Access

```typescript
// Test endpoint
app.get('/api/test-calendar', async (req, res) => {
  try {
    const userContext = req.user; // From authentication middleware
    const events = await graphService.getCalendarEvents(
      userContext,
      new Date(),
      new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // Next 7 days
    );
    
    res.json({
      status: 'success',
      message: 'Calendar access working',
      events: events.map(event => ({
        id: event.id,
        subject: event.subject,
        start: event.start,
        end: event.end,
        attendees: event.attendees?.length || 0
      }))
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: 'Calendar access failed',
      error: error.message
    });
  }
});
```

### Mock Graph API for Testing

```typescript
// Mock implementation for testing
class MockGraphService extends GraphService {
  async getCalendarEvents(userContext: UserContext, startDate: Date, endDate: Date): Promise<CalendarEvent[]> {
    return [
      {
        id: 'mock-event-1',
        subject: 'Test Meeting',
        start: {
          dateTime: startDate.toISOString(),
          timeZone: 'UTC'
        },
        end: {
          dateTime: new Date(startDate.getTime() + 60 * 60 * 1000).toISOString(),
          timeZone: 'UTC'
        },
        attendees: [],
        organizer: {
          emailAddress: {
            name: 'Test User',
            address: 'test@example.com'
          }
        }
      }
    ];
  }
}
```

## 🔒 Security Best Practices

### Token Management

```typescript
class TokenManager {
  private tokens = new Map<string, TokenData>();
  
  async storeToken(userId: string, tokenData: TokenData): Promise<void> {
    // Encrypt token before storing
    const encryptedToken = await this.encrypt(JSON.stringify(tokenData));
    
    // Store in database
    await this.database.storeToken(userId, encryptedToken);
  }
  
  async getToken(userId: string): Promise<TokenData | null> {
    const encryptedToken = await this.database.getToken(userId);
    if (!encryptedToken) return null;
    
    // Decrypt token
    const decryptedToken = await this.decrypt(encryptedToken);
    return JSON.parse(decryptedToken);
  }
  
  isTokenExpired(token: TokenData): boolean {
    return new Date() >= new Date(token.expires_at);
  }
}
```

### Permission Validation

```typescript
async function validatePermissions(userContext: UserContext): Promise<boolean> {
  try {
    const accessToken = await teamsSSO.getAccessToken(userContext);
    
    // Test with a simple Graph API call
    const response = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });
    
    return response.ok;
  } catch (error) {
    return false;
  }
}
```

## 📚 Additional Resources

- [Microsoft Graph API Documentation](https://docs.microsoft.com/en-us/graph/)
- [Graph Explorer](https://developer.microsoft.com/en-us/graph/graph-explorer)
- [Calendar API Reference](https://docs.microsoft.com/en-us/graph/api/resources/calendar)
- [Authentication Scopes](https://docs.microsoft.com/en-us/graph/permissions-reference)

---

*Last updated: October 3, 2025*
