import { BotFrameworkAdapter, TurnContext, MessageFactory } from 'botbuilder';
import * as restify from 'restify';
import * as dotenv from 'dotenv';
import { createHash } from 'crypto';
import { SimpleAgentService, UserContext } from './simple-agent-service';
import GraphService from './graph-service';
import TeamsSSOService from './teams-sso-service';
import { SupabaseDatabaseService } from './database-env';
import { PromptSuggestions, PromptContext } from './bot/prompt-suggestions';
import { CaleoCards } from './bot/cards';
import { ActionRouter } from './bot/action-router';
import { ActivityHelpers } from './bot/activity-helpers';

// Load environment variables
dotenv.config({ path: './config.env' });

// Environment detection
const isProduction = process.env.MICROSOFT_APP_ID === 'a66672e1-4d5f-4a39-9da9-48abebaadea4';
const environment = isProduction ? 'prod' : 'dev';

console.log(`🌍 Environment detected: ${environment} (${isProduction ? 'PRODUCTION' : 'DEVELOPMENT'})`);
console.log(`🔧 App ID: ${process.env.MICROSOFT_APP_ID}`);
console.log(`🔧 Using ${environment} database tables`);

// Function to determine if calendar context is needed
function needsCalendarContext(message: string): boolean {
  const lowerMessage = message.toLowerCase();
  
  // Exclude simple date/time questions that don't need calendar context
  const simpleDateQuestions = [
    'what is today\'s date',
    'what\'s today\'s date',
    'what is the date today',
    'what\'s the date today',
    'what date is it',
    'what time is it',
    'what\'s the time'
  ];
  
  // If it's a simple date/time question, don't add calendar context
  if (simpleDateQuestions.some(question => lowerMessage.includes(question))) {
    return false;
  }
  
  // Calendar-related keywords that DO need context
  const calendarKeywords = [
    'calendar', 'schedule', 'meeting', 'event', 'appointment',
    'tomorrow', 'yesterday', 'this week', 'next week',
    'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
    'next tuesday', 'next monday', 'this friday', 'next friday',
    'when', 'what time', 'what day', 'available', 'free time',
    'book', 'schedule', 'create', 'add', 'cancel', 'reschedule',
    'view', 'show', 'list', 'upcoming', 'next meeting'
  ];
  
  return calendarKeywords.some(keyword => lowerMessage.includes(keyword));
}

// Create adapter with minimal configuration
console.log('🔑 Loading credentials...');
console.log('App ID:', process.env.MICROSOFT_APP_ID ? 'SET' : 'NOT SET');
console.log('App Password:', process.env.MICROSOFT_APP_PASSWORD ? 'SET' : 'NOT SET');
console.log('OpenAI API Key:', process.env.OPENAI_API_KEY ? 'SET' : 'NOT SET');

// Initialize Agent Client (local or remote based on environment)
import { getAgentClient } from './agent/client';
let agentClient: any;
try {
  agentClient = getAgentClient();
  console.log('✅ Agent client initialized successfully');
  console.log('🔍 Agent client type:', agentClient.constructor.name);
} catch (error) {
  console.error('❌ Failed to initialize agent client, falling back to SimpleAgentService:', error);
  // Fallback to direct SimpleAgentService if agent client fails
  const { SimpleAgentService } = require('./simple-agent-service');
  agentClient = { processMessage: (msg: string, ctx: any) => new SimpleAgentService().processMessage(msg, ctx) };
  console.log('⚠️  Using fallback SimpleAgentService');
}

// Initialize environment-specific services with graceful fallbacks
let db: any;
let teamsSSO: any;
try {
  db = new SupabaseDatabaseService(environment);
  teamsSSO = new TeamsSSOService(environment);
} catch (error) {
  console.error('❌ Failed to initialize environment-specific services:', error);
  // Fallback to basic services if env-specific ones fail
  const TeamsSSOServiceBasic = require('./teams-sso-service').default;
  teamsSSO = new TeamsSSOServiceBasic();
}

// Initialize Graph Service with environment-specific TeamsSSO instance
const graphService = new GraphService(teamsSSO);

const adapter = new BotFrameworkAdapter({
    appId: process.env.MICROSOFT_APP_ID || '',
    appPassword: process.env.MICROSOFT_APP_PASSWORD || '',
    channelAuthTenant: '82ee4c80-a9cb-455b-95f4-d2168dfed70a'
});


// Remove authentication bypass now that we have correct tenant ID

