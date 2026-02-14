#!/bin/bash

# Production Configuration Script for Caleo Bot
# This script configures the Azure App Service for production deployment

echo "🚀 Starting Caleo Bot Production Configuration..."

# Set variables
RESOURCE_GROUP="caleo-bot-rg"
APP_NAME="caleo-bot-prod"
BOT_SERVICE_NAME="caleo-bot-prod"

echo "📋 Configuration Details:"
echo "Resource Group: $RESOURCE_GROUP"
echo "App Service: $APP_NAME"
echo "Bot Service: $BOT_SERVICE_NAME"
echo ""

# Check if user is logged in
echo "🔐 Checking Azure login status..."
if ! az account show &> /dev/null; then
    echo "❌ Not logged in to Azure. Please run 'az login' first."
    exit 1
fi
echo "✅ Azure login verified"
echo ""

# Get current subscription
SUBSCRIPTION=$(az account show --query "name" --output tsv)
echo "📊 Using subscription: $SUBSCRIPTION"
echo ""

# Step 1: Update Environment Variables
echo "🔧 Step 1: Configuring Environment Variables..."

# Get the App ID and Password from the user
echo "Please provide your production App Registration details:"
read -p "Enter your production MICROSOFT_APP_ID: " APP_ID
read -s -p "Enter your production MICROSOFT_APP_PASSWORD: " APP_PASSWORD
echo ""

# Update Microsoft Bot Framework credentials
echo "Setting Microsoft Bot Framework credentials..."
az webapp config appsettings set --resource-group $RESOURCE_GROUP --name $APP_NAME --settings \
  MICROSOFT_APP_ID="$APP_ID" \
  MICROSOFT_APP_PASSWORD="$APP_PASSWORD" \
  MICROSOFT_TENANT_ID="common"

# Set other required environment variables
echo "Setting other environment variables..."
az webapp config appsettings set --resource-group $RESOURCE_GROUP --name $APP_NAME --settings \
  NODE_ENV="production" \
  PORT="3978" \
  OPENAI_API_KEY="<YOUR_OPENAI_API_KEY>" \
  SUPABASE_URL="https://hvnbiqubzzkbveovdenj.supabase.co" \
  SUPABASE_ANON_KEY="<YOUR_SUPABASE_ANON_KEY>" \
  SUPABASE_SERVICE_ROLE_KEY="<YOUR_SUPABASE_SERVICE_ROLE_KEY>" \
  ENCRYPTION_KEY="<YOUR_ENCRYPTION_KEY>"

echo "✅ Environment variables configured"
echo ""

# Step 2: Configure CORS
echo "🌐 Step 2: Configuring CORS..."
az webapp cors add --resource-group $RESOURCE_GROUP --name $APP_NAME --allowed-origins \
  "https://teams.microsoft.com" \
  "https://*.teams.microsoft.com" \
  "https://*.skype.com" \
  "https://teams.microsoft.com"

echo "✅ CORS configured for Teams"
echo ""

# Step 3: Enable Authentication
echo "🔐 Step 3: Configuring Authentication..."
az webapp auth update --resource-group $RESOURCE_GROUP --name $APP_NAME --enabled true

echo "✅ Authentication enabled"
echo ""

# Step 4: Set Health Check
echo "🏥 Step 4: Configuring Health Check..."
az webapp config set --resource-group $RESOURCE_GROUP --name $APP_NAME --health-check-path "/api/health"

echo "✅ Health check configured"
echo ""

# Step 5: Enable Application Insights
echo "📊 Step 5: Setting up Application Insights..."

# Check if Application Insights already exists
if az monitor app-insights component show --app caleo-bot-insights --resource-group $RESOURCE_GROUP &> /dev/null; then
    echo "Application Insights already exists, using existing instance..."
    INSTRUMENTATION_KEY=$(az monitor app-insights component show --app caleo-bot-insights --resource-group $RESOURCE_GROUP --query "instrumentationKey" --output tsv)
else
    echo "Creating new Application Insights instance..."
    az monitor app-insights component create --app caleo-bot-insights --location westus2 --resource-group $RESOURCE_GROUP
    INSTRUMENTATION_KEY=$(az monitor app-insights component show --app caleo-bot-insights --resource-group $RESOURCE_GROUP --query "instrumentationKey" --output tsv)
fi

# Set the instrumentation key
az webapp config appsettings set --resource-group $RESOURCE_GROUP --name $APP_NAME --settings APPINSIGHTS_INSTRUMENTATIONKEY="$INSTRUMENTATION_KEY"

echo "✅ Application Insights configured"
echo ""

# Step 6: Restart App Service
echo "🔄 Step 6: Restarting App Service..."
az webapp restart --resource-group $RESOURCE_GROUP --name $APP_NAME

echo "✅ App Service restarted"
echo ""

# Step 7: Verify Configuration
echo "🔍 Step 7: Verifying Configuration..."

# Wait a moment for the app to start
echo "Waiting for app to start..."
sleep 30

# Check app status
echo "Checking app status..."
APP_STATE=$(az webapp show --resource-group $RESOURCE_GROUP --name $APP_NAME --query "state" --output tsv)
echo "App State: $APP_STATE"

# Test health endpoint
echo "Testing health endpoint..."
HEALTH_RESPONSE=$(curl -s https://$APP_NAME.azurewebsites.net/api/health)
echo "Health Response: $HEALTH_RESPONSE"

# Test AI endpoint
echo "Testing AI endpoint..."
AI_RESPONSE=$(curl -s https://$APP_NAME.azurewebsites.net/api/test-ai)
echo "AI Response: $AI_RESPONSE"

echo ""
echo "🎉 Production Configuration Complete!"
echo ""
echo "📋 Summary:"
echo "✅ Environment variables configured"
echo "✅ CORS configured for Teams"
echo "✅ Authentication enabled"
echo "✅ Health check configured"
echo "✅ Application Insights enabled"
echo "✅ App Service restarted"
echo ""
echo "🔗 Your bot is now available at: https://$APP_NAME.azurewebsites.net"
echo "🏥 Health check: https://$APP_NAME.azurewebsites.net/api/health"
echo "🤖 AI test: https://$APP_NAME.azurewebsites.net/api/test-ai"
echo ""
echo "📝 Next Steps:"
echo "1. Update your production manifest with App ID: $APP_ID"
echo "2. Upload the manifest to Microsoft Teams"
echo "3. Test the bot in Teams"
echo ""
echo "🔧 Useful Commands:"
echo "View logs: az webapp log tail --resource-group $RESOURCE_GROUP --name $APP_NAME"
echo "Check status: az webapp show --resource-group $RESOURCE_GROUP --name $APP_NAME --query state"
echo "List settings: az webapp config appsettings list --resource-group $RESOURCE_GROUP --name $APP_NAME --output table"
