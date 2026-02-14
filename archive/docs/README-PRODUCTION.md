# Caleo Bot - Production Branch

This is the production branch for Caleo Bot, deployed to Azure App Service.

## 🚀 Production Environment

- **URL**: https://caleo-bot-prod.azurewebsites.net
- **Environment**: Production
- **Database**: Supabase (Production)
- **Deployment**: Azure App Service

## 🔧 Production Setup

### 1. Create New Bot Registration

You'll need to create a new Azure Bot Service for production:

1. **Azure Portal** → **Create a resource** → **Azure Bot**
2. **Configuration**:
   - **Bot handle**: `caleo-bot-prod` (must be globally unique)
   - **Resource group**: `caleo-bot-rg`
   - **Pricing tier**: F0 (Free)
   - **Microsoft App ID**: Create new
   - **Messaging endpoint**: `https://caleo-bot-prod.azurewebsites.net/api/messages`

### 2. Update Environment Variables

Update the production environment variables in Azure App Service:

```bash
# Update with your new production App ID and Password
az webapp config appsettings set --resource-group caleo-bot-rg --name caleo-bot-prod --settings MICROSOFT_APP_ID="YOUR_NEW_PRODUCTION_APP_ID"

az webapp config appsettings set --resource-group caleo-bot-rg --name caleo-bot-prod --settings MICROSOFT_APP_PASSWORD="YOUR_NEW_PRODUCTION_APP_PASSWORD"
```

### 3. Update Production Manifest

Update `manifest-prod/manifest.json` with your new production App ID:

```json
{
  "id": "YOUR_NEW_PRODUCTION_APP_ID",
  "bots": [
    {
      "botId": "YOUR_NEW_PRODUCTION_APP_ID"
    }
  ]
}
```

### 4. Deploy to Teams

Upload `caleo-bot-prod-manifest.zip` to Microsoft Teams.

## 🔄 Development vs Production

### Development (agent-clean branch):
- **Manifest**: `manifest/manifest.json` (points to ngrok)
- **Environment**: Local with ngrok
- **Bot Registration**: Development bot

### Production (caleo-prod branch):
- **Manifest**: `manifest-prod/manifest.json` (points to Azure)
- **Environment**: Azure App Service
- **Bot Registration**: Production bot

## 📋 Production Checklist

- [ ] Create new Azure Bot Service
- [ ] Update environment variables in Azure App Service
- [ ] Update production manifest with new App ID
- [ ] Test bot health endpoint
- [ ] Upload production manifest to Teams
- [ ] Test bot in Teams
- [ ] Set up GitHub Actions CI/CD

## 🚨 Important Notes

- **Never use production credentials in development**
- **Keep dev and prod bot registrations separate**
- **Test thoroughly before deploying to production**
- **Monitor Azure App Service logs for issues**

## 🔍 Troubleshooting

### Bot not responding:
1. Check Azure App Service logs
2. Verify environment variables are set
3. Test health endpoint: `https://caleo-bot-prod.azurewebsites.net/api/health`
4. Check Bot Service messaging endpoint

### Teams integration issues:
1. Verify manifest is uploaded correctly
2. Check App ID matches in manifest and Bot Service
3. Ensure valid domains are correct
4. Check Teams app permissions
