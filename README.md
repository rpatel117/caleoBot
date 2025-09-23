# Caleo Bot - Microsoft Teams AI Assistant

Caleo is an AI-powered assistant bot for Microsoft Teams that integrates seamlessly into your team conversations. Users can @mention Caleo in channels or send direct messages to get AI-powered assistance.

## Features

- 🤖 **AI-Powered Responses**: Intelligent responses using your Azure LLM backend
- 💬 **Seamless Integration**: Appears as a team member in Microsoft Teams
- 📝 **Console Logging**: All messages are logged for debugging
- 🔧 **Easy Development**: Simple setup for local development and testing

## Prerequisites

Before you begin, ensure you have:

1. **Node.js** (v16 or higher)
2. **npm** (comes with Node.js)
3. **Microsoft Teams** (desktop app recommended)
4. **Azure App Registration** (already set up)
5. **ngrok** (for local development tunneling)

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Copy the example config and update with your Azure app details:

```bash
cp config.env .env
```

Edit `.env` and add your Azure app registration details:
```
MICROSOFT_APP_ID=your_actual_app_id
MICROSOFT_APP_PASSWORD=your_actual_app_password
PORT=3978
```

### 3. Start the Bot

```bash
# Development mode with auto-restart
npm run dev

# Or production mode
npm start
```

The bot will start on `http://localhost:3978`

### 4. Expose Bot with ngrok

In a new terminal:

```bash
# Install ngrok if you haven't already
npm install -g ngrok

# Expose your bot
npm run ngrok
```

Copy the HTTPS URL (e.g., `https://abc123.ngrok.io`)

### 5. Update Manifest

Edit `manifest/manifest.json`:
1. Replace `your-app-id-here` with your actual Azure App ID
2. Replace `your-ngrok-url.ngrok.io` with your ngrok URL
3. Update other placeholder values

### 6. Side-load in Microsoft Teams

1. Open Microsoft Teams
2. Go to **Apps** → **Manage your apps** → **Upload an app**
3. Select **Upload a custom app**
4. Choose the `manifest` folder
5. Click **Add**

### 7. Test the Bot

1. Find Caleo in your Teams app list
2. Start a conversation with Caleo
3. Send a message like "Hello Caleo!"
4. Check your console for logged messages
5. Caleo should respond with "Hi, I'm Caleo! 👋"

## Development Workflow

### Local Development

1. **Start the bot**: `npm run dev`
2. **Expose with ngrok**: `npm run ngrok` (in another terminal)
3. **Update manifest** with new ngrok URL if it changes
4. **Re-upload to Teams** if manifest changed
5. **Test in Teams** and check console logs

### Console Logging

All incoming messages are logged to the console with:
- User name
- Message content
- Channel information
- Conversation details

### Bot Behavior

- **Direct Messages**: Responds to all messages
- **Channel Messages**: Only responds when @mentioned
- **Current Response**: "Hi, I'm Caleo! 👋" + "I'm your AI assistant. How can I help you today?"

## Project Structure

```
caleoBot/
├── src/
│   └── index.ts          # Main bot logic
├── manifest/
│   ├── manifest.json     # Teams app manifest
│   ├── color.png         # Bot icon (192x192)
│   └── outline.png       # Bot outline icon (32x32)
├── config.env            # Environment variables template
├── package.json          # Dependencies and scripts
├── tsconfig.json         # TypeScript configuration
└── README.md            # This file
```

## Next Steps

1. **Integrate Azure APIs**: Replace hardcoded responses with actual LLM calls
2. **Add Authentication**: Use Teams identity for API authentication
3. **Enhance Responses**: Add more sophisticated conversation logic
4. **Add Features**: File handling, rich cards, etc.

## Troubleshooting

### Bot Not Responding
- Check console logs for errors
- Verify ngrok is running and URL is correct
- Ensure manifest.json has correct app ID and ngrok URL
- Check Azure app registration permissions

### Side-loading Issues
- Make sure manifest.json is valid JSON
- Verify all required fields are filled
- Check that icons exist and are correct size
- Try refreshing Teams or clearing cache

### Connection Issues
- Verify ngrok is running
- Check firewall settings
- Ensure bot is running on correct port
- Verify Azure app credentials

## Support

For issues or questions, check the console logs first, then refer to the Microsoft Teams Bot Framework documentation.
