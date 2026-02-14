# Calendar Access Authentication Guide

## 🎯 Current Status
- ✅ **Microsoft Graph Authentication** - Working (Client Credentials)
- ✅ **AI Service** - Working (OpenAI)
- ❌ **Calendar Access** - Failing (Requires Delegated Permissions)

## 🔍 The Issue

### Current Authentication Flow: **Client Credentials**
```typescript
// This works for server-to-server operations
const tokenEndpoint = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
const response = await fetch(tokenEndpoint, {
    method: 'POST',
    body: new URLSearchParams({
        client_id: process.env.MICROSOFT_APP_ID,
        client_secret: process.env.MICROSOFT_APP_PASSWORD,
        scope: 'https://graph.microsoft.com/.default',
        grant_type: 'client_credentials'
    })
});
```

### Required Authentication Flow: **Delegated Permissions**
```typescript
// This is needed for user-specific calendar access
const authUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?` +
    `client_id=${clientId}&` +
    `response_type=code&` +
    `redirect_uri=${redirectUri}&` +
    `scope=Calendars.ReadWrite User.Read offline_access&` +
    `state=${state}`;
```

## 🔧 Required Azure Configuration

### 1. API Permissions (Delegated)
Your Azure app registration needs these **delegated permissions**:

- ✅ `Calendars.ReadWrite` - Read and write user calendars
- ✅ `User.Read` - Read user profile
- ✅ `offline_access` - Maintain access to resources

### 2. Authentication Configuration
- ✅ **Redirect URIs** - Add your bot's callback URL
- ✅ **Supported Account Types** - Configure for your tenant
- ✅ **Implicit Grant** - Enable if needed

## 🚀 Implementation Options

### Option 1: Teams-Specific Authentication (Recommended)
Since this is a Teams bot, we can use Teams-specific authentication:

```typescript
// Teams provides user context in the message payload
const userId = context.activity.from.id;
const userEmail = context.activity.from.aadObjectId;

// Use the user's context for calendar access
const events = await graphService.getCalendarEvents(userId, startTime, endTime);
```

### Option 2: OAuth2 Delegated Flow
Implement full OAuth2 delegated authentication:

```typescript
// 1. Redirect user to Microsoft login
const authUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?` +
    `client_id=${clientId}&` +
    `response_type=code&` +
    `redirect_uri=${redirectUri}&` +
    `scope=Calendars.ReadWrite User.Read offline_access&` +
    `state=${state}`;

// 2. Handle callback and exchange code for token
const tokenResponse = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code: authCode,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
    })
});
```

### Option 3: Teams SSO (Simplest)
Use Teams Single Sign-On for seamless authentication:

```typescript
// Teams handles authentication automatically
// User context is provided in the message payload
const userInfo = {
    id: context.activity.from.id,
    name: context.activity.from.name,
    email: context.activity.from.aadObjectId
};
```

## 🎯 Recommended Approach: Teams Context

Since this is a Microsoft Teams bot, the easiest approach is to use the user context that Teams provides:

### 1. Extract User Information from Teams Message
```typescript
// In your message handler
const userInfo = {
    id: context.activity.from.id,
    name: context.activity.from.name,
    email: context.activity.from.aadObjectId,
    tenantId: context.activity.conversation.tenantId
};
```

### 2. Use User Context for Calendar Access
```typescript
// Pass user information to Graph service
const events = await graphService.getUserCalendarEvents(userInfo, startTime, endTime);
```

### 3. Implement User-Specific Authentication
```typescript
// In graph-service.ts
async getUserCalendarEvents(userInfo: UserInfo, startTime: string, endTime: string) {
    // Use user-specific authentication
    const userToken = await this.getUserToken(userInfo);
    
    const response = await fetch(`${this.baseUrl}/users/${userInfo.email}/calendar/events`, {
        headers: {
            'Authorization': `Bearer ${userToken}`,
            'Content-Type': 'application/json'
        }
    });
    
    return response.json();
}
```

## 🔧 Implementation Steps

### Step 1: Update Azure App Registration
1. Go to Azure Portal > App registrations > Your app
2. Add delegated permissions:
   - `Calendars.ReadWrite`
   - `User.Read`
   - `offline_access`
3. Grant admin consent for these permissions

### Step 2: Update Bot Code
1. Extract user information from Teams messages
2. Implement user-specific authentication
3. Use user context for calendar operations

### Step 3: Test Calendar Access
1. Send a message to the bot in Teams
2. Bot extracts user information
3. Bot accesses user's calendar using their context

## 🧪 Testing the Implementation

### Test User Context Extraction
```bash
# Send a message to the bot and check logs
# Look for user information in the message payload
```

### Test Calendar Access
```bash
# Test the calendar endpoint with user context
curl -s http://localhost:3978/api/test-calendar
```

## 📋 Next Steps

1. **Configure Azure Permissions** - Add delegated permissions
2. **Update Bot Code** - Extract user context from Teams messages
3. **Implement User Authentication** - Use user-specific tokens
4. **Test Calendar Access** - Verify calendar operations work

## 🎯 Expected Result

After implementing user-specific authentication:
- ✅ Bot can read user's calendar events
- ✅ Bot can create meetings on user's behalf
- ✅ Bot can find available meeting times
- ✅ Bot can manage user's schedule

This approach leverages the fact that Teams already provides user context, making calendar access much simpler than implementing full OAuth2 flows.
