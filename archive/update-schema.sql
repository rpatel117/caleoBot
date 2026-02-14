-- Update schema to create Tenant_Dev and Tenant_Prod tables
-- Run this in your Supabase SQL editor

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

-- Update User_Dev foreign key to reference Tenant_Dev
ALTER TABLE "User_Dev" DROP CONSTRAINT IF EXISTS "User_Dev_tenantId_fkey";
ALTER TABLE "User_Dev" ADD CONSTRAINT "User_Dev_tenantId_fkey" 
  FOREIGN KEY ("tenantId") REFERENCES "Tenant_Dev"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Update User_Prod foreign key to reference Tenant_Prod  
ALTER TABLE "User_Prod" DROP CONSTRAINT IF EXISTS "User_Prod_tenantId_fkey";
ALTER TABLE "User_Prod" ADD CONSTRAINT "User_Prod_tenantId_fkey" 
  FOREIGN KEY ("tenantId") REFERENCES "Tenant_Prod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;





