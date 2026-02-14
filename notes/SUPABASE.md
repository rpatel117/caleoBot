# Supabase Integration Guide

## 🎯 Overview

This guide covers the complete integration of Supabase with Caleo Bot, including database setup, authentication, and data persistence.

## 🚀 Quick Setup

### 1. Create Supabase Project

1. Go to [Supabase](https://supabase.com)
2. Click **"New project"**
3. Choose organization and fill in project details
4. Wait for project to be created

### 2. Get Connection Details

1. Go to **Settings** → **Database**
2. Copy the connection string
3. Go to **Settings** → **API**
4. Copy the anon key and service role key

### 3. Environment Configuration

```bash
# Add to .env file
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_ANON_KEY=your_anon_key_here
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
DATABASE_URL=postgresql://postgres:[PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres
DIRECT_URL=postgresql://postgres:[PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres
```

## 🗄️ Database Schema

### Create Tables

Run this SQL in your Supabase SQL Editor:

```sql
-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Tenants table
CREATE TABLE IF NOT EXISTS "Tenant" (
    "id" TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    "tenantId" TEXT UNIQUE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Users table
CREATE TABLE IF NOT EXISTS "User" (
    "id" TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    "aadObjectId" TEXT UNIQUE NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE
);

-- OAuth Tokens table
CREATE TABLE IF NOT EXISTS "OAuthToken" (
    "id" TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);

-- Conversations table
CREATE TABLE IF NOT EXISTS "Conversation" (
    "id" TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT UNIQUE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);

-- Messages table
CREATE TABLE IF NOT EXISTS "Message" (
    "id" TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL CHECK ("role" IN ('user', 'assistant', 'system')),
    "content" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS "idx_user_aad_object_id" ON "User"("aadObjectId");
CREATE INDEX IF NOT EXISTS "idx_oauth_token_user_id" ON "OAuthToken"("userId");
CREATE INDEX IF NOT EXISTS "idx_conversation_user_id" ON "Conversation"("userId");
CREATE INDEX IF NOT EXISTS "idx_message_conversation_id" ON "Message"("conversationId");
CREATE INDEX IF NOT EXISTS "idx_message_timestamp" ON "Message"("timestamp");
```

### Enable Row Level Security (RLS)

```sql
-- Enable RLS on all tables
ALTER TABLE "Tenant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OAuthToken" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Conversation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Message" ENABLE ROW LEVEL SECURITY;

-- Create policies (adjust based on your security requirements)
CREATE POLICY "Users can access their own data" ON "User"
    FOR ALL USING (true);

CREATE POLICY "Users can access their own tokens" ON "OAuthToken"
    FOR ALL USING (true);

CREATE POLICY "Users can access their own conversations" ON "Conversation"
    FOR ALL USING (true);

CREATE POLICY "Users can access their own messages" ON "Message"
    FOR ALL USING (true);
```

## 🔧 Implementation

### Database Service

```typescript
import { createClient } from '@supabase/supabase-js';

class SupabaseDatabaseService {
  private supabase;
  
  constructor() {
    this.supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  
  async testConnection(): Promise<boolean> {
    try {
      const { data, error } = await this.supabase
        .from('Tenant')
        .select('count')
        .limit(1);
      
      return !error;
    } catch (error) {
      console.error('Database connection test failed:', error);
      return false;
    }
  }
  
  async createOrGetTenant(tenantId: string): Promise<string> {
    // Check if tenant exists
    const { data: existingTenant } = await this.supabase
      .from('Tenant')
      .select('id')
      .eq('tenantId', tenantId)
      .single();
    
    if (existingTenant) {
      return existingTenant.id;
    }
    
    // Create new tenant
    const { data: newTenant, error } = await this.supabase
      .from('Tenant')
      .insert({
        tenantId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      })
      .select('id')
      .single();
    
    if (error) {
      throw new Error(`Failed to create tenant: ${error.message}`);
    }
    
    return newTenant.id;
  }
  
  async createUser(aadObjectId: string, name: string, email: string, tenantId: string): Promise<string> {
    // Ensure tenant exists
    const tenantDbId = await this.createOrGetTenant(tenantId);
    
    // Check if user exists
    const { data: existingUser } = await this.supabase
      .from('User')
      .select('id')
      .eq('aadObjectId', aadObjectId)
      .single();
    
    if (existingUser) {
      return existingUser.id;
    }
    
    // Create new user
    const { data: newUser, error } = await this.supabase
      .from('User')
      .insert({
        aadObjectId,
        name,
        email,
        tenantId: tenantDbId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      })
      .select('id')
      .single();
    
    if (error) {
      throw new Error(`Failed to create user: ${error.message}`);
    }
    
    return newUser.id;
  }
  
  async getUserByAadObjectId(aadObjectId: string): Promise<any> {
    const { data, error } = await this.supabase
      .from('User')
      .select('*')
      .eq('aadObjectId', aadObjectId)
      .single();
    
    if (error) {
      return null;
    }
    
    return data;
  }
  
  async storeToken(userId: string, accessToken: string, refreshToken: string, expiresAt: Date): Promise<void> {
    const { error } = await this.supabase
      .from('OAuthToken')
      .upsert({
        userId,
        accessToken,
        refreshToken,
        expiresAt: expiresAt.toISOString(),
        updatedAt: new Date().toISOString()
      });
    
    if (error) {
      throw new Error(`Failed to store token: ${error.message}`);
    }
  }
  
  async getToken(userId: string): Promise<any> {
    const { data, error } = await this.supabase
      .from('OAuthToken')
      .select('*')
      .eq('userId', userId)
      .single();
    
    if (error) {
      return null;
    }
    
    return data;
  }
  
  async createConversation(userId: string, conversationId: string): Promise<string> {
    const { data, error } = await this.supabase
      .from('Conversation')
      .insert({
        userId,
        conversationId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      })
      .select('id')
      .single();
    
    if (error) {
      throw new Error(`Failed to create conversation: ${error.message}`);
    }
    
    return data.id;
  }
  
  async getConversation(conversationId: string): Promise<any> {
    const { data, error } = await this.supabase
      .from('Conversation')
      .select('*')
      .eq('conversationId', conversationId)
      .single();
    
    if (error) {
      return null;
    }
    
    return data;
  }
  
  async addMessage(conversationId: string, role: string, content: string): Promise<void> {
    const { error } = await this.supabase
      .from('Message')
      .insert({
        conversationId,
        role,
        content,
        timestamp: new Date().toISOString()
      });
    
    if (error) {
      throw new Error(`Failed to add message: ${error.message}`);
    }
  }
  
  async getMessages(conversationId: string, limit: number = 50): Promise<any[]> {
    const { data, error } = await this.supabase
      .from('Message')
      .select('*')
      .eq('conversationId', conversationId)
      .order('timestamp', { ascending: true })
      .limit(limit);
    
    if (error) {
      throw new Error(`Failed to get messages: ${error.message}`);
    }
    
    return data || [];
  }
}
```

### Encryption Service

```typescript
import crypto from 'crypto';

class EncryptionService {
  private algorithm = 'aes-256-gcm';
  private key: Buffer;
  
  constructor() {
    const encryptionKey = process.env.ENCRYPTION_KEY;
    if (!encryptionKey || encryptionKey.length !== 64) {
      throw new Error('ENCRYPTION_KEY must be 64 characters long');
    }
    this.key = Buffer.from(encryptionKey, 'hex');
  }
  
  encrypt(text: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipher(this.algorithm, this.key);
    cipher.setAAD(Buffer.from('caleo-bot', 'utf8'));
    
    let encrypted = cipher.update(text, 'utf8', 'base64');
    encrypted += cipher.final('base64');
    
    const authTag = cipher.getAuthTag();
    
    return JSON.stringify({
      encrypted,
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64')
    });
  }
  
  decrypt(encryptedData: string): string {
    try {
      const data = JSON.parse(encryptedData);
      const iv = Buffer.from(data.iv, 'base64');
      const authTag = Buffer.from(data.authTag, 'base64');
      
      const decipher = crypto.createDecipher(this.algorithm, this.key);
      decipher.setAAD(Buffer.from('caleo-bot', 'utf8'));
      decipher.setAuthTag(authTag);
      
      let decrypted = decipher.update(data.encrypted, 'base64', 'utf8');
      decrypted += decipher.final('utf8');
      
      return decrypted;
    } catch (error) {
      // Handle hex-encoded strings from Supabase
      if (encryptedData.startsWith('\\x')) {
        const hexString = encryptedData.slice(2);
        const base64String = Buffer.from(hexString, 'hex').toString('base64');
        return this.decrypt(base64String);
      }
      throw error;
    }
  }
}
```

## 🔐 Security Considerations

### Row Level Security (RLS)

```sql
-- Example RLS policies for multi-tenant security
CREATE POLICY "Users can only access their own data" ON "User"
    FOR ALL USING (
        "aadObjectId" = current_setting('request.jwt.claims', true)::json->>'oid'
    );

CREATE POLICY "Users can only access their own tokens" ON "OAuthToken"
    FOR ALL USING (
        "userId" IN (
            SELECT "id" FROM "User" 
            WHERE "aadObjectId" = current_setting('request.jwt.claims', true)::json->>'oid'
        )
    );
```

### Data Encryption

```typescript
// Encrypt sensitive data before storing
const encryptedToken = encryptionService.encrypt(accessToken);
await database.storeToken(userId, encryptedToken, encryptedRefreshToken, expiresAt);

// Decrypt when retrieving
const tokenData = await database.getToken(userId);
const decryptedToken = encryptionService.decrypt(tokenData.accessToken);
```

## 🧪 Testing

### Test Database Connection

```typescript
// Test endpoint
app.get('/api/test-database', async (req, res) => {
  try {
    const isConnected = await databaseService.testConnection();
    
    if (isConnected) {
      res.json({
        status: 'success',
        message: 'Database connection working',
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(500).json({
        status: 'error',
        message: 'Database connection failed'
      });
    }
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: 'Database test failed',
      error: error.message
    });
  }
});
```

### Test Data Operations

```typescript
// Test user creation and token storage
app.post('/api/test-user', async (req, res) => {
  try {
    const { aadObjectId, name, email, tenantId } = req.body;
    
    // Create user
    const userId = await databaseService.createUser(aadObjectId, name, email, tenantId);
    
    // Store test token
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
    await databaseService.storeToken(userId, 'test-access-token', 'test-refresh-token', expiresAt);
    
    res.json({
      status: 'success',
      message: 'User created and token stored',
      userId
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: 'User creation failed',
      error: error.message
    });
  }
});
```

## 📊 Monitoring and Maintenance

### Database Health Check

```typescript
async function checkDatabaseHealth(): Promise<HealthStatus> {
  try {
    // Test connection
    const isConnected = await databaseService.testConnection();
    
    if (!isConnected) {
      return {
        status: 'unhealthy',
        message: 'Database connection failed',
        timestamp: new Date().toISOString()
      };
    }
    
    // Test basic operations
    const testTenantId = 'health-check-tenant';
    await databaseService.createOrGetTenant(testTenantId);
    
    return {
      status: 'healthy',
      message: 'Database is working correctly',
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      message: `Database health check failed: ${error.message}`,
      timestamp: new Date().toISOString()
    };
  }
}
```

### Cleanup Old Data

```sql
-- Clean up old messages (older than 30 days)
DELETE FROM "Message" 
WHERE "timestamp" < NOW() - INTERVAL '30 days';

-- Clean up expired tokens
DELETE FROM "OAuthToken" 
WHERE "expiresAt" < NOW();
```

## 🚀 Deployment Considerations

### Environment Variables

```bash
# Production environment
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_ANON_KEY=your_production_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_production_service_role_key
DATABASE_URL=postgresql://postgres:[PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres
DIRECT_URL=postgresql://postgres:[PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres
ENCRYPTION_KEY=your_production_encryption_key
```

### Connection Pooling

```typescript
// Configure connection pooling for production
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    db: {
      schema: 'public'
    },
    auth: {
      persistSession: false
    },
    global: {
      headers: {
        'x-application-name': 'caleo-bot'
      }
    }
  }
);
```

## 📚 Additional Resources

- [Supabase Documentation](https://supabase.com/docs)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [Row Level Security Guide](https://supabase.com/docs/guides/auth/row-level-security)
- [Database Functions](https://supabase.com/docs/guides/database/functions)

---

*Last updated: October 3, 2025*