// CRITICAL FIX 5: Error handler guard - prevent duplicate error messages
adapter.onTurnError = async (context: TurnContext, error: Error) => {
    const messageId = getMessageId(context);
    
    // Only send error if we haven't already processed this message
    if (!processedMessages.has(messageId)) {
        console.error(`\n [onTurnError] unhandled error: ${error}`);
        console.error('Error details:', error.message);
        
        // Mark as processed to prevent duplicate error messages
        processedMessages.add(messageId);
        
        // Send a friendly response even if authentication fails
        try {
            await context.sendActivity("Hi! I'm Caleo, your AI assistant. I'm having some technical difficulties right now, but I'm here to help! How can I assist you today?");
            console.log('✅ Fallback response sent despite auth error');
        } catch (sendError) {
            console.error('Failed to send fallback response:', sendError);
        }
    } else {
        console.log('🔄 Error handler: Message already processed, skipping duplicate error message');
    }
};

// CRITICAL FIX 4: Removed unused bot function - it was never called and could cause confusion

// Create server
const server = restify.createServer();
server.use(restify.plugins.bodyParser());

// CRITICAL FIX 2: Atomic message ID deduplication
// Track processed messages to prevent duplicates
const processedMessages = new Set<string>();
const processingMessageSent = new Set<string>(); // Track if processing message was sent

/**
 * Generate composite message ID for better uniqueness
 * Handles cases where activity.id might be undefined or reused
 * 
 * CRITICAL: This must generate the SAME ID for the same message even if
 * Teams retries with slightly different timestamps or other fields.
 */
function getMessageId(context: TurnContext): string {
    const activityId = context.activity.id;
    const conversationId = context.activity.conversation?.id || 'unknown';
    const userId = context.activity.from?.id || 'unknown';
    
    // PRIMARY: Use activity ID if available (most reliable)
    // Teams will use the same activity.id for retries
    if (activityId) {
        return activityId; // Just use activity ID - Teams guarantees uniqueness per message
    }
    
    // FALLBACK: Generate hash-based ID for messages without activity.id
    // Use conversation + user + text (but not timestamp, as retries might have different timestamps)
    const text = (context.activity.text || '').substring(0, 100);
    const composite = `${conversationId}-${userId}-${text}`;
    const hash = createHash('md5').update(composite).digest('hex');
    return hash;
}

/**
 * Atomic check-and-set for message processing
 * Returns true if message can be processed, false if already processing
 */
function markMessageAsProcessing(messageId: string): boolean {
    if (processedMessages.has(messageId)) {
        return false; // Already processing
    }
    processedMessages.add(messageId);
    return true; // Successfully marked as processing
}

// Track conversation state for prompt suggestions
const conversationState = new Map<string, {
  suggestionCount: number;
  lastActionType?: 'calendar' | 'help' | 'general';
  messageCount: number;
  hasSeenWelcome: boolean;
  isProcessing: boolean; // CRITICAL FIX 3: Prevent concurrent processing
  lastProcessedMessageId?: string; // Track last processed message
}>();

// Register action handlers (after agentClient is initialized)
// Use a function to ensure agentClient is available
function registerActionHandlers() {
  ActionRouter.register('plan_my_day', async (ctx, userCtx, token) => {
    if (!userCtx || !userCtx.userId) {
      console.error('❌ Invalid userContext in plan_my_day handler:', userCtx);
      throw new Error('Invalid userContext in plan_my_day handler');
    }
    console.log('🔍 plan_my_day handler called with userContext:', {
      userId: userCtx.userId,
      name: userCtx.name,
      hasToken: !!token
    });
    return await agentClient.processMessage('Plan my day', userCtx, token);
  });

  ActionRouter.register('show_calendar', async (ctx, userCtx, token) => {
    if (!userCtx || !userCtx.userId) {
      console.error('❌ Invalid userContext in show_calendar handler:', userCtx);
      throw new Error('Invalid userContext in show_calendar handler');
    }
    return await agentClient.processMessage('Show my calendar', userCtx, token);
  });

  ActionRouter.register('find_free_time', async (ctx, userCtx, token) => {
    if (!userCtx || !userCtx.userId) {
      console.error('❌ Invalid userContext in find_free_time handler:', userCtx);
      throw new Error('Invalid userContext in find_free_time handler');
    }
    return await agentClient.processMessage('Find free time for a 1 hour meeting', userCtx, token);
  });

  ActionRouter.register('summarize_meetings', async (ctx, userCtx, token) => {
    if (!userCtx || !userCtx.userId) {
      console.error('❌ Invalid userContext in summarize_meetings handler:', userCtx);
      throw new Error('Invalid userContext in summarize_meetings handler');
    }
    return await agentClient.processMessage('Summarize my morning meetings', userCtx, token);
  });

  ActionRouter.register('help', async (ctx, userCtx, token) => {
    if (!userCtx || !userCtx.userId) {
      console.error('❌ Invalid userContext in help handler:', userCtx);
      throw new Error('Invalid userContext in help handler');
    }
    return await agentClient.processMessage('What can you do?', userCtx, token);
  });
  
  console.log('✅ Action handlers registered');
}

