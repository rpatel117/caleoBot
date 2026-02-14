# Authentication & Token Refresh Flow

## 🔐 Complete Authentication & Token Management Flow

### Overview
The bot uses **OAuth 2.0 with refresh tokens** for Microsoft Graph API access. Tokens are **encrypted** before storage and **automatically refreshed** when expired.

---

## 📋 Authentication Flow

### 1. Initial Authentication (First Time User)

```
User sends calendar-related message
    ↓
Bot checks: needsCalendarContext(message)
    ↓
Bot calls: teamsSSO.getAuthStatus(userContext)
    ↓
Checks database for user token
    ↓
[No token found] → Generate auth URL → Send to user
    ↓
User clicks auth URL → Microsoft OAuth consent
    ↓
User redirected to: /auth/callback?code=xxx&state=xxx
    ↓
Bot calls: teamsSSO.exchangeCodeForToken(code, state)
    ↓
Microsoft returns: { access_token, refresh_token, expires_in }
    ↓
Bot encrypts tokens → Stores in Supabase (OAuthToken_Prod table)
    ↓
✅ User authenticated
```

**Code Location:**
- `src/index.ts` lines 160-174 (auth check & URL generation)
- `src/index.ts` lines 212-270 (OAuth callback handler)
- `src/teams-sso-service.ts` lines 355-447 (token exchange)

---

## 🔄 Token Refresh Flow

### 2. Access Token Retrieval (Every Request)

```
User sends calendar-related message
    ↓
Bot calls: teamsSSO.getAccessToken(userContext)
    ↓
Get encrypted token from database (OAuthToken_Prod table)
    ↓
Decrypt access token (CryptoJS AES)
    ↓
Validate token with Microsoft Graph API (/me endpoint)
    ↓
[Token Valid] → Return decrypted access token ✅
    ↓
[Token Invalid/Expired] → Check refresh token
    ↓
[Has Refresh Token] → Call refreshAccessToken()
    ↓
Microsoft returns: { access_token, refresh_token, expires_in }
    ↓
Encrypt new tokens → Update database
    ↓
Return new access token ✅
    ↓
[No Refresh Token] → Return null → User needs to re-authenticate
```

**Code Location:**
- `src/teams-sso-service.ts` lines 157-235 (getAccessToken)
- `src/teams-sso-service.ts` lines 270-332 (refreshAccessToken)
- `src/teams-sso-service.ts` lines 240-265 (validateTokenWithMicrosoft)

---

## 🔐 Token Storage & Encryption

