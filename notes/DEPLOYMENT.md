# Deployment Guide

## 🎯 Overview

This guide covers the complete deployment process for Caleo Bot, from local development to production environments.

## 🚀 Deployment Options

### 1. Azure App Service (Recommended)
- **Pros**: Easy setup, integrated with Microsoft ecosystem, auto-scaling
- **Cons**: Vendor lock-in, higher cost for high traffic
- **Best for**: Production deployments, enterprise environments

### 2. AWS Lambda + API Gateway
- **Pros**: Serverless, pay-per-use, auto-scaling
- **Cons**: Cold starts, 15-minute execution limit
- **Best for**: Variable traffic, cost optimization

### 3. Docker + Kubernetes
- **Pros**: Full control, portable, scalable
- **Cons**: Complex setup, requires Kubernetes knowledge
- **Best for**: Large-scale deployments, multi-cloud

### 4. VPS/Cloud Server
- **Pros**: Full control, cost-effective for consistent traffic
- **Cons**: Manual scaling, server management required
- **Best for**: Small to medium deployments

## 🔧 Azure App Service Deployment

### Prerequisites
- Azure account with active subscription
- Azure CLI installed
- Docker (optional, for container deployment)

### 1. Create App Service

```bash
# Login to Azure
az login

# Create resource group
az group create --name caleo-bot-rg --location eastus

# Create App Service plan
az appservice plan create \
  --name caleo-bot-plan \
  --resource-group caleo-bot-rg \
  --sku B1 \
  --is-linux

# Create web app
az webapp create \
  --resource-group caleo-bot-rg \
  --plan caleo-bot-plan \
  --name caleo-bot-app \
  --runtime "NODE|20-lts"
```

### 2. Configure Environment Variables

```bash
# Set environment variables
az webapp config appsettings set \
  --resource-group caleo-bot-rg \
  --name caleo-bot-app \
  --settings \
    MICROSOFT_APP_ID="your_app_id" \
    MICROSOFT_APP_PASSWORD="your_app_password" \
    OPENAI_API_KEY="your_openai_key" \
    SUPABASE_URL="your_supabase_url" \
    SUPABASE_SERVICE_ROLE_KEY="your_service_key" \
    DATABASE_URL="your_database_url" \
    ENCRYPTION_KEY="your_encryption_key" \
    NODE_ENV="production"
```

### 3. Deploy Application

#### Option A: Direct Deployment
```bash
# Deploy from local directory
az webapp deployment source config-zip \
  --resource-group caleo-bot-rg \
  --name caleo-bot-app \
  --src caleo-bot.zip
```

#### Option B: GitHub Actions
```yaml
# .github/workflows/deploy.yml
name: Deploy to Azure

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '20'
          
      - name: Install dependencies
        run: npm ci
        
      - name: Build application
        run: npm run build
        
      - name: Deploy to Azure
        uses: azure/webapps-deploy@v2
        with:
          app-name: 'caleo-bot-app'
          publish-profile: ${{ secrets.AZURE_WEBAPP_PUBLISH_PROFILE }}
          package: .
```

### 4. Configure Custom Domain (Optional)

```bash
# Add custom domain
az webapp config hostname add \
  --resource-group caleo-bot-rg \
  --webapp-name caleo-bot-app \
  --hostname your-domain.com

# Configure SSL certificate
az webapp config ssl bind \
  --resource-group caleo-bot-rg \
  --name caleo-bot-app \
  --certificate-thumbprint YOUR_CERT_THUMBPRINT
```

## 🐳 Docker Deployment

### 1. Create Dockerfile

```dockerfile
# Dockerfile
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY . .

# Build application
RUN npm run build

# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S caleo -u 1001

# Change ownership
RUN chown -R caleo:nodejs /app
USER caleo

# Expose port
EXPOSE 3978

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3978/api/health || exit 1

# Start application
CMD ["node", "dist/index.js"]
```

### 2. Build and Run

```bash
# Build Docker image
docker build -t caleo-bot .

# Run container
docker run -d \
  --name caleo-bot \
  -p 3978:3978 \
  -e MICROSOFT_APP_ID=your_app_id \
  -e MICROSOFT_APP_PASSWORD=your_app_password \
  -e OPENAI_API_KEY=your_openai_key \
  -e SUPABASE_URL=your_supabase_url \
  -e SUPABASE_SERVICE_ROLE_KEY=your_service_key \
  -e DATABASE_URL=your_database_url \
  -e ENCRYPTION_KEY=your_encryption_key \
  -e NODE_ENV=production \
  caleo-bot
```

### 3. Docker Compose

```yaml
# docker-compose.yml
version: '3.8'

services:
  caleo-bot:
    build: .
    ports:
      - "3978:3978"
    environment:
      - NODE_ENV=production
      - MICROSOFT_APP_ID=${MICROSOFT_APP_ID}
      - MICROSOFT_APP_PASSWORD=${MICROSOFT_APP_PASSWORD}
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - SUPABASE_URL=${SUPABASE_URL}
      - SUPABASE_SERVICE_ROLE_KEY=${SUPABASE_SERVICE_ROLE_KEY}
      - DATABASE_URL=${DATABASE_URL}
      - ENCRYPTION_KEY=${ENCRYPTION_KEY}
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3978/api/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
```

