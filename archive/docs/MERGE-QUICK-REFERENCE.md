# Quick Reference: Dev to Prod Merge

## 🚀 **Quick Commands**

### **Start New Feature:**
```bash
# From dev branch
git checkout agent-clean
./scripts/safe-merge.sh your-feature-name

# Make your changes
# Test in dev environment
```

### **Merge to Production:**
```bash
# From dev branch
./scripts/merge-to-prod.sh your-feature-name

# Deploy to Azure
npm run build
zip -r caleo-bot-deployment.zip dist/ package.json manifest-prod/ node_modules/
az webapp deployment source config-zip --resource-group caleo-bot-rg --name caleo-bot-prod --src caleo-bot-deployment.zip
```

## 🛡️ **Safe to Merge:**
- ✅ `src/` directory (source code)
- ✅ Logic improvements
- ✅ Bug fixes
- ✅ New features
- ✅ Dependencies (carefully)

## ❌ **NEVER Merge:**
- ❌ `.env` files
- ❌ `manifest/manifest.json` (dev manifest)
- ❌ Environment-specific URLs
- ❌ App IDs or secrets
- ❌ Database connection strings

## 🔧 **Environment Detection:**
```typescript
// Use this pattern in your code
const isProduction = process.env.MICROSOFT_APP_ID === 'a66672e1-4d5f-4a39-9da9-48abebaadea4';
const environment = isProduction ? 'prod' : 'dev';
```

## 📋 **Verification Checklist:**
- [ ] No environment-specific configs in merge
- [ ] No hardcoded URLs or IDs
- [ ] Logic changes are environment-agnostic
- [ ] Database changes use environment detection
- [ ] Production app still works
- [ ] Dev app still works
- [ ] No authentication conflicts

## 🚨 **Emergency Rollback:**
```bash
# If production breaks after merge
git checkout caleo-prod
git reset --hard HEAD~1
# Redeploy previous version
```

## 📞 **Need Help?**
- Check `DEV-TO-PROD-MERGE-GUIDE.md` for detailed instructions
- Use `./scripts/safe-merge.sh` for guided feature creation
- Use `./scripts/merge-to-prod.sh` for guided production merge





