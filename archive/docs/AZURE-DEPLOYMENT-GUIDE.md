# Azure Deployment Guide - Caleo Bot

This guide documents the complete process of deploying Caleo Bot to Azure App Service, including all the steps, commands, configurations, and troubleshooting information.

## 📋 Overview

This guide covers:
- Azure infrastructure setup
- Environment configuration
- Code deployment
- Production branch setup
- Manifest configuration
- **Complete troubleshooting guide**
- **Endpoint testing and validation**
- **Common issues and solutions**

## 🚀 Step-by-Step Deployment Process

### Step 1: Azure CLI Setup

**Install Azure CLI:**
```bash
brew install azure-cli
```

**Login to Azure:**
```bash
az login
```

**Verify login:**
```bash
az account show
```

### Step 2: Create Azure Resources

**Create Resource Group:**
```bash
az group create --name caleo-bot-rg --location eastus
```

**Register Required Providers:**
```bash
az provider register --namespace Microsoft.Web
az provider register --namespace Microsoft.KeyVault
az provider register --namespace Microsoft.Insights
```

**Create App Service Plan (in West US 2 due to quota limits):**
```bash
az appservice plan create --name caleo-bot-plan --resource-group caleo-bot-rg --sku B1 --is-linux --location westus2
```

**Create Web App:**
```bash
az webapp create --resource-group caleo-bot-rg --plan caleo-bot-plan --name caleo-bot-prod --runtime "NODE|20-lts"
```

### Step 3: Configure Environment Variables

**Set Basic Environment Variables:**
```bash
az webapp config appsettings set --resource-group caleo-bot-rg --name caleo-bot-prod --settings NODE_ENV=production PORT=3978
```

**Set Microsoft Bot Framework Credentials:**
```bash
az webapp config appsettings set --resource-group caleo-bot-rg --name caleo-bot-prod --settings MICROSOFT_APP_ID="7ac8f532-c402-43c4-bcb9-7d18a7184ca0"

az webapp config appsettings set --resource-group caleo-bot-rg --name caleo-bot-prod --settings MICROSOFT_APP_PASSWORD="<YOUR_CLIENT_SECRET>"

az webapp config appsettings set --resource-group caleo-bot-rg --name caleo-bot-prod --settings MICROSOFT_TENANT_ID="common"
```

**Set OpenAI API Key:**
```bash
az webapp config appsettings set --resource-group caleo-bot-rg --name caleo-bot-prod --settings OPENAI_API_KEY="<YOUR_OPENAI_API_KEY>"
```

**Set Supabase Configuration:**
```bash
az webapp config appsettings set --resource-group caleo-bot-rg --name caleo-bot-prod --settings SUPABASE_URL="https://hvnbiqubzzkbveovdenj.supabase.co"

az webapp config appsettings set --resource-group caleo-bot-rg --name caleo-bot-prod --settings SUPABASE_ANON_KEY="<YOUR_SUPABASE_ANON_KEY>"

az webapp config appsettings set --resource-group caleo-bot-rg --name caleo-bot-prod --settings SUPABASE_SERVICE_ROLE_KEY="<YOUR_SUPABASE_SERVICE_ROLE_KEY>"
```

**Set Encryption Key:**
```bash
az webapp config appsettings set --resource-group caleo-bot-rg --name caleo-bot-prod --settings ENCRYPTION_KEY="<YOUR_ENCRYPTION_KEY>"
```

### Step 4: Build and Deploy Code

**Build TypeScript:**
```bash
npm run build
```

**Create Deployment Package:**
```bash
# Remove old package
rm caleo-bot.zip

# Create proper deployment package
zip -r caleo-bot-deployment.zip package.json dist/ node_modules/ manifest/
```

**Deploy to Azure:**
```bash
az webapp deployment source config-zip --resource-group caleo-bot-rg --name caleo-bot-prod --src caleo-bot-deployment.zip
```

**Note:** Initial deployment took ~347 seconds due to cold start and dependency installation.

### Step 5: Verify Deployment

**Check App Service Status:**
```bash
az webapp show --resource-group caleo-bot-rg --name caleo-bot-prod --query "state"
```

**Test Health Endpoint:**
```bash
curl -s https://caleo-bot-prod.azurewebsites.net/api/health
```

**Test AI Service:**
```bash
curl -s https://caleo-bot-prod.azurewebsites.net/api/test-ai
```

