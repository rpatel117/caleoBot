# Fix Dev Authentication - Redirect URI Mismatch

## 🎯 **Problem**
The dev authentication is failing because the redirect URI in Azure App Registration doesn't match the ngrok URL.

## 🔧 **Solution**

### **Step 1: Add Ngrok URL to Azure App Registration**

1. Go to [Azure Portal](https://portal.azure.com)
2. Navigate to **Azure Active Directory** → **App registrations**
3. Find your **dev app registration** (App ID: `7ac8f532-c402-43c4-bcb9-7d18a7184ca0`)
4. Click on **Authentication** in the left menu
5. In the **Redirect URIs** section, add:
   ```
   https://nonperversive-bellicosely-tawanna.ngrok-free.dev/auth/callback
   ```
6. Click **Save**

### **Step 2: Verify Environment Variables**

Your `.env` file should have:
```bash
MICROSOFT_APP_ID=7ac8f532-c402-43c4-bcb9-7d18a7184ca0
MICROSOFT_APP_PASSWORD=<YOUR_CLIENT_SECRET>
NGROK_URL=https://nonperversive-bellicosely-tawanna.ngrok-free.dev
```

### **Step 3: Test Authentication**

After adding the redirect URI, test the authentication:
```bash
curl -s "http://localhost:3978/auth/callback?code=..."
```

## ✅ **Expected Result**

After adding the redirect URI, you should see:
```json
{
  "status": "success",
  "message": "Teams SSO authentication successful for user: Rushi Patel in dev environment"
}
```

## 🎉 **What This Means**

- ✅ **Environment Separation**: Working perfectly
- ✅ **Dev App Password**: Now correctly configured
- ✅ **Database Tables**: Using `User_Dev`, `OAuthToken_Dev` tables
- ✅ **URL Configuration**: Using correct ngrok URL
- ✅ **Authentication**: Should work after redirect URI fix

The environment separation is working! Just need to add the ngrok URL to Azure App Registration. 🚀





