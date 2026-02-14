import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

interface TeamsMessage {
    text: string;
    from: {
        name: string;
        id: string;
    };
    channelId: string;
    conversation: {
        id: string;
        conversationType: string;
    };
}

interface AIResponse {
    message: string;
    success: boolean;
    error?: string;
}

interface ConversationMessage {
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
}

class AIService {
    private apiKey: string;
    private baseUrl: string = 'https://api.openai.com/v1';
    private conversations: Map<string, ConversationMessage[]> = new Map();
    private maxConversationLength = 20; // Keep last 20 messages per conversation

    constructor() {
        this.apiKey = process.env.OPENAI_API_KEY || '';
        if (!this.apiKey) {
            console.warn('⚠️  OPENAI_API_KEY not found in environment variables');
        }
    }

    /**
     * Process a Teams message and generate an AI response
     */
    async processMessage(teamsMessage: TeamsMessage): Promise<AIResponse> {
        try {
            if (!this.apiKey) {
                return {
                    message: "I'm sorry, but I'm not configured with AI capabilities yet. Please check my setup.",
                    success: false,
                    error: 'OpenAI API key not configured'
                };
            }

            // Extract user context
            const userName = teamsMessage.from.name;
            const userMessage = teamsMessage.text;
            const isDirectMessage = teamsMessage.conversation.conversationType === 'personal';
            const conversationId = teamsMessage.conversation.id;

            // Add user message to conversation history
            this.addMessageToConversation(conversationId, 'user', userMessage);

            // Create context-aware prompt
            const systemPrompt = this.createSystemPrompt(userName, isDirectMessage);
            
            // Get conversation history for this conversation
            const conversationHistory = this.getConversationHistory(conversationId);
            
            // Call OpenAI API with conversation history
            const aiResponse = await this.callOpenAIWithHistory(systemPrompt, conversationHistory);
            
            // Add AI response to conversation history
            this.addMessageToConversation(conversationId, 'assistant', aiResponse);
            
            return {
                message: aiResponse,
                success: true
            };

        } catch (error) {
            console.error('❌ AI Service Error:', error);
            return {
                message: "I'm experiencing some technical difficulties. Please try again in a moment.",
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }

    /**
     * Create a context-aware system prompt for Caleo Bot
     */
    private createSystemPrompt(userName: string, isDirectMessage: boolean): string {
        const context = isDirectMessage 
            ? "You are having a private conversation with the user."
            : "You are in a Teams channel and should respond appropriately to the group context.";

        // Add current date and time to the system prompt
        const currentDate = new Date();
        const currentDateString = currentDate.toLocaleDateString('en-US', { 
            weekday: 'long', 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric',
            timeZone: 'America/Chicago' // Central Time
        });
        const currentTimeString = currentDate.toLocaleTimeString('en-US', { 
            hour: '2-digit', 
            minute: '2-digit', 
            timeZoneName: 'short',
            timeZone: 'America/Chicago' // Central Time
        });

        return `You are Caleo, an AI-powered meeting scheduler and team assistant for Microsoft Teams. 

CRITICAL: Today's date is ${currentDateString} and the current time is ${currentTimeString}. 
- ALWAYS use this as the reference for "today", "tomorrow", "this week", etc.
- IGNORE any dates mentioned in calendar events or other context data when determining the current date
- The current date is ${currentDateString} - this is the ONLY date that matters for "today"

CONTEXT:
- User: ${userName}
- ${context}
- You help with meeting scheduling, calendar coordination, and team productivity

PERSONALITY:
- Professional but friendly
- Helpful and proactive
- Clear and concise in responses
- Use emojis sparingly and appropriately

CAPABILITIES:
- Schedule meetings and check availability
- Coordinate with team members
- Help with calendar management
- Provide productivity tips
- Answer questions about team collaboration

RESPONSE GUIDELINES:
- Keep responses conversational and helpful
- If asked about scheduling, offer to help coordinate meetings
- Be specific about what you can do
- If you can't help with something, suggest alternatives
- Always be professional and maintain a helpful tone

Remember: You're Caleo, the AI assistant that makes team collaboration easier!`;
    }

    /**
     * Add a message to conversation history
     */
    private addMessageToConversation(conversationId: string, role: 'user' | 'assistant', content: string): void {
        if (!this.conversations.has(conversationId)) {
            this.conversations.set(conversationId, []);
        }
        
        const conversation = this.conversations.get(conversationId)!;
        conversation.push({
            role,
            content,
            timestamp: Date.now()
        });
        
        // Keep only the last maxConversationLength messages
        if (conversation.length > this.maxConversationLength) {
            conversation.splice(0, conversation.length - this.maxConversationLength);
        }
        
        console.log(`💬 Added ${role} message to conversation ${conversationId}. Total messages: ${conversation.length}`);
    }

    /**
     * Get conversation history for a conversation
     */
    private getConversationHistory(conversationId: string): ConversationMessage[] {
        return this.conversations.get(conversationId) || [];
    }

    /**
     * Call OpenAI API with conversation history
     */
    private async callOpenAIWithHistory(systemPrompt: string, conversationHistory: ConversationMessage[]): Promise<string> {
        const messages = [
            {
                role: 'system',
                content: systemPrompt
            },
            ...conversationHistory.map(msg => ({
                role: msg.role,
                content: msg.content
            }))
        ];

        console.log(`🤖 Sending ${messages.length} messages to OpenAI (including system prompt)`);
        console.log(`📅 System prompt date: ${systemPrompt.includes('Today\'s date is') ? systemPrompt.split('Today\'s date is')[1]?.split(' and')[0] : 'NOT FOUND'}`);

        const response = await fetch(`${this.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                messages: messages,
                max_tokens: 500,
                temperature: 0.7,
                top_p: 1,
                frequency_penalty: 0,
                presence_penalty: 0
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({})) as any;
            throw new Error(`OpenAI API error: ${response.status} - ${errorData.error?.message || 'Unknown error'}`);
        }

        const data = await response.json() as any;
        
        if (!data.choices || !data.choices[0] || !data.choices[0].message) {
            throw new Error('Invalid response from OpenAI API');
        }

        return data.choices[0].message.content.trim();
    }

    /**
     * Call OpenAI API with the given prompt and message (legacy method for backward compatibility)
     */
    private async callOpenAI(systemPrompt: string, userMessage: string): Promise<string> {
        const response = await fetch(`${this.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                messages: [
                    {
                        role: 'system',
                        content: systemPrompt
                    },
                    {
                        role: 'user',
                        content: userMessage
                    }
                ],
                max_tokens: 500,
                temperature: 0.7,
                top_p: 1,
                frequency_penalty: 0,
                presence_penalty: 0
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({})) as any;
            throw new Error(`OpenAI API error: ${response.status} - ${errorData.error?.message || 'Unknown error'}`);
        }

        const data = await response.json() as any;
        
        if (!data.choices || !data.choices[0] || !data.choices[0].message) {
            throw new Error('Invalid response from OpenAI API');
        }

        return data.choices[0].message.content.trim();
    }

    /**
     * Test the AI service with a simple message
     */
    async testConnection(): Promise<boolean> {
        try {
            const testMessage: TeamsMessage = {
                text: "Hello, can you help me?",
                from: { name: "Test User", id: "test-123" },
                channelId: "msteams",
                conversation: { id: "test-conv", conversationType: "personal" }
            };

            const response = await this.processMessage(testMessage);
            return response.success;
        } catch (error) {
            console.error('AI Service test failed:', error);
            return false;
        }
    }
}

export default AIService;
