# Caleo Bot API Reference

## 🎯 Overview

This document provides comprehensive API documentation for Caleo Bot, including all endpoints, request/response formats, and integration examples.

## 📡 Base URLs

- **Local Development**: `http://localhost:3978`
- **Production**: `https://your-domain.com`
- **ngrok**: `https://your-ngrok-url.ngrok-free.dev`

## 🔐 Authentication

### Bot Framework Authentication
All bot endpoints require Microsoft Bot Framework authentication via JWT tokens.

### API Key Authentication
Some endpoints require API keys for external service access.

## 📋 Endpoints

### Health Check

#### GET /api/health

Check if the bot service is running.

**Response:**
```json
{
  "status": "OK",
  "message": "Caleo Bot is running!",
  "timestamp": "2025-10-03T21:00:00.000Z"
}
```

**Status Codes:**
- `200` - Service is healthy
- `500` - Service error

---

### AI Service

#### GET /api/test-ai

Test the AI service integration.

**Response:**
```json
{
  "status": "success",
  "message": "AI service is working!",
  "response": "Hello! I'm Caleo, your AI assistant. How can I help you today?",
  "model": "gpt-4o-mini",
  "timestamp": "2025-10-03T21:00:00.000Z"
}
```

**Status Codes:**
- `200` - AI service working
- `500` - AI service error

---

### Microsoft Graph Integration

#### GET /api/test-graph

Test Microsoft Graph API integration.

**Response:**
```json
{
  "status": "success",
  "message": "Graph API is accessible",
  "user": {
    "id": "user-id",
    "displayName": "User Name",
    "mail": "user@example.com"
  }
}
```

**Status Codes:**
- `200` - Graph API accessible
- `401` - Authentication required
- `403` - Insufficient permissions

#### GET /api/test-calendar

Test calendar access.

**Response:**
```json
{
  "status": "success",
  "message": "Calendar access working",
  "events": [
    {
      "id": "event-id",
      "subject": "Meeting Title",
      "start": {
        "dateTime": "2025-10-03T18:00:00.000Z",
        "timeZone": "UTC"
      },
      "end": {
        "dateTime": "2025-10-03T19:00:00.000Z",
        "timeZone": "UTC"
      }
    }
  ]
}
```

---

### Teams SSO

#### GET /api/test-teams-sso

Test Teams Single Sign-On integration.

**Response:**
```json
{
  "status": "success",
  "message": "Teams SSO is working",
  "authenticated": true,
  "user": {
    "id": "user-id",
    "name": "User Name",
    "email": "user@example.com"
  }
}
```

---

### Bot Messages

#### POST /api/messages

Main bot endpoint for Microsoft Teams messages.

**Request Headers:**
```
Content-Type: application/json
Authorization: Bearer <jwt-token>
```

**Request Body:**
```json
{
  "type": "message",
  "id": "message-id",
  "timestamp": "2025-10-03T21:00:00.000Z",
  "channelId": "msteams",
  "from": {
    "id": "user-id",
    "name": "User Name"
  },
  "conversation": {
    "id": "conversation-id"
  },
  "text": "Hello, bot!",
  "channelData": {
    "tenant": {
      "id": "tenant-id"
    }
  }
}
```

**Response:**
```json
{
  "type": "message",
  "text": "Hello! How can I help you today?",
  "timestamp": "2025-10-03T21:00:00.000Z"
}
```

**Status Codes:**
- `200` - Message processed successfully
- `400` - Invalid request
- `401` - Authentication required
- `500` - Internal server error

---

## 🔄 Webhook Endpoints

### OAuth Callback

#### GET /auth/callback

Handle OAuth callback from Microsoft.

**Query Parameters:**
- `code` - Authorization code
- `state` - State parameter for security
- `session_state` - Session state

**Response:**
- Redirects to success/error page
- Stores authentication tokens

---

## 📊 Data Models

### User Context

```typescript
interface UserContext {
  userId: string;
  name: string;
  email: string;
  tenantId: string;
  isAuthenticated: boolean;
  tokenExpiry?: Date;
}
```

### Calendar Event

```typescript
interface CalendarEvent {
  id: string;
  subject: string;
  start: {
    dateTime: string;
    timeZone: string;
  };
  end: {
    dateTime: string;
    timeZone: string;
  };
  attendees: Attendee[];
  location?: {
    displayName: string;
  };
  organizer: {
    emailAddress: {
      name: string;
      address: string;
    };
  };
}
```

### Message

