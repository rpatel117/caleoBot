# Development Guide

## 🎯 Overview

This guide provides comprehensive information for developers working on Caleo Bot, including development workflow, coding standards, and best practices.

## 🚀 Getting Started

### Prerequisites
- Node.js 20+ (recommended)
- npm or yarn package manager
- Git
- VS Code (recommended) or your preferred IDE
- Docker (optional, for local database)

### Initial Setup
```bash
# Clone repository
git clone <repository-url>
cd caleoBot

# Install dependencies
npm install

# Copy environment template
cp .env.template .env

# Build project
npm run build

# Start development server
npm run dev
```

## 📁 Project Structure

```
caleoBot/
├── src/                    # Source code
│   ├── index.ts           # Main bot server
│   ├── ai-service.ts      # AI service integration
│   ├── teams-sso-service.ts # Teams authentication
│   ├── graph-service.ts   # Microsoft Graph API
│   ├── database.ts        # Database service
│   └── encryption.ts      # Encryption utilities
├── dist/                  # Compiled JavaScript
├── manifest/              # Teams app manifest
├── notes/                 # Documentation
├── prisma/                # Database schema
├── .env                   # Environment variables
├── package.json           # Dependencies and scripts
└── tsconfig.json         # TypeScript configuration
```

## 🔧 Development Workflow

### Branch Strategy
- `main` - Production-ready code
- `develop` - Integration branch for features
- `feature/*` - Feature development branches
- `hotfix/*` - Critical bug fixes

### Git Workflow
```bash
# Create feature branch
git checkout -b feature/agent-architecture

# Make changes and commit
git add .
git commit -m "feat: implement agent orchestration"

# Push and create PR
git push origin feature/agent-architecture
```

### Code Standards

#### TypeScript Configuration
- Use strict mode
- Enable all strict type checks
- Use explicit return types for functions
- Prefer interfaces over types when possible

#### Naming Conventions
- **Files**: kebab-case (`ai-service.ts`)
- **Classes**: PascalCase (`AIService`)
- **Functions/Variables**: camelCase (`getUserById`)
- **Constants**: UPPER_SNAKE_CASE (`API_BASE_URL`)
- **Interfaces**: PascalCase with `I` prefix (`IUserContext`)

#### Code Organization
```typescript
// 1. Imports (external, then internal)
import { createClient } from '@supabase/supabase-js';
import { AIService } from './ai-service';

// 2. Interfaces and types
interface UserContext {
  userId: string;
  name: string;
}

// 3. Constants
const MAX_RETRIES = 3;

// 4. Class definition
class UserService {
  // 5. Private properties
  private supabase: any;
  
  // 6. Constructor
  constructor() {
    this.supabase = createClient(/* ... */);
  }
  
  // 7. Public methods
  async getUser(id: string): Promise<UserContext | null> {
    // Implementation
  }
  
  // 8. Private methods
  private validateUser(user: any): boolean {
    // Implementation
  }
}
```

## 🧪 Testing

### Unit Testing
```bash
# Run unit tests
npm run test

# Run tests with coverage
npm run test:coverage

# Run tests in watch mode
npm run test:watch
```

### Integration Testing
```bash
# Run integration tests
npm run test:integration

# Test specific service
npm run test:integration -- --grep "AI Service"
```

### End-to-End Testing
```bash
# Run E2E tests
npm run test:e2e

# Test with specific environment
NODE_ENV=test npm run test:e2e
```

### Test Structure
```typescript
// Example test file
describe('AIService', () => {
  let aiService: AIService;
  
  beforeEach(() => {
    aiService = new AIService();
  });
  
  describe('generateResponse', () => {
    it('should generate valid response', async () => {
      const response = await aiService.generateResponse('Hello');
      expect(response).toBeDefined();
      expect(typeof response).toBe('string');
    });
    
    it('should handle errors gracefully', async () => {
      // Mock error scenario
      jest.spyOn(aiService, 'callOpenAI').mockRejectedValue(new Error('API Error'));
      
      await expect(aiService.generateResponse('Hello')).rejects.toThrow('API Error');
    });
  });
});
```

## 🔍 Debugging

### Local Development
```bash
# Enable debug logging
DEBUG=* npm run dev

# Debug specific module
DEBUG=caleo:ai-service npm run dev

# Use Node.js debugger
node --inspect dist/index.js
```

### VS Code Debugging
Create `.vscode/launch.json`:
```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Debug Bot",
      "type": "node",
      "request": "launch",
      "program": "${workspaceFolder}/dist/index.js",
      "env": {
        "NODE_ENV": "development"
      },
      "console": "integratedTerminal"
    }
  ]
}
```

### Logging
```typescript
import winston from 'winston';

const logger = winston.createLogger({
  level: 'debug',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' })
  ]
});
```

## 🚀 Building and Deployment

### Build Process
```bash
# Clean build
npm run clean
npm run build

# Build for production
NODE_ENV=production npm run build

# Type check only
npm run type-check
```

### Environment Configuration
```bash
# Development
NODE_ENV=development
DEBUG=*

# Staging
NODE_ENV=staging
LOG_LEVEL=info

# Production
NODE_ENV=production
LOG_LEVEL=warn
```

### Docker Development
```dockerfile
# Dockerfile.dev
FROM node:20-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

EXPOSE 3978
CMD ["npm", "run", "dev"]
```

## 📊 Performance Monitoring

