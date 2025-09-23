import { BotFrameworkAdapter, TurnContext } from 'botbuilder';
import * as restify from 'restify';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Create adapter
const adapter = new BotFrameworkAdapter({
    appId: process.env.MICROSOFT_APP_ID || '',
    appPassword: process.env.MICROSOFT_APP_PASSWORD || ''
});

// Error handler
adapter.onTurnError = async (context: TurnContext, error: Error) => {
    console.error(`\n [onTurnError] unhandled error: ${error}`);
    await context.sendActivity('The bot encountered an error or bug.');
    await context.sendActivity('To continue to run this bot, please fix the bot source code.');
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

// Listen for incoming activities
server.post('/api/messages', async (req, res) => {
    adapter.processActivity(req, res, async (context) => {
        await bot(context);
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