### Step 6: Configure Production Manifest

**Create Production Manifest Directory:**
```bash
mkdir -p manifest-prod
```

**Copy Assets:**
```bash
cp manifest/color.png manifest-prod/
cp manifest/outline.png manifest-prod/
```

**Create Production Manifest:**
```json
{
  "$schema": "https://developer.microsoft.com/en-us/json-schemas/teams/v1.16/MicrosoftTeams.schema.json",
  "manifestVersion": "1.16",
  "version": "1.0.0",
  "id": "7ac8f532-c402-43c4-bcb9-7d18a7184ca0",
  "packageName": "com.yourcompany.caleo-bot",
  "developer": {
    "name": "Caleo",
    "websiteUrl": "https://yourcompany.com",
    "privacyUrl": "https://yourcompany.com/privacy",
    "termsOfUseUrl": "https://yourcompany.com/terms"
  },
  "icons": {
    "color": "color.png",
    "outline": "outline.png"
  },
  "name": {
    "short": "Caleo Bot",
    "full": "Caleo AI Assistant Bot"
  },
  "description": {
    "short": "AI-powered assistant for your team",
    "full": "Caleo is an AI-powered assistant that helps your team with various tasks and questions. Simply @mention Caleo in any channel or send a direct message to get started."
  },
  "accentColor": "#FFFFFF",
  "bots": [
    {
      "botId": "7ac8f532-c402-43c4-bcb9-7d18a7184ca0",
      "scopes": [
        "personal"
      ],
      "supportsFiles": false,
      "isNotificationOnly": false,
      "supportsCalling": false,
      "supportsVideo": false
    }
  ],
  "permissions": [
    "identity"
  ],
  "validDomains": [
    "caleo-bot-prod.azurewebsites.net"
  ]
}
```

**Create Production Manifest Package:**
```bash
cd manifest-prod
zip -r ../caleo-bot-prod-manifest.zip .
cd ..
```

### Step 7: Set Up Production Branch

**Create Production Branch:**
```bash
git checkout -b caleo-prod
```

**Create Production Configuration:**
```bash
# Create config.production.env with production environment variables
# Create README-PRODUCTION.md with production setup instructions
```

**Commit Production Setup:**
```bash
git add .
git commit -m "Set up production branch with configuration and documentation"
```

## 🔧 Azure Resource Details

### Created Resources:
- **Resource Group**: `caleo-bot-rg`
- **App Service Plan**: `caleo-bot-plan` (B1, Linux, West US 2)
- **Web App**: `caleo-bot-prod` (Node.js 20 LTS)
- **URL**: `https://caleo-bot-prod.azurewebsites.net`

### Environment Variables Set (PRODUCTION):
- `NODE_ENV=production`
- `PORT=3978`
- `MICROSOFT_APP_ID=a66672e1-4d5f-4a39-9da9-48abebaadea4` (Production App ID)
- `MICROSOFT_APP_PASSWORD=<YOUR_CLIENT_SECRET>` (Production Secret)
- `MICROSOFT_TENANT_ID=common`
- `NGROK_URL=https://caleo-bot-prod.azurewebsites.net` (Critical for redirect URIs)
- `OPENAI_API_KEY=<YOUR_OPENAI_API_KEY>`
- `SUPABASE_URL=https://hvnbiqubzzkbveovdenj.supabase.co`
- `SUPABASE_ANON_KEY=<YOUR_SUPABASE_ANON_KEY>`
- `SUPABASE_SERVICE_ROLE_KEY=<YOUR_SUPABASE_SERVICE_ROLE_KEY>`
- `ENCRYPTION_KEY=<YOUR_ENCRYPTION_KEY>`

## 🚨 Important Notes

### Quota Issues Encountered:
- **East US**: No quota for Basic VMs
- **West US 2**: Successfully created resources
- **Solution**: Use different regions if quota limits are hit

### Deployment Package Requirements:
- Must include `package.json` in root
- Must include compiled `dist/` folder
- Must include `node_modules/` for dependencies
- Must include `manifest/` for Teams integration

### Long Deployment Time:
- Initial deployment: ~347 seconds (5+ minutes)
- Reason: Cold start, dependency installation, Node.js runtime setup
- Future deployments should be faster

## 🔍 Complete Troubleshooting Guide

### 🚨 Critical Issues We Encountered and Fixed