// Register handlers after agentClient is initialized
registerActionHandlers();

// Listen for incoming activities - use Bot Framework adapter with error handling
server.post('/api/messages', async (req, res) => {
    try {
        // CRITICAL: Process with adapter - it handles the response
        // The adapter will send 200 OK when done, but we need to ensure
        // deduplication happens BEFORE processing to prevent duplicates
        await adapter.processActivity(req, res, async (context) => {
            // CRITICAL FIX 2: Atomic message ID deduplication
            const messageId = getMessageId(context);
            
            // Log for debugging - CRITICAL for diagnosing duplicates
            const alreadyInSet = processedMessages.has(messageId);
            console.log('🔍 [DEDUP CHECK] Processing message:', {
                messageId,
                activityId: context.activity.id,
                text: context.activity.text?.substring(0, 50),
                timestamp: context.activity.timestamp,
                conversationId: context.activity.conversation?.id,
                userId: context.activity.from?.id,
                alreadyInSet: alreadyInSet,
                processedMessagesSize: processedMessages.size
            });
            
            // Atomic check-and-set: if already processing, return immediately
            if (!markMessageAsProcessing(messageId)) {
                console.log('🔄 [DEDUP] Duplicate message IGNORED (already processing):', messageId);
                console.log('🔄 [DEDUP] Current processedMessages size:', processedMessages.size);
                return;
            }
            
            console.log('✅ [DEDUP] Message marked as processing:', messageId);
            console.log('✅ [DEDUP] Current processedMessages size:', processedMessages.size);

            console.log('\n=== NEW MESSAGE ===');
            console.log('From:', context.activity.from.name);
            console.log('Message:', context.activity.text);
            console.log('Channel:', context.activity.channelId);
            console.log('==================\n');

                   // Extract user context from Teams message
                   const userContext: UserContext = {
                       userId: context.activity.from?.id || context.activity.from?.aadObjectId || '',
                       name: context.activity.from?.name || 'Unknown User',
                       email: context.activity.from?.aadObjectId || context.activity.from?.id || '',
                       tenantId: context.activity.conversation?.tenantId || process.env.MICROSOFT_TENANT_ID || '82ee4c80-a9cb-455b-95f4-d2168dfed70a'
                   };

                   // Extract message text (handles both regular messages and card actions)
                   const messageText = ActivityHelpers.extractMessageText(context) || context.activity.text || '';
                   const isCardAction = ActivityHelpers.isCardAction(context);

                   // Get or create conversation state
                   const conversationId = context.activity.conversation?.id || 'unknown';
                   
                   // Validate userContext - CRITICAL for edge function
                   if (!userContext.userId) {
                       console.error('❌ CRITICAL: userContext.userId is missing!', {
                           activityFrom: context.activity.from,
                           userContext,
                           messageId,
                           conversationId
                       });
                       // Don't process if we don't have a userId - get state first
                       let state = conversationState.get(conversationId) || {
                           suggestionCount: 0,
                           messageCount: 0,
                           hasSeenWelcome: false,
                           isProcessing: false,
                           lastProcessedMessageId: undefined
                       };
                       state.isProcessing = false;
                       conversationState.set(conversationId, state);
                       return;
                   }
                   
                   console.log('✅ UserContext validated:', {
                       userId: userContext.userId,
                       name: userContext.name,
                       tenantId: userContext.tenantId
                   });
                   
                   // Log if this is a suggestion click (SuggestedActions use imBack/postBack)
                   if (!isCardAction && messageText && context.activity.text) {
                       // Check if this might be from a suggestion click
                       const suggestionActions = ['Plan my day', 'Show my calendar', 'What can you do?', 
                                                  'Find free time', 'Reschedule conflicts', 'Help'];
                       if (suggestionActions.some(action => messageText.includes(action))) {
                           console.log('👆 Suggestion clicked:', { conversationId, text: messageText });
                       }
                   }
                   let state = conversationState.get(conversationId) || {
                       suggestionCount: 0,
                       messageCount: 0,
                       hasSeenWelcome: false,
                       isProcessing: false,
                       lastProcessedMessageId: undefined
                   };

                   // CRITICAL FIX 3: Check if conversation is already processing
                   if (state.isProcessing) {
                       console.log('🔄 Conversation already processing, ignoring duplicate:', conversationId);
                       return;
                   }
                   
                   // Mark conversation as processing
                   state.isProcessing = true;
                   state.lastProcessedMessageId = messageId;
                   conversationState.set(conversationId, state);

                   // CRITICAL FIX 6: Handle card actions FIRST (before welcome card or processing)
                   if (isCardAction) {
                       const actionData = ActivityHelpers.getCardActionData(context);
                       console.log('👆 Card action clicked:', { 
                           conversationId, 
                           action: actionData?.action,
                           text: actionData?.text 
                       });
                       
                       // Get access token if needed for card action
                       let accessToken = null;
                       const cardMessageText = actionData?.text || '';
                       if (needsCalendarContext(cardMessageText)) {
                           const authStatus = await teamsSSO.getAuthStatus(userContext);
                           if (authStatus.authenticated) {
                               accessToken = await teamsSSO.getAccessToken(userContext);
                           }
                       }
                       
                       // CRITICAL FIX 8: Send processing message for card actions (before routing)
                       // Use atomic check-and-set to prevent duplicates
                       if (!processingMessageSent.has(messageId)) {
                           processingMessageSent.add(messageId);
                           console.log('📤 Sending processing message for card action, messageId:', messageId);
                           await context.sendActivity("Caleo is processing your request...");
                           console.log('✅ Processing message sent for card action');
                       } else {
                           console.log('🔄 Processing message already sent for card action, skipping. messageId:', messageId);
                       }
                       
                       const routed = await ActionRouter.route(context, actionData, userContext, accessToken || undefined);
                       
                       // CRITICAL FIX 6: Always mark as handled for card actions, even if routing fails
                       // This prevents card actions from triggering normal flow
                       state.messageCount++;
                       state.isProcessing = false; // Clear processing flag
                       conversationState.set(conversationId, state);
                       
                       if (routed.handled) {
                           return; // Action was handled directly
                       } else {
                           // Log but don't continue to normal flow - prevent duplication
                           console.error('❌ Card action routing failed, but preventing normal flow to avoid duplicates');
                           return;
                       }
                   }

                   // CRITICAL FIX 7: Welcome card deduplication with atomic check
                   const isFirstMessage = !state.hasSeenWelcome && await ActivityHelpers.isFirstMessage(context);
                   if (isFirstMessage && !isCardAction) {
                       // Double-check with atomic operation (state already marked as processing)
                       if (!state.hasSeenWelcome) {
                           state.hasSeenWelcome = true;
                           state.isProcessing = false; // Clear processing flag
                           conversationState.set(conversationId, state);
                           
                           // Send welcome card
                           await context.sendActivity({
                               attachments: [CaleoCards.createWelcomeCard(userContext.name)]
                           });
                           console.log('✅ Welcome card sent to user');
                           
                           // Always return - don't process message further on first message
                           return;
                       } else {
                           // Already sent welcome card, clear processing flag and return
                           state.isProcessing = false;
                           conversationState.set(conversationId, state);
                           return;
                       }
                   }

                   // Detect action type for suggestion context
                   let lastActionType: 'calendar' | 'help' | 'general' = 'general';
                   if (PromptSuggestions.isHelpRequest(messageText)) {
                       lastActionType = 'help';
                   } else if (PromptSuggestions.isCalendarOperation(messageText)) {
                       lastActionType = 'calendar';
                   }
                   state.lastActionType = lastActionType;
                   state.messageCount++;

                   // Authentication Health Check - check if user needs calendar access
                   let accessToken = null;
                   if (needsCalendarContext(messageText)) {
                       console.log('🔍 Calendar context detected, checking authentication...');
                       
                       // Check if user is authenticated for calendar operations
                       const authStatus = await teamsSSO.getAuthStatus(userContext);
                       
                       if (!authStatus.authenticated) {
                           console.log('🔐 User needs authentication for calendar access');
                           await context.sendActivity({
                               text: `Hi ${userContext.name}! 👋 I'd love to help you with your calendar, but I need your permission first.\n\n**Please click this link to authenticate:**\n${authStatus.authUrl}\n\nOnce you've authenticated, I'll be able to help you with:\n• 📅 View your calendar\n• 🕐 Schedule meetings\n• 🔍 Check availability\n• 📝 Create events`,
                               type: 'message'
                           });
                           console.log('✅ Authentication URL sent to user');
                           conversationState.set(conversationId, state);
                           return;
                       }
                       
                       // Get the access token for the authenticated user
                       accessToken = await teamsSSO.getAccessToken(userContext);
                       if (accessToken) {
                           console.log('✅ Access token obtained for calendar operations');
                       } else {
                           console.log('❌ Failed to get access token, proceeding without calendar access');
                       }
                       
                       console.log('✅ User is authenticated, proceeding with agent...');
                   }
                   
                   // CRITICAL FIX 8: Processing message deduplication
                   // Only send processing message if not already sent for this message ID
                   // Use atomic check-and-set to prevent race conditions
                   const wasAlreadySent = processingMessageSent.has(messageId);
                   if (!wasAlreadySent) {
                       processingMessageSent.add(messageId);
                       console.log('📤 [PROCESSING MSG] Sending processing message, messageId:', messageId);
                       console.log('📤 [PROCESSING MSG] processingMessageSent size before:', processingMessageSent.size - 1);
                       await context.sendActivity("Caleo is processing your request...");
                       console.log('✅ [PROCESSING MSG] Processing message sent to Teams, messageId:', messageId);
                       console.log('✅ [PROCESSING MSG] processingMessageSent size after:', processingMessageSent.size);
                   } else {
                       console.log('🔄 [PROCESSING MSG] DUPLICATE DETECTED - Processing message already sent, skipping!');
                       console.log('🔄 [PROCESSING MSG] messageId:', messageId);
                       console.log('🔄 [PROCESSING MSG] processingMessageSent size:', processingMessageSent.size);
                   }
                   
                   // Process message with Agent Client (local or remote)
                   // This is the promise that may take time (especially for Supabase Edge Function)
                   console.log('🤖 Processing with Agent client...');
                   console.log('🔍 Agent client type:', agentClient?.constructor?.name || typeof agentClient);
                   console.log('🔍 Has processMessage method:', typeof agentClient?.processMessage === 'function');
                   
                   try {
                       // Validate userContext before calling agent
                       if (!userContext || !userContext.userId) {
                           console.error('❌ [AGENT] Invalid userContext before calling agent:', {
                               hasUserContext: !!userContext,
                               userId: userContext?.userId,
                               messageId
                           });
                           throw new Error('Invalid userContext: userId is required');
                       }
                       
                       console.log('🤖 [AGENT] Calling agentClient.processMessage:', {
                           messageText: messageText.substring(0, 50),
                           userId: userContext.userId,
                           hasAccessToken: !!accessToken,
                           messageId
                       });
                       
                       const startTime = Date.now();
                       const agentResponse = await agentClient.processMessage(messageText, userContext, accessToken || undefined);
                       const processingTime = Date.now() - startTime;
                       
                       console.log(`⏱️  Agent processing completed in ${processingTime}ms`);
                       console.log('🔍 Agent response type:', typeof agentResponse);
                       console.log('🔍 Agent response length:', agentResponse?.length || 0);
                       
                       if (!agentResponse || agentResponse.trim().length === 0) {
                           console.error('❌ Agent returned empty response');
                           await context.sendActivity({
                               text: "I apologize, but I didn't receive a valid response. Please try again.",
                               type: 'message'
                           });
                       } else {
                           // Determine if we should show suggestions
                           const promptContext: PromptContext = {
                               isFirstMessage: isFirstMessage,
                               lastActionType: state.lastActionType,
                               messageLength: messageText.length,
                               hasCalendarAccess: !!accessToken
                           };

                           if (PromptSuggestions.shouldShowSuggestions(promptContext, state.suggestionCount)) {
                               const suggestions = PromptSuggestions.generateSuggestions(promptContext);
                               if (suggestions.actions.length > 0) {
                                   const reply = MessageFactory.suggestedActions(
                                       suggestions.actions,
                                       agentResponse
                                   );
                                   await context.sendActivity(reply);
                                   state.suggestionCount++;
                                   console.log('📋 Suggestions shown:', { 
                                       conversationId, 
                                       suggestionCount: state.suggestionCount,
                                       actions: suggestions.actions.map(a => a.title)
                                   });
                               } else {
                                   await context.sendActivity(agentResponse);
                               }
                           } else {
                               await context.sendActivity(agentResponse);
                           }
                           console.log('✅ Agent response sent to Teams:', agentResponse.substring(0, 100) + '...');
                       }
                   } catch (agentError) {
                       console.error('❌ Agent processing error:', agentError);
                       console.error('❌ Error stack:', agentError instanceof Error ? agentError.stack : 'No stack trace');
                       
                       // Send error message to user (only if not already sent by error handler)
                       if (!processedMessages.has(messageId)) {
                           await context.sendActivity({
                               text: "I apologize, but I encountered an error while processing your request. Please try again.",
                               type: 'message'
                           });
                       }
                   } finally {
                       // Always clear processing flag, even on error
                       state.isProcessing = false;
                       conversationState.set(conversationId, state);
                   }
        });
    } catch (error) {
        // Error in adapter processing
        console.error('❌ Error in adapter.processActivity:', error instanceof Error ? error.message : String(error));
        console.error('❌ Error stack:', error instanceof Error ? error.stack : 'No stack trace');
        
        // Send error response
        try {
            res.send(500, { error: 'Internal server error' });
        } catch (sendError) {
            console.error('Failed to send error response:', sendError);
        }
    }
});

