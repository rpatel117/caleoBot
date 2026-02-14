# Merge Preparation: agent-clean → caleo-prod

## ✅ Changes Made for Production Safety

### 1. Edge Function Updated (`supabase/functions/caleo-agent/index.ts`)
- ✅ Replaced all hardcoded ngrok URLs with environment variables
- ✅ Replaced hardcoded App ID with `MICROSOFT_CLIENT_ID` env var
- ✅ Replaced hardcoded client secret with `MICROSOFT_CLIENT_SECRET` env var
- ✅ Replaced hardcoded encryption key with `ENCRYPTION_KEY` env var
- ✅ Replaced hardcoded Supabase URLs/keys with env vars
- ✅ Environment detection now reads from `MICROSOFT_CLIENT_ID` env var
- ✅ Auth URLs now use `NGROK_URL` or `BOT_BASE_URL` env vars

### 2. Environment Variables Required

The edge function now requires these environment variables to be set in Supabase:

**For Dev:**
```bash
SUPABASE_URL=https://hvnbiqubzzkbveovdenj.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<dev-service-role-key>
OPENAI_API_KEY=<openai-key>
MICROSOFT_CLIENT_ID=7ac8f532-c402-43c4-bcb9-7d18a7184ca0
MICROSOFT_CLIENT_SECRET=<dev-client-secret>
ENCRYPTION_KEY=<encryption-key>
NGROK_URL=https://<your-ngrok-url>.ngrok-free.dev
```

**For Prod:**
```bash
SUPABASE_URL=<prod-supabase-url>
SUPABASE_SERVICE_ROLE_KEY=<prod-service-role-key>
OPENAI_API_KEY=<openai-key>
MICROSOFT_CLIENT_ID=a66672e1-4d5f-4a39-9da9-48abebaadea4
MICROSOFT_CLIENT_SECRET=<prod-client-secret>
ENCRYPTION_KEY=<encryption-key>
BOT_BASE_URL=https://caleo-bot-prod.azurewebsites.net
```

## 📋 Files Safe to Merge

### New Files (Logic Only)
- ✅ `src/agent/client.ts` - Agent client abstraction
- ✅ `src/agent/config.ts` - Shared agent configuration
- ✅ `src/database-env.ts` - Environment-aware database service
- ✅ `src/data-sanitizer.ts` - Data sanitization utilities
- ✅ `supabase/functions/caleo-agent/index.ts` - Edge function (NOW PRODUCTION-SAFE)
- ✅ `test-agent-parity.ts` - Testing script

### Modified Files (Logic Changes)
- ✅ `src/index.ts` - Environment detection + agent client (will auto-detect prod)
- ✅ `src/simple-agent-service.ts` - Agent service improvements
- ✅ `src/encryption.ts` - Enhanced token decryption
- ✅ `src/teams-sso-service.ts` - Environment-aware SSO
- ✅ `package.json` - Added test script

### Files to NOT Merge (Environment-Specific)
- ❌ `config.env` - Dev configuration (prod has `config.production.env`)
- ❌ `manifest/manifest.json` - Dev manifest (prod has `manifest-prod/`)
- ❌ Any documentation files with dev-specific URLs

## 🔄 Merge Process

### Step 1: Merge to Production Branch
```bash
git checkout caleo-prod
git merge agent-clean --no-commit
```

### Step 2: Review Changes
```bash
git status
# Verify no config files are being overwritten
```

### Step 3: Exclude Environment-Specific Files
```bash
# If any config files are staged, unstage them
git restore --staged config.env
git restore --staged manifest/manifest.json
```

### Step 4: Commit
```bash
git commit -m "Merge agent improvements: environment-aware services and edge function"
```

### Step 5: Set Supabase Edge Function Secrets (Production)

After merging, set these secrets in your production Supabase project:

```bash
# Login to Supabase
supabase login

# Link to production project
supabase link --project-ref <prod-project-ref>

# Set production secrets
supabase secrets set SUPABASE_URL=<prod-supabase-url>
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<prod-service-role-key>
supabase secrets set OPENAI_API_KEY=<openai-key>
supabase secrets set MICROSOFT_CLIENT_ID=a66672e1-4d5f-4a39-9da9-48abebaadea4
supabase secrets set MICROSOFT_CLIENT_SECRET=<prod-client-secret>
supabase secrets set ENCRYPTION_KEY=<prod-encryption-key>
supabase secrets set BOT_BASE_URL=https://caleo-bot-prod.azurewebsites.net

# Deploy edge function
supabase functions deploy caleo-agent
```

### Step 6: Verify Azure App Service Environment Variables

Ensure these are set in Azure App Service (production):

```bash
MICROSOFT_APP_ID=a66672e1-4d5f-4a39-9da9-48abebaadea4
NGROK_URL=https://caleo-bot-prod.azurewebsites.net
USE_EDGE_AGENT=true
SUPABASE_AGENT_ENDPOINT=https://<prod-supabase-project>.supabase.co/functions/v1/caleo-agent
```

## 🎯 What Will Work After Merge

1. **Environment Detection**: Automatically detects prod vs dev based on App ID
2. **Database Tables**: Uses `_Prod` suffix in production automatically
3. **Edge Function**: Uses production credentials from environment variables
4. **Agent Client**: Uses remote edge function when `USE_EDGE_AGENT=true`
5. **Authentication**: Uses Azure URL for OAuth callbacks in production

## ⚠️ Important Notes

1. **Edge Function Secrets**: Must be set in Supabase before deploying
2. **Azure Environment Variables**: Must be set in Azure App Service
3. **No Hardcoded Values**: All environment-specific values are now in env vars
4. **Backward Compatible**: Dev environment will continue to work with ngrok URLs

## ✅ Verification Checklist

After merge and deployment:

- [ ] Edge function secrets set in production Supabase
- [ ] Edge function deployed to production Supabase
- [ ] Azure App Service environment variables set
- [ ] Test health endpoint: `curl https://caleo-bot-prod.azurewebsites.net/api/health`
- [ ] Test AI endpoint: `curl https://caleo-bot-prod.azurewebsites.net/api/test-ai`
- [ ] Verify environment detection logs show "PRODUCTION"
- [ ] Verify database tables use `_Prod` suffix
- [ ] Test OAuth callback with Azure URL

## 🚀 Ready to Merge!

All code changes are production-safe. The merge will:
- ✅ Bring over all logic improvements
- ✅ Preserve production configurations
- ✅ Use environment variables for all sensitive data
- ✅ Work correctly in both dev and prod environments