### Metrics Collection
```typescript
import { performance } from 'perf_hooks';

class PerformanceMonitor {
  private metrics: Map<string, number[]> = new Map();
  
  startTimer(name: string): () => void {
    const start = performance.now();
    return () => {
      const duration = performance.now() - start;
      this.recordMetric(name, duration);
    };
  }
  
  recordMetric(name: string, value: number): void {
    if (!this.metrics.has(name)) {
      this.metrics.set(name, []);
    }
    this.metrics.get(name)!.push(value);
  }
  
  getMetrics(): Record<string, { avg: number; max: number; min: number }> {
    const result: Record<string, any> = {};
    
    for (const [name, values] of this.metrics) {
      result[name] = {
        avg: values.reduce((a, b) => a + b, 0) / values.length,
        max: Math.max(...values),
        min: Math.min(...values)
      };
    }
    
    return result;
  }
}
```

### Memory Monitoring
```typescript
// Monitor memory usage
setInterval(() => {
  const usage = process.memoryUsage();
  console.log('Memory Usage:', {
    rss: `${Math.round(usage.rss / 1024 / 1024)} MB`,
    heapTotal: `${Math.round(usage.heapTotal / 1024 / 1024)} MB`,
    heapUsed: `${Math.round(usage.heapUsed / 1024 / 1024)} MB`,
    external: `${Math.round(usage.external / 1024 / 1024)} MB`
  });
}, 30000); // Every 30 seconds
```

## 🔒 Security Best Practices

### Input Validation
```typescript
import Joi from 'joi';

const userSchema = Joi.object({
  userId: Joi.string().uuid().required(),
  name: Joi.string().min(1).max(100).required(),
  email: Joi.string().email().required()
});

function validateUser(input: any): UserContext {
  const { error, value } = userSchema.validate(input);
  if (error) {
    throw new Error(`Validation error: ${error.details[0].message}`);
  }
  return value;
}
```

### Secure Configuration
```typescript
// Use environment variables for sensitive data
const config = {
  appId: process.env.MICROSOFT_APP_ID,
  appPassword: process.env.MICROSOFT_APP_PASSWORD,
  openaiKey: process.env.OPENAI_API_KEY,
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY
};

// Validate required configuration
const requiredEnvVars = ['MICROSOFT_APP_ID', 'MICROSOFT_APP_PASSWORD', 'OPENAI_API_KEY'];
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`Missing required environment variable: ${envVar}`);
  }
}
```

## 📚 Code Documentation

### JSDoc Comments
```typescript
/**
 * Creates a new calendar event for the specified user
 * @param userContext - The user context containing authentication info
 * @param eventData - The event data to create
 * @returns Promise resolving to the created event
 * @throws {Error} When user is not authenticated or event creation fails
 * @example
 * ```typescript
 * const event = await calendarService.createEvent(userContext, {
 *   subject: 'Team Meeting',
 *   startTime: '2025-10-03T14:00:00Z',
 *   endTime: '2025-10-03T15:00:00Z'
 * });
 * ```
 */
async createEvent(userContext: UserContext, eventData: CreateEventData): Promise<CalendarEvent> {
  // Implementation
}
```

### API Documentation
Use OpenAPI/Swagger for API documentation:
```yaml
# swagger.yaml
openapi: 3.0.0
info:
  title: Caleo Bot API
  version: 1.0.0
paths:
  /api/health:
    get:
      summary: Health check endpoint
      responses:
        '200':
          description: Service is healthy
          content:
            application/json:
              schema:
                type: object
                properties:
                  status:
                    type: string
                    example: "OK"
```

## 🔄 Continuous Integration

### GitHub Actions
```yaml
# .github/workflows/ci.yml
name: CI

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '20'
      - run: npm ci
      - run: npm run test
      - run: npm run build
      - run: npm run type-check
```

### Pre-commit Hooks
```json
// package.json
{
  "husky": {
    "hooks": {
      "pre-commit": "lint-staged"
    }
  },
  "lint-staged": {
    "*.{ts,js}": [
      "eslint --fix",
      "prettier --write",
      "git add"
    ]
  }
}
```

## 📋 Code Review Checklist

### Before Submitting PR
- [ ] Code follows project conventions
- [ ] All tests pass
- [ ] TypeScript compiles without errors
- [ ] No console.log statements in production code
- [ ] Error handling is implemented
- [ ] Documentation is updated
- [ ] Performance considerations addressed

### Reviewing PRs
- [ ] Code is readable and maintainable
- [ ] Logic is correct and efficient
- [ ] Security considerations addressed
- [ ] Tests cover new functionality
- [ ] Documentation is clear and complete

## 🆘 Getting Help

### Common Issues
1. **Build Errors**: Check TypeScript configuration and dependencies
2. **Test Failures**: Verify test environment and mocks
3. **Runtime Errors**: Check logs and debug configuration
4. **Performance Issues**: Use profiling tools and monitor metrics

### Resources
- [TypeScript Documentation](https://www.typescriptlang.org/docs/)
- [Node.js Best Practices](https://github.com/goldbergyoni/nodebestpractices)
- [Microsoft Bot Framework Docs](https://docs.microsoft.com/en-us/azure/bot-service/)
- [OpenAI API Documentation](https://platform.openai.com/docs)

---

*This guide is maintained by the development team and updated regularly based on project evolution.*

*Last updated: October 3, 2025*