// Health check endpoint
server.get('/api/health', async (req, res) => {
    res.send(200, { status: 'OK', message: 'Caleo Bot is running!' });
});

// Test endpoint for duplicate message testing (bypasses Bot Framework auth)
server.post('/api/test-messages', async (req, res) => {
    // Send 200 OK immediately
    res.send(200, { status: 'OK', message: 'Test message received' });
    
    // Simulate message processing with deduplication
    const testMessage = req.body;
    const messageId = testMessage.id || `test-${Date.now()}-${Math.random()}`;
    
    console.log('\n=== TEST MESSAGE ===');
    console.log('Message ID:', messageId);
    console.log('Text:', testMessage.text);
    console.log('==================\n');
    
    // Test deduplication
    if (!markMessageAsProcessing(messageId)) {
        console.log('🔄 TEST: Duplicate message ignored:', messageId);
        return;
    }
    
    console.log('✅ TEST: Message marked as processing:', messageId);
    
    // Simulate processing delay
    setTimeout(() => {
        console.log('✅ TEST: Message processing complete:', messageId);
    }, 100);
});

// Test endpoint to see UI components
server.get('/api/test-ui', async (req, res) => {
    res.send(200, {
        status: 'OK',
        message: 'UI Components Test',
        instructions: {
            welcomeCard: 'Send ANY message to the bot in Teams (first time) to see welcome card',
            suggestions: 'Type "help" to see SuggestedActions chips',
            cardButtons: 'Click buttons in the welcome card to test card actions',
            whenToSee: {
                welcomeCard: 'First message in personal chat',
                suggestions: 'After typing "help", "what can you do", or very short messages (< 5 chars)',
                cardButtons: 'In the welcome card that appears on first message'
            }
        },
        conversationStates: Array.from(conversationState.entries()).map(([id, state]) => ({
            conversationId: id.substring(0, 20) + '...',
            hasSeenWelcome: state.hasSeenWelcome,
            suggestionCount: state.suggestionCount,
            messageCount: state.messageCount,
            lastActionType: state.lastActionType
        }))
    });
});