#### **1. Module Not Found Error (CRITICAL)**
```bash
Error: Cannot find module '/home/site/wwwroot/dist/index.js'
```
**Root Cause**: Deployment package missing compiled TypeScript files
**Solution**: 
```bash
# Ensure dist folder is included in deployment package
zip -r caleo-bot-deployment.zip dist/ package.json manifest/ node_modules/
```

#### **2. Redirect URI Mismatch (AUTHENTICATION)**
```bash
AADSTS50011: The redirect URI 'http://localhost:3978/auth/callback' specified in the request does not match the redirect URIs configured for the application
```
**Root Cause**: App using localhost instead of Azure URL
**Solution**: 
```bash
# Set NGROK_URL environment variable
az webapp config appsettings set --resource-group caleo-bot-rg --name caleo-bot-prod --settings NGROK_URL="https://caleo-bot-prod.azurewebsites.net"

# Add redirect URI in Azure App Registration
# https://caleo-bot-prod.azurewebsites.net/auth/callback
```

#### **3. Database Constraint Error (USER CREATION)**
```bash
duplicate key value violates unique constraint "User_email_key"
```
**Root Cause**: User already exists with same email but different AAD Object ID
**Solution**: Modified `teams-sso-service.ts` to handle existing users:
```typescript
// Check if user exists by email and update AAD Object ID
if (error.code === '23505' && error.message.includes('email')) {
  user = await this.db.getUserByEmail(userInfo.email);
  if (user) {
    await this.db.updateUserAadObjectId(user.id, userInfo.userId);
  }
}
```

#### **4. Bot Service Messaging Endpoint Null**
**Root Cause**: Bot Service not configured with correct messaging endpoint
**Solution**:
```bash
# Set messaging endpoint in Bot Service
az bot update --name caleo-bot-prod --resource-group caleo-bot-rg --endpoint "https://caleo-bot-prod.azurewebsites.net/api/messages"
```

#### **5. Teams Channel Not Enabled**
**Root Cause**: Teams channel not enabled for Bot Service
**Solution**: Enable Teams channel in Azure Portal or via CLI

### 🔧 Common Issues and Solutions

#### **1. Quota Errors:**
```bash
ERROR: Operation cannot be completed without additional quota
```
**Solution**: Try different Azure regions or request quota increase
```bash
# Try different regions
az appservice plan create --name caleo-bot-plan --resource-group caleo-bot-rg --sku B1 --is-linux --location westus2
```

#### **2. Deployment Timeout:**
```bash
ERROR: Deployment failed because the site failed to start within 10 mins
```
**Solution**: Ensure proper deployment package with all dependencies
```bash
# Create proper deployment package
zip -r caleo-bot-deployment.zip dist/ package.json manifest/ node_modules/
```

#### **3. Environment Variables Not Set:**
```bash
# Check current settings
az webapp config appsettings list --resource-group caleo-bot-rg --name caleo-bot-prod --output table

# Set missing variables
az webapp config appsettings set --resource-group caleo-bot-rg --name caleo-bot-prod --settings VARIABLE_NAME="value"
```

#### **4. Health Check Fails:**
```bash
# Test endpoints
curl https://caleo-bot-prod.azurewebsites.net/api/health
curl https://caleo-bot-prod.azurewebsites.net/api/test-ai
```

#### **5. App Service Authentication Issues:**
```bash
# Temporarily disable authentication for testing
az webapp auth update --resource-group caleo-bot-rg --name caleo-bot-prod --enabled false

# Re-enable after testing
az webapp auth update --resource-group caleo-bot-rg --name caleo-bot-prod --enabled true
```

### 🧪 Endpoint Testing and Validation

#### **Health Check Endpoints:**
```bash
# Basic health check
curl -s https://caleo-bot-prod.azurewebsites.net/api/health
# Expected: {"status":"OK","message":"Caleo Bot is running!"}

# AI service test
curl -s https://caleo-bot-prod.azurewebsites.net/api/test-ai
# Expected: AI response or error details

# Graph service test
curl -s https://caleo-bot-prod.azurewebsites.net/api/test-graph
# Expected: Graph API response or authentication error

# Teams SSO test
curl -s https://caleo-bot-prod.azurewebsites.net/api/test-teams-sso
# Expected: SSO configuration details
```

