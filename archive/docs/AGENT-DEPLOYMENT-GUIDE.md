# Agent Deployment Guide

This guide explains how to deploy the Caleo agent to Supabase Edge Functions and switch between local and remote execution modes.

## Overview

The agent system now supports two execution modes:
- **Local Mode**: Uses the existing `SimpleAgentService` running in your Node.js application
- **Remote Mode**: Uses a Supabase Edge Function that hosts the same agent logic

## Prerequisites

1. Supabase project set up
2. Supabase CLI installed (`npm install -g supabase`)
3. Environment variables configured

## Step 1: Deploy the Edge Function

### 1.1 Login to Supabase
```bash
supabase login
```

### 1.2 Link to your project
```bash
supabase link --project-ref YOUR_PROJECT_REF
```

### 1.3 Set environment secrets
```bash
supabase secrets set OPENAI_API_KEY=your_openai_api_key
supabase secrets set ENCRYPTION_KEY=your_encryption_key
supabase secrets set MICROSOFT_CLIENT_ID=your_microsoft_client_id
supabase secrets set MICROSOFT_CLIENT_SECRET=your_microsoft_client_secret
supabase secrets set NGROK_URL=https://your-ngrok-url.ngrok.io
```

### 1.4 Deploy the edge function
```bash
supabase functions deploy caleo-agent
```

## Step 2: Configure Environment Variables

Update your `config.env` file:

```env
# Agent Configuration
USE_EDGE_AGENT=false  # Set to true to use remote agent
SUPABASE_AGENT_ENDPOINT=https://YOUR_PROJECT_REF.supabase.co/functions/v1/caleo-agent
```

## Step 3: Test the Implementation

### 3.1 Test Local Mode
```bash
# Set USE_EDGE_AGENT=false in config.env
npm start
```

Visit: `http://localhost:3978/api/test-ai`

Expected response:
```json
{
  "status": "OK",
  "message": "AI service is working!",
  "aiEnabled": true,
  "agentMode": "local",
  "testResponse": "Hello! I'm Caleo, your AI assistant..."
}
```

### 3.2 Test Remote Mode
```bash
# Set USE_EDGE_AGENT=true in config.env
# Update SUPABASE_AGENT_ENDPOINT with your actual project ref
npm start
```

Visit: `http://localhost:3978/api/test-ai`

Expected response:
```json
{
  "status": "OK",
  "message": "AI service is working!",
  "aiEnabled": true,
  "agentMode": "remote",
  "testResponse": "Hello! I'm Caleo, your AI assistant..."
}
```

### 3.3 Run Parity Tests
```bash
npm run test:agent-parity
```

This will compare local vs remote agent responses and show latency differences.

## Step 4: Production Deployment

### 4.1 Deploy Edge Function to Production
```bash
supabase functions deploy caleo-agent --project-ref YOUR_PROD_PROJECT_REF
```

### 4.2 Update Production Environment
```env
USE_EDGE_AGENT=true
SUPABASE_AGENT_ENDPOINT=https://YOUR_PROD_PROJECT_REF.supabase.co/functions/v1/caleo-agent
```

## Architecture

### Local Mode Flow
```
Teams Message → Node.js App → SimpleAgentService → OpenAI API → Response
```

### Remote Mode Flow
```
Teams Message → Node.js App → Supabase Edge Function → OpenAI API → Response
```

## Edge Function Details

The edge function (`supabase/functions/caleo-agent/index.ts`) includes:

- **Agent Initialization**: Same OpenAI Agent SDK setup as local
- **Tool Definitions**: All 10 Graph API tools (calendar operations)
- **Token Management**: Retrieves and decrypts user tokens from Supabase
- **Graph API Integration**: Makes Microsoft Graph API calls server-side
- **Error Handling**: Returns auth URLs when tokens are missing/expired

## Request/Response Format

### Request to Edge Function
```json
{
  "userMessage": "What's on my calendar today?",
  "userContext": {
    "userId": "29:1K_7pin...",
    "name": "Rushi Patel",
    "email": "rushi@company.com",
    "tenantId": "82ee4c80-..."
  },
  "conversationHistory": [
    { "role": "user", "content": "Hello", "timestamp": 1234567890 },
    { "role": "assistant", "content": "Hi!", "timestamp": 1234567891 }
  ]
}
```

### Response from Edge Function
```json
{
  "response": "You have 3 meetings today...",
  "success": true,
  "metadata": {
    "model": "gpt-4o-mini",
    "toolCalls": 2,
    "latency": 1250
  }
}
```

## Troubleshooting

### Common Issues

1. **Edge Function Not Found (404)**
   - Check that the function is deployed: `supabase functions list`
   - Verify the endpoint URL in `SUPABASE_AGENT_ENDPOINT`

2. **Authentication Errors**
   - Ensure all secrets are set: `supabase secrets list`
   - Check that user tokens exist in the `OAuthToken` table

3. **Graph API Errors**
   - Verify Microsoft Graph API permissions
   - Check that user tokens are valid and not expired

4. **CORS Errors**
   - The edge function includes CORS headers for browser clients
   - For Teams, this shouldn't be an issue

### Debug Commands

```bash
# Check function logs
supabase functions logs caleo-agent

# Test function locally
supabase functions serve caleo-agent

# Check secrets
supabase secrets list
```

## Performance Considerations

- **Local Mode**: Faster for development, direct API calls
- **Remote Mode**: Better for production, centralized logic, easier scaling
- **Latency**: Remote mode adds network overhead (~100-500ms depending on location)
- **Cost**: Remote mode uses Supabase Edge Function compute time

## Next Steps

1. **Chrome Extension**: The edge function can be called from browser clients
2. **Web App**: Same agent logic can power a web interface
3. **Analytics**: Add logging and metrics to the edge function
4. **Caching**: Implement conversation history caching in Supabase
5. **Rate Limiting**: Add rate limiting to the edge function

## Files Created/Modified

### New Files
- `supabase/functions/caleo-agent/index.ts` - Edge function implementation
- `src/agent/config.ts` - Shared agent configuration
- `src/agent/client.ts` - Client abstraction (local/remote)
- `test-agent-parity.ts` - Testing script
- `AGENT-DEPLOYMENT-GUIDE.md` - This guide

### Modified Files
- `src/index.ts` - Added agent client switching
- `config.env` - Added agent configuration variables
- `package.json` - Added test script





