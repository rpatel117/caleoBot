import { BotFrameworkAdapter, TurnContext } from 'botbuilder';
import * as restify from 'restify';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Create adapter with minimal configuration
console.log('🔑 Loading credentials...');
console.log('App ID:', process.env.MICROSOFT_APP_ID ? 'SET' : 'NOT SET');
console.log('App Password:', process.env.MICROSOFT_APP_PASSWORD ? 'SET' : 'NOT SET');

const adapter = new BotFrameworkAdapter({
    appId: process.env.MICROSOFT_APP_ID || '',
    appPassword: process.env.MICROSOFT_APP_PASSWORD || '',
    channelAuthTenant: '82ee4c80-a9cb-455b-95f4-d2168dfed70a'
});

// Remove authentication bypass now that we have correct tenant ID

// Error handler
adapter.onTurnError = async (context: TurnContext, error: Error) => {
    console.error(`\n [onTurnError] unhandled error: ${error}`);
    // Don't send error messages to user, just log them
    console.error('Error details:', error.message);
};

// Bot logic
const bot = async (context: TurnContext) => {
    const userMessage = context.activity.text;
    const userName = context.activity.from.name;
    
    // Console log the incoming message
    console.log(`\n=== NEW MESSAGE ===`);
    console.log(`From: ${userName}`);
    console.log(`Message: ${userMessage}`);
    console.log(`Channel: ${context.activity.channelId}`);
    console.log(`Conversation: ${context.activity.conversation?.id}`);
    console.log(`==================\n`);

    // Simple response logic
    if (userMessage) {
        // Check if user is mentioning the bot or if it's a direct message
        const isMentioned = userMessage.toLowerCase().includes('caleo') || 
                           context.activity.conversation?.conversationType === 'personal';
        
        if (isMentioned) {
            await context.sendActivity("Hi, I'm Caleo! 👋");
            await context.sendActivity("I'm your AI assistant. How can I help you today?");
        } else {
            // In channel conversations, only respond if mentioned
            console.log('Message received but bot not mentioned - no response sent');
        }
    }
};

// Create server
const server = restify.createServer();
server.use(restify.plugins.bodyParser());

// Track processed messages to prevent duplicates
const processedMessages = new Set();

// Listen for incoming activities - use Bot Framework adapter
server.post('/api/messages', async (req, res) => {
    adapter.processActivity(req, res, async (context) => {
        // Prevent duplicate processing
        const messageId = context.activity.id;
        if (processedMessages.has(messageId)) {
            console.log('🔄 Duplicate message ignored:', messageId);
            return;
        }
        processedMessages.add(messageId);

        console.log('\n=== NEW MESSAGE ===');
        console.log('From:', context.activity.from.name);
        console.log('Message:', context.activity.text);
        console.log('Channel:', context.activity.channelId);
        console.log('==================\n');

        // Send response using Bot Framework
        await context.sendActivity("Hi, I'm Caleo! 👋 I'm your AI assistant. How can I help you today?");
        console.log('✅ Response sent to Teams via Bot Framework');
    });
});

// Health check endpoint
server.get('/api/health', async (req, res) => {
    res.send(200, { status: 'OK', message: 'Caleo Bot is running!' });
});

const port = process.env.PORT || 3978;
server.listen(port, () => {
    console.log(`\n🤖 Caleo Bot is running on port ${port}`);
    console.log(`📡 Health check: http://localhost:${port}/api/health`);
    console.log(`💬 Bot endpoint: http://localhost:${port}/api/messages`);
    console.log(`\n🔧 To test locally, use ngrok to expose this port:`);
    console.log(`   ngrok http ${port}`);
    console.log(`\n📋 Next steps:`);
    console.log(`   1. Run 'npm run ngrok' to expose your bot`);
    console.log(`   2. Update the manifest.json with your ngrok URL`);
    console.log(`   3. Side-load the app in Microsoft Teams`);
});