#### **Log Monitoring:**
```bash
# View real-time logs
az webapp log tail --resource-group caleo-bot-rg --name caleo-bot-prod

# View application logs only
az webapp log tail --resource-group caleo-bot-rg --name caleo-bot-prod --provider application

# Download logs
az webapp log download --resource-group caleo-bot-rg --name caleo-bot-prod
```

#### **App Service Status Checks:**
```bash
# Check app state
az webapp show --resource-group caleo-bot-rg --name caleo-bot-prod --query "state"

# Check app settings
az webapp config appsettings list --resource-group caleo-bot-rg --name caleo-bot-prod --output table

# Check CORS configuration
az webapp cors show --resource-group caleo-bot-rg --name caleo-bot-prod
```

### 🚀 Deployment Troubleshooting

#### **Deployment Package Issues:**
```bash
# Verify package contents
unzip -l caleo-bot-deployment.zip | head -20

# Check if dist folder exists
unzip -l caleo-bot-deployment.zip | grep "dist/"

# Rebuild and redeploy
npm run build
zip -r caleo-bot-deployment.zip dist/ package.json manifest/ node_modules/
az webapp deployment source config-zip --resource-group caleo-bot-rg --name caleo-bot-prod --src caleo-bot-deployment.zip
```

#### **Build and Runtime Issues:**
```bash
# Check if TypeScript compiled correctly
ls -la dist/

# Verify package.json start script
cat package.json | grep -A 5 -B 5 "scripts"

# Check Node.js version compatibility
az webapp config show --resource-group caleo-bot-rg --name caleo-bot-prod --query "linuxFxVersion"
```

### 🔐 Authentication and Authorization Issues

#### **Microsoft Graph Permissions:**
Required permissions for App Registration:
- `User.Read` (Delegated)
- `Calendars.Read` (Delegated)
- `Calendars.ReadWrite` (Delegated)
- `Mail.Read` (Delegated)
- `Mail.Send` (Delegated)
- `Files.ReadWrite` (Delegated)

#### **Bot Framework Authentication:**
```bash
# Verify Bot Service configuration
az bot show --name caleo-bot-prod --resource-group caleo-bot-rg

# Check messaging endpoint
az bot show --name caleo-bot-prod --resource-group caleo-bot-rg --query "properties.endpoint"

# Update messaging endpoint if needed
az bot update --name caleo-bot-prod --resource-group caleo-bot-rg --endpoint "https://caleo-bot-prod.azurewebsites.net/api/messages"
```

#### **Teams Manifest Issues:**
```bash
# Validate manifest JSON
cat manifest/manifest-prod.json | jq .

# Check App ID consistency
grep -r "a66672e1-4d5f-4a39-9da9-48abebaadea4" manifest/

# Verify valid domains
grep -A 5 "validDomains" manifest/manifest-prod.json
```

### 📊 Performance and Monitoring

#### **Application Insights:**
```bash
# Check if Application Insights is configured
az webapp config appsettings list --resource-group caleo-bot-rg --name caleo-bot-prod --query "[?name=='APPINSIGHTS_INSTRUMENTATIONKEY']"

# View Application Insights
az monitor app-insights component show --app caleo-bot-insights --resource-group caleo-bot-rg
```

#### **Resource Usage:**
```bash
# Check App Service metrics
az monitor metrics list --resource /subscriptions/{subscription-id}/resourceGroups/caleo-bot-rg/providers/Microsoft.Web/sites/caleo-bot-prod --metric "CpuPercentage,MemoryPercentage"

# Check App Service plan usage
az appservice plan show --name caleo-bot-plan --resource-group caleo-bot-rg --query "sku"
```

### 🛠️ Quick Fix Commands

#### **Restart Everything:**
```bash
# Restart App Service
az webapp restart --resource-group caleo-bot-rg --name caleo-bot-prod

# Restart Bot Service
az bot restart --name caleo-bot-prod --resource-group caleo-bot-rg
```

#### **Reset Environment:**
```bash
# Clear all app settings and reset
az webapp config appsettings delete --resource-group caleo-bot-rg --name caleo-bot-prod --setting-names @()

# Redeploy with fresh package
az webapp deployment source config-zip --resource-group caleo-bot-rg --name caleo-bot-prod --src caleo-bot-deployment.zip
```

