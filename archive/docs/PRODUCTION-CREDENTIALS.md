# Production Credentials - Caleo Bot

## 🔐 Production App Registration Details

**App (Client) ID:** `a66672e1-4d5f-4a39-9da9-48abebaadea4`  
**Secret ID:** `8a2acd7a-f81b-451a-98b9-d8e069540564`

## 📝 Notes

- These credentials are for the production `caleo-bot-prod` App Registration
- Created on: October 13, 2025
- Used for: Production Azure Bot Service
- Environment: Azure App Service (caleo-bot-prod.azurewebsites.net)

## 🔧 Configuration Commands

```bash
# Set App ID
az webapp config appsettings set --resource-group caleo-bot-rg --name caleo-bot-prod --settings MICROSOFT_APP_ID="a66672e1-4d5f-4a39-9da9-48abebaadea4"

# Set App Password (Secret Value - not the Secret ID)
az webapp config appsettings set --resource-group caleo-bot-rg --name caleo-bot-prod --settings MICROSOFT_APP_PASSWORD="YOUR_SECRET_VALUE_HERE"
```

## ⚠️ Important

- The Secret ID is not the password - you need the actual secret value
- The secret value was shown only once when created
- If you don't have the secret value, you'll need to create a new secret in Azure Portal

---

*Credentials saved on October 13, 2025*
