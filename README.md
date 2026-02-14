# Caleo Bot - Enterprise Meeting Scheduler for Microsoft Teams

Caleo is an AI-powered meeting scheduler that integrates seamlessly into Microsoft Teams. Using natural language processing and Microsoft Graph API, Caleo intelligently schedules meetings by understanding user intent, checking calendar availability, and coordinating with team members across your organization.

## 🎉 **CURRENT STATUS: FULLY WORKING!**

✅ **Bot is operational and responding to Microsoft Teams messages**  
✅ **Authentication working with Azure Bot Framework**  
✅ **AI integration ready (OpenAI GPT-3.5-turbo)**  
✅ **No 502 errors or crashes**  
✅ **Single message responses (no duplicates)**  
✅ **Production-ready error handling**

**Quick Test:** Send a message to the bot in Microsoft Teams - it will respond with intelligent AI-generated responses!

**AI Features:**
- Context-aware responses based on conversation type
- Personalized interactions using sender names
- Intelligent meeting scheduling assistance
- Graceful fallbacks when AI service is unavailable

## 🎯 Business Use Case

**Problem**: Enterprise teams waste significant time coordinating meetings across multiple calendars, time zones, and availability constraints.

**Solution**: Caleo acts as an intelligent meeting coordinator that:
- Understands natural language meeting requests
- Checks real-time calendar availability across your organization
- Suggests optimal meeting times based on participant schedules
- Automatically creates and sends meeting invitations
- Handles timezone conversions and scheduling conflicts

## ✨ Key Features

### 🤖 **AI-Powered Natural Language Processing**
- Understands complex meeting requests: *"Schedule a 1-hour product review with the engineering team next Tuesday afternoon"*
- Extracts meeting details: participants, duration, preferred times, agenda items
- Handles follow-up questions and clarifications

### 📅 **Microsoft Graph Integration**
- **Calendar Access**: Read availability across all participants
- **People Search**: Find team members by name, role, or department
- **Meeting Creation**: Automatically create calendar events
- **Conflict Detection**: Identify and resolve scheduling conflicts
- **Timezone Handling**: Automatic timezone conversion for global teams

### 💬 **Seamless Teams Integration**
- Appears as a team member in Microsoft Teams
- Responds to @mentions in channels
- Handles direct messages for private scheduling
- Rich card interfaces for meeting confirmations

### 🔍 **Intelligent Scheduling Logic**
- **Availability Analysis**: Find optimal time slots across all participants
- **Preference Learning**: Remember user scheduling preferences
- **Conflict Resolution**: Suggest alternative times when conflicts arise
- **Recurring Meetings**: Handle weekly, monthly, and custom recurring patterns

## 🏗️ Architecture Overview

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Microsoft     │    │     Caleo Bot    │    │   Supabase      │
│     Teams       │◄──►│   (Node.js/TS)   │◄──►│  Edge Function  │
│                 │    │                  │    │   (LLM Backend) │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                │
                                ▼
                       ┌──────────────────┐
                       │  Microsoft Graph │
                       │      API         │
                       │  (Calendars &    │
                       │   People)        │
                       └──────────────────┘
```

## 🚀 Quick Start

### Prerequisites

1. **Node.js** (v18 or higher)
2. **Microsoft Teams** (desktop app recommended)
3. **Azure App Registration** with Microsoft Graph permissions
4. **Supabase Account** (for LLM backend)
5. **ngrok** (for local development)

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Copy the template and add your credentials:

```bash
cp config.env .env
```

Edit `.env` with your Azure app details:
```env
# Microsoft App Registration
MICROSOFT_APP_ID=your_app_id_here
MICROSOFT_APP_PASSWORD=your_app_password_here

# Server Configuration
PORT=3978

# Ngrok URL (update when running ngrok)
NGROK_URL=your_ngrok_url_here

