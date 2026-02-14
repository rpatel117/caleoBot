#!/usr/bin/env node

/**
 * Supabase Setup Script for Caleo Bot
 * Run this after creating your Supabase project
 */

const fs = require('fs');
const crypto = require('crypto');

console.log('🚀 Setting up Supabase integration for Caleo Bot...\n');

// Generate encryption key
const encryptionKey = crypto.randomBytes(32).toString('hex');

// Template for .env file
const envTemplate = `# Microsoft Bot Framework
MICROSOFT_APP_ID=your_app_id_here
MICROSOFT_APP_PASSWORD=your_app_password_here
MICROSOFT_TENANT_ID=common

# OpenAI
OPENAI_API_KEY=your_openai_api_key_here

# Ngrok URL (update this when running ngrok)
NGROK_URL=your_ngrok_url_here

# Database Configuration (Supabase)
DATABASE_URL=postgresql://postgres:[YOUR-SUPABASE-PASSWORD]@db.[YOUR-PROJECT-REF].supabase.co:5432/postgres
DIRECT_URL=postgresql://postgres:[YOUR-SUPABASE-PASSWORD]@db.[YOUR-PROJECT-REF].supabase.co:5432/postgres

# Supabase Configuration
SUPABASE_URL=https://[YOUR-PROJECT-REF].supabase.co
SUPABASE_ANON_KEY=your_supabase_anon_key_here
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key_here

# Encryption Key (generated)
ENCRYPTION_KEY=${encryptionKey}

# Azure Configuration (for production)
AZURE_CLIENT_ID=your_azure_client_id
AZURE_CLIENT_SECRET=your_azure_client_secret
AZURE_TENANT_ID=your_azure_tenant_id
AZURE_KEY_VAULT_URL=https://your-keyvault.vault.azure.net/

# Environment
NODE_ENV=development
PORT=3978
`;

// Write the template
fs.writeFileSync('.env.supabase-template', envTemplate);

console.log('✅ Created .env.supabase-template');
console.log('🔑 Generated encryption key:', encryptionKey);
console.log('\n📋 Next steps:');
console.log('1. Create your Supabase project at https://supabase.com');
console.log('2. Copy .env.supabase-template to .env');
console.log('3. Update the Supabase credentials in .env');
console.log('4. Run: npm run db:push (to create tables)');
console.log('5. Test locally with: npm start');

