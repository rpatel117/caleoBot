import { Agent, run, tool } from '@openai/agents';
import GraphService from './graph-service';
import TeamsSSOService from './teams-sso-service';
import { SupabaseDatabaseService } from './database';
import { DataSanitizer } from './data-sanitizer';

export interface UserContext {
  userId: string;
  name: string;
  email: string;
  tenantId: string;
}

export interface CalendarEvent {
  id: string;
  subject: string;
  start: {
    dateTime: string;
    timeZone: string;
  };
  end: {
    dateTime: string;
    timeZone: string;
  };
  attendees?: Array<{
    emailAddress: {
      name: string;
      address: string;
    };
    type: string;
  }>;
  location?: {
    displayName: string;
  };
  body?: {
    content: string;
  };
}

export class SimpleAgentService {
  private mainAgent: Agent;
  private graphService: GraphService;
  private teamsSSO: TeamsSSOService;
  private database: SupabaseDatabaseService;
  private conversationHistory: Map<string, Array<{role: string, content: string, timestamp: Date}>> = new Map();

  constructor() {
    this.graphService = new GraphService();
    this.teamsSSO = new TeamsSSOService();
    this.database = new SupabaseDatabaseService();
    
    try {
      this.mainAgent = new Agent({
        name: 'Caleo Assistant',
        model: 'gpt-4o-mini',
        instructions: this.getMainInstructions(),
        tools: this.getAllTools()
      });
      console.log('✅ Agent created successfully with', this.getAllTools().length, 'tools');
    } catch (error) {
      console.error('❌ Error creating agent:', error);
      throw error;
    }
  }

  private getMainInstructions(): string {
    return `You are Caleo, an AI-powered meeting scheduler and team assistant for Microsoft Teams.

CORE PRINCIPLES:
- Always use the current date and time as your reference point
- When users ask about "today", "tomorrow", "this week", etc., use the actual current date
- Convert all times to the user's timezone (America/Chicago) for display
- Be proactive and helpful in calendar management
- Ask clarifying questions when needed for meeting creation
- Remember previous messages in the conversation to provide context-aware responses

CONVERSATION CONTEXT:
- You have access to the conversation history with the user
- Use previous messages to understand context and provide more relevant responses
- Reference previous topics when appropriate
- Maintain continuity in the conversation
- If a user refers to "it", "that", "the meeting", etc., use conversation context to understand what they mean

CAPABILITIES:
- View and analyze calendar events (you have direct access to the user's calendar)
- Create new meetings with attendees
- Update existing meetings
- Check availability
- Answer questions about schedules
- Provide intelligent calendar insights
- Remember and reference previous conversation topics

CALENDAR ACCESS:
- You have full access to the user's calendar through Microsoft Graph API
- When users ask about meetings, events, or schedule, use the appropriate tools directly
- No need to ask for permission - you already have authenticated access
- Use get_today_events for today's meetings, get_week_events for this week, or get_calendar_events for specific date ranges

AUTHENTICATION HANDLING:
- If any tool returns a result with needsReauth: true, this means the user needs to re-authenticate
- When this happens, immediately inform the user that they need to re-authenticate
- Provide the authUrl from the tool result as a clickable link
- Explain that they need to click the link to authorize calendar access
- After they re-authenticate, they can try their request again
- Be helpful and clear about the re-authentication process

RESPONSE STYLE:
- Professional but friendly
- Clear and concise
- Use emojis sparingly and appropriately
- Always confirm actions taken
- Provide helpful context when relevant
- Reference previous conversation topics when appropriate

IMPORTANT: Always use the get_current_time tool to get the current date and time before responding to any time-related questions.`;
  }

  private getAllTools() {
    return [
      this.getCurrentTimeTool(),
      this.getUserInfoTool(),
      this.getTodayEventsTool(),
      this.getWeekEventsTool(),
      this.getCalendarEventsTool(),
      this.createMeetingTool(),
      this.updateMeetingTool(),
      this.deleteMeetingTool(),
      this.checkAvailabilityTool(),
      this.findFreeTimeTool()
    ];
  }

