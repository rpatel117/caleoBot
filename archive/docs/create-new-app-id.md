# Create New App ID for Production

## Steps to Create New App Registration:

1. **Go to Azure Portal** → **Azure Active Directory** → **App registrations**
2. **Click "New registration"**
3. **Fill in details:**
   - **Name**: `caleo-bot-prod-v2`
   - **Supported account types**: Accounts in this organizational directory only
   - **Redirect URI**: `https://caleo-bot-prod.azurewebsites.net/api/messages`
4. **Click "Register"**
5. **Copy the new Application (client) ID**
6. **Create a new client secret:**
   - Go to **Certificates & secrets**
   - Click **"New client secret"**
   - Description: "Caleo Bot Production Secret"
   - Expires: 24 months
   - **IMMEDIATELY COPY THE SECRET VALUE**

## Update Azure App Service:
```bash
# Set new App ID
az webapp config appsettings set --resource-group caleo-bot-rg --name caleo-bot-prod --settings MICROSOFT_APP_ID="NEW_APP_ID"

# Set new App Password
az webapp config appsettings set --resource-group caleo-bot-rg --name caleo-bot-prod --settings MICROSOFT_APP_PASSWORD="NEW_SECRET_VALUE"
```

## Update Manifest:
Replace the App ID in `manifest-prod/manifest.json` with the new one.

## Update Bot Service:
1. Go to **Azure Portal** → **Bot Services**
2. Find your bot: `caleo-bot-prod`
3. Go to **Configuration**
4. Update **Microsoft App ID** to the new one
5. **Save**

## Recreate Manifest Package:
```bash
cd manifest-prod
# Edit manifest.json with new App ID
zip -r ../Caleo-Prod-New.zip .
cd ..
```
