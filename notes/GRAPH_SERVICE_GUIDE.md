# Microsoft Graph Service Integration Guide

## 🎯 Overview
The Graph Service (`src/graph-service.ts`) provides comprehensive Microsoft Graph API integration for calendar operations, user management, and meeting scheduling within Caleo Bot.

## 🔧 Setup Requirements

### Azure App Registration Permissions
Your Azure app registration needs the following Microsoft Graph API permissions:

#### Application Permissions (Admin Consent Required)
- `Calendars.ReadWrite` - Read and write user calendars
- `User.Read.All` - Read user profiles
- `Calendars.ReadWrite.Shared` - Read and write shared calendars
- `Mail.ReadWrite` - Read and write user mail (for meeting invitations)

#### Delegated Permissions (User Consent)
- `Calendars.ReadWrite` - Read and write user calendars
- `User.Read` - Read user profile
- `offline_access` - Maintain access to resources

### Environment Variables
```bash
# Required in .env file
MICROSOFT_APP_ID=your_app_id_here
MICROSOFT_APP_PASSWORD=your_app_password_here
MICROSOFT_TENANT_ID=your_tenant_id_here
```

## 🚀 Core Features

### 1. Authentication
- **Client Credentials Flow** - Server-to-server authentication
- **Automatic Token Refresh** - Handles token expiration
- **Error Handling** - Graceful authentication failures

### 2. User Management
```typescript
// Get user profile
const userProfile = await graphService.getUserProfile(userId);

// Get user's calendars
const calendars = await graphService.getUserCalendars(userId);
```

### 3. Calendar Operations

#### Read Operations
```typescript
// Get calendar events for a time range
const events = await graphService.getCalendarEvents(
    userId, 
    '2024-01-01T00:00:00Z', 
    '2024-01-31T23:59:59Z'
);
```

#### Write Operations
```typescript
// Create a new calendar event
const newEvent = await graphService.createCalendarEvent(userId, {
    subject: 'Team Meeting',
    start: {
        dateTime: '2024-01-15T10:00:00',
        timeZone: 'UTC'
    },
    end: {
        dateTime: '2024-01-15T11:00:00',
        timeZone: 'UTC'
    },
    attendees: [
        {
            emailAddress: {
                address: 'colleague@company.com',
                name: 'John Doe'
            },
            type: 'required'
        }
    ]
});

// Update an existing event
const updatedEvent = await graphService.updateCalendarEvent(
    userId, 
    eventId, 
    { subject: 'Updated Meeting Title' }
);

// Delete an event
const deleted = await graphService.deleteCalendarEvent(userId, eventId);
```

### 4. Meeting Scheduling
```typescript
// Find available meeting times
const availableTimes = await graphService.findMeetingTimes(
    userId,
    ['colleague1@company.com', 'colleague2@company.com'],
    60, // 60 minutes
    '2024-01-15T09:00:00Z',
    '2024-01-15T17:00:00Z'
);
```

## 🧪 Testing the Graph Service

### Test Endpoint
```bash
curl -s http://localhost:3978/api/test-graph
```

### Expected Response
```json
{
  "status": "OK",
  "message": "Microsoft Graph service is working!",
  "graphEnabled": true
}
```

### Error Response
```json
{
  "status": "ERROR",
  "message": "Microsoft Graph service test failed",
  "graphEnabled": false,
  "error": "Authentication failed"
}
```

## 🔒 Security Considerations

### Authentication Flow
1. **Client Credentials** - Uses app registration credentials
2. **Token Management** - Automatic token refresh
3. **Error Handling** - Graceful failure without exposing secrets

### Data Protection
- **Encryption in Transit** - All API calls use HTTPS
- **Token Security** - Access tokens stored securely in memory
- **Error Sanitization** - No sensitive data in error messages

## 📊 API Response Format

### Success Response
```typescript
interface GraphResponse<T> {
    data: T;
    success: true;
}
```

### Error Response
```typescript
interface GraphResponse<T> {
    data: T | null;
    success: false;
    error: string;
}
```

## 🎯 Use Cases