#### **Emergency Rollback:**
```bash
# Stop the app
az webapp stop --resource-group caleo-bot-rg --name caleo-bot-prod

# Start with previous deployment
az webapp start --resource-group caleo-bot-rg --name caleo-bot-prod
```

## 🎉 Production Setup Completed

### ✅ What We Successfully Deployed:

1. **✅ Azure App Service**: Running on `https://caleo-bot-prod.azurewebsites.net`
2. **✅ Production Bot Registration**: App ID `a66672e1-4d5f-4a39-9da9-48abebaadea4`
3. **✅ Bot Service**: Configured with correct messaging endpoint
4. **✅ Teams Integration**: Production manifest uploaded and working
5. **✅ Database Connection**: Supabase integration working
6. **✅ Authentication Flow**: SSO and redirect URIs fixed
7. **✅ Environment Variables**: All production settings configured
8. **✅ End-to-End Testing**: Bot responding in Microsoft Teams

### 🔧 Production Configuration Details:

**App Service URL**: `https://caleo-bot-prod.azurewebsites.net`
**Bot Messaging Endpoint**: `https://caleo-bot-prod.azurewebsites.net/api/messages`
**Redirect URI**: `https://caleo-bot-prod.azurewebsites.net/auth/callback`
**Production App ID**: `a66672e1-4d5f-4a39-9da9-48abebaadea4`

### 🧪 Production Endpoints Working:

- **Health Check**: `https://caleo-bot-prod.azurewebsites.net/api/health`
- **AI Service**: `https://caleo-bot-prod.azurewebsites.net/api/test-ai`
- **Graph Service**: `https://caleo-bot-prod.azurewebsites.net/api/test-graph`
- **Teams SSO**: `https://caleo-bot-prod.azurewebsites.net/api/test-teams-sso`

## 📚 Next Steps (Optional)

1. **✅ COMPLETED**: Production Bot Registration and deployment
2. **✅ COMPLETED**: Production Manifest with new App ID
3. **🔄 PENDING**: Set up GitHub Actions CI/CD for automatic deployments
4. **🔄 PENDING**: Configure monitoring and logging (Application Insights)
5. **✅ COMPLETED**: Test bot in Microsoft Teams

## 🔗 Useful Commands

**Check App Service Status:**
```bash
az webapp show --resource-group caleo-bot-rg --name caleo-bot-prod --query "state"
```

**View App Service Logs:**
```bash
az webapp log tail --resource-group caleo-bot-rg --name caleo-bot-prod
```

**List Environment Variables:**
```bash
az webapp config appsettings list --resource-group caleo-bot-rg --name caleo-bot-prod --output table
```

**Restart App Service:**
```bash
az webapp restart --resource-group caleo-bot-rg --name caleo-bot-prod
```

## 📋 Quick Reference

### 🚀 Production URLs:
- **App Service**: `https://caleo-bot-prod.azurewebsites.net`
- **Health Check**: `https://caleo-bot-prod.azurewebsites.net/api/health`
- **Bot Messages**: `https://caleo-bot-prod.azurewebsites.net/api/messages`
- **Auth Callback**: `https://caleo-bot-prod.azurewebsites.net/auth/callback`

### 🔑 Production Credentials:
- **App ID**: `a66672e1-4d5f-4a39-9da9-48abebaadea4`
- **App Secret**: `<YOUR_CLIENT_SECRET>`
- **Resource Group**: `caleo-bot-rg`
- **App Service**: `caleo-bot-prod`
- **Bot Service**: `caleo-bot-prod`

### 🛠️ Emergency Commands:
```bash
# Check status
az webapp show --resource-group caleo-bot-rg --name caleo-bot-prod --query "state"

# View logs
az webapp log tail --resource-group caleo-bot-rg --name caleo-bot-prod

# Restart if needed
az webapp restart --resource-group caleo-bot-rg --name caleo-bot-prod

# Test endpoints
curl -s https://caleo-bot-prod.azurewebsites.net/api/health
```

### 📁 Key Files:
- **Production Manifest**: `manifest/manifest-prod.json`
- **Deployment Package**: `caleo-bot-deployment.zip`
- **Environment Config**: Azure App Service Settings
- **Source Code**: `src/` directory (TypeScript)
- **Compiled Code**: `dist/` directory (JavaScript)

---

*This guide was created and updated during the Azure deployment of Caleo Bot on October 13, 2025. All critical issues encountered and their solutions are documented above.*
