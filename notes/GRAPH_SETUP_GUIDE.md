# Microsoft Graph API Setup Guide for Caleo Bot

## 🎯 Overview
This guide walks you through setting up Microsoft Graph API permissions for Caleo Bot to enable calendar read/write operations.

## 🔧 Azure App Registration Configuration

### Step 1: Access Azure Portal
1. Go to [Azure Portal](https://portal.azure.com)
2. Navigate to **Azure Active Directory** > **App registrations**
3. Find your app: `7ac8f532-c402-43c4-bcb9-7d18a7184ca0`

### Step 2: Configure API Permissions

#### Required Microsoft Graph Permissions

**Application Permissions (Admin Consent Required):**
- `Calendars.ReadWrite` - Read and write user calendars
- `User.Read.All` - Read user profiles
- `Calendars.ReadWrite.Shared` - Read and write shared calendars
- `Mail.ReadWrite` - Read and write user mail

**Delegated Permissions (User Consent):**
- `Calendars.ReadWrite` - Read and write user calendars
- `User.Read` - Read user profile
- `offline_access` - Maintain access to resources

#### How to Add Permissions:
1. In your app registration, go to **API permissions**
2. Click **Add a permission**
3. Select **Microsoft Graph**
4. Choose **Application permissions** for server-to-server access
5. Add the required permissions listed above
6. Click **Grant admin consent** (requires admin privileges)

### Step 3: Configure Authentication

#### Redirect URIs
Add these redirect URIs:
- `https://nonperversive-bellicosely-tawanna.ngrok-free.dev/api/auth/callback`
- `http://localhost:3978/api/auth/callback` (for local testing)

#### Supported Account Types
- **Accounts in this organizational directory only** (Single tenant)
- Or **Accounts in any organizational directory** (Multi-tenant)

### Step 4: Client Secret Configuration

#### Current Configuration:
- **Client ID**: `7ac8f532-c402-43c4-bcb9-7d18a7184ca0`
- **Client Secret**: `<YOUR_CLIENT_SECRET>`
- **Tenant ID**: `82ee4c80-a9cb-455b-95f4-d2168dfed70a`

#### Verify Secret is Active:
1. Go to **Certificates & secrets**
2. Ensure your client secret is **Active**
3. Note the expiration date
4. If expired, create a new secret

## 🔐 Authentication Flow Configuration

### Client Credentials Flow (Current Implementation)
```typescript
// This is what we're using for server-to-server authentication
const tokenEndpoint = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
const response = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
        client_id: process.env.MICROSOFT_APP_ID,
        client_secret: process.env.MICROSOFT_APP_PASSWORD,
        scope: 'https://graph.microsoft.com/.default',
        grant_type: 'client_credentials'
    })
});
```

### Delegated Flow (Future Enhancement)
For user-specific operations, we'll need to implement delegated authentication:
```typescript
// This would be used for user-specific calendar access
const authUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?` +
    `client_id=${clientId}&` +
    `response_type=code&` +
    `redirect_uri=${redirectUri}&` +
    `scope=Calendars.ReadWrite User.Read&` +
    `state=${state}`;
```

## 🧪 Testing Graph Service

### Test Endpoints
```bash
# Test Graph service authentication
curl -s http://localhost:3978/api/test-graph

# Expected success response:
{
  "status": "OK",
  "message": "Microsoft Graph service is working!",
  "graphEnabled": true
}

# Expected error response (if permissions not configured):
{
  "status": "ERROR",
  "message": "Microsoft Graph service test failed",
  "graphEnabled": false,
  "error": "Authentication failed"
}
```

### Debug Authentication Issues
```bash
# Check environment variables
echo "App ID: $MICROSOFT_APP_ID"
echo "App Password: $MICROSOFT_APP_PASSWORD"
echo "Tenant ID: $MICROSOFT_TENANT_ID"

# Test direct authentication
curl -X POST "https://login.microsoftonline.com/82ee4c80-a9cb-455b-95f4-d2168dfed70a/oauth2/v2.0/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "client_id=7ac8f532-c402-43c4-bcb9-7d18a7184ca0&client_secret=<YOUR_CLIENT_SECRET>&scope=https://graph.microsoft.com/.default&grant_type=client_credentials"
```

## 🔧 Common Issues & Solutions

### Issue 1: "Insufficient privileges to complete the operation"
**Solution**: Ensure admin consent is granted for all application permissions

### Issue 2: "Application not found in directory"
**Solution**: Verify the tenant ID matches your Azure AD tenant

### Issue 3: "Invalid client secret"
**Solution**: Check if the client secret has expired and create a new one

### Issue 4: "Insufficient privileges to complete the operation"
**Solution**: 
1. Go to Azure Portal > App registrations > Your app
2. Go to API permissions
3. Click "Grant admin consent for [Your Organization]"
4. Confirm the consent

## 📋 Required Azure Configuration Checklist

### ✅ App Registration Settings
- [ ] Application ID: `7ac8f532-c402-43c4-bcb9-7d18a7184ca0`
- [ ] Client Secret: Active and not expired
- [ ] Tenant ID: `82ee4c80-a9cb-455b-95f4-d2168dfed70a`

### ✅ API Permissions (Application)
- [ ] `Calendars.ReadWrite` - Admin consent granted
- [ ] `User.Read.All` - Admin consent granted
- [ ] `Calendars.ReadWrite.Shared` - Admin consent granted
- [ ] `Mail.ReadWrite` - Admin consent granted

### ✅ API Permissions (Delegated)
- [ ] `Calendars.ReadWrite` - User consent
- [ ] `User.Read` - User consent
- [ ] `offline_access` - User consent

### ✅ Authentication
- [ ] Redirect URIs configured
- [ ] Supported account types set
- [ ] Client credentials flow enabled

## 🚀 Next Steps After Configuration

### 1. Test Basic Authentication
```bash
curl -s http://localhost:3978/api/test-graph
```

### 2. Test Calendar Operations
```typescript
// Once authentication works, test calendar operations
const calendars = await graphService.getUserCalendars('me');
const events = await graphService.getCalendarEvents('me', startTime, endTime);
```

### 3. Integrate with AI Service
```typescript
// Use Graph data to enhance AI responses
const userProfile = await graphService.getUserProfile(userId);
const userCalendars = await graphService.getUserCalendars(userId);
```

## 🔒 Security Best Practices

### Environment Variables
- Store all secrets in `.env` file
- Never commit secrets to version control
- Use different secrets for different environments

### API Security
- Implement rate limiting
- Add request validation
- Log all API calls for auditing
- Use HTTPS for all communications

### Token Management
- Store tokens securely
- Implement token refresh logic
- Handle token expiration gracefully
- Never log access tokens

## 📊 Monitoring & Debugging

### Enable Detailed Logging
```typescript
// Add to graph-service.ts for debugging
console.log('Graph API Request:', requestUrl);
console.log('Graph API Response Status:', response.status);
console.log('Graph API Response Data:', responseData);
```

### Monitor API Usage
- Check Azure Portal > App registrations > Your app > API permissions
- Monitor Graph API usage in Azure Portal
- Set up alerts for authentication failures

## 🎯 Production Considerations

### Scaling
- Implement connection pooling
- Add request caching
- Use retry logic with exponential backoff
- Monitor rate limits

### Security
- Implement proper error handling
- Add request validation
- Use secure token storage
- Implement audit logging

This setup guide ensures your Caleo Bot has the necessary permissions to read and write calendar data through Microsoft Graph API.
