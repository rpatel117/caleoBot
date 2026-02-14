# Fix Ngrok Landing Page and Personal Account Issues

## 🎯 **Problems Identified**

1. **Ngrok Landing Page**: Blocking direct access to your bot
2. **Personal Microsoft Account**: App registration doesn't support personal accounts

## 🔧 **Solution 1: Fix Ngrok Landing Page**

### **Option A: Use ngrok with custom header**
```bash
# Test with header to bypass landing page
curl -H "ngrok-skip-browser-warning: true" -s "https://nonperversive-bellicosely-tawanna.ngrok-free.dev/api/health"
```

### **Option B: Update ngrok configuration**
```bash
# Start ngrok with custom header
ngrok http 3978 --host-header="localhost:3978"
```

### **Option C: Use ngrok auth token (recommended)**
```bash
# Add your ngrok auth token to bypass landing page
ngrok config add-authtoken YOUR_NGROK_AUTH_TOKEN
ngrok http 3978
```

## 🔧 **Solution 2: Fix Personal Microsoft Account Issue**

### **Step 1: Update Azure App Registration**

1. Go to [Azure Portal](https://portal.azure.com)
2. Navigate to **Azure Active Directory** → **App registrations**
3. Find your **dev app registration** (App ID: `7ac8f532-c402-43c4-bcb9-7d18a7184ca0`)
4. Click on **Authentication** in the left menu
5. In the **Supported account types** section, select:
   - ✅ **Accounts in any organizational directory (Any Azure AD directory - Multitenant) and personal Microsoft accounts (e.g. Skype, Xbox)**
6. Click **Save**

### **Step 2: Update Redirect URIs**

Add these redirect URIs:
```
https://nonperversive-bellicosely-tawanna.ngrok-free.dev/auth/callback
http://localhost:3978/auth/callback
```

### **Step 3: Update Tenant ID in Code**

The current tenant ID `82ee4c80-a9cb-455b-95f4-d2168dfed70a` is specific to your organization. For personal accounts, we need to use `common` or `organizations`.

Update your `.env` file:
```bash
MICROSOFT_TENANT_ID=common
```

## 🧪 **Test the Fixes**

### **Test 1: Ngrok Bypass**
```bash
curl -H "ngrok-skip-browser-warning: true" -s "https://nonperversive-bellicosely-tawanna.ngrok-free.dev/api/health"
```

### **Test 2: Authentication**
```bash
curl -H "ngrok-skip-browser-warning: true" -s "https://nonperversive-bellicosely-tawanna.ngrok-free.dev/auth/callback?code=..."
```

## 🎯 **Expected Results**

After these fixes:
- ✅ Ngrok landing page bypassed
- ✅ Personal Microsoft accounts supported
- ✅ Authentication should work
- ✅ Environment separation maintained

## 🚀 **Quick Fix Commands**

```bash
# Update tenant ID to support personal accounts
echo "MICROSOFT_TENANT_ID=common" >> .env

# Restart server
pkill -f "node dist/index.js" && npm start

# Test with ngrok header
curl -H "ngrok-skip-browser-warning: true" -s "https://nonperversive-bellicosely-tawanna.ngrok-free.dev/api/health"
```

The environment separation is working perfectly - just need to fix these authentication issues! 🚀





