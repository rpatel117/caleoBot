-- Environment-specific schema for Dev and Prod separation
-- This creates separate tables for dev and prod environments

-- Create Tenant table for Dev
CREATE TABLE IF NOT EXISTS "Tenant_Dev" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "aadTenantId" TEXT NOT NULL UNIQUE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create Tenant table for Prod
CREATE TABLE IF NOT EXISTS "Tenant_Prod" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "aadTenantId" TEXT NOT NULL UNIQUE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create User_Dev table for development environment
CREATE TABLE IF NOT EXISTS "User_Dev" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "aadObjectId" TEXT NOT NULL UNIQUE,
  "displayName" TEXT,
  "email" TEXT UNIQUE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("tenantId") REFERENCES "Tenant_Dev"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Create User_Prod table for production environment
CREATE TABLE IF NOT EXISTS "User_Prod" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "aadObjectId" TEXT NOT NULL UNIQUE,
  "displayName" TEXT,
  "email" TEXT UNIQUE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("tenantId") REFERENCES "Tenant_Prod"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Create OAuthToken_Dev table for development environment
CREATE TABLE IF NOT EXISTS "OAuthToken_Dev" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "accessToken" TEXT NOT NULL,
  "refreshToken" TEXT,
  "scopes" TEXT[] NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("userId") REFERENCES "User_Dev"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Create OAuthToken_Prod table for production environment
CREATE TABLE IF NOT EXISTS "OAuthToken_Prod" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "accessToken" TEXT NOT NULL,
  "refreshToken" TEXT,
  "scopes" TEXT[] NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("userId") REFERENCES "User_Prod"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Create Conversation_Dev table for development environment
CREATE TABLE IF NOT EXISTS "Conversation_Dev" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "contextType" TEXT NOT NULL,
  "contextId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("userId") REFERENCES "User_Dev"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Create Conversation_Prod table for production environment
CREATE TABLE IF NOT EXISTS "Conversation_Prod" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "contextType" TEXT NOT NULL,
  "contextId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("userId") REFERENCES "User_Prod"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Create Message_Dev table for development environment
CREATE TABLE IF NOT EXISTS "Message_Dev" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "conversationId" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("conversationId") REFERENCES "Conversation_Dev"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Create Message_Prod table for production environment
CREATE TABLE IF NOT EXISTS "Message_Prod" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "conversationId" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("conversationId") REFERENCES "Conversation_Prod"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS "User_Dev_aadObjectId_idx" ON "User_Dev"("aadObjectId");
CREATE INDEX IF NOT EXISTS "User_Prod_aadObjectId_idx" ON "User_Prod"("aadObjectId");
CREATE INDEX IF NOT EXISTS "OAuthToken_Dev_userId_provider_idx" ON "OAuthToken_Dev"("userId", "provider");
CREATE INDEX IF NOT EXISTS "OAuthToken_Prod_userId_provider_idx" ON "OAuthToken_Prod"("userId", "provider");
CREATE INDEX IF NOT EXISTS "Conversation_Dev_userId_idx" ON "Conversation_Dev"("userId");
CREATE INDEX IF NOT EXISTS "Conversation_Prod_userId_idx" ON "Conversation_Prod"("userId");
CREATE INDEX IF NOT EXISTS "Message_Dev_conversationId_idx" ON "Message_Dev"("conversationId");
CREATE INDEX IF NOT EXISTS "Message_Prod_conversationId_idx" ON "Message_Prod"("conversationId");