### 1. Meeting Scheduling
```typescript
// Check user's availability
const events = await graphService.getCalendarEvents(
    userId,
    startTime,
    endTime
);

// Find optimal meeting time
const availableTimes = await graphService.findMeetingTimes(
    userId,
    attendeeEmails,
    duration,
    startTime,
    endTime
);

// Create the meeting
const meeting = await graphService.createCalendarEvent(userId, {
    subject: 'Team Standup',
    start: { dateTime: optimalTime, timeZone: 'UTC' },
    end: { dateTime: endTime, timeZone: 'UTC' },
    attendees: attendeeList
});
```

### 2. Calendar Management
```typescript
// Get user's calendars
const calendars = await graphService.getUserCalendars(userId);

// Read calendar events
const todayEvents = await graphService.getCalendarEvents(
    userId,
    startOfDay,
    endOfDay
);

// Update event details
await graphService.updateCalendarEvent(userId, eventId, {
    subject: 'Updated Meeting',
    location: { displayName: 'Conference Room A' }
});
```

### 3. User Profile Integration
```typescript
// Get user information for personalization
const userProfile = await graphService.getUserProfile(userId);

// Use in AI responses
const personalizedResponse = `Hello ${userProfile.displayName}! I can help you schedule meetings.`;
```

## 🚨 Error Handling

### Common Errors
1. **Authentication Failed** - Check app registration and permissions
2. **Insufficient Permissions** - Verify Graph API permissions
3. **Rate Limiting** - Implement retry logic with exponential backoff
4. **Network Issues** - Handle connection timeouts gracefully

### Error Recovery
```typescript
try {
    const result = await graphService.getCalendarEvents(userId, start, end);
    if (!result.success) {
        console.error('Graph API error:', result.error);
        // Implement fallback logic
    }
} catch (error) {
    console.error('Unexpected error:', error);
    // Handle unexpected errors
}
```

## 🔄 Integration with AI Service

### Enhanced AI Responses
```typescript
// In ai-service.ts, you can now use Graph data
const userProfile = await graphService.getUserProfile(userId);
const userCalendars = await graphService.getUserCalendars(userId);

// Create context-aware AI prompts
const systemPrompt = `User: ${userProfile.displayName}
Available Calendars: ${userCalendars.map(c => c.name).join(', ')}
I can help schedule meetings and manage your calendar.`;
```

### Meeting Creation Flow
```typescript
// AI processes natural language request
const aiResponse = await aiService.processMessage(teamsMessage);

// If user wants to schedule a meeting
if (isMeetingRequest(aiResponse.message)) {
    const meetingDetails = parseMeetingRequest(aiResponse.message);
    const newEvent = await graphService.createCalendarEvent(userId, meetingDetails);
    
    return `I've scheduled your meeting: ${newEvent.subject}`;
}
```

## 📈 Performance Considerations

### Caching Strategy
- **Token Caching** - Store access tokens to avoid repeated authentication
- **Response Caching** - Cache calendar data for short periods
- **Connection Pooling** - Reuse HTTP connections

### Rate Limiting
- **Microsoft Graph Limits** - 10,000 requests per 10 minutes per app
- **Implement Backoff** - Exponential backoff for rate limit errors
- **Request Batching** - Combine multiple requests when possible

## 🔧 Troubleshooting

### Common Issues

#### 1. Authentication Errors
```bash
# Check environment variables
echo $MICROSOFT_APP_ID
echo $MICROSOFT_APP_PASSWORD
echo $MICROSOFT_TENANT_ID
```

#### 2. Permission Errors
- Verify app registration has required permissions
- Ensure admin consent is granted
- Check that permissions are properly configured

#### 3. API Errors
```bash
# Test Graph service
curl -s http://localhost:3978/api/test-graph

# Check logs for detailed error messages
tail -f bot.log
```

### Debug Mode
```typescript
// Enable detailed logging
console.log('Graph API Request:', requestUrl);
console.log('Graph API Response:', responseData);
```

## 🚀 Next Steps

### Immediate Actions
1. **Test Graph Service** - Verify authentication and basic operations
2. **Configure Permissions** - Ensure all required permissions are granted
3. **Test Calendar Operations** - Verify read/write access to calendars

### Future Enhancements
1. **Advanced Scheduling** - Implement complex meeting scheduling logic
2. **Conflict Resolution** - Handle scheduling conflicts intelligently
3. **Recurring Meetings** - Support for recurring meeting patterns
4. **Time Zone Handling** - Proper time zone conversion and display

This Graph Service provides the foundation for all calendar-related functionality in Caleo Bot, enabling intelligent meeting scheduling and calendar management through natural language interactions.
