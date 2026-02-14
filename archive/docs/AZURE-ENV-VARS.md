# Azure App Service Environment Variables

## Required Environment Variables for Production

These should be set in Azure App Service Configuration:

```bash
# Microsoft Bot Framework
MICROSOFT_APP_ID=a66672e1-4d5f-4a39-9da9-48abebaadea4
MICROSOFT_APP_PASSWORD=<your_prod_app_password>
MICROSOFT_TENANT_ID=82ee4c80-a9cb-455b-95f4-d2168dfed70a

# Server Configuration
PORT=3978
NODE_ENV=production

# Bot Base URL (Azure URL)
NGROK_URL=https://caleo-bot-prod.azurewebsites.net

# Supabase Configuration
SUPABASE_URL=<your_supabase_url>
SUPABASE_ANON_KEY=<your_supabase_anon_key>
SUPABASE_SERVICE_ROLE_KEY=<your_supabase_service_role_key>

# Database Configuration
DATABASE_URL=<your_database_url>
DIRECT_URL=<your_direct_database_url>

# Encryption
ENCRYPTION_KEY=<your_encryption_key>

# OpenAI
OPENAI_API_KEY=<your_openai_api_key>

# Agent Configuration (for edge function)
USE_EDGE_AGENT=true
SUPABASE_AGENT_ENDPOINT=https://hvnbiqubzzkbveovdenj.supabase.co/functions/v1/caleo-agent
```

## Quick Setup Commands

```bash
# Set all at once (replace values)
az webapp config appsettings set \
  --resource-group caleo-bot-rg \
  --name caleo-bot-prod \
  --settings \
    MICROSOFT_APP_ID="a66672e1-4d5f-4a39-9da9-48abebaadea4" \
    MICROSOFT_APP_PASSWORD="<your_password>" \
    NGROK_URL="https://caleo-bot-prod.azurewebsites.net" \
    USE_EDGE_AGENT="true" \
    SUPABASE_AGENT_ENDPOINT="https://hvnbiqubzzkbveovdenj.supabase.co/functions/v1/caleo-agent" \
    NODE_ENV="production"
```

## Verification

After setting, verify the app starts:
```bash
az webapp log tail --resource-group caleo-bot-rg --name caleo-bot-prod
```

Look for:
- ✅ `Environment detected: prod (PRODUCTION)`
- ✅ `Using REMOTE agent (Supabase Edge Function)`
- ✅ `Using prod database tables`

