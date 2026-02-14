-- Fix token storage issue: Change BYTEA to TEXT for encrypted tokens
-- This script updates the OAuthToken tables to store encrypted tokens as TEXT instead of BYTEA

-- Update OAuthToken_Dev table
ALTER TABLE "OAuthToken_Dev" 
ALTER COLUMN "accessToken" TYPE TEXT USING encode("accessToken", 'base64'),
ALTER COLUMN "refreshToken" TYPE TEXT USING encode("refreshToken", 'base64');

-- Update OAuthToken_Prod table  
ALTER TABLE "OAuthToken_Prod"
ALTER COLUMN "accessToken" TYPE TEXT USING encode("accessToken", 'base64'),
ALTER COLUMN "refreshToken" TYPE TEXT USING encode("refreshToken", 'base64');

-- Note: The USING clause converts existing BYTEA data to base64-encoded TEXT
-- This ensures existing encrypted tokens are preserved in the new format