### Storage
- **Database**: Supabase `OAuthToken_Prod` table (production)
- **Environment-aware**: Uses `_Prod` suffix in production
- **Fields stored**:
  - `accessToken` (encrypted)
  - `refreshToken` (encrypted)
  - `expiresAt` (ISO timestamp)
  - `userId` (user's database ID)
  - `provider` (always "microsoft")

### Encryption
- **Method**: AES encryption using CryptoJS
- **Key**: `ENCRYPTION_KEY` environment variable
- **Format**: Base64-encoded encrypted strings
- **Handles**: Legacy hex-encoded tokens (from BYTEA database format)

**Code Location:**
- `src/encryption.ts` - EncryptionService class
- `src/database-env.ts` - Database token storage

---

## 🌐 Edge Function Token Handling

### How Edge Function Gets Tokens

**Current Flow (Remote Agent):**
```
Node.js App → getAccessToken() → Decrypts token → Passes to edge function
    ↓
Edge function receives: { userMessage, userContext, accessToken }
    ↓
Edge function uses accessToken directly for Graph API calls
    ↓
Edge function does NOT decrypt tokens (receives already decrypted)
```

**Important:** The edge function receives **already decrypted** access tokens from the Node.js app. It does NOT handle token decryption or refresh.

**Code Location:**
- `src/index.ts` line 177: Gets access token
- `src/index.ts` line 189: Passes to agent client
- `src/agent/client.ts` line 39: Passes to edge function
- `supabase/functions/caleo-agent/index.ts`: Uses token directly

---

## 🔄 Token Refresh Logic

### Automatic Refresh Conditions

1. **On Access Token Retrieval** (`getAccessToken()`):
   - Validates token with Microsoft Graph
   - If invalid → automatically refreshes using refresh token
   - Updates database with new tokens

2. **Token Expiration Check**:
   - Access tokens expire in ~1 hour
   - Refresh happens automatically when token is invalid
   - No proactive refresh (only when needed)

3. **Refresh Token Flow**:
   ```
   Refresh Token (from database) 
       ↓
   Decrypt refresh token
       ↓
   Call Microsoft token endpoint with refresh_token
       ↓
   Microsoft returns new access_token + new refresh_token
       ↓
   Encrypt both tokens
       ↓
   Update database with new tokens
       ↓
   Return new access_token
   ```

**Code Location:**
- `src/teams-sso-service.ts` lines 270-332 (refreshAccessToken)

---

## 🛡️ Security Features

### Token Encryption
- ✅ All tokens encrypted before storage (AES)
- ✅ Encryption key stored in environment variable
- ✅ Tokens decrypted only when needed
- ✅ Never logged or exposed in responses

### Token Validation
- ✅ Validates access tokens with Microsoft Graph before use
- ✅ Checks expiration time before using token
- ✅ Handles token refresh failures gracefully

### Environment Separation
- ✅ Production tokens stored in `OAuthToken_Prod` table
- ✅ Development tokens stored in `OAuthToken_Dev` table
- ✅ Automatic table selection based on App ID

---

## 📊 Token Lifecycle

### Access Token
- **Lifetime**: ~1 hour (3600 seconds)
- **Usage**: Direct API calls to Microsoft Graph
- **Storage**: Encrypted in database
- **Refresh**: Automatic when expired/invalid

### Refresh Token
- **Lifetime**: Long-lived (weeks/months)
- **Usage**: To obtain new access tokens
- **Storage**: Encrypted in database
- **Refresh**: Gets new refresh token on each refresh

---

## 🔍 Edge Function Token Handling

**Important Note:** The edge function has token refresh logic but **it's not currently being used** because:

1. Node.js app handles all token management
2. Edge function receives already-decrypted tokens
3. Edge function just uses tokens for Graph API calls

**Edge Function Token Code (Not Active):**
- `supabase/functions/caleo-agent/index.ts` lines 123-308
- This code exists but the edge function receives tokens from Node.js app

---

## ✅ Current Flow Summary

### For Calendar Operations:

```
1. User sends message: "What's on my calendar?"
   ↓
2. Bot detects calendar context needed
   ↓
3. Bot checks: teamsSSO.getAuthStatus()
   ↓
4. If not authenticated → Send auth URL
   ↓
5. If authenticated → Get access token:
   - Retrieve from database
   - Decrypt token
   - Validate with Microsoft
   - If invalid → Refresh automatically
   ↓
6. Pass decrypted access token to agent client
   ↓
7. Agent client passes to edge function
   ↓
8. Edge function uses token for Graph API calls
   ↓
9. Return calendar results to user
```

---

## 🎯 Key Points

1. **Token Storage**: Encrypted in Supabase database (environment-specific tables)
2. **Token Refresh**: Automatic when access token expires/invalid
3. **Token Flow**: Node.js app decrypts → Passes to edge function → Edge function uses directly
4. **Security**: All tokens encrypted at rest, decrypted only when needed
5. **Environment-Aware**: Production uses `_Prod` tables, dev uses `_Dev` tables

---

## 🔧 Configuration

### Required Environment Variables:
- `ENCRYPTION_KEY` - For encrypting/decrypting tokens
- `MICROSOFT_APP_ID` - OAuth client ID
- `MICROSOFT_APP_PASSWORD` - OAuth client secret
- `NGROK_URL` - For OAuth callback URL (Azure URL in prod)

### Database Tables:
- `OAuthToken_Prod` - Production tokens
- `OAuthToken_Dev` - Development tokens
- `User_Prod` - Production users
- `User_Dev` - Development users

---

## 🚨 Error Handling

### Token Refresh Failures:
- If refresh token is invalid → User must re-authenticate
- Returns auth URL for user to click
- Bot continues without calendar access

### Token Decryption Failures:
- Handles legacy hex-encoded tokens
- Handles corrupted tokens
- Falls back to re-authentication

---

This flow ensures secure, automatic token management with minimal user friction! 🔐

