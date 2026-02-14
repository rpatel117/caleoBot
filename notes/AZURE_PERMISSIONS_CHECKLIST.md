# Azure Permissions Checklist for Caleo Bot

## 🎯 Current Status
- ✅ **Bot Framework Authentication** - Working
- ✅ **AI Service (OpenAI)** - Working  
- ❌ **Calendar Access** - Failing (401 Unauthorized)
- ❌ **User Data Access** - Failing (403 Forbidden)

## 🔍 Root Cause Analysis

The issue is that **client credentials flow** (server-to-server) cannot access **user-specific data** like calendars, even with admin consent.

### Current Authentication Flow:
```
Client Credentials = Server-to-Server Access
❌ Cannot access individual user calendars
❌ Cannot read user-specific data
❌ Cannot create meetings on behalf of users
```

### Required for Calendar Access:
```
Delegated Permissions = User-Specific Access
✅ Can access user's calendar
✅ Can read user's data
✅ Can create meetings on behalf of users
```

## 🔧 Required Azure Configuration

### 1. Application Permissions (Admin Consent Required)
Your Azure app registration needs these **application permissions**:

- ✅ `User.Read.All` - Read all users in tenant
- ✅ `Calendars.ReadWrite` - Read/write all calendars in tenant
- ✅ `Calendars.ReadWrite.Shared` - Access shared calendars

### 2. Delegated Permissions (User Consent)
Your Azure app registration needs these **delegated permissions**:

- ✅ `Calendars.ReadWrite` - Read and write user calendars
- ✅ `User.Read` - Read user profile
- ✅ `offline_access` - Maintain access to resources

## 🚀 Implementation Options

### Option 1: Teams SSO (Recommended)
Since this is a Teams bot, we can use Teams Single Sign-On:

```typescript
// Teams provides user context automatically
const userContext = {
    id: context.activity.from.id,
    name: context.activity.from.name,
    email: context.activity.from.aadObjectId,
    tenantId: context.activity.conversation.tenantId
};

// Use Teams SSO token for Graph API calls
const userToken = await this.getTeamsUserToken(context);
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

## 📋 Azure Configuration Steps

### Step 1: Access Azure Portal
1. Go to [Azure Portal](https://portal.azure.com)
2. Navigate to **Azure Active Directory** > **App registrations**
3. Find your app: `7ac8f532-c402-43c4-bcb9-7d18a7184ca0`

### Step 2: Configure API Permissions

#### Application Permissions (Admin Consent Required):
1. Go to **API permissions**
2. Click **Add a permission**
3. Select **Microsoft Graph**
4. Choose **Application permissions**
5. Add these permissions:
   - `User.Read.All`
   - `Calendars.ReadWrite`
   - `Calendars.ReadWrite.Shared`
6. Click **Grant admin consent**

#### Delegated Permissions (User Consent):
1. Go to **API permissions**
2. Click **Add a permission**
3. Select **Microsoft Graph**
4. Choose **Delegated permissions**
5. Add these permissions:
   - `Calendars.ReadWrite`
   - `User.Read`
   - `offline_access`
6. Users will be prompted to consent when they first use the bot

### Step 3: Test Permissions
After configuring permissions, test with:

```bash
# Test Graph service
curl -s http://localhost:3978/api/test-graph

# Test calendar access
curl -s http://localhost:3978/api/test-calendar-teams
```

## 🎯 Expected Results

### After Application Permissions:
- ✅ Can read user data (`/users` endpoint)
- ✅ Can access tenant information
- ❌ Still cannot access individual user calendars

### After Delegated Permissions:
- ✅ Can access user's calendar
- ✅ Can create meetings on user's behalf
- ✅ Can find available meeting times
- ✅ Can manage user's schedule

## 🚨 Common Issues

### Issue 1: "Insufficient privileges to complete the operation"
**Solution**: Add `User.Read.All` application permission and grant admin consent

### Issue 2: "401 Unauthorized" for calendar access
**Solution**: Implement delegated authentication flow or Teams SSO

### Issue 3: "offline_access" not working
**Solution**: Ensure `offline_access` is in delegated permissions and user has consented

## 🔧 Quick Test Commands

```bash
# Test basic Graph authentication
curl -s http://localhost:3978/api/test-graph

# Test calendar access
curl -s http://localhost:3978/api/test-calendar-teams

# Test AI service
curl -s http://localhost:3978/api/test-ai

# Test bot health
curl -s http://localhost:3978/api/health
```

## 🎯 Next Steps

1. **Configure Azure Permissions** - Add both application and delegated permissions
2. **Grant Admin Consent** - Required for application permissions
3. **Implement Teams SSO** - Use Teams authentication for user context
4. **Test Calendar Access** - Verify calendar operations work
5. **Implement End-to-End Flow** - Complete meeting scheduling functionality

The key is that **Teams already provides user context**, so we just need to implement the proper authentication flow to access their calendar data!
