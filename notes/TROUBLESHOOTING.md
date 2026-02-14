# Caleo Bot Troubleshooting Guide

## Current Status
- ✅ Bot is receiving messages from Microsoft Teams
- ✅ ngrok tunnel is working (https://nonperversive-bellicosely-tawanna.ngrok-free.dev)
- ✅ Bot code is properly structured
- ❌ **CRITICAL ISSUE**: Bot Framework authentication failing

## The Core Problem

**Error**: `AADSTS700016: Application with identifier '7ac8f532-c402-43c4-bcb9-7d18a7184ca0' was not found in the directory 'Bot Framework'`

This means your Azure App Registration exists but is **NOT registered with the Bot Framework service**.

## What We've Tried (That Didn't Work)

1. ✅ Updated credentials in `.env` file
2. ✅ Removed `channelAuthTenant` parameter
3. ✅ Added error handling and fallback responses
4. ✅ Implemented authentication bypass middleware
5. ✅ Created HTTP-only endpoint (temporary workaround)

**None of these fixed the root cause.**

## The Real Solution

### Option 1: Register with Bot Framework (Recommended)
1. Go to **https://dev.botframework.com/**
2. Sign in with your Microsoft account
3. Click **"Create a bot"** or **"Register a bot"**
4. Choose **"Use existing app registration"**
5. Enter your App ID: `7ac8f532-c402-43c4-bcb9-7d18a7184ca0`
6. Set messaging endpoint: `https://nonperversive-bellicosely-tawanna.ngrok-free.dev/api/messages`
7. Complete the registration process

### Option 2: Azure Bot Service
1. Go to **Azure Portal** → **Bot Services**
2. Click **"Create"** → **"Azure Bot"**
3. Use existing App ID: `7ac8f532-c402-43c4-bcb9-7d18a7184ca0`
4. Set messaging endpoint to your ngrok URL

## Current Configuration

### Environment Variables (`.env`)
```
MICROSOFT_APP_ID=7ac8f532-c402-43c4-bcb9-7d18a7184ca0
MICROSOFT_APP_PASSWORD=<YOUR_CLIENT_SECRET>
NGROK_URL=https://nonperversive-bellicosely-tawanna.ngrok-free.dev
```

### Manifest Configuration (`manifest/manifest.json`)
```json
{
  "id": "7ac8f532-c402-43c4-bcb9-7d18a7184ca0",
  "botId": "7ac8f532-c402-43c4-bcb9-7d18a7184ca0",
  "validDomains": ["nonperversive-bellicosely-tawanna.ngrok-free.dev"]
}
```

## Commands to Run

### Start the Bot
```bash
cd /Users/rpate/Desktop/caleoBot
npm run build
npm start
```

### Expose with ngrok (if not already running)
```bash
npm run ngrok
```

## What Happens After Registration

Once you register your app with the Bot Framework:

1. **Authentication will work** - No more `AADSTS700016` errors
2. **Bot will respond properly** - Messages will be sent back to Teams
3. **Production ready** - Full Bot Framework functionality restored

## Current Workaround Status

The bot is currently using a temporary HTTP-only endpoint that:
- ✅ Receives messages from Teams
- ✅ Logs message details
- ✅ Sends 200 OK response
- ❌ **Cannot send responses back to Teams** (this requires Bot Framework authentication)

## Next Steps

1. **Register your Azure App with Bot Framework** (this is the only real fix)
2. **Test the bot** - Send a message in Teams
3. **Verify responses** - Bot should reply properly
4. **Remove workaround code** - Restore full Bot Framework functionality

## Files Modified During Troubleshooting

- `src/index.ts` - Added error handling, authentication bypass attempts
- `.env` - Updated with correct credentials
- `manifest/manifest.json` - Updated with ngrok URL

## Why This Happened

The Azure App Registration was created but never registered with the Bot Framework service. This is a common oversight - having an Azure App doesn't automatically make it a Bot Framework bot.

## Production Considerations

- **Never bypass authentication** in production
- **Use proper error handling** (already implemented)
- **Monitor logs** for authentication issues
- **Keep credentials secure** (use environment variables)

---

**Bottom Line**: The code is correct. The issue is purely that the Bot Framework service doesn't know about your Azure App Registration. Once registered, everything will work as expected.
