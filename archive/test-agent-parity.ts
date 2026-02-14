import { getAgentClient } from './src/agent/client';
import { UserContext } from './src/simple-agent-service';

// Test script to compare local vs remote agent responses
async function testAgentParity() {
  console.log('🧪 Testing Agent Parity: Local vs Remote');
  console.log('=====================================');

  const testCases = [
    {
      name: 'Simple greeting',
      message: 'Hello, how are you?',
      userContext: {
        userId: 'test-user-1',
        name: 'Test User',
        email: 'test@example.com',
        tenantId: 'test-tenant'
      }
    },
    {
      name: 'Time question',
      message: 'What time is it?',
      userContext: {
        userId: 'test-user-2',
        name: 'Test User 2',
        email: 'test2@example.com',
        tenantId: 'test-tenant'
      }
    },
    {
      name: 'Calendar question',
      message: 'What meetings do I have today?',
      userContext: {
        userId: 'test-user-3',
        name: 'Test User 3',
        email: 'test3@example.com',
        tenantId: 'test-tenant'
      }
    }
  ];

  // Test local agent
  console.log('\n🤖 Testing LOCAL Agent...');
  process.env.USE_EDGE_AGENT = 'false';
  const localClient = getAgentClient();

  const localResults = [];
  for (const testCase of testCases) {
    try {
      const startTime = Date.now();
      const response = await localClient.processMessage(testCase.message, testCase.userContext);
      const latency = Date.now() - startTime;
      
      localResults.push({
        testCase: testCase.name,
        response: response.substring(0, 100) + '...',
        latency,
        success: true
      });
      
      console.log(`✅ ${testCase.name}: ${latency}ms`);
    } catch (error) {
      localResults.push({
        testCase: testCase.name,
        response: 'ERROR',
        latency: 0,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      console.log(`❌ ${testCase.name}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Test remote agent (if configured)
  console.log('\n🌐 Testing REMOTE Agent...');
  process.env.USE_EDGE_AGENT = 'true';
  
  if (!process.env.SUPABASE_AGENT_ENDPOINT || process.env.SUPABASE_AGENT_ENDPOINT.includes('[YOUR-PROJECT-REF]')) {
    console.log('⚠️  Remote agent not configured - skipping remote tests');
    console.log('   Set SUPABASE_AGENT_ENDPOINT in config.env to test remote agent');
    return;
  }

  const remoteClient = getAgentClient();
  const remoteResults = [];
  
  for (const testCase of testCases) {
    try {
      const startTime = Date.now();
      const response = await remoteClient.processMessage(testCase.message, testCase.userContext);
      const latency = Date.now() - startTime;
      
      remoteResults.push({
        testCase: testCase.name,
        response: response.substring(0, 100) + '...',
        latency,
        success: true
      });
      
      console.log(`✅ ${testCase.name}: ${latency}ms`);
    } catch (error) {
      remoteResults.push({
        testCase: testCase.name,
        response: 'ERROR',
        latency: 0,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      console.log(`❌ ${testCase.name}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Compare results
  console.log('\n📊 Comparison Results');
  console.log('====================');
  
  for (let i = 0; i < testCases.length; i++) {
    const testCase = testCases[i];
    const local = localResults[i];
    const remote = remoteResults[i];
    
    console.log(`\n${testCase.name}:`);
    console.log(`  Local:  ${local.success ? '✅' : '❌'} ${local.latency}ms - ${local.response}`);
    console.log(`  Remote: ${remote.success ? '✅' : '❌'} ${remote.latency}ms - ${remote.response}`);
    
    if (local.success && remote.success) {
      const latencyDiff = Math.abs(local.latency - remote.latency);
      console.log(`  Latency difference: ${latencyDiff}ms`);
    }
  }

  // Summary
  const localSuccessCount = localResults.filter(r => r.success).length;
  const remoteSuccessCount = remoteResults.filter(r => r.success).length;
  const avgLocalLatency = localResults.reduce((sum, r) => sum + r.latency, 0) / localResults.length;
  const avgRemoteLatency = remoteResults.reduce((sum, r) => sum + r.latency, 0) / remoteResults.length;

  console.log('\n📈 Summary');
  console.log('==========');
  console.log(`Local Agent:  ${localSuccessCount}/${testCases.length} successful, avg ${Math.round(avgLocalLatency)}ms`);
  console.log(`Remote Agent: ${remoteSuccessCount}/${testCases.length} successful, avg ${Math.round(avgRemoteLatency)}ms`);
  
  if (remoteSuccessCount > 0) {
    const latencyImprovement = avgLocalLatency - avgRemoteLatency;
    console.log(`Latency difference: ${latencyImprovement > 0 ? 'Remote' : 'Local'} is ${Math.abs(latencyImprovement)}ms ${latencyImprovement > 0 ? 'faster' : 'slower'}`);
  }
}

// Run the test
if (require.main === module) {
  testAgentParity().catch(console.error);
}

export { testAgentParity };





