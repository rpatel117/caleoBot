# Caleo Bot Setup Guide

## 🎯 Overview

This guide will help you set up Caleo Bot from scratch, including all necessary configurations for Microsoft Teams, OpenAI, and Supabase integration.

## ✅ Prerequisites

- Node.js 18+ (recommended: Node.js 20+)
- npm or yarn package manager
- Microsoft Azure account
- OpenAI API account
- Supabase account
- ngrok account (for local development)

## 🚀 Quick Start

### 1. Clone and Install

```bash
git clone <repository-url>
cd caleoBot
npm install
```

### 2. Environment Configuration

Create a `.env` file in the root directory:

```bash
# Microsoft Bot Framework
MICROSOFT_APP_ID=your_app_id_here
MICROSOFT_APP_PASSWORD=your_app_password_here
MICROSOFT_TENANT_ID=common

# OpenAI
OPENAI_API_KEY=your_openai_api_key_here

# Supabase Configuration
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_ANON_KEY=your_supabase_anon_key_here
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key_here
DATABASE_URL=postgresql://postgres:[PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres
DIRECT_URL=postgresql://postgres:[PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres

# Encryption
ENCRYPTION_KEY=your_32_character_encryption_key_here

# Development
NODE_ENV=development
PORT=3978
NGROK_URL=http://localhost:3978
```

### 3. Build and Run

```bash
# Build TypeScript
npm run build

# Start the bot
npm start

# In another terminal, start ngrok
npm run ngrok
```

## 🔧 Detailed Setup

### Microsoft Azure Configuration

#### 1. Create App Registration

1. Go to [Azure Portal](https://portal.azure.com)
2. Navigate to **Azure Active Directory** → **App registrations**
3. Click **"New registration"**
4. Fill in:
   - **Name**: Caleo Bot
   - **Supported account types**: Accounts in this organizational directory only
   - **Redirect URI**: Web - `http://localhost:3978/auth/callback`

#### 2. Configure API Permissions

Add these **Delegated permissions**:
- `Calendars.ReadWrite`
- `offline_access`
- `OnlineMeetings.ReadWrite`
- `People.Read`
- `User.Read.All`

#### 3. Generate Client Secret

1. Go to **Certificates & secrets**
2. Click **"New client secret"**
3. Copy the secret value (you won't see it again)

#### 4. Register with Bot Framework

1. Go to [Bot Framework Portal](https://dev.botframework.com)
2. Click **"Create a bot"**
3. Choose **"Use existing app registration"**
4. Enter your App ID and secret
5. Set messaging endpoint: `https://your-ngrok-url.ngrok-free.dev/api/messages`

### OpenAI Configuration

1. Go to [OpenAI Platform](https://platform.openai.com)
2. Navigate to **API Keys**
3. Click **"Create new secret key"**
4. Copy the API key

### Supabase Configuration

#### 1. Create Project

1. Go to [Supabase](https://supabase.com)
2. Click **"New project"**
3. Choose organization and fill in project details

#### 2. Get Connection Details

1. Go to **Settings** → **Database**
2. Copy the connection string
3. Go to **Settings** → **API**
4. Copy the anon key and service role key

#### 3. Set Up Database Schema

Run the SQL script in `supabase-schema.sql` in your Supabase SQL editor:

```sql
-- Copy and paste the contents of supabase-schema.sql
```

### ngrok Configuration

1. Install ngrok: `npm install -g ngrok`
2. Sign up at [ngrok.com](https://ngrok.com)
3. Get your authtoken from the dashboard
4. Configure: `ngrok config add-authtoken YOUR_TOKEN`

## 🧪 Testing the Setup

### 1. Health Check

```bash
curl http://localhost:3978/api/health
# Should return: {"status":"OK","message":"Caleo Bot is running!"}
```

### 2. Test AI Service

```bash
curl http://localhost:3978/api/test-ai
# Should return AI response
```

### 3. Test Teams Integration

1. Go to [Microsoft Teams](https://teams.microsoft.com)
2. Click **"Apps"** → **"Manage your apps"** → **"Upload a custom app"**
3. Upload the `manifest/manifest.json` file
4. Start a conversation with the bot

## 🔍 Troubleshooting

### Common Issues

#### Bot Not Responding
- Check if ngrok is running: `curl https://your-ngrok-url.ngrok-free.dev/api/health`
- Verify Bot Framework registration
- Check console logs for errors

#### Authentication Errors
- Verify App ID and password in `.env`
- Check Azure App Registration permissions
- Ensure Bot Framework registration is complete

#### Database Connection Issues
- Verify Supabase credentials
- Check database schema is created
- Test connection with Supabase dashboard

### Debug Commands

```bash
# Check if bot is running
ps aux | grep "node dist/index.js"

# Check ngrok status
curl -s https://your-ngrok-url.ngrok-free.dev/api/health

# View logs
tail -f logs/bot.log  # if logging is configured
```

## 📋 Verification Checklist

- [ ] Bot server starts without errors
- [ ] ngrok tunnel is active and accessible
- [ ] Health check endpoint returns OK
- [ ] AI service responds to test requests
- [ ] Teams can send messages to bot
- [ ] Bot responds to Teams messages
- [ ] Database connection is working
- [ ] Authentication flow completes successfully

## 🚀 Next Steps

Once setup is complete:

1. **Test Calendar Integration**: Try calendar-related commands
2. **Configure Persistence**: Set up token storage
3. **Customize Responses**: Modify AI prompts for your use case
4. **Deploy to Production**: Follow the deployment guide

## 📚 Additional Resources

- [Microsoft Bot Framework Documentation](https://docs.microsoft.com/en-us/azure/bot-service/)
- [OpenAI API Documentation](https://platform.openai.com/docs)
- [Supabase Documentation](https://supabase.com/docs)
- [ngrok Documentation](https://ngrok.com/docs)

---

*For issues not covered in this guide, see [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)*
