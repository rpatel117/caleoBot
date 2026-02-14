# Environment Separation Setup Guide

## 🎯 **Problem Solved:**
Separate dev and prod environments to avoid authentication conflicts between different App IDs.

## 🛠️ **Solution: Environment-Specific Database Tables**

### **Step 1: Update Supabase Schema**
Run the new schema to create separate tables for dev and prod:

```sql
-- Run this in your Supabase SQL editor
-- File: supabase-schema-env.sql
```

### **Step 2: Update Your Code**

#### **Option A: Quick Fix (Recommended)**
1. **Update your main files** to use environment detection:

```typescript
// In src/index.ts - detect environment
const isProduction = process.env.NODE_ENV === 'production' || 
                    process.env.MICROSOFT_APP_ID === 'a66672e1-4d5f-4a39-9da9-48abebaadea4';

// Use environment-specific services
const teamsSSO = new TeamsSSOService(isProduction ? 'prod' : 'dev');
const db = new SupabaseDatabaseService(isProduction ? 'prod' : 'dev');
```

#### **Option B: Environment Variables**
Set environment variables to control which tables to use:

```bash
# For dev environment
export DATABASE_ENV=dev

# For prod environment  
export DATABASE_ENV=prod
```

### **Step 3: Update Database Service**
Replace your current `database.ts` with the environment-aware version:

```typescript
// Use src/database-env.ts instead of src/database.ts
import { SupabaseDatabaseService } from './database-env';

// Initialize with environment
const db = new SupabaseDatabaseService(process.env.DATABASE_ENV || 'dev');
```

### **Step 4: Update Teams SSO Service**
Replace your current `teams-sso-service.ts` with the environment-aware version:

```typescript
// Use src/teams-sso-service-env.ts instead of src/teams-sso-service.ts
import TeamsSSOService from './teams-sso-service-env';

// Initialize with environment
const teamsSSO = new TeamsSSOService(process.env.DATABASE_ENV || 'dev');
```

## 🚀 **Implementation Steps:**

### **1. Update Supabase Database:**
```bash
# Run the new schema in Supabase SQL editor
# This creates separate tables for dev and prod
```

### **2. Update Your Main Files:**
```typescript
// In src/index.ts
const isProduction = process.env.MICROSOFT_APP_ID === 'a66672e1-4d5f-4a39-9da9-48abebaadea4';
const environment = isProduction ? 'prod' : 'dev';

// Initialize services with environment
const db = new SupabaseDatabaseService(environment);
const teamsSSO = new TeamsSSOService(environment);
```

### **3. Test Both Environments:**
- **Dev**: Should use `User_Dev`, `OAuthToken_Dev`, etc.
- **Prod**: Should use `User_Prod`, `OAuthToken_Prod`, etc.

## 📋 **Benefits:**

✅ **Separate Authentication**: Dev and prod users don't conflict
✅ **Independent Data**: Each environment has its own user data
✅ **Easy Testing**: Test changes in dev without affecting prod
✅ **Clean Separation**: No more authentication conflicts

## 🔧 **Files Created:**
- `supabase-schema-env.sql` - New database schema
- `src/database-env.ts` - Environment-aware database service
- `src/teams-sso-service-env.ts` - Environment-aware SSO service

## 🧪 **Testing:**
1. **Deploy new schema** to Supabase
2. **Update your code** to use environment detection
3. **Test dev bot** - should work independently
4. **Test prod bot** - should work independently
5. **Both should authenticate** without conflicts

This solution completely separates dev and prod environments while keeping the same Supabase project! 🚀




