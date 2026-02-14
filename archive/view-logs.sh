#!/bin/bash

# Caleo Bot Log Viewer
# This script helps you view logs from your production Azure App Service

echo "🔍 Caleo Bot Log Viewer"
echo "======================"
echo ""

# Set variables
RESOURCE_GROUP="caleo-bot-rg"
APP_NAME="caleo-bot-prod"

echo "📊 Available Log Commands:"
echo ""
echo "1. View live application logs:"
echo "   az webapp log tail --resource-group $RESOURCE_GROUP --name $APP_NAME"
echo ""
echo "2. View application logs only:"
echo "   az webapp log tail --resource-group $RESOURCE_GROUP --name $APP_NAME --provider application"
echo ""
echo "3. View HTTP logs:"
echo "   az webapp log tail --resource-group $RESOURCE_GROUP --name $APP_NAME --provider http"
echo ""
echo "4. Download logs to file:"
echo "   az webapp log download --resource-group $RESOURCE_GROUP --name $APP_NAME --log-file logs.zip"
echo ""
echo "5. Check app status:"
echo "   az webapp show --resource-group $RESOURCE_GROUP --name $APP_NAME --query state"
echo ""
echo "6. Test endpoints:"
echo "   curl https://$APP_NAME.azurewebsites.net/api/health"
echo "   curl https://$APP_NAME.azurewebsites.net/api/test-ai"
echo ""

# Interactive menu
echo "🚀 Quick Actions:"
echo "1) View live logs"
echo "2) Download logs"
echo "3) Test endpoints"
echo "4) Check app status"
echo "5) View in Azure Portal"
echo ""

read -p "Choose an option (1-5): " choice

case $choice in
    1)
        echo "📱 Starting live log stream... (Press Ctrl+C to stop)"
        az webapp log tail --resource-group $RESOURCE_GROUP --name $APP_NAME
        ;;
    2)
        echo "📥 Downloading logs..."
        az webapp log download --resource-group $RESOURCE_GROUP --name $APP_NAME --log-file logs.zip
        echo "✅ Logs downloaded to logs.zip"
        ;;
    3)
        echo "🧪 Testing endpoints..."
        echo "Health check:"
        curl -s https://$APP_NAME.azurewebsites.net/api/health
        echo ""
        echo "AI test:"
        curl -s https://$APP_NAME.azurewebsites.net/api/test-ai
        echo ""
        ;;
    4)
        echo "📊 App status:"
        az webapp show --resource-group $RESOURCE_GROUP --name $APP_NAME --query "state" --output tsv
        ;;
    5)
        echo "🌐 Opening Azure Portal..."
        echo "Go to: https://portal.azure.com"
        echo "Navigate to: App Services → caleo-bot-prod → Monitoring → Log stream"
        ;;
    *)
        echo "❌ Invalid option"
        ;;
esac
