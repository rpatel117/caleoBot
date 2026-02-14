# Production Setup Guide - Making Caleo-Prod Production Ready

This guide walks you through the complete process of making your `caleo-prod` branch production-ready with a new Azure Bot Service.

## 🎯 Overview

We'll create a completely separate production environment with:
- New Azure Bot Service
- New App Registration
- Updated environment variables
- Production manifest
- Teams integration

## 📋 Step-by-Step Production Setup

### Step 1: Create New Azure Bot Service

**1.1 Go to Azure Portal:**
- Navigate to [Azure Portal](https://portal.azure.com)
- Click **"Create a resource"**
- Search for **"Azure Bot"**
- Click **"Create"**

**1.2 Configure Bot Service:**
```
Project Details:
├── Subscription: [Your subscription]
├── Resource Group: caleo-bot-rg
└── Region: West US 2 (same as App Service)

Instance Details:
├── Bot handle: caleo-bot-prod-service
├── Pricing tier: F0 (Free)
└── Microsoft App ID: Create new

Messaging endpoint:
└── Endpoint URL: https://caleo-bot-prod.azurewebsites.net/api/messages
```

**1.3 Complete Creation:**
- Click **"Review + create"**
- Click **"Create"**
- Wait for deployment to complete

### Step 2: Get New App Registration Details

**2.1 Find Your New App Registration:**
- Go to **Azure Active Directory** → **App registrations**
- Find your new app (should be named something like "caleo-bot-prod-service")
- Click on it

**2.2 Get App ID:**
- Copy the **Application (client) ID** - this is your new `MICROSOFT_APP_ID`

**2.3 Create New Client Secret:**
- Go to **Certificates & secrets**
- Click **"New client secret"**
- Add description: "Caleo Bot Production Secret"
- Expires: 24 months
- Click **"Add"**
- **IMMEDIATELY COPY THE SECRET VALUE** - this is your new `MICROSOFT_APP_PASSWORD`

### Step 3: Update Azure App Service Environment Variables

**3.1 Update Microsoft Bot Credentials:**
```bash
# Update with your NEW production App ID
az webapp config appsettings set --resource-group caleo-bot-rg --name caleo-bot-prod --settings MICROSOFT_APP_ID="YOUR_NEW_PRODUCTION_APP_ID"

# Update with your NEW production App Password
az webapp config appsettings set --resource-group caleo-bot-rg --name caleo-bot-prod --settings MICROSOFT_APP_PASSWORD="YOUR_NEW_PRODUCTION_APP_PASSWORD"
```

**3.2 Verify Environment Variables:**
```bash
az webapp config appsettings list --resource-group caleo-bot-rg --name caleo-bot-prod --query "[?name=='MICROSOFT_APP_ID' || name=='MICROSOFT_APP_PASSWORD'].{name:name, value:value}" --output table
```

### Step 4: Update Production Manifest

**4.1 Edit Production Manifest:**
```bash
# Edit the production manifest file
nano manifest-prod/manifest.json
```

**4.2 Update App ID in Manifest:**
```json
{
  "$schema": "https://developer.microsoft.com/en-us/json-schemas/teams/v1.16/MicrosoftTeams.schema.json",
  "manifestVersion": "1.16",
  "version": "1.0.0",
  "id": "YOUR_NEW_PRODUCTION_APP_ID",
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
      "botId": "YOUR_NEW_PRODUCTION_APP_ID",
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

**4.3 Recreate Production Manifest Package:**
```bash
cd manifest-prod
rm ../caleo-bot-prod-manifest.zip
zip -r ../caleo-bot-prod-manifest.zip .
cd ..
```

### Step 5: Configure App Registration Permissions

**5.1 Add Microsoft Graph Permissions:**
- Go to your new App Registration
- Click **"API permissions"**
- Click **"Add a permission"**
- Select **"Microsoft Graph"**
- Add these permissions:
  ```
  Application Permissions:
  ├── User.Read.All
  ├── Directory.Read.All
  └── Calendars.ReadWrite

  Delegated Permissions:
  ├── User.Read
  ├── Calendars.Read
  ├── Calendars.ReadWrite
  └── People.Read
  ```

**5.2 Grant Admin Consent:**
- Click **"Grant admin consent for [Your Organization]"**
- Confirm the permissions

### Step 6: Test Production Setup

**6.1 Test App Service Health:**
```bash
curl -s https://caleo-bot-prod.azurewebsites.net/api/health
# Expected: {"status":"OK","message":"Caleo Bot is running!"}
```

**6.2 Test AI Service:**
```bash
curl -s https://caleo-bot-prod.azurewebsites.net/api/test-ai
# Expected: {"status":"OK","message":"AI service is working!","aiEnabled":true}
```

**6.3 Test Bot Framework Endpoint:**
```bash
curl -X POST https://caleo-bot-prod.azurewebsites.net/api/messages \
     -H "Content-Type: application/json" \
     -d '{"type":"ping"}'
```

### Step 7: Deploy to Microsoft Teams

**7.1 Upload Production Manifest:**
- Go to [Microsoft Teams Admin Center](https://admin.teams.microsoft.com)
- Navigate to **"Teams apps"** → **"Manage apps"**
- Click **"Upload"**
- Select `caleo-bot-prod-manifest.zip`
- Click **"Upload"**

**7.2 Configure App Permissions:**
- In Teams Admin Center, find your uploaded app
- Click **"Permissions"**
- Ensure proper permissions are granted
- Click **"Save"**

### Step 8: Test in Microsoft Teams

**8.1 Install App in Teams:**
- Open Microsoft Teams
- Go to **"Apps"**
- Search for **"Caleo Bot"**
- Click **"Add"**

**8.2 Test Bot Functionality:**
- Send a direct message to the bot
- Test with: "Hello, can you help me schedule a meeting?"
- Verify AI responses are working
- Test calendar functionality if implemented

### Step 9: Set Up Monitoring (Optional)

**9.1 Enable Application Insights:**
```bash
# Create Application Insights
az monitor app-insights component create --app caleo-bot-insights --location westus2 --resource-group caleo-bot-rg

# Get the instrumentation key
az monitor app-insights component show --app caleo-bot-insights --resource-group caleo-bot-rg --query "instrumentationKey" --output tsv
```

**9.2 Configure App Service with Application Insights:**
```bash
# Set Application Insights key
az webapp config appsettings set --resource-group caleo-bot-rg --name caleo-bot-prod --settings APPINSIGHTS_INSTRUMENTATIONKEY="YOUR_INSTRUMENTATION_KEY"
```

## 🔍 Verification Checklist

### Azure Resources:
- [ ] New Bot Service created
- [ ] New App Registration created
- [ ] App Service environment variables updated
- [ ] App Registration permissions configured
- [ ] Admin consent granted

### Application:
- [ ] Health endpoint responding
- [ ] AI service working
- [ ] Bot Framework endpoint responding
- [ ] Production manifest updated
- [ ] Manifest package recreated

### Teams Integration:
- [ ] App uploaded to Teams
- [ ] App permissions configured
- [ ] Bot responding in Teams
- [ ] AI functionality working
- [ ] Calendar integration working (if applicable)

## 🚨 Troubleshooting

### Common Issues:

**1. Bot Not Responding in Teams:**
- Check App Service logs: `az webapp log tail --resource-group caleo-bot-rg --name caleo-bot-prod`
- Verify environment variables are set correctly
- Check Bot Service messaging endpoint is correct

**2. Authentication Errors:**
- Verify App ID and Password match between Bot Service and App Service
- Check App Registration permissions are granted
- Ensure admin consent is given

**3. Teams App Not Found:**
- Verify manifest is uploaded correctly
- Check App ID matches in manifest and Bot Service
- Ensure valid domains are correct

**4. AI Service Not Working:**
- Check OpenAI API key is set correctly
- Verify Supabase credentials are configured
- Check App Service logs for specific errors

## 📚 Next Steps After Production Setup

1. **Set up GitHub Actions CI/CD** for automatic deployments
2. **Configure monitoring and alerting**
3. **Set up staging environment** for testing
4. **Document production procedures**
5. **Train team on production deployment process**

---

*This guide will make your `caleo-prod` branch fully production-ready with a separate bot service and complete Teams integration.*
