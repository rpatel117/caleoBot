-- Clear corrupted tokens from the database
-- This will force users to re-authenticate with the correct token format

-- Clear all tokens from dev environment
DELETE FROM "OAuthToken_Dev";

-- Clear all tokens from prod environment  
DELETE FROM "OAuthToken_Prod";

-- Optional: Clear users too if you want a complete reset
-- DELETE FROM "User_Dev";
-- DELETE FROM "User_Prod";
-- DELETE FROM "Tenant_Dev";
-- DELETE FROM "Tenant_Prod";