// OAuth callback endpoint for Teams SSO
server.get('/auth/callback', async (req, res) => {
    try {
        console.log('🔐 OAuth callback received. Full URL:', req.url);
        console.log('🔐 Query params:', req.query);
        
        // Get code and state from query parameters (response_mode=query)
        let code = req.query.code;
        let state = req.query.state;
        
        console.log('📝 Parsed from query - Code:', code ? 'YES' : 'NO', 'State:', state ? 'YES' : 'NO');
        console.log('📝 Raw query values:', { code: req.query.code, state: req.query.state });
        
        // Try manual parsing if Restify isn't parsing correctly
        if (!code || !state) {
            const urlObj = new URL(req.url || '', 'http://localhost');
            code = code || urlObj.searchParams.get('code');
            state = state || urlObj.searchParams.get('state');
            console.log('📝 Manual parsing - Code:', code ? 'YES' : 'NO', 'State:', state ? 'YES' : 'NO');
        }
        
        if (!code || !state) {
            console.log('❌ Missing parameters. URL:', req.url);
            console.log('❌ Query params:', req.query);
            res.send(400, { error: 'Missing code or state parameter', url: req.url, query: req.query });
            return;
        }

        console.log('🔐 OAuth callback received');
        console.log('Code:', code);
        console.log('State:', state);

        // Exchange code for token
        const result = await teamsSSO.exchangeCodeForToken(code as string, state as string);
        
        if (result.success) {
            console.log('✅ Teams SSO authentication successful');
            res.send(200, { 
                status: 'success', 
                message: 'Teams SSO authentication completed successfully!',
                accessToken: result.accessToken ? 'YES' : 'NO'
            });
        } else {
            console.log('❌ Teams SSO authentication failed:', result.error);
            res.send(400, { 
                status: 'error', 
                message: 'Teams SSO authentication failed',
                error: result.error
            });
        }
    } catch (error) {
        console.error('❌ OAuth callback error:', error);
        res.send(500, { 
            status: 'error', 
            message: 'OAuth callback failed',
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

// AI service test endpoint
server.get('/api/test-ai', async (req, res) => {
    try {
        console.log('🧪 Testing AI service...');
        // Test the agent client (local or remote)
        const testMessage = "Hello, can you help me?";
        const testUserContext = {
            userId: 'test-user',
            name: 'Test User',
            email: 'test@example.com',
            tenantId: 'test-tenant'
        };
        
        try {
            const testResponse = await agentClient.processMessage(testMessage, testUserContext);
            const isWorking = testResponse && testResponse.length > 0;
        
            if (isWorking) {
                res.send(200, { 
                    status: 'OK', 
                    message: 'AI service is working!',
                    aiEnabled: true,
                    agentMode: process.env.USE_EDGE_AGENT === 'true' ? 'remote' : 'local',
                    testResponse: testResponse.substring(0, 100) + '...'
                });
            } else {
                res.send(500, { 
                    status: 'ERROR', 
                    message: 'AI service test failed',
                    aiEnabled: false
                });
            }
        } catch (error) {
            res.send(500, { 
                status: 'ERROR', 
                message: 'AI service test failed',
                aiEnabled: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    } catch (error) {
        console.error('AI test error:', error);
        res.send(500, { 
            status: 'ERROR', 
            message: 'AI service test failed',
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

// Graph service test endpoint
server.get('/api/test-graph', async (req, res) => {
    try {
        console.log('🧪 Testing Microsoft Graph service...');
        const isWorking = await graphService.testConnection();
        
        if (isWorking) {
            res.send(200, { 
                status: 'OK', 
                message: 'Microsoft Graph service is working!',
                graphEnabled: true
            });
        } else {
            res.send(500, { 
                status: 'ERROR', 
                message: 'Microsoft Graph service test failed',
                graphEnabled: false
            });
        }
    } catch (error) {
        console.error('Graph test error:', error);
        res.send(500, { 
            status: 'ERROR', 
            message: 'Microsoft Graph service test failed',
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

// Teams SSO test endpoint
server.get('/api/test-teams-sso', async (req, res) => {
    try {
        console.log('🧪 Testing Teams SSO service...');
        const isWorking = await teamsSSO.testConnection();
        
        if (isWorking) {
            res.send(200, { 
                status: 'OK', 
                message: 'Teams SSO service is working!',
                teamsSSOEnabled: true
            });
        } else {
            res.send(500, { 
                status: 'ERROR', 
                message: 'Teams SSO service test failed',
                teamsSSOEnabled: false
            });
        }
    } catch (error) {
        console.error('Teams SSO test error:', error);
        res.send(500, { 
            status: 'ERROR', 
            message: 'Teams SSO service test failed',
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

// Debug endpoint to check stored tokens
server.get('/api/debug-tokens', async (req, res) => {
    try {
        const mockUserContext = {
            userId: '29:1K_7pin8V8RvDhJzbfln385rbU6pR5N7LEqcVYdO9qTJd6mzjpjo2u3_gPU4ji-vGLL3A3ZdI7f1GqelFNJFEPQ',
            name: 'Rushi Patel',
            email: 'rushi.patel@company.com',
            tenantId: '82ee4c80-a9cb-455b-95f4-d2168dfed70a'
        };
        
        const authStatus = await teamsSSO.getAuthStatus(mockUserContext);
        
        res.send(200, {
            status: 'OK',
            userContext: mockUserContext,
            authStatus: authStatus,
            message: 'Debug token information'
        });
    } catch (error) {
        res.send(500, {
            status: 'ERROR',
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

// Calendar test endpoint - read calendar events
server.get('/api/test-calendar', async (req, res) => {
    try {
        console.log('📅 Testing calendar operations...');
        
        // Get current date and next 7 days
        const now = new Date();
        const startTime = now.toISOString();
        const endTime = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
        
        console.log(`📅 Reading calendar events from ${startTime} to ${endTime}`);
        
        // Try to read calendar events
        // Note: This will need a specific user ID - we'll use 'me' for now
        const events = await graphService.getCalendarEvents('me', startTime, endTime);
        
        if (events.success) {
            res.send(200, { 
                status: 'OK', 
                message: 'Calendar access successful!',
                eventCount: events.data.length,
                events: events.data,
                timeRange: {
                    start: startTime,
                    end: endTime
                }
            });
        } else {
            res.send(500, { 
                status: 'ERROR', 
                message: 'Calendar access failed - This requires delegated permissions',
                error: events.error,
                solution: 'Calendar access requires user-specific permissions. You need to implement delegated authentication flow.',
                requiredPermissions: [
                    'Calendars.Read (delegated)',
                    'User.Read (delegated)',
                    'offline_access (delegated)'
                ],
                currentAuthFlow: 'Client Credentials (server-to-server)',
                neededAuthFlow: 'Delegated (user-specific)'
            });
        }
    } catch (error) {
        console.error('Calendar test error:', error);
        res.send(500, { 
            status: 'ERROR', 
            message: 'Calendar test failed',
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

// Calendar test with Teams SSO
server.get('/api/test-calendar-teams', async (req, res) => {
    try {
        console.log('📅 Testing calendar operations with Teams SSO...');
        
        // Get current date and next 7 days
        const now = new Date();
        const startTime = now.toISOString();
        const endTime = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
        
        // Create a mock user context (in real usage, this comes from Teams message)
        const mockUserContext = {
            userId: '29:1K_7pin8V8RvDhJzbfln385rbU6pR5N7LEqcVYdO9qTJd6mzjpjo2u3_gPU4ji-vGLL3A3ZdI7f1GqelFNJFEPQ',
            name: 'Rushi Patel',
            email: 'rushi.patel@company.com', // This would be extracted from Teams
            tenantId: '82ee4c80-a9cb-455b-95f4-d2168dfed70a'
        };
        
        console.log(`📅 Reading calendar events for user: ${mockUserContext.name} (${mockUserContext.email})`);
        
        // Check Teams SSO authentication status
        const authStatus = await teamsSSO.getAuthStatus(mockUserContext);
        
        if (!authStatus.authenticated) {
            res.send(200, { 
                status: 'AUTH_REQUIRED', 
                message: 'User needs to authenticate with Teams SSO',
                user: mockUserContext.name,
                authUrl: authStatus.authUrl,
                instructions: 'Click the authUrl to complete Teams SSO authentication'
            });
            return;
        }
        
        // Try to read calendar events using Teams SSO
        const events = await graphService.getCalendarEvents(mockUserContext, startTime, endTime);
        
        if (events.success) {
            res.send(200, { 
                status: 'OK', 
                message: 'Calendar access successful with Teams SSO!',
                user: mockUserContext.name,
                eventCount: events.data.length,
                events: events.data,
                timeRange: {
                    start: startTime,
                    end: endTime
                }
            });
        } else {
            res.send(500, { 
                status: 'ERROR', 
                message: 'Calendar access failed with Teams SSO',
                error: events.error,
                userContext: mockUserContext,
                authUrl: events.authUrl
            });
        }
    } catch (error) {
        console.error('Calendar Teams SSO test error:', error);
        res.send(500, { 
            status: 'ERROR', 
            message: 'Calendar Teams SSO test failed',
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

const port = process.env.PORT || 3978;
server.listen(port, () => {
    console.log(`\n🤖 Caleo Bot is running on port ${port}`);
    console.log(`📡 Health check: http://localhost:${port}/api/health`);
    console.log(`🧪 AI test: http://localhost:${port}/api/test-ai`);
    console.log(`📅 Graph test: http://localhost:${port}/api/test-graph`);
    console.log(`🔐 Teams SSO test: http://localhost:${port}/api/test-teams-sso`);
    console.log(`📅 Calendar test: http://localhost:${port}/api/test-calendar`);
    console.log(`📅 Teams Calendar test: http://localhost:${port}/api/test-calendar-teams`);
    console.log(`🔐 OAuth callback: http://localhost:${port}/auth/callback`);
    console.log(`💬 Bot endpoint: http://localhost:${port}/api/messages`);
    console.log(`\n🔧 To test locally, use ngrok to expose this port:`);
    console.log(`   ngrok http ${port}`);
    console.log(`\n📋 Next steps:`);
    console.log(`   1. Run 'npm run ngrok' to expose your bot`);
    console.log(`   2. Update the manifest.json with your ngrok URL`);
    console.log(`   3. Side-load the app in Microsoft Teams`);
    console.log(`\n🤖 Service Status:`);
    console.log(`   OpenAI API Key: ${process.env.OPENAI_API_KEY ? '✅ SET' : '❌ NOT SET'}`);
    console.log(`   Microsoft Tenant ID: ${process.env.MICROSOFT_TENANT_ID ? '✅ SET' : '❌ NOT SET'}`);
    console.log(`   USE_EDGE_AGENT: ${process.env.USE_EDGE_AGENT || 'NOT SET (defaults to local)'}`);
    console.log(`   SUPABASE_AGENT_ENDPOINT: ${process.env.SUPABASE_AGENT_ENDPOINT || 'NOT SET'}`);
    console.log(`   Agent Mode: ${process.env.USE_EDGE_AGENT === 'true' && process.env.SUPABASE_AGENT_ENDPOINT ? '🌐 REMOTE' : '🤖 LOCAL'}`);
    console.log(`   Agent Client Type: ${agentClient?.constructor?.name || 'Unknown'}`);
    console.log(`\n🧪 Test Endpoints:`);
    console.log(`   Test AI: curl http://localhost:${port}/api/test-ai`);
    console.log(`   Test Graph: curl http://localhost:${port}/api/test-graph`);
    console.log(`   Test Teams SSO: curl http://localhost:${port}/api/test-teams-sso`);
    console.log(`   Test Calendar: curl http://localhost:${port}/api/test-calendar`);
    console.log(`   Test Teams Calendar: curl http://localhost:${port}/api/test-calendar-teams`);
});