```typescript
interface Message {
  id: string;
  type: 'message' | 'typing' | 'ping';
  text: string;
  timestamp: string;
  from: {
    id: string;
    name: string;
  };
  conversation: {
    id: string;
  };
  channelData?: any;
}
```

---

## 🔧 Configuration

### Environment Variables

```bash
# Microsoft Bot Framework
MICROSOFT_APP_ID=your_app_id
MICROSOFT_APP_PASSWORD=your_app_password
MICROSOFT_TENANT_ID=common

# OpenAI
OPENAI_API_KEY=your_openai_key

# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
DATABASE_URL=postgresql://...
DIRECT_URL=postgresql://...

# Encryption
ENCRYPTION_KEY=your_32_character_key

# Development
NODE_ENV=development
PORT=3978
NGROK_URL=http://localhost:3978
```

---

## 🚀 Integration Examples

### JavaScript/Node.js

```javascript
const axios = require('axios');

// Test bot health
async function testBot() {
  try {
    const response = await axios.get('http://localhost:3978/api/health');
    console.log(response.data);
  } catch (error) {
    console.error('Bot is not running:', error.message);
  }
}

// Send message to bot
async function sendMessage(message) {
  try {
    const response = await axios.post('http://localhost:3978/api/messages', {
      type: 'message',
      text: message,
      from: { id: 'test-user', name: 'Test User' },
      conversation: { id: 'test-conversation' }
    });
    console.log(response.data);
  } catch (error) {
    console.error('Failed to send message:', error.message);
  }
}
```

### Python

```python
import requests

# Test bot health
def test_bot():
    try:
        response = requests.get('http://localhost:3978/api/health')
        print(response.json())
    except requests.exceptions.RequestException as e:
        print(f'Bot is not running: {e}')

# Send message to bot
def send_message(message):
    try:
        response = requests.post('http://localhost:3978/api/messages', json={
            'type': 'message',
            'text': message,
            'from': {'id': 'test-user', 'name': 'Test User'},
            'conversation': {'id': 'test-conversation'}
        })
        print(response.json())
    except requests.exceptions.RequestException as e:
        print(f'Failed to send message: {e}')
```

### cURL

```bash
# Test health
curl -X GET http://localhost:3978/api/health

# Test AI service
curl -X GET http://localhost:3978/api/test-ai

# Send message
curl -X POST http://localhost:3978/api/messages \
  -H "Content-Type: application/json" \
  -d '{
    "type": "message",
    "text": "Hello, bot!",
    "from": {"id": "test-user", "name": "Test User"},
    "conversation": {"id": "test-conversation"}
  }'
```

---

## 🔍 Error Handling

### Common Error Responses

#### 400 Bad Request
```json
{
  "error": "Bad Request",
  "message": "Invalid request format",
  "code": 400
}
```

#### 401 Unauthorized
```json
{
  "error": "Unauthorized",
  "message": "Authentication required",
  "code": 401
}
```

#### 403 Forbidden
```json
{
  "error": "Forbidden",
  "message": "Insufficient permissions",
  "code": 403
}
```

#### 500 Internal Server Error
```json
{
  "error": "Internal Server Error",
  "message": "An unexpected error occurred",
  "code": 500
}
```

### Error Handling Best Practices

1. **Always check status codes** before processing responses
2. **Implement retry logic** for transient errors
3. **Log errors** for debugging purposes
4. **Provide user-friendly error messages**
5. **Handle rate limiting** gracefully

---

## 📈 Rate Limits

### OpenAI API
- **Free tier**: 3 requests per minute
- **Paid tier**: Varies by plan
- **Rate limit headers**: `x-ratelimit-remaining`, `x-ratelimit-reset`

### Microsoft Graph API
- **Default**: 10,000 requests per 10 minutes per app
- **Rate limit headers**: `Retry-After`

### Bot Framework
- **No specific limits** but respect Microsoft's guidelines
- **Recommended**: < 30 messages per second per bot

---

## 🔒 Security Considerations

### Authentication
- Always use HTTPS in production
- Validate JWT tokens properly
- Implement proper CORS policies

### Data Protection
- Encrypt sensitive data at rest
- Use secure communication channels
- Implement proper access controls

### API Security
- Validate all input parameters
- Implement rate limiting
- Log security events
- Regular security audits

---

## 📚 Additional Resources

- [Microsoft Bot Framework Documentation](https://docs.microsoft.com/en-us/azure/bot-service/)
- [OpenAI API Documentation](https://platform.openai.com/docs)
- [Microsoft Graph API Documentation](https://docs.microsoft.com/en-us/graph/)
- [Supabase Documentation](https://supabase.com/docs)

---

*Last updated: October 3, 2025*