  // Context Tools
  private getCurrentTimeTool() {
    return tool({
      name: 'get_current_time',
      description: 'Get the current date and time in the user\'s timezone',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false
      },
      execute: async () => {
        const now = new Date();
        const currentDate = now.toLocaleDateString('en-US', { 
          weekday: 'long', 
          year: 'numeric', 
          month: 'long', 
          day: 'numeric',
          timeZone: 'America/Chicago'
        });
        const currentTime = now.toLocaleTimeString('en-US', { 
          hour: '2-digit', 
          minute: '2-digit', 
          timeZoneName: 'short',
          timeZone: 'America/Chicago'
        });
        
        return {
          currentDate,
          currentTime,
          timezone: 'America/Chicago',
          timestamp: now.toISOString()
        };
      }
    });
  }

  private getUserInfoTool() {
    return tool({
      name: 'get_user_info',
      description: 'Get current user information',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false
      },
      execute: async () => {
        return {
          timezone: 'America/Chicago',
          locale: 'en-US'
        };
      }
    });
  }

  // Calendar Read Tools
  private getTodayEventsTool() {
    return tool({
      name: 'get_today_events',
      description: 'Get calendar events for today (current date)',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false
      },
      execute: async (params: any, context: any) => {
        console.log('📅 get_today_events: Starting execution');
        console.log('📅 get_today_events: Full context object:', JSON.stringify(context, null, 2));
        console.log('📅 get_today_events: Context keys:', Object.keys(context || {}));
        console.log('📅 get_today_events: userContext property:', context?.userContext);
        console.log('📅 get_today_events: context.context property:', context?.context);
        
        const userContext = context?.context?.userContext as UserContext;
        if (!userContext) {
          console.log('❌ get_today_events: No user context provided');
          throw new Error('User context required');
        }
        console.log('✅ get_today_events: User context found');

        const today = new Date();
        const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0, 0);
        const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);
        
        const startTime = startOfDay.toISOString();
        const endTime = endOfDay.toISOString();
        
        console.log('📅 get_today_events: Date range:', { startTime, endTime });
        console.log('📅 get_today_events: Calling graphService.getCalendarEvents...');
        
        const result = await this.graphService.getCalendarEvents(userContext, startTime, endTime);
        
        console.log('📅 get_today_events: Graph service result:', { 
          success: result.success, 
          hasData: !!result.data, 
          dataLength: result.data?.length || 0,
          error: result.error 
        });
        
        if (!result.success || !result.data) {
          console.log('❌ get_today_events: Failed to get calendar events:', result.error);
          return { events: [], error: result.error };
        }

        // Format events directly (sanitization happens in formatEventForDisplay)
        const events = result.data.map((event: any) => this.formatEventForDisplay(event));
        
        // Log token usage for debugging
        const totalTokens = DataSanitizer.estimateTokens(events);
        console.log(`🔍 Total events tokens: ~${totalTokens}`);
        console.log('✅ get_today_events: Successfully formatted', events.length, 'events');
        return { events, count: events.length };
      }
    });
  }

  private getWeekEventsTool() {
    return tool({
      name: 'get_week_events',
      description: 'Get all calendar events for the current week',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false
      },
      execute: async (params: any, context: any) => {
        const userContext = context?.context?.userContext as UserContext;
        if (!userContext) {
          throw new Error('User context required');
        }

        const today = new Date();
        const startOfWeek = new Date(today);
        startOfWeek.setDate(today.getDate() - today.getDay()); // Start of week (Sunday)
        
        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 7); // End of week
        
        const startTime = startOfWeek.toISOString();
        const endTime = endOfWeek.toISOString();
        
        const result = await this.graphService.getCalendarEvents(userContext, startTime, endTime);
        
        if (!result.success || !result.data) {
          return { events: [], error: result.error };
        }

        const events = result.data.map((event: any) => this.formatEventForDisplay(event));
        return { events, count: events.length };
      }
    });
  }

  private getCalendarEventsTool() {
    return tool({
      name: 'get_calendar_events',
      description: 'Get calendar events for a specific date range',
      parameters: {
        type: 'object',
        properties: {
          startDate: { 
            type: 'string', 
            description: 'Start date in ISO format (e.g., 2025-10-03T00:00:00.000Z)' 
          },
          endDate: { 
            type: 'string', 
            description: 'End date in ISO format (e.g., 2025-10-10T23:59:59.999Z)' 
          },
          includeDetails: { 
            type: 'boolean', 
            description: 'Include full event details', 
            default: false 
          }
        },
        required: ['startDate', 'endDate', 'includeDetails'],
        additionalProperties: false
      },
      execute: async (params: any, context: any) => {
        const userContext = context?.context?.userContext as UserContext;
        if (!userContext) {
          throw new Error('User context required');
        }

        const result = await this.graphService.getCalendarEvents(
          userContext, 
          params.startDate, 
          params.endDate
        );
        
        if (!result.success || !result.data) {
          return { events: [], error: result.error };
        }

        // Format events directly (sanitization happens in formatEventForDisplay)
        const events = result.data.map((event: any) => this.formatEventForDisplay(event));
        
        // Log token usage for debugging
        const totalTokens = DataSanitizer.estimateTokens(events);
        console.log(`🔍 Calendar events tokens: ~${totalTokens}`);
        return { events, count: events.length };
      }
    });
  }

  // Calendar Write Tools
  private createMeetingTool() {
    return tool({
      name: 'create_meeting',
      description: 'Create a new calendar meeting',
      parameters: {
        type: 'object',
        properties: {
          subject: { 
            type: 'string', 
            description: 'Meeting subject/title' 
          },
          startTime: { 
            type: 'string', 
            description: 'Start time in ISO format (e.g., 2025-10-03T18:00:00.000Z)' 
          },
          endTime: { 
            type: 'string', 
            description: 'End time in ISO format (e.g., 2025-10-03T19:00:00.000Z)' 
          },
          attendees: { 
            type: 'array', 
            items: { type: 'string' },
            description: 'List of attendee email addresses' 
          },
          location: { 
            type: 'string', 
            description: 'Meeting location (optional)' 
          },
          body: { 
            type: 'string', 
            description: 'Meeting description/body (optional)' 
          },
          isOnlineMeeting: { 
            type: 'boolean', 
            description: 'Whether to create an online meeting', 
            default: true 
          }
        },
        required: ['subject', 'startTime', 'endTime', 'attendees', 'location', 'body', 'isOnlineMeeting'],
        additionalProperties: false
      },
      execute: async (params: any, context: any) => {
        const userContext = context?.context?.userContext as UserContext;
        if (!userContext) {
          throw new Error('User context required');
        }

        // Parse the datetime strings to ensure proper UTC format
        const startDateTime = new Date(params.startTime).toISOString();
        const endDateTime = new Date(params.endTime).toISOString();
        
        const meetingData = {
          subject: params.subject,
          start: {
            dateTime: startDateTime,
            timeZone: 'UTC'
          },
          end: {
            dateTime: endDateTime,
            timeZone: 'UTC'
          },
          attendees: params.attendees?.map((email: string) => ({
            emailAddress: { 
              address: email,
              name: email.split('@')[0] // Use email prefix as name
            },
            type: 'required'
          })) || [],
          location: params.location ? {
            displayName: params.location
          } : undefined,
          isOnlineMeeting: params.isOnlineMeeting,
          // Essential properties for invitations
          isReminderOn: true,
          reminderMinutesBeforeStart: 15,
          responseRequested: true,
          allowNewTimeProposals: true,
          isOrganizer: true,
          sensitivity: 'normal',
          importance: 'normal',
          showAs: 'busy',
          isAllDay: false,
          // Meeting body
          body: {
            contentType: 'html',
            content: params.body ? `<p>${params.body}</p><p>You have been invited to this meeting.</p>` : '<p>You have been invited to this meeting.</p>'
          }
        };

        const result = await this.graphService.createMeeting(userContext, meetingData);
        
        if (!result.success) {
          return { success: false, error: result.error };
        }

        return { 
          success: true, 
          meetingId: result.data?.id,
          webLink: result.data?.webLink,
          joinUrl: result.data?.onlineMeeting?.joinUrl
        };
      }
    });
  }

  private updateMeetingTool() {
    return tool({
      name: 'update_meeting',
      description: 'Update an existing calendar meeting',
      parameters: {
        type: 'object',
        properties: {
          meetingId: { 
            type: 'string', 
            description: 'ID of the meeting to update' 
          },
          subject: { 
            type: 'string', 
            description: 'Updated meeting subject/title' 
          },
          startTime: { 
            type: 'string', 
            description: 'Updated start time in ISO format' 
          },
          endTime: { 
            type: 'string', 
            description: 'Updated end time in ISO format' 
          },
          attendees: { 
            type: 'array', 
            items: { type: 'string' },
            description: 'Updated list of attendee email addresses' 
          },
          location: { 
            type: 'string', 
            description: 'Updated meeting location' 
          },
          body: { 
            type: 'string', 
            description: 'Updated meeting description/body' 
          }
        },
        required: ['meetingId', 'subject', 'startTime', 'endTime', 'attendees', 'location', 'body'],
        additionalProperties: false
      },
      execute: async (params: any, context: any) => {
        const userContext = context?.context?.userContext as UserContext;
        if (!userContext) {
          throw new Error('User context required');
        }

        const updateData: any = {};
        
        if (params.subject) updateData.subject = params.subject;
        if (params.startTime) {
          updateData.start = {
            dateTime: params.startTime,
            timeZone: 'UTC'
          };
        }
        if (params.endTime) {
          updateData.end = {
            dateTime: params.endTime,
            timeZone: 'UTC'
          };
        }
        if (params.attendees) {
          updateData.attendees = params.attendees.map((email: string) => ({
            emailAddress: { address: email },
            type: 'required'
          }));
        }
        if (params.location) {
          updateData.location = { displayName: params.location };
        }
        if (params.body) {
          updateData.body = {
            content: params.body,
            contentType: 'text'
          };
        }

        const result = await this.graphService.updateMeeting(userContext, params.meetingId, updateData);
        
        if (!result.success) {
          return { success: false, error: result.error };
        }

        return { success: true, meetingId: params.meetingId };
      }
    });
  }

  private deleteMeetingTool() {
    return tool({
      name: 'delete_meeting',
      description: 'Delete a calendar meeting',
      parameters: {
        type: 'object',
        properties: {
          meetingId: { 
            type: 'string', 
            description: 'ID of the meeting to delete' 
          }
        },
        required: ['meetingId'],
        additionalProperties: false
      },
      execute: async (params: any, context: any) => {
        const userContext = context?.context?.userContext as UserContext;
        if (!userContext) {
          throw new Error('User context required');
        }

        const result = await this.graphService.deleteMeeting(userContext, params.meetingId);
        
        if (!result.success) {
          return { success: false, error: result.error };
        }

        return { success: true, meetingId: params.meetingId };
      }
    });
  }

  private checkAvailabilityTool() {
    return tool({
      name: 'check_availability',
      description: 'Check availability for a specific time range',
      parameters: {
        type: 'object',
        properties: {
          startTime: { 
            type: 'string', 
            description: 'Start time in ISO format' 
          },
          endTime: { 
            type: 'string', 
            description: 'End time in ISO format' 
          },
          attendees: { 
            type: 'array', 
            items: { type: 'string' },
            description: 'List of attendee email addresses to check' 
          }
        },
        required: ['startTime', 'endTime', 'attendees'],
        additionalProperties: false
      },
      execute: async (params: any, context: any) => {
        const userContext = context?.context?.userContext as UserContext;
        if (!userContext) {
          throw new Error('User context required');
        }

        const result = await this.graphService.checkAvailability(
          userContext, 
          params.startTime, 
          params.endTime, 
          params.attendees
        );
        
        if (!result.success) {
          return { available: false, error: result.error };
        }

        return { 
          available: result.data?.available || false,
          conflicts: result.data?.conflicts || []
        };
      }
    });
  }

  private findFreeTimeTool() {
    return tool({
      name: 'find_free_time',
      description: 'Find free time slots in the calendar',
      parameters: {
        type: 'object',
        properties: {
          duration: { 
            type: 'number', 
            description: 'Duration in minutes' 
          },
          startDate: { 
            type: 'string', 
            description: 'Start date to search from (ISO format)' 
          },
          endDate: { 
            type: 'string', 
            description: 'End date to search until (ISO format)' 
          },
          workingHours: { 
            type: 'object',
            properties: {
              start: { type: 'string', description: 'Start time (e.g., "09:00")' },
              end: { type: 'string', description: 'End time (e.g., "17:00")' }
            },
            required: ['start', 'end'],
            additionalProperties: false,
            description: 'Working hours to consider'
          }
        },
        required: ['duration', 'startDate', 'endDate', 'workingHours'],
        additionalProperties: false
      },
      execute: async (params: any, context: any) => {
        const userContext = context?.context?.userContext as UserContext;
        if (!userContext) {
          throw new Error('User context required');
        }

        const startDate = params.startDate || new Date().toISOString();
        const endDate = params.endDate || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
        
        // Get calendar events for the period
        const result = await this.graphService.getCalendarEvents(userContext, startDate, endDate);
        
        if (!result.success || !result.data) {
          return { freeSlots: [], error: result.error };
        }

        // Simple free time calculation (this could be more sophisticated)
        const freeSlots = this.calculateFreeTimeSlots(result.data, params.duration, params.workingHours);
        
        return { freeSlots };
      }
    });
  }

  // Helper Methods
  private formatEventForDisplay(event: any): CalendarEvent {
    console.log('🔍 Raw event data:', {
      subject: event.subject,
      startDateTime: event.start?.dateTime,
      endDateTime: event.end?.dateTime
    });
    
    const startTime = event.start?.dateTime ? 
      new Date(event.start.dateTime.replace(/\.\d{7}Z$/, 'Z')).toLocaleString('en-US', { 
        timeZone: 'America/Chicago',
        weekday: 'short',
        month: 'short', 
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZoneName: 'short'
      }) : 'Unknown';
    
    const endTime = event.end?.dateTime ? 
      new Date(event.end.dateTime.replace(/\.\d{7}Z$/, 'Z')).toLocaleString('en-US', { 
        timeZone: 'America/Chicago',
        hour: '2-digit',
        minute: '2-digit',
        timeZoneName: 'short'
      }) : 'Unknown';
    
    console.log('🔍 Formatted times:', { startTime, endTime });

    // Sanitize the event data to reduce token usage
    const sanitizedEvent = {
      id: event.id,
      subject: event.subject,
      start: {
        dateTime: startTime,
        timeZone: 'America/Chicago'
      },
      end: {
        dateTime: endTime,
        timeZone: 'America/Chicago'
      },
      attendees: event.attendees?.map((a: any) => ({
        emailAddress: {
          name: a.emailAddress?.name || a.emailAddress?.address,
          address: a.emailAddress?.address
        },
        type: a.type
      })),
      location: event.location?.displayName || null,
      // Strip HTML body content to save tokens
      body: event.body?.content ? {
        content: DataSanitizer.stripHtml(event.body.content)
      } : undefined
    };

    // Log token usage for debugging
    const tokenEstimate = DataSanitizer.estimateTokens(sanitizedEvent);
    console.log(`🔍 Sanitized event tokens: ~${tokenEstimate}`);

    return sanitizedEvent;
  }

  private calculateFreeTimeSlots(events: any[], durationMinutes: number, workingHours?: any): any[] {
    // This is a simplified implementation
    // In a real scenario, you'd want more sophisticated free time calculation
    const freeSlots: any[] = [];
    
    // For now, return a simple response
    // This would need to be implemented based on your specific requirements
    return freeSlots;
  }

  // Main Processing Method
  async processMessage(userMessage: string, userContext: UserContext): Promise<string> {
    try {
      console.log(`🤖 Agent processing message: "${userMessage}"`);
      console.log(`🔍 User context details:`, {
        userId: userContext.userId,
        name: userContext.name,
        email: userContext.email,
        tenantId: userContext.tenantId
      });
      
      const userId = userContext.userId;
      
      // Get or create conversation history for this user
      if (!this.conversationHistory.has(userId)) {
        this.conversationHistory.set(userId, []);
        console.log(`📝 Created new conversation history for user: ${userId}`);
      }
      
      const history = this.conversationHistory.get(userId)!;
      
      // Add user message to history
      history.push({ 
        role: 'user', 
        content: userMessage, 
        timestamp: new Date() 
      });
      
      console.log(`📝 Conversation history length: ${history.length} messages`);
      
      // Pass user context and conversation history through the run context
      console.log(`🚀 Calling agent.run with context and conversation history...`);
      const result = await run(this.mainAgent, userMessage, {
        context: { 
          userContext,
          conversationHistory: history.slice(-10) // Keep last 10 messages for context
        }
      });
      
      const botResponse = result.finalOutput || 'I apologize, but I was unable to generate a response.';
      
      // Add bot response to history
      history.push({ 
        role: 'assistant', 
        content: botResponse, 
        timestamp: new Date() 
      });
      
      console.log(`✅ Agent response generated:`, {
        hasFinalOutput: !!result.finalOutput,
        outputLength: botResponse.length,
        conversationLength: history.length
      });
      
      return botResponse;
    } catch (error) {
      console.error('❌ Agent processing error:', error);
      return `I apologize, but I encountered an error while processing your request. Please try again.`;
    }
  }

  private updateToolsWithContext(userContext: UserContext): void {
    // The tools are now created with the user context passed through the run context
    // No need to modify the tools directly as the context is passed through the run method
  }

  // Conversation Management Methods
  public getConversationHistory(userId: string): Array<{role: string, content: string, timestamp: Date}> {
    return this.conversationHistory.get(userId) || [];
  }

  public clearConversationHistory(userId: string): void {
    this.conversationHistory.delete(userId);
    console.log(`🗑️ Cleared conversation history for user: ${userId}`);
  }

  public getConversationLength(userId: string): number {
    return this.conversationHistory.get(userId)?.length || 0;
  }

  public getAllConversationUsers(): string[] {
    return Array.from(this.conversationHistory.keys());
  }

  // Test connection method for health checks
  async testConnection(): Promise<boolean> {
    try {
      console.log('🧪 Testing Agent service...');
      
      // Test basic agent functionality (tools and instructions)
      if (this.mainAgent && this.getAllTools().length > 0) {
        console.log('✅ Agent service is working!');
        console.log(`✅ Agent has ${this.getAllTools().length} tools available`);
        console.log('ℹ️  Note: Calendar operations require user authentication');
        return true;
      } else {
        console.log('❌ Agent service test failed - Agent not properly initialized');
        return false;
      }
    } catch (error) {
      console.error('❌ Agent service test failed:', error);
      return false;
    }
  }
}
