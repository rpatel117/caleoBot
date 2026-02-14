# Microsoft Graph Permissions Test Results

## 🔍 Current Status Analysis

### ✅ What's Working:
- **Microsoft Graph Authentication** - Client credentials flow is working
- **AI Service** - OpenAI integration is working
- **Bot Framework** - Teams communication is working

### ❌ What's Failing:
- **User Data Access** - Cannot read user information
- **Calendar Access** - Cannot access user calendars
- **Delegated Permissions** - Not implemented

## 🎯 Root Cause

The issue is that **client credentials flow** (server-to-server) cannot access **user-specific data** like calendars, even with admin consent. Here's why:

### Client Credentials Flow Limitations:
```
✅ Can access: Application-level data
❌ Cannot access: User-specific data (calendars, emails, personal info)
```

### Required for Calendar Access:
```
✅ Delegated Permissions: User.Read, Calendars.ReadWrite
✅ User Consent: User must grant permission to the app
✅ Proper Authentication: OAuth2 delegated flow
```

## 🔧 Solution Options

### Option 1: Teams SSO (Recommended)
Since this is a Teams bot, we can leverage Teams Single Sign-On:

```typescript
// Teams provides user context and handles authentication
const userContext = {
    id: context.activity.from.id,
    name: context.activity.from.name,
    email: context.activity.from.aadObjectId,
    tenantId: context.activity.conversation.tenantId
};

// Use Teams SSO token for Graph API calls
const teamsToken = context.activity.serviceUrl; // Teams provides this
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

### Option 3: Application Permissions (Limited)
Use application permissions for specific scenarios:

```typescript
// This requires specific application permissions
// And may not work for all calendar operations
const events = await fetch(`${this.baseUrl}/users/${userId}/calendar/events`, {
    headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json'
    }
});
```

## 🚀 Recommended Implementation

### Step 1: Configure Azure Permissions
Add these **delegated permissions** to your Azure app registration:

- `Calendars.ReadWrite` (delegated)
- `User.Read` (delegated)
- `offline_access` (delegated)

### Step 2: Implement Teams SSO
Use Teams Single Sign-On for seamless authentication:

```typescript
// In your message handler
const userContext = {
    id: context.activity.from.id,
    name: context.activity.from.name,
    email: context.activity.from.aadObjectId,
    tenantId: context.activity.conversation.tenantId
};

// Use Teams SSO token for Graph API calls
const userToken = await this.getTeamsUserToken(context);
```

### Step 3: Test Calendar Access
Once delegated permissions are configured:

```bash
# Test calendar access
curl -s http://localhost:3978/api/test-calendar-teams
```

## 📋 Next Steps

1. **Configure Azure Permissions** - Add delegated permissions
2. **Implement Teams SSO** - Use Teams authentication
3. **Test Calendar Access** - Verify calendar operations work
4. **Implement End-to-End Flow** - Complete meeting scheduling

## 🎯 Expected Result

After implementing delegated permissions:
- ✅ Bot can read user's calendar events
- ✅ Bot can create meetings on user's behalf
- ✅ Bot can find available meeting times
- ✅ Bot can manage user's schedule

The key is that **Teams already provides user context**, so we just need to implement the proper authentication flow to access their calendar data!