## ☁️ AWS Lambda Deployment

### 1. Install Serverless Framework

```bash
npm install -g serverless
npm install --save-dev serverless-offline
```

### 2. Create serverless.yml

```yaml
# serverless.yml
service: caleo-bot

provider:
  name: aws
  runtime: nodejs20.x
  region: us-east-1
  environment:
    NODE_ENV: production
    MICROSOFT_APP_ID: ${env:MICROSOFT_APP_ID}
    MICROSOFT_APP_PASSWORD: ${env:MICROSOFT_APP_PASSWORD}
    OPENAI_API_KEY: ${env:OPENAI_API_KEY}
    SUPABASE_URL: ${env:SUPABASE_URL}
    SUPABASE_SERVICE_ROLE_KEY: ${env:SUPABASE_SERVICE_ROLE_KEY}
    DATABASE_URL: ${env:DATABASE_URL}
    ENCRYPTION_KEY: ${env:ENCRYPTION_KEY}

functions:
  bot:
    handler: dist/index.handler
    events:
      - http:
          path: /{proxy+}
          method: ANY
          cors: true
    timeout: 30
    memorySize: 512

plugins:
  - serverless-offline
```

### 3. Deploy

```bash
# Deploy to AWS
serverless deploy

# Deploy to specific stage
serverless deploy --stage production
```

## 🔧 Environment Configuration

### Production Environment Variables

```bash
# Required variables
NODE_ENV=production
PORT=3978

# Microsoft Bot Framework
MICROSOFT_APP_ID=your_production_app_id
MICROSOFT_APP_PASSWORD=your_production_app_password
MICROSOFT_TENANT_ID=common

# OpenAI
OPENAI_API_KEY=your_production_openai_key

# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your_production_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_production_service_key
DATABASE_URL=postgresql://postgres:[PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres
DIRECT_URL=postgresql://postgres:[PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres

# Encryption
ENCRYPTION_KEY=your_production_encryption_key

# Optional
LOG_LEVEL=warn
MAX_CONCURRENT_REQUESTS=100
REQUEST_TIMEOUT=30000
```

### Environment-Specific Configs

```typescript
// config/index.ts
interface Config {
  nodeEnv: string;
  port: number;
  microsoft: {
    appId: string;
    appPassword: string;
    tenantId: string;
  };
  openai: {
    apiKey: string;
  };
  supabase: {
    url: string;
    anonKey: string;
    serviceKey: string;
    databaseUrl: string;
  };
  encryption: {
    key: string;
  };
}

const config: Config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3978'),
  microsoft: {
    appId: process.env.MICROSOFT_APP_ID!,
    appPassword: process.env.MICROSOFT_APP_PASSWORD!,
    tenantId: process.env.MICROSOFT_TENANT_ID || 'common'
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY!
  },
  supabase: {
    url: process.env.SUPABASE_URL!,
    anonKey: process.env.SUPABASE_ANON_KEY!,
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    databaseUrl: process.env.DATABASE_URL!
  },
  encryption: {
    key: process.env.ENCRYPTION_KEY!
  }
};

export default config;
```

## 📊 Monitoring and Logging

### Application Insights (Azure)

```typescript
// monitoring.ts
import { ApplicationInsights } from '@microsoft/applicationinsights';

const appInsights = new ApplicationInsights({
  config: {
    connectionString: process.env.APPLICATIONINSIGHTS_CONNECTION_STRING
  }
});

appInsights.start();

export const logger = {
  info: (message: string, properties?: any) => {
    appInsights.trackEvent({ name: 'Info', properties: { message, ...properties } });
  },
  error: (message: string, error?: Error, properties?: any) => {
    appInsights.trackException({ exception: error, properties: { message, ...properties } });
  },
  metric: (name: string, value: number, properties?: any) => {
    appInsights.trackMetric({ name, value, properties });
  }
};
```

### CloudWatch (AWS)

```typescript
// cloudwatch.ts
import { CloudWatchLogs } from 'aws-sdk';

const cloudWatch = new CloudWatchLogs();

export const logger = {
  info: async (message: string, properties?: any) => {
    await cloudWatch.putLogEvents({
      logGroupName: '/aws/lambda/caleo-bot',
      logStreamName: 'bot-logs',
      logEvents: [{
        message: JSON.stringify({ level: 'info', message, ...properties }),
        timestamp: Date.now()
      }]
    }).promise();
  }
};
```

## 🔒 Security Configuration

### HTTPS Configuration

```typescript
// https.ts
import https from 'https';
import fs from 'fs';

const options = {
  key: fs.readFileSync('path/to/private-key.pem'),
  cert: fs.readFileSync('path/to/certificate.pem')
};

const server = https.createServer(options, app);
```

### Security Headers

```typescript
// security.ts
import helmet from 'helmet';

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"]
    }
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
}));
```

## 🚀 CI/CD Pipeline

