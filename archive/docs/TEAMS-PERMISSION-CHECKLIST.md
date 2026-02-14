# Teams Permission Checklist - Production vs Development

## 🔍 **Compare Your Two Apps**

### **Development App (Working)**
- **App ID**: `7ac8f532-c402-43c4-bcb9-7d18a7184ca0`
- **Status**: ✅ Working
- **URL**: ngrok domain

### **Production App (Blocked)**
- **App ID**: `a66672e1-4d5f-4a39-9da9-48abebaadea4`
- **Status**: ❌ Blocked
- **URL**: caleo-bot-prod.azurewebsites.net

## 🚨 **Common Issues for Production Apps**

### **1. App Registration Permissions**
**Check in Azure Portal:**
1. Go to **Azure Active Directory** → **App registrations**
2. Find your production app: `caleo-bot-prod`
3. Go to **API permissions**
4. **Compare with your working dev app**

**Required Permissions:**
```
Microsoft Graph (Delegated):
├── User.Read
├── Calendars.Read
├── Calendars.ReadWrite
├── People.Read
└── Directory.Read.All

Microsoft Graph (Application):
├── User.Read.All
└── Directory.Read.All
```

### **2. Bot Service Configuration**
**Check in Azure Portal:**
1. Go to **Bot Services**
2. Find your production bot: `caleo-bot-prod`
3. Go to **Configuration**
4. **Verify:**
   - Messaging endpoint: `https://caleo-bot-prod.azurewebsites.net/api/messages`
   - Microsoft App ID matches your App Registration
   - Microsoft App Password is set

### **3. Teams Admin Center Settings**
**Check in Teams Admin Center:**
1. Go to **Teams apps** → **Manage apps**
2. Find both apps
3. **Compare their status:**
   - Development app: What status?
   - Production app: What status?

### **4. App Registration Redirect URIs**
**Check in Azure Portal:**
1. Go to your production App Registration
2. Go to **Authentication**
3. **Verify redirect URIs:**
   - `https://caleo-bot-prod.azurewebsites.net/api/messages`
   - Should match your Bot Service messaging endpoint

## 🔧 **Quick Fixes to Try**

### **Fix 1: Copy Working App Settings**
1. **Go to your working dev app** in Teams Admin Center
2. **Note all its settings** (permissions, policies, etc.)
3. **Apply the same settings** to your production app

### **Fix 2: Check App Registration Differences**
1. **Compare both App Registrations** in Azure Portal
2. **Look for differences** in:
   - API permissions
   - Redirect URIs
   - Authentication settings
   - Certificates & secrets

### **Fix 3: Re-create Production App Registration**
If the production App Registration has issues:
1. **Create a new App Registration**
2. **Copy settings from working dev app**
3. **Update manifest with new App ID**
4. **Update Azure App Service settings**

## 📋 **Debugging Steps**

### **Step 1: Check Teams Admin Center**
1. Go to [Teams Admin Center](https://admin.teams.microsoft.com)
2. **Teams apps** → **Manage apps**
3. **Find both apps**
4. **Compare their details:**
   - Status
   - Permissions
   - Policies
   - Any error messages

### **Step 2: Check Azure App Registration**
1. Go to [Azure Portal](https://portal.azure.com)
2. **Azure Active Directory** → **App registrations**
3. **Compare both apps:**
   - API permissions
   - Redirect URIs
   - Authentication settings

### **Step 3: Check Bot Service**
1. Go to **Bot Services**
2. **Compare both bots:**
   - Messaging endpoints
   - App IDs
   - Configuration

## 🎯 **Most Likely Issues**

1. **Missing API permissions** in production App Registration
2. **Different redirect URIs** between dev and prod
3. **Bot Service configuration** differences
4. **Teams admin policies** blocking production app specifically

## 🚀 **Quick Test**

**Try this:**
1. **Copy the exact App ID** from your working dev app
2. **Update your production manifest** to use the dev App ID temporarily
3. **Test if it works** - this will tell us if it's an App ID issue

---

*This checklist should help identify why your production app is blocked while dev works.*
