# Teams Manifest Upload Troubleshooting

## 🚨 Common Upload Issues and Solutions

### **Issue 1: "Something went wrong" Error**

**Possible Causes:**
1. **App ID already exists** - Teams might already have an app with this ID
2. **Invalid App ID format** - The App ID must be a valid GUID
3. **Missing required fields** - Manifest might be missing required properties
4. **Invalid domain** - The validDomains might not be accessible

### **Issue 2: App ID Conflicts**

**Solution:** Try using a different App ID or check if the app already exists:

1. **Check existing apps in Teams Admin Center:**
   - Go to [Teams Admin Center](https://admin.teams.microsoft.com)
   - Navigate to **Teams apps** → **Manage apps**
   - Look for apps with ID: `a66672e1-4d5f-4a39-9da9-48abebaadea4`

2. **If app exists, either:**
   - Update the existing app
   - Use a different App ID
   - Delete the existing app first

### **Issue 3: Domain Validation**

**Check if your domain is accessible:**
```bash
# Test if the domain is reachable
curl -I https://caleo-bot-prod.azurewebsites.net

# Test the health endpoint
curl https://caleo-bot-prod.azurewebsites.net/api/health
```

### **Issue 4: Manifest Validation**

**Validate the manifest:**
1. Go to [Teams App Validation Tool](https://developer.microsoft.com/en-us/microsoft-teams/teams-app-validation-tool)
2. Upload your manifest file
3. Check for validation errors

## 🔧 Step-by-Step Troubleshooting

### **Step 1: Verify App Service is Running**
```bash
# Check if the app is running
curl https://caleo-bot-prod.azurewebsites.net/api/health

# Expected response: {"status":"OK","message":"Caleo Bot is running!"}
```

### **Step 2: Check App Registration**
1. Go to [Azure Portal](https://portal.azure.com)
2. Navigate to **Azure Active Directory** → **App registrations**
3. Find your app: `caleo-bot-prod`
4. Verify the App ID matches: `a66672e1-4d5f-4a39-9da9-48abebaadea4`

### **Step 3: Check Bot Service**
1. Go to [Azure Portal](https://portal.azure.com)
2. Navigate to **Bot Services**
3. Find your bot: `caleo-bot-prod`
4. Verify the messaging endpoint: `https://caleo-bot-prod.azurewebsites.net/api/messages`

### **Step 4: Test Manifest Locally**
```bash
# Extract and check the manifest
unzip -l Caleo-Prod-Manifest.zip

# Should show:
# manifest.json
# color.png
# outline.png
```

### **Step 5: Try Alternative Upload Methods**

**Method 1: Teams Admin Center**
1. Go to [Teams Admin Center](https://admin.teams.microsoft.com)
2. **Teams apps** → **Manage apps** → **Upload**
3. Upload `Caleo-Prod-Manifest.zip`

**Method 2: Teams Desktop App**
1. Open Teams Desktop
2. **Apps** → **Upload a custom app** → **Upload for me or my teams**
3. Upload `Caleo-Prod-Manifest.zip`

**Method 3: Teams Web**
1. Go to [Teams Web](https://teams.microsoft.com)
2. **Apps** → **Upload a custom app**
3. Upload `Caleo-Prod-Manifest.zip`

## 🛠️ Alternative Solutions

### **Solution 1: Create New App ID**
If the App ID is causing conflicts, create a new one:

1. **Create new App Registration:**
   - Go to Azure Portal → **Azure Active Directory** → **App registrations**
   - Click **"New registration"**
   - Name: `caleo-bot-prod-v2`
   - Get new App ID

2. **Update manifest with new App ID:**
   ```bash
   # Edit manifest-prod/manifest.json
   # Replace the App ID with the new one
   ```

3. **Update Azure App Service:**
   ```bash
   az webapp config appsettings set --resource-group caleo-bot-rg --name caleo-bot-prod --settings MICROSOFT_APP_ID="NEW_APP_ID"
   ```

### **Solution 2: Simplify Manifest**
Create a minimal manifest for testing:

```json
{
  "$schema": "https://developer.microsoft.com/en-us/json-schemas/teams/v1.16/MicrosoftTeams.schema.json",
  "manifestVersion": "1.16",
  "version": "1.0.0",
  "id": "a66672e1-4d5f-4a39-9da9-48abebaadea4",
  "packageName": "com.caleo.bot",
  "developer": {
    "name": "Caleo",
    "websiteUrl": "https://caleo-bot-prod.azurewebsites.net",
    "privacyUrl": "https://caleo-bot-prod.azurewebsites.net/privacy",
    "termsOfUseUrl": "https://caleo-bot-prod.azurewebsites.net/terms"
  },
  "icons": {
    "color": "color.png",
    "outline": "outline.png"
  },
  "name": {
    "short": "Caleo Bot PROD",
    "full": "Caleo AI Assistant Bot - PRODUCTION"
  },
  "description": {
    "short": "AI-powered assistant for your team (PRODUCTION)",
    "full": "Caleo PRODUCTION Bot - AI-powered assistant that helps your team with various tasks and questions."
  },
  "accentColor": "#FFFFFF",
  "bots": [
    {
      "botId": "a66672e1-4d5f-4a39-9da9-48abebaadea4",
      "scopes": ["personal"]
    }
  ],
  "permissions": ["identity"],
  "validDomains": ["caleo-bot-prod.azurewebsites.net"]
}
```

## 📋 Quick Checklist

- [ ] App Service is running and responding
- [ ] App Registration exists and is correct
- [ ] Bot Service is configured correctly
- [ ] Manifest file is valid JSON
- [ ] All required files are in the zip
- [ ] App ID matches between manifest and Azure
- [ ] Domain is accessible
- [ ] No existing app with same ID

## 🆘 If All Else Fails

1. **Try uploading to Teams Admin Center instead of Teams app**
2. **Check Teams Admin Center for any error messages**
3. **Try creating a completely new App Registration**
4. **Use the Teams App Validation Tool to check for issues**

---

*This guide should help resolve most Teams manifest upload issues.*
