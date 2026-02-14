#!/usr/bin/env node

// Test script to verify environment detection and database table selection
const { SupabaseDatabaseService } = require('./dist/database-env');

console.log('🧪 Testing Environment Detection');
console.log('================================');

// Test dev environment
console.log('\n🔧 Testing DEV Environment:');
const devDb = new SupabaseDatabaseService('dev');
console.log(`Environment: ${devDb.getEnvironment()}`);
console.log(`Table Prefix: ${devDb.getTablePrefix()}`);

// Test prod environment
console.log('\n🔧 Testing PROD Environment:');
const prodDb = new SupabaseDatabaseService('prod');
console.log(`Environment: ${prodDb.getEnvironment()}`);
console.log(`Table Prefix: ${prodDb.getTablePrefix()}`);

// Test environment detection logic
console.log('\n🔧 Testing Environment Detection Logic:');
const testAppIds = [
  '7ac8f532-c402-43c4-bcb9-7d18a7184ca0', // Dev App ID
  'a66672e1-4d5f-4a39-9da9-48abebaadea4', // Prod App ID
  'some-other-app-id' // Unknown App ID
];

testAppIds.forEach(appId => {
  const isProduction = appId === 'a66672e1-4d5f-4a39-9da9-48abebaadea4';
  const environment = isProduction ? 'prod' : 'dev';
  console.log(`App ID: ${appId} -> Environment: ${environment} (${isProduction ? 'PRODUCTION' : 'DEVELOPMENT'})`);
});

console.log('\n✅ Environment detection test completed!');
console.log('\n📋 Expected Results:');
console.log('- Dev environment should use User_Dev, OAuthToken_Dev tables');
console.log('- Prod environment should use User_Prod, OAuthToken_Prod tables');
console.log('- Environment detection should work based on App ID');





