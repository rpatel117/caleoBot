# Caleo Bot Architecture

## 🏗️ System Overview

Caleo Bot is a Node.js/TypeScript application that integrates Microsoft Teams with OpenAI's GPT models for intelligent meeting scheduling and team assistance.

## 📁 File Structure

```
caleoBot/
├── src/
│   ├── index.ts              # Main bot server and Teams integration
│   ├── ai-service.ts         # OpenAI integration and AI logic
│   └── simple-bot.js         # Legacy simple bot (unused)
├── manifest/
│   └── manifest.json         # Microsoft Teams app configuration
├── dist/                     # Compiled TypeScript output
├── .env                      # Environment variables (credentials)
├── package.json              # Dependencies and scripts
└── tsconfig.json            # TypeScript configuration
```

## 🔄 Data Flow

```
Microsoft Teams → Bot Framework → Node.js Server → AI Service → OpenAI API
                     ↓
                Teams Response ← Bot Framework ← Node.js Server ← AI Response
```

## 🧩 Core Components

### 1. **Main Server (`src/index.ts`)**
- **Purpose**: Handles Microsoft Teams integration via Bot Framework
- **Responsibilities**:
  - Receives messages from Microsoft Teams
  - Manages authentication with Azure Bot Framework
  - Routes messages to AI service
  - Sends responses back to Teams
  - Handles errors and fallbacks

### 2. **AI Service (`src/ai-service.ts`)**
- **Purpose**: Centralized AI interaction layer
- **Responsibilities**:
  - Formats Teams messages for OpenAI
  - Creates context-aware prompts
  - Calls OpenAI API
  - Handles AI errors gracefully
  - Provides fallback responses

### 3. **Teams Integration**
- **Bot Framework Adapter**: Handles Teams authentication and message routing
- **Manifest**: Defines bot capabilities and permissions
- **ngrok**: Exposes local server to Microsoft Teams

## 🔧 Configuration

### Environment Variables
```bash
# Microsoft Teams Authentication
MICROSOFT_APP_ID=your_app_id_here
MICROSOFT_APP_PASSWORD=your_app_password_here

# OpenAI Integration
OPENAI_API_KEY=your_openai_api_key_here

# Server Configuration
PORT=3978
NGROK_URL=https://your-ngrok-url.ngrok-free.dev
```

### Key Dependencies
- **botbuilder**: Microsoft Bot Framework for Teams integration
- **restify**: HTTP server framework
- **dotenv**: Environment variable management
- **TypeScript**: Type-safe development

## 🤖 AI Integration Architecture

### Message Processing Flow
1. **Teams Message Received** → Bot Framework validates authentication
2. **Message Parsing** → Extract user info, message text, conversation context
3. **AI Service Call** → Format message and send to OpenAI
4. **Response Generation** → OpenAI generates contextual response
5. **Teams Response** → Send AI response back to Teams user

### AI Service Features
- **Context Awareness**: Understands if message is in channel vs direct message
- **User Personalization**: Uses sender name in responses
- **Error Handling**: Graceful fallbacks when AI service fails
- **Prompt Engineering**: Optimized prompts for meeting scheduling context

## 🔒 Security & Authentication

### Microsoft Teams Authentication
- **Azure App Registration**: Bot identity and permissions
- **Bot Framework**: Secure message routing
- **JWT Token Validation**: Automatic token verification
- **Tenant Isolation**: Scoped to specific Azure tenant

### API Security
- **OpenAI API Key**: Secure credential storage
- **HTTPS Only**: All external communications encrypted
- **Error Sanitization**: No sensitive data in error messages

## 🚀 Deployment Architecture

### Development Environment
```
Local Machine:
├── Node.js Server (port 3978)
├── ngrok Tunnel (exposes to internet)
└── Microsoft Teams (receives bot messages)
```

### Production Considerations
- **Server Hosting**: Azure App Service, AWS Lambda, or similar
- **Database**: Future integration for meeting storage
- **Monitoring**: Application insights and logging
- **Scaling**: Horizontal scaling for multiple bot instances

## 📊 API Endpoints

### Bot Endpoints
- `POST /api/messages` - Microsoft Teams webhook
- `GET /api/health` - Health check
- `GET /api/test-ai` - AI service test

### External APIs
- **Microsoft Teams**: Bot Framework messaging
- **OpenAI API**: GPT-3.5-turbo for AI responses

## 🔄 Error Handling Strategy

### Multi-Layer Error Handling
1. **Bot Framework Level**: Authentication and message validation
2. **Application Level**: Try-catch around message processing
3. **AI Service Level**: OpenAI API error handling
4. **Fallback Level**: Default responses when AI fails

### Error Recovery
- **Graceful Degradation**: Bot continues working even if AI fails
- **User Feedback**: Clear error messages to users
- **Logging**: Comprehensive error logging for debugging
- **Health Checks**: Monitor service availability

## 🎯 Future Architecture Considerations

### Planned Enhancements
- **Database Integration**: Store meeting preferences and history
- **Microsoft Graph API**: Calendar and people search integration
- **Meeting Creation**: Direct calendar event creation
- **Advanced AI**: More sophisticated scheduling logic

### Scalability
- **Microservices**: Separate AI service as independent service
- **Message Queues**: Handle high message volumes
- **Caching**: Reduce OpenAI API calls
- **Load Balancing**: Multiple bot instances

## 🔍 Monitoring & Debugging

### Health Checks
- **Bot Status**: `GET /api/health`
- **AI Service**: `GET /api/test-ai`
- **Teams Integration**: Console logs for message flow

### Logging Strategy
- **Message Flow**: Track message processing pipeline
- **AI Interactions**: Log AI requests and responses
- **Error Tracking**: Comprehensive error logging
- **Performance**: Monitor response times

## 📈 Performance Considerations

### Optimization Strategies
- **Message Deduplication**: Prevent processing same message twice
- **AI Response Caching**: Cache common responses
- **Async Processing**: Non-blocking AI calls
- **Connection Pooling**: Reuse HTTP connections

### Resource Management
- **Memory Usage**: Efficient message processing
- **API Rate Limits**: Respect OpenAI rate limits
- **Connection Limits**: Manage concurrent requests
- **Error Recovery**: Prevent memory leaks

This architecture provides a solid foundation for Caleo Bot while maintaining flexibility for future enhancements and scaling requirements.