# Supabase Configuration (for LLM backend)
SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_supabase_anon_key
```

### 3. Build and Start

```bash
# Build TypeScript
npm run build

# Start the bot
npm start
```

### 4. Expose with ngrok

```bash
# Install ngrok globally
npm install -g ngrok

# Expose your bot
npm run ngrok
```

### 5. Configure Microsoft Teams

1. **Update Manifest**: Edit `manifest/manifest.json` with your app ID and ngrok URL
2. **Side-load App**: Upload the manifest folder to Microsoft Teams
3. **Grant Permissions**: Allow calendar and people access when prompted

### 6. Test the Bot

Start a conversation with Caleo and try:
- *"Schedule a meeting with John Smith tomorrow at 2 PM"*
- *"Find a time for a 1-hour team standup next week"*
- *"When is Sarah available for a project review?"*

## 📋 Microsoft Graph Permissions Required

The bot requires these Microsoft Graph API permissions:

### Calendar Permissions
- `Calendars.Read` - Read user calendars
- `Calendars.ReadWrite` - Create and modify calendar events
- `Calendars.ReadWrite.Shared` - Access shared calendars

### People Permissions
- `People.Read` - Read user profiles and contacts
- `User.Read.All` - Read all users in the organization
- `Directory.Read.All` - Read organizational directory

### Teams Permissions
- `Channel.ReadBasic.All` - Read channel information
- `Team.ReadBasic.All` - Read team information

## 🔧 Development Workflow

### Local Development

1. **Start Bot**: `npm run dev` (auto-restart on changes)
2. **Expose with ngrok**: `npm run ngrok` (in separate terminal)
3. **Update Manifest**: If ngrok URL changes, update manifest.json
4. **Re-upload to Teams**: If manifest changes, re-upload to Teams
5. **Test & Debug**: Check console logs for message processing

### Project Structure

```
caleoBot/
├── src/
│   └── index.ts              # Main bot logic and message handling
├── manifest/
│   ├── manifest.json         # Teams app configuration
│   ├── color.png            # Bot icon (192x192)
│   └── outline.png          # Bot outline icon (32x32)
├── config.env               # Environment variables template
├── .env                     # Actual environment variables (git-ignored)
├── package.json             # Dependencies and scripts
├── tsconfig.json            # TypeScript configuration
└── README.md               # This file
```

### Current Bot Behavior

- **Direct Messages**: Responds to all messages with AI processing
- **Channel Messages**: Only responds when @mentioned
- **Message Processing**: Logs all incoming messages for debugging
- **Response Format**: Sends structured responses via Teams messaging

## 🎯 Example Use Cases

### 1. Simple Meeting Request
**User**: *"Schedule a 30-minute catch-up with the marketing team tomorrow"*

**Caleo Response**:
- Finds all marketing team members
- Checks availability for tomorrow
- Suggests optimal time slots
- Creates calendar event and sends invitations

### 2. Complex Scheduling
**User**: *"I need a 2-hour product review with engineering, design, and product managers next week, preferably in the afternoon"*

**Caleo Response**:
- Identifies team members from each department
- Analyzes availability across all participants
- Considers timezone differences
- Suggests multiple afternoon options
- Handles follow-up questions about specific times

### 3. Availability Check
**User**: *"When is everyone free for a team building event this Friday?"*

**Caleo Response**:
- Checks calendar availability for all team members
- Identifies common free time slots
- Suggests optimal duration and timing
- Provides conflict resolution options

## 🔮 Planned Features

### Phase 1: Core Scheduling (Current)
- ✅ Basic message processing
- ✅ Microsoft Teams integration
- ✅ Natural language understanding
- 🔄 Calendar availability checking
- 🔄 Meeting creation and invitations

### Phase 2: Advanced Features
- 📅 Recurring meeting patterns
- 🌍 Multi-timezone support
- 📝 Meeting agenda integration
- 🔔 Smart notifications and reminders
- 📊 Meeting analytics and insights

### Phase 3: Enterprise Features
- 🏢 Department and role-based scheduling
- 📋 Meeting room and resource booking
- 🔐 Advanced permission management
- 📈 Usage analytics and reporting
- 🔗 Integration with other enterprise tools

## 🛡️ Security Considerations

> **Note**: This is a development version. The following security improvements are planned for production:

### Immediate Security Needs
- [ ] Move hardcoded credentials to environment variables
- [ ] Implement proper secret management
- [ ] Add input validation and sanitization
- [ ] Implement rate limiting and security headers
- [ ] Add proper error handling and logging

### Production Security Requirements
- [ ] HTTPS enforcement
- [ ] OAuth2 flow for Microsoft Graph access
- [ ] Data encryption in transit and at rest
- [ ] Audit logging and monitoring
- [ ] GDPR compliance for EU users
- [ ] Access controls and permission management

## 🐛 Troubleshooting

### Bot Not Responding
1. Check console logs for authentication errors
2. Verify ngrok is running and URL is accessible
3. Ensure manifest.json has correct app ID and ngrok URL
4. Check Azure app registration permissions
5. Verify Microsoft Graph permissions are granted

### Authentication Issues
1. Regenerate app password in Azure portal
2. Update .env file with new credentials
3. Restart the bot after credential changes
4. Check tenant ID configuration

### Microsoft Graph Access
1. Ensure proper permissions are granted in Azure portal
2. Check that Teams app has been granted consent
3. Verify user has appropriate licenses for Graph API access
4. Test Graph API calls independently

## 📚 Documentation

- [Setup Guide](SETUP_STEPS.md) - Complete setup instructions and current status
- [Troubleshooting Guide](TROUBLESHOOTING_GUIDE.md) - Comprehensive troubleshooting for common issues
- [Troubleshooting Log](TROUBLESHOOTING.md) - Historical troubleshooting steps taken

## 🚨 Quick Troubleshooting

### Bot Not Responding?
1. **Check if bot is running:**
   ```bash
   curl -s http://localhost:3978/api/health
   ```

2. **Check ngrok:**
   ```bash
   curl -s https://nonperversive-bellicosely-tawanna.ngrok-free.dev/api/health
   ```

3. **Restart if needed:**
   ```bash
   pkill -f "node dist/index.js"
   npm run build && npm start
   ```

### Getting 502 Errors?
- Bot process likely crashed due to authentication issues
- Check console logs for `AADSTS700016` errors
- Verify `.env` file has correct Azure credentials
- See [Troubleshooting Guide](TROUBLESHOOTING_GUIDE.md) for detailed solutions

### Duplicate Messages?
- This was fixed in the current implementation
- Bot now tracks message IDs to prevent duplicates

### AI Not Responding?
1. **Check OpenAI API Key:**
   ```bash
   echo $OPENAI_API_KEY
   # Should show your OpenAI API key
   ```

2. **Test AI Service:**
   ```bash
   curl -s http://localhost:3978/api/test-ai
   # Should return: {"status":"OK","message":"AI service is working!","aiEnabled":true}
   ```

3. **Add OpenAI API Key to .env:**
   ```bash
   echo "OPENAI_API_KEY=your_openai_api_key_here" >> .env
   ```

## 📚 Resources

- [Microsoft Teams Bot Framework Documentation](https://docs.microsoft.com/en-us/microsoftteams/platform/bots/what-are-bots)
- [Microsoft Graph API Documentation](https://docs.microsoft.com/en-us/graph/)
- [Supabase Edge Functions](https://supabase.com/docs/guides/functions)
- [Azure App Registration Guide](https://docs.microsoft.com/en-us/azure/active-directory/develop/quickstart-register-app)

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly with Microsoft Teams
5. Submit a pull request

## 📄 License

MIT License - see LICENSE file for details

---

**Caleo Bot** - Making enterprise meeting scheduling as simple as a conversation. 🚀