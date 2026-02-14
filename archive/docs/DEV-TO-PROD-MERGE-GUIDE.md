# Dev to Production Merge Guide

## 🎯 **Purpose**
Safe deployment of logic changes from dev to production without breaking URLs, App IDs, or configurations.

## 📋 **Pre-Merge Checklist**

### **1. Environment-Specific Files to NEVER Merge:**
```bash
# These files should NEVER be merged from dev to prod:
.env                          # Dev environment variables
config.env                    # Dev configuration
manifest/manifest.json        # Dev Teams manifest
```

### **2. Production-Only Files to NEVER Overwrite:**
```bash
# These files should NEVER be changed in prod:
manifest-prod/manifest.json   # Production Teams manifest
config.production.env         # Production environment variables
AZURE-DEPLOYMENT-GUIDE.md     # Production documentation
```

### **3. Safe Files to Merge (Logic Changes Only):**
```bash
# These files are safe to merge for logic changes:
src/                          # All source code (TypeScript)
dist/                         # Compiled JavaScript (if needed)
package.json                  # Dependencies (be careful with versions)
tsconfig.json                 # TypeScript configuration
```

## 🔄 **Safe Merge Process**

### **Step 1: Create Feature Branch from Dev**
```bash
# Start from dev branch
git checkout agent-clean

# Create feature branch for your changes
git checkout -b feature/your-feature-name

# Make your logic changes here
# ... your code changes ...
```

### **Step 2: Test Changes in Dev**
```bash
# Test your changes in dev environment
npm run build
npm start

# Test with dev Teams app
# Verify functionality works
```

### **Step 3: Create Production Merge Branch**
```bash
# Switch to production branch
git checkout caleo-prod

# Create merge branch
git checkout -b merge/your-feature-name-to-prod

# Merge ONLY the logic changes
git merge feature/your-feature-name --no-commit
```

### **Step 4: Verify Production-Safe Changes**
```bash
# Check what files were changed
git status

# Review changes to ensure no environment-specific configs
git diff --cached
```

### **Step 5: Manual Production Configuration Updates**
```bash
# Update production-specific files manually:

# 1. Update production manifest if needed
# Edit: manifest-prod/manifest.json
# - Keep production App ID: a66672e1-4d5f-4a39-9da9-48abebaadea4
# - Keep production URL: caleo-bot-prod.azurewebsites.net

# 2. Update Azure App Service settings if needed
# Use Azure CLI to update environment variables
az webapp config appsettings set --resource-group caleo-bot-rg --name caleo-bot-prod --settings NEW_VARIABLE="value"
```

## 🛡️ **Environment-Specific Configuration Management**

### **Dev Environment (.env):**
```bash
# Dev-specific settings
MICROSOFT_APP_ID=7ac8f532-c402-43c4-bcb9-7d18a7184ca0  # Dev App ID
NGROK_URL=https://your-ngrok-url.ngrok-free.dev
NODE_ENV=development
```

### **Prod Environment (Azure App Service):**
```bash
# Production-specific settings
MICROSOFT_APP_ID=a66672e1-4d5f-4a39-9da9-48abebaadea4  # Prod App ID
NGROK_URL=https://caleo-bot-prod.azurewebsites.net
NODE_ENV=production
```

## 🔧 **Code Patterns for Environment Safety**

### **1. Environment Detection in Code:**
```typescript
// Safe way to detect environment
const isProduction = process.env.MICROSOFT_APP_ID === 'a66672e1-4d5f-4a39-9da9-48abebaadea4';
const environment = isProduction ? 'prod' : 'dev';

// Use environment-specific services
const db = new SupabaseDatabaseService(environment);
const teamsSSO = new TeamsSSOService(environment);
```

### **2. URL Configuration:**
```typescript
// Safe URL handling
const baseUrl = process.env.NGROK_URL || 'http://localhost:3978';
const redirectUri = `${baseUrl}/auth/callback`;

// This works for both:
// Dev: https://ngrok-url.ngrok-free.dev/auth/callback
// Prod: https://caleo-bot-prod.azurewebsites.net/auth/callback
```

### **3. Database Table Selection:**
```typescript
// Environment-specific table names
const getTableName = (baseName: string, environment: 'dev' | 'prod') => {
  return `${baseName}_${environment === 'dev' ? 'Dev' : 'Prod'}`;
};

// Usage:
const userTable = getTableName('User', environment); // User_Dev or User_Prod
```

## 📦 **Deployment Process**

### **1. Deploy to Azure:**
```bash
# Build the updated code
npm run build

# Create deployment package
zip -r caleo-bot-deployment.zip dist/ package.json manifest-prod/ node_modules/

# Deploy to Azure
az webapp deployment source config-zip --resource-group caleo-bot-rg --name caleo-bot-prod --src caleo-bot-deployment.zip
```

### **2. Update Production Manifest (if needed):**
```bash
# Only if you need to update the Teams app
# Update manifest-prod/manifest.json
# Recreate the zip package
cd manifest-prod
zip -r ../Caleo-Prod-Manifest.zip .
```

### **3. Verify Production Deployment:**
```bash
# Test production endpoints
curl -s https://caleo-bot-prod.azurewebsites.net/api/health
curl -s https://caleo-bot-prod.azurewebsites.net/api/test-ai

# Check logs
az webapp log tail --resource-group caleo-bot-rg --name caleo-bot-prod
```

## 🚨 **Common Pitfalls to Avoid**

### **❌ DON'T Merge These:**
- `.env` files
- `manifest/manifest.json` (dev manifest)
- Environment-specific URLs
- App IDs or secrets
- Database connection strings

### **❌ DON'T Overwrite These:**
- `manifest-prod/manifest.json`
- Azure App Service settings
- Production environment variables
- Production documentation

### **✅ DO Merge These:**
- Source code changes (`src/`)
- Logic improvements
- Bug fixes
- New features
- Dependencies (carefully)

## 🔍 **Verification Checklist**

### **Before Merging:**
- [ ] No environment-specific configs in merge
- [ ] No hardcoded URLs or IDs
- [ ] Logic changes are environment-agnostic
- [ ] Database changes use environment detection

### **After Merging:**
- [ ] Production app still works
- [ ] Dev app still works
- [ ] No authentication conflicts
- [ ] All endpoints responding
- [ ] Teams integration working

## 📝 **Example Safe Merge**

### **Scenario: Adding a new feature**
```bash
# 1. Make changes in dev
git checkout agent-clean
git checkout -b feature/new-calendar-feature

# 2. Test in dev
npm run build && npm start
# Test with dev Teams app

# 3. Merge to production
git checkout caleo-prod
git checkout -b merge/new-calendar-feature

# 4. Merge only source code changes
git merge feature/new-calendar-feature --no-commit

# 5. Review changes
git diff --cached
# Should only show src/ changes, no config files

# 6. Commit and deploy
git commit -m "Add new calendar feature to production"
# Deploy to Azure
```

## 🎯 **Key Principles**

1. **Environment Detection**: Use code to detect environment, not config files
2. **Separate Configs**: Keep dev and prod configs completely separate
3. **Logic Only**: Only merge business logic, not configuration
4. **Test Both**: Always test in both environments after changes
5. **Document Changes**: Keep track of what was changed and why

This approach ensures you can safely develop in dev and deploy logic changes to production without breaking either environment! 🚀





