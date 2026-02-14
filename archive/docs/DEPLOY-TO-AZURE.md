# Deploy to Azure App Service

## ✅ Code is on GitHub, now deploy to Azure

The code has been merged to `caleo-prod` branch. Now you need to deploy it to Azure App Service.

## 🚀 Quick Deployment Steps

### Option 1: Direct Deployment (Recommended - Fastest)

```bash
# 1. Build the application
npm run build

# 2. Create deployment package (includes dist, package.json, and node_modules)
zip -r caleo-bot-deployment.zip dist/ package.json node_modules/

# 3. Deploy to Azure
az webapp deployment source config-zip \
  --resource-group caleo-bot-rg \
  --name caleo-bot-prod \
  --src caleo-bot-deployment.zip

# 4. Verify deployment
curl -s https://caleo-bot-prod.azurewebsites.net/api/health
```

### Option 2: GitHub Integration (Automatic)

If you have GitHub Actions set up, it will deploy automatically when you push to `caleo-prod`.

Otherwise, you can set up continuous deployment from GitHub:

```bash
# Configure Azure to deploy from GitHub
az webapp deployment source config \
  --resource-group caleo-bot-rg \
  --name caleo-bot-prod \
  --repo-url https://github.com/YOUR_USERNAME/YOUR_REPO \
  --branch caleo-prod \
  --manual-integration
```

## ⚙️ Required Environment Variables

**Before/After deployment, ensure these are set in Azure:**

```bash
# Set the two new variables for edge function support
az webapp config appsettings set \
  --resource-group caleo-bot-rg \
  --name caleo-bot-prod \
  --settings \
    USE_EDGE_AGENT="true" \
    SUPABASE_AGENT_ENDPOINT="https://hvnbiqubzzkbveovdenj.supabase.co/functions/v1/caleo-agent"
```

**Verify all required variables are set:**
```bash
az webapp config appsettings list \
  --resource-group caleo-bot-rg \
  --name caleo-bot-prod \
  --query "[].{Name:name, Value:value}" \
  --output table
```

## ✅ Post-Deployment Verification

1. **Check health endpoint:**
   ```bash
   curl https://caleo-bot-prod.azurewebsites.net/api/health
   ```

2. **Check AI test endpoint:**
   ```bash
   curl https://caleo-bot-prod.azurewebsites.net/api/test-ai
   ```

3. **Check logs for proper initialization:**
   ```bash
   az webapp log tail --resource-group caleo-bot-rg --name caleo-bot-prod
   ```

   Look for:
   - ✅ `Environment detected: prod (PRODUCTION)`
   - ✅ `Using REMOTE agent (Supabase Edge Function)`
   - ✅ `Using prod database tables`

4. **Test in Teams:**
   - Send a message to the bot
   - Verify it responds correctly
   - Check that calendar operations work (if authenticated)

## 🔄 If Deployment Fails

1. **Check Azure logs:**
   ```bash
   az webapp log tail --resource-group caleo-bot-rg --name caleo-bot-prod
   ```

2. **Restart the app:**
   ```bash
   az webapp restart --resource-group caleo-bot-rg --name caleo-bot-prod
   ```

3. **Verify environment variables:**
   ```bash
   az webapp config appsettings list \
     --resource-group caleo-bot-rg \
     --name caleo-bot-prod
   ```

## 📝 Deployment Checklist

- [ ] Code merged to `caleo-prod` branch
- [ ] Code pushed to GitHub
- [ ] Build succeeds (`npm run build`)
- [ ] Deployment package created
- [ ] Deployed to Azure App Service
- [ ] Environment variables set (`USE_EDGE_AGENT`, `SUPABASE_AGENT_ENDPOINT`)
- [ ] Health endpoint responds
- [ ] Logs show correct environment detection
- [ ] Bot responds in Teams

## 🎯 Quick Deploy Script

Save this as `deploy-prod.sh`:

```bash
#!/bin/bash
set -e

echo "🔨 Building application..."
npm run build

echo "📦 Creating deployment package..."
zip -r caleo-bot-deployment.zip dist/ package.json node_modules/

echo "🚀 Deploying to Azure..."
az webapp deployment source config-zip \
  --resource-group caleo-bot-rg \
  --name caleo-bot-prod \
  --src caleo-bot-deployment.zip

echo "✅ Deployment complete!"
echo "🧪 Testing health endpoint..."
curl -s https://caleo-bot-prod.azurewebsites.net/api/health

echo ""
echo "📋 Next: Check logs with:"
echo "   az webapp log tail --resource-group caleo-bot-rg --name caleo-bot-prod"
```

Make it executable and run:
```bash
chmod +x deploy-prod.sh
./deploy-prod.sh
```

