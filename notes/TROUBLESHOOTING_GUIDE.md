# Caleo Bot Troubleshooting Guide

## 🎯 Quick Status Check

### Verify Bot is Running
```bash
curl -s http://localhost:3978/api/health
# Should return: {"status":"OK","message":"Caleo Bot is running!"}
```

### Check ngrok Status
```bash
curl -s https://nonperversive-bellicosely-tawanna.ngrok-free.dev/api/health
# Should return: {"status":"OK","message":"Caleo Bot is running!"}
```

## 🔧 Common Issues & Solutions

### 1. 502 Bad Gateway Errors

**Symptoms:**
- ngrok shows 502 Bad Gateway
- Bot console shows crashes
- Teams can't reach the bot

**Root Causes & Solutions:**

#### A. Bot Process Crashed
```bash
# Check if bot is running
ps aux | grep "node dist/index.js"

# If not running, restart:
pkill -f "node dist/index.js"
npm run build && npm start
```

#### B. Authentication Errors Causing Crashes
**Error:** `AADSTS700016: Application not found in Bot Framework directory`

**Solution:** Check these in order:
1. **Verify .env file:**
   ```bash
   cat .env
   # Should show:
   # MICROSOFT_APP_ID=7ac8f532-c402-43c4-bcb9-7d18a7184ca0
   # MICROSOFT_APP_PASSWORD=<YOUR_CLIENT_SECRET>
   ```

2. **Check Azure App Registration:**
   - App ID matches: `7ac8f532-c402-43c4-bcb9-7d18a7184ca0`
   - Client secret is valid and not expired
   - App is registered in Bot Framework

3. **Verify Tenant ID:**
   - Current tenant: `82ee4c80-a9cb-455b-95f4-d2168dfed70a`
   - Check in `src/index.ts` line 16

#### C. Port Already in Use
```bash
# Kill existing processes
pkill -f "node dist/index.js"
lsof -ti:3978 | xargs kill -9

# Restart bot
npm run build && npm start
```

### 2. Duplicate Message Responses

**Symptoms:**
- Bot sends 2 identical responses
- Console shows duplicate "NEW MESSAGE" logs

**Solution:** Already implemented in current code:
```typescript
// Message ID tracking prevents duplicates
const messageId = context.activity.id;
if (processedMessages.has(messageId)) {
    console.log('🔄 Duplicate message ignored:', messageId);
    return;
}
processedMessages.add(messageId);
```

### 3. Authentication Issues

#### A. AADSTS700016 Error
**Error:** `Application with identifier '7ac8f532-c402-43c4-bcb9-7d18a7184ca0' was not found in the directory 'Bot Framework'`

**Solutions:**
1. **Check Azure Portal:**
   - Go to Azure Portal → App registrations
   - Find app with ID: `7ac8f532-c402-43c4-bcb9-7d18a7184ca0`
   - Verify it's registered with Bot Framework

2. **Regenerate Client Secret:**
   - Azure Portal → App registrations → Your app
   - Certificates & secrets → New client secret
   - Update `.env` file with new secret

3. **Verify Tenant ID:**
   - Current working tenant: `82ee4c80-a9cb-455b-95f4-d2168dfed70a`
   - Check if this matches your Azure tenant

#### B. Signing Key Errors
**Error:** `Signing Key could not be retrieved`

**Solution:** This is handled by our error handling code:
```typescript
try {
    await adapter.processActivity(req, res, async (context) => {
        // Bot logic here
    });
} catch (error) {
    console.error('❌ Error processing message:', error);
    res.send(200, 'OK'); // Prevents 502 errors
}
```

### 4. ngrok Issues

#### A. ngrok Already Running
**Error:** `ERR_NGROK_334: The endpoint is already online`

**Solution:**
```bash
# Kill existing ngrok
pkill -f ngrok
# Or use different port
npx ngrok http 3979
```

#### B. ngrok URL Changed
**Solution:** Update manifest.json:
```json
{
  "validDomains": [
    "your-new-ngrok-url.ngrok-free.dev"
  ]
}
```

### 5. Teams Integration Issues

#### A. Bot Not Responding in Teams
**Checklist:**
1. Bot is running: `curl http://localhost:3978/api/health`
2. ngrok is running: `curl https://your-ngrok-url.ngrok-free.dev/api/health`
3. Manifest.json has correct ngrok URL
4. App is re-uploaded to Teams after manifest changes

#### B. Bot Receives Messages But Doesn't Respond
**Check Console Logs:**
```bash
# Look for these in bot console:
=== NEW MESSAGE ===
From: [User Name]
Message: [Message Text]
✅ Response sent to Teams via Bot Framework
```

**If missing, check:**
- Authentication errors in console
- Bot Framework adapter configuration
- Error handling logs

## 🚀 Production Deployment Checklist

### Before Going Live:
- [ ] Bot responds to test messages
- [ ] No 502 errors in ngrok
- [ ] No duplicate responses
- [ ] Authentication working (no AADSTS errors)
- [ ] Health check endpoint responding
- [ ] Proper error logging in place

### Environment Variables:
```bash
# Required in .env file:
MICROSOFT_APP_ID=7ac8f532-c402-43c4-bcb9-7d18a7184ca0
MICROSOFT_APP_PASSWORD=<YOUR_CLIENT_SECRET>
NGROK_URL=https://nonperversive-bellicosely-tawanna.ngrok-free.dev
PORT=3978
```

### Key Files to Check:
- `.env` - Azure credentials
- `src/index.ts` - Bot logic and error handling
- `manifest/manifest.json` - Teams app configuration
- `package.json` - Dependencies and scripts

## 🔍 Debug Commands

### Check Bot Status:
```bash
# Health check
curl -s http://localhost:3978/api/health

# Check if process is running
ps aux | grep "node dist/index.js"

# Check port usage
lsof -i :3978
```

### Check ngrok:
```bash
# Test ngrok endpoint
curl -s https://nonperversive-bellicosely-tawanna.ngrok-free.dev/api/health

# Check ngrok process
ps aux | grep ngrok
```

### View Logs:
```bash
# Bot console logs (in terminal where bot is running)
# Look for:
# - "🤖 Caleo Bot is running on port 3978"
# - "=== NEW MESSAGE ==="
# - "✅ Response sent to Teams via Bot Framework"
# - Any error messages
```

## 📞 Emergency Recovery

If everything breaks:

1. **Kill all processes:**
   ```bash
   pkill -f "node dist/index.js"
   pkill -f ngrok
   ```

2. **Restart everything:**
   ```bash
   # Terminal 1
   npm run build && npm start
   
   # Terminal 2
   npm run ngrok
   ```

3. **Test:**
   ```bash
   curl -s http://localhost:3978/api/health
   curl -s https://nonperversive-bellicosely-tawanna.ngrok-free.dev/api/health
   ```

4. **Test in Teams:**
   - Send a message to the bot
   - Check console for "NEW MESSAGE" and "Response sent" logs

## ✅ Success Indicators

Your bot is working correctly when you see:
- ✅ Health check returns 200 OK
- ✅ Console shows "🤖 Caleo Bot is running on port 3978"
- ✅ Teams messages appear as "=== NEW MESSAGE ==="
- ✅ Console shows "✅ Response sent to Teams via Bot Framework"
- ✅ No 502 errors in ngrok
- ✅ Single responses (no duplicates)
- ✅ No authentication errors in console