### GitHub Actions

```yaml
# .github/workflows/deploy.yml
name: Deploy

on:
  push:
    branches: [main]

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

  deploy:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Deploy to Azure
        uses: azure/webapps-deploy@v2
        with:
          app-name: 'caleo-bot-app'
          publish-profile: ${{ secrets.AZURE_WEBAPP_PUBLISH_PROFILE }}
          package: .
```

### Azure DevOps

```yaml
# azure-pipelines.yml
trigger:
- main

pool:
  vmImage: 'ubuntu-latest'

stages:
- stage: Build
  jobs:
  - job: BuildJob
    steps:
    - task: NodeTool@0
      inputs:
        versionSpec: '20.x'
    - script: |
        npm ci
        npm run test
        npm run build
      displayName: 'Build and Test'

- stage: Deploy
  dependsOn: Build
  jobs:
  - deployment: DeployJob
    environment: 'production'
    strategy:
      runOnce:
        deploy:
          steps:
          - task: AzureWebApp@1
            inputs:
              azureSubscription: 'Azure-Subscription'
              appName: 'caleo-bot-app'
              package: '$(System.DefaultWorkingDirectory)'
```

## 🔍 Health Checks

### Application Health Check

```typescript
// health.ts
app.get('/api/health', async (req, res) => {
  const health = {
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    services: {
      database: await checkDatabaseHealth(),
      openai: await checkOpenAIHealth(),
      graph: await checkGraphHealth()
    }
  };

  const isHealthy = Object.values(health.services).every(service => service.status === 'OK');
  
  res.status(isHealthy ? 200 : 503).json(health);
});

async function checkDatabaseHealth(): Promise<{status: string, message: string}> {
  try {
    await databaseService.testConnection();
    return { status: 'OK', message: 'Database connected' };
  } catch (error) {
    return { status: 'ERROR', message: error.message };
  }
}
```

### Load Balancer Health Check

```bash
# Configure health check endpoint
curl -f http://your-app.com/api/health || exit 1
```

## 📈 Scaling

### Horizontal Scaling

```yaml
# docker-compose.scale.yml
version: '3.8'

services:
  caleo-bot:
    build: .
    deploy:
      replicas: 3
      resources:
        limits:
          cpus: '0.5'
          memory: 512M
        reservations:
          cpus: '0.25'
          memory: 256M
    environment:
      - NODE_ENV=production
      # ... other environment variables
```

### Auto-scaling (Azure)

```bash
# Configure auto-scaling
az monitor autoscale create \
  --resource-group caleo-bot-rg \
  --resource caleo-bot-app \
  --resource-type Microsoft.Web/sites \
  --name caleo-bot-autoscale \
  --min-count 1 \
  --max-count 10 \
  --count 2
```

## 🔄 Rollback Strategy

### Blue-Green Deployment

```bash
# Deploy to staging slot
az webapp deployment slot create \
  --resource-group caleo-bot-rg \
  --name caleo-bot-app \
  --slot staging

# Deploy to staging
az webapp deployment source config-zip \
  --resource-group caleo-bot-rg \
  --name caleo-bot-app \
  --slot staging \
  --src caleo-bot.zip

# Swap slots
az webapp deployment slot swap \
  --resource-group caleo-bot-rg \
  --name caleo-bot-app \
  --slot staging \
  --target-slot production
```

### Rollback Commands

```bash
# Rollback to previous version
az webapp deployment source config-zip \
  --resource-group caleo-bot-rg \
  --name caleo-bot-app \
  --src previous-version.zip

# Restart application
az webapp restart \
  --resource-group caleo-bot-rg \
  --name caleo-bot-app
```

## 📋 Deployment Checklist

### Pre-deployment
- [ ] All tests pass
- [ ] Environment variables configured
- [ ] Database migrations applied
- [ ] SSL certificates valid
- [ ] Monitoring configured
- [ ] Backup strategy in place

### Post-deployment
- [ ] Health checks passing
- [ ] Application responding correctly
- [ ] Logs being collected
- [ ] Monitoring alerts configured
- [ ] Performance metrics normal
- [ ] User acceptance testing completed

## 🆘 Troubleshooting

### Common Issues

#### Application Won't Start
```bash
# Check logs
az webapp log tail --resource-group caleo-bot-rg --name caleo-bot-app

# Check environment variables
az webapp config appsettings list --resource-group caleo-bot-rg --name caleo-bot-app
```

#### Database Connection Issues
```bash
# Test database connection
az webapp config connection-string list --resource-group caleo-bot-rg --name caleo-bot-app

# Check firewall rules
az postgres server firewall-rule list --resource-group caleo-bot-rg --server-name your-server
```

#### Performance Issues
```bash
# Check metrics
az monitor metrics list --resource-group caleo-bot-rg --resource caleo-bot-app

# Scale up
az appservice plan update --resource-group caleo-bot-rg --name caleo-bot-plan --sku P1V2
```

---

*This deployment guide is maintained by the DevOps team and updated regularly based on infrastructure changes.*

*Last updated: October 3, 2025*
