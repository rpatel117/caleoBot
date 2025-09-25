const express = require('express');
const app = express();
const port = 3978;

// Middleware
app.use(express.json());

// Simple bot logic
app.post('/api/messages', (req, res) => {
    console.log('\n=== NEW MESSAGE ===');
    console.log('From:', req.body.from?.name || 'Unknown');
    console.log('Message:', req.body.text || 'No text');
    console.log('Channel:', req.body.channelId || 'Unknown');
    console.log('==================\n');

    // Simple response
    const response = {
        type: 'message',
        text: "Hi, I'm Caleo! 👋 I'm your AI assistant. How can I help you today?"
    };

    res.json(response);
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', message: 'Caleo Bot is running!' });
});

app.listen(port, () => {
    console.log(`\n🤖 Caleo Bot is running on port ${port}`);
    console.log(`📡 Health check: http://localhost:${port}/api/health`);
    console.log(`💬 Bot endpoint: http://localhost:${port}/api/messages`);
    console.log(`\n🔧 To test locally, use ngrok to expose this port:`);
    console.log(`   ngrok http ${port}`);
});
