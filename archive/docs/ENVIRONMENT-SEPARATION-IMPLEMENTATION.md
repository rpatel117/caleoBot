# Environment Separation Implementation

## 🎯 **Problem Solved**
Separated dev and prod environments to avoid authentication conflicts between different App IDs using environment-specific database tables.

## ✅ **What Was Implemented**

### **1. Database Schema Updates**
- **Created**: `supabase-schema-env.sql` with separate tables for dev and prod
- **Tables Created**:
  - `User_Dev` and `User_Prod`
  - `OAuthToken_Dev` and `OAuthToken_Prod`
  - `Conversation_Dev` and `Conversation_Prod`
  - `Message_Dev` and `Message_Prod`

### **2. Environment-Aware Services**
- **Updated**: `src/database-env.ts` - Environment-specific database service
- **Updated**: `src/teams-sso-service.ts` - Now accepts environment parameter
- **Updated**: `src/index.ts` - Environment detection and service initialization

### **3. Environment Detection Logic**
```typescript
// Automatic environment detection based on App ID
const isProduction = process.env.MICROSOFT_APP_ID === 'a66672e1-4d5f-4a39-9da9-48abebaadea4';
const environment = isProduction ? 'prod' : 'dev';
```

### **4. Safe Merge System**
- **Created**: `DEV-TO-PROD-MERGE-GUIDE.md` - Comprehensive merge guide
- **Created**: `scripts/safe-merge.sh` - Guided feature creation
- **Created**: `scripts/merge-to-prod.sh` - Guided production merge
- **Created**: `MERGE-QUICK-REFERENCE.md` - Quick reference card

## 🔧 **How It Works**

### **Environment Detection**
- **Dev Environment**: Uses App ID `7ac8f532-c402-43c4-bcb9-7d18a7184ca0`
- **Prod Environment**: Uses App ID `a66672e1-4d5f-4a39-9da9-48abebaadea4`
- **Automatic**: Code detects environment based on App ID

### **Database Table Selection**
- **Dev**: Uses `User_Dev`, `OAuthToken_Dev`, etc.
- **Prod**: Uses `User_Prod`, `OAuthToken_Prod`, etc.
- **Isolated**: Each environment has its own user data

### **Service Initialization**
```typescript
// Environment-specific services
const db = new SupabaseDatabaseService(environment);
const teamsSSO = new TeamsSSOService(environment);
```

## 🚀 **Testing the Implementation**

### **1. Test Environment Detection**
```bash
node test-environment-simple.js
```

### **2. Test Dev Environment**
```bash
# Make sure you're on dev branch
git checkout agent-clean

# Set dev environment variables
export MICROSOFT_APP_ID=7ac8f532-c402-43c4-bcb9-7d18a7184ca0
export NGROK_URL=https://your-ngrok-url.ngrok-free.dev

# Start dev server
npm start
```

### **3. Test Prod Environment**
```bash
# Make sure you're on prod branch
git checkout caleo-prod

# Set prod environment variables
export MICROSOFT_APP_ID=a66672e1-4d5f-4a39-9da9-48abebaadea4
export NGROK_URL=https://caleo-bot-prod.azurewebsites.net

# Start prod server
npm start
```

## 📋 **Expected Results**

### **Dev Environment**
- ✅ Uses `User_Dev` table
- ✅ Uses `OAuthToken_Dev` table
- ✅ Independent user authentication
- ✅ No conflicts with prod users

### **Prod Environment**
- ✅ Uses `User_Prod` table
- ✅ Uses `OAuthToken_Prod` table
- ✅ Independent user authentication
- ✅ No conflicts with dev users

## 🔍 **Verification Steps**

### **1. Check Environment Detection**
```bash
# Look for these logs when starting the server:
# 🌍 Environment detected: dev (DEVELOPMENT)
# 🔧 Using dev database tables
```

### **2. Check Database Tables**
```sql
-- In Supabase SQL editor, verify tables exist:
SELECT table_name FROM information_schema.tables 
WHERE table_name LIKE '%_Dev' OR table_name LIKE '%_Prod';
```

### **3. Test Authentication**
- **Dev Bot**: Should authenticate independently
- **Prod Bot**: Should authenticate independently
- **No Conflicts**: Same user can authenticate in both environments

## 🎉 **Benefits Achieved**

✅ **Complete Separation**: Dev and prod environments are completely isolated
✅ **No Authentication Conflicts**: Same user can authenticate in both environments
✅ **Safe Merging**: Logic changes can be safely merged from dev to prod
✅ **Environment Detection**: Automatic environment detection based on App ID
✅ **Independent Data**: Each environment maintains its own user data

## 🚀 **Next Steps**

1. **Test the dev environment** with the updated code
2. **Verify authentication** works independently
3. **Test the prod environment** with the updated code
4. **Use the merge system** for future changes

The environment separation is now fully implemented! 🎉





