import Anthropic from '@anthropic-ai/sdk';
import { AGENT_CONFIG, AGENT_INSTRUCTIONS } from './config';
import { UserContext, CalendarProviderType } from '../types';
import { CalendarProvider } from '../calendar/types';
import { EmailProvider } from '../email/types';
import { DataSanitizer } from '../data-sanitizer';
import { repository } from '../database/repository';

interface ProviderSet {
  calendar?: CalendarProvider;
  email?: EmailProvider;
  accessToken?: string;
  providerType: CalendarProviderType;
}

interface AgentContext {
  userContext: UserContext;
  providers: Map<CalendarProviderType, ProviderSet>;
  dbUserId?: string;
}

const toolDefinitions: Anthropic.Tool[] = [
  {
    name: 'get_current_time',
    description: 'Get the current date and time in the user\'s timezone',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: []
    }
  },
  {
    name: 'get_user_info',
    description: 'Get current user information including timezone and connected providers',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: []
    }
  },
  {
    name: 'get_today_events',
    description: 'Get calendar events for today',
    input_schema: {
      type: 'object' as const,
      properties: {
        provider: {
          type: 'string',
          description: 'Calendar provider to use: "microsoft" or "google". If omitted, uses the first connected provider.',
          enum: ['microsoft', 'google']
        }
      },
      required: []
    }
  },
  {
    name: 'get_week_events',
    description: 'Get all calendar events for the current week',
    input_schema: {
      type: 'object' as const,
      properties: {
        provider: {
          type: 'string',
          description: 'Calendar provider to use: "microsoft" or "google"',
          enum: ['microsoft', 'google']
        }
      },
      required: []
    }
  },
  {
    name: 'get_calendar_events',
    description: 'Get calendar events for a specific date range',
    input_schema: {
      type: 'object' as const,
      properties: {
        startDate: { type: 'string', description: 'Start date in ISO format' },
        endDate: { type: 'string', description: 'End date in ISO format' },
        provider: {
          type: 'string',
          description: 'Calendar provider to use: "microsoft" or "google"',
          enum: ['microsoft', 'google']
        }
      },
      required: ['startDate', 'endDate']
    }
  },
  {
    name: 'create_meeting',
    description: 'Create a new calendar meeting',
    input_schema: {
      type: 'object' as const,
      properties: {
        subject: { type: 'string', description: 'Meeting subject/title' },
        startTime: { type: 'string', description: 'Start time in ISO format' },
        endTime: { type: 'string', description: 'End time in ISO format' },
        attendees: { type: 'array', items: { type: 'string' }, description: 'Attendee email addresses' },
        location: { type: 'string', description: 'Meeting location (optional)' },
        body: { type: 'string', description: 'Meeting description (optional)' },
        isOnlineMeeting: { type: 'boolean', description: 'Create as online meeting' },
        provider: { type: 'string', description: 'Calendar provider', enum: ['microsoft', 'google'] }
      },
      required: ['subject', 'startTime', 'endTime']
    }
  },
  {
    name: 'update_meeting',
    description: 'Update an existing calendar meeting',
    input_schema: {
      type: 'object' as const,
      properties: {
        meetingId: { type: 'string', description: 'Meeting ID to update' },
        subject: { type: 'string', description: 'Updated subject' },
        startTime: { type: 'string', description: 'Updated start time in ISO format' },
        endTime: { type: 'string', description: 'Updated end time in ISO format' },
        attendees: { type: 'array', items: { type: 'string' }, description: 'Updated attendees' },
        location: { type: 'string', description: 'Updated location' },
        body: { type: 'string', description: 'Updated description' },
        provider: { type: 'string', description: 'Calendar provider', enum: ['microsoft', 'google'] }
      },
      required: ['meetingId']
    }
  },
  {
    name: 'delete_meeting',
    description: 'Delete a calendar meeting',
    input_schema: {
      type: 'object' as const,
      properties: {
        meetingId: { type: 'string', description: 'Meeting ID to delete' },
        provider: { type: 'string', description: 'Calendar provider', enum: ['microsoft', 'google'] }
      },
      required: ['meetingId']
    }
  },
  {
    name: 'check_availability',
    description: 'Check availability for a specific time range',
    input_schema: {
      type: 'object' as const,
      properties: {
        startTime: { type: 'string', description: 'Start time in ISO format' },
        endTime: { type: 'string', description: 'End time in ISO format' },
        attendees: { type: 'array', items: { type: 'string' }, description: 'Attendees to check' },
        provider: { type: 'string', description: 'Calendar provider', enum: ['microsoft', 'google'] }
      },
      required: ['startTime', 'endTime']
    }
  },
  {
    name: 'find_free_time',
    description: 'Find free time slots in the calendar',
    input_schema: {
      type: 'object' as const,
      properties: {
        duration: { type: 'number', description: 'Duration in minutes' },
        startDate: { type: 'string', description: 'Start date (ISO format)' },
        endDate: { type: 'string', description: 'End date (ISO format)' },
        workingHoursStart: { type: 'string', description: 'Working hours start (e.g., "09:00")' },
        workingHoursEnd: { type: 'string', description: 'Working hours end (e.g., "17:00")' },
        provider: { type: 'string', description: 'Calendar provider', enum: ['microsoft', 'google'] }
      },
      required: ['duration', 'startDate', 'endDate']
    }
  },
  {
    name: 'draft_followup_email',
    description: 'Create a draft follow-up email based on meeting context',
    input_schema: {
      type: 'object' as const,
      properties: {
        subject: { type: 'string', description: 'Email subject' },
        body: { type: 'string', description: 'Email body text' },
        toRecipients: { type: 'array', items: { type: 'string' }, description: 'Recipient email addresses' },
        provider: { type: 'string', description: 'Email provider', enum: ['microsoft', 'google'] }
      },
      required: ['subject', 'body', 'toRecipients']
    }
  },
  {
    name: 'list_providers',
    description: 'Show which calendar and email providers the user has connected',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: []
    }
  }
];

export class AnthropicAgent {
  private client: Anthropic;

  constructor() {
    this.client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }

  async processMessage(
    userMessage: string,
    context: AgentContext,
    conversationHistory: Array<{ role: string; content: string }>
  ): Promise<string> {
    try {
    const messages: Anthropic.MessageParam[] = [];

    // Add conversation history
    for (const msg of conversationHistory.slice(-(AGENT_CONFIG.maxConversationLength))) {
      messages.push({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      });
    }

    // Add current user message
    messages.push({ role: 'user', content: userMessage });

    // Tool use loop
    let response = await this.client.messages.create({
      model: AGENT_CONFIG.model,
      max_tokens: AGENT_CONFIG.maxTokens,
      system: AGENT_INSTRUCTIONS,
      tools: toolDefinitions,
      messages,
    });

    // Process tool calls in a loop until we get a final text response
    const MAX_TOOL_ITERATIONS = 10;
    let toolIterations = 0;
    while (response.stop_reason === 'tool_use') {
      toolIterations++;
      if (toolIterations > MAX_TOOL_ITERATIONS) {
        console.warn(`Tool loop exceeded ${MAX_TOOL_ITERATIONS} iterations, forcing stop`);
        break;
      }
      const assistantContent = response.content;
      messages.push({ role: 'assistant', content: assistantContent });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const block of assistantContent) {
        if (block.type === 'tool_use') {
          const result = await this.executeTool(block.name, block.input as Record<string, any>, context);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify(result),
          });
        }
      }

      messages.push({ role: 'user', content: toolResults });

      response = await this.client.messages.create({
        model: AGENT_CONFIG.model,
        max_tokens: AGENT_CONFIG.maxTokens,
        system: AGENT_INSTRUCTIONS,
        tools: toolDefinitions,
        messages,
      });
    }

    // Extract text from final response
    const textBlocks = response.content.filter(
      (b): b is Anthropic.TextBlock => b.type === 'text'
    );
    return textBlocks.map((b) => b.text).join('\n') || 'I was unable to generate a response.';
    } catch (error: any) {
      console.error('Anthropic API error:', error?.message || error);
      if (error?.status === 400 && error?.message?.includes('credit balance')) {
        return 'Caleo is temporarily unavailable: the Anthropic API account needs credits. Please check billing at console.anthropic.com.';
      }
      if (error?.status === 401) {
        return 'Caleo configuration error: invalid Anthropic API key.';
      }
      if (error?.status === 429) {
        return 'Caleo is rate-limited right now. Please try again in a moment.';
      }
      return `Sorry, I encountered an error processing your request: ${error?.message || 'Unknown error'}`;
    }
  }

  private getProvider(context: AgentContext, requestedProvider?: string): ProviderSet | null {
    if (requestedProvider) {
      return context.providers.get(requestedProvider as CalendarProviderType) || null;
    }
    // Return first available provider
    for (const [, provider] of context.providers) {
      if (provider.calendar && provider.accessToken) {
        return provider;
      }
    }
    return null;
  }

  private formatApiError(error: any, provider?: ProviderSet): string {
    const msg = error?.message || 'Unknown error';
    const status = error?.status || error?.response?.status;
    if (status === 401 || status === 403 || msg.includes('401') || msg.includes('Unauthorized') || msg.includes('InvalidAuthenticationToken')) {
      const provName = provider?.providerType === 'google' ? 'Google' : provider?.providerType === 'microsoft' ? 'Microsoft' : 'your calendar';
      return `${provName} access token has expired or been revoked. Please run /caleo-auth to reconnect ${provName}.`;
    }
    return msg;
  }

  private getProviderError(context: AgentContext, requestedProvider?: string): string {
    if (requestedProvider) {
      const providerName = requestedProvider === 'google' ? 'Google Calendar' : 'Microsoft Outlook';
      const connected = Array.from(context.providers.keys());
      if (connected.length > 0) {
        return `${providerName} is not connected. You have: ${connected.join(', ')}. Use /caleo-auth to connect ${providerName}.`;
      }
      return `${providerName} is not connected. Use /caleo-auth to connect it.`;
    }
    return 'No calendar provider connected. Use /caleo-auth to connect Microsoft Outlook or Google Calendar.';
  }

  private async executeTool(name: string, input: Record<string, any>, context: AgentContext): Promise<any> {
    const tz = context.userContext.timezone || 'America/Chicago';

    switch (name) {
      case 'get_current_time': {
        const now = new Date();
        return {
          currentDate: now.toLocaleDateString('en-US', {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: tz,
          }),
          currentTime: now.toLocaleTimeString('en-US', {
            hour: '2-digit', minute: '2-digit', timeZoneName: 'short', timeZone: tz,
          }),
          timezone: tz,
          timestamp: now.toISOString(),
        };
      }

      case 'get_user_info': {
        const connectedProviders: string[] = [];
        for (const [provType, prov] of context.providers) {
          if (prov.accessToken) connectedProviders.push(provType);
        }
        return {
          name: context.userContext.name,
          email: context.userContext.email,
          timezone: tz,
          connectedProviders,
        };
      }

      case 'get_today_events': {
        const provider = this.getProvider(context, input.provider);
        if (!provider?.calendar || !provider.accessToken) {
          return { events: [], error: this.getProviderError(context, input.provider) };
        }
        const now = new Date();
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
        try {
          const events = await provider.calendar.getEvents(provider.accessToken, startOfDay, endOfDay);
          return { events: events.map(e => this.formatEvent(e, tz)), count: events.length };
        } catch (error: any) {
          return { events: [], error: this.formatApiError(error, provider) };
        }
      }

      case 'get_week_events': {
        const provider = this.getProvider(context, input.provider);
        if (!provider?.calendar || !provider.accessToken) {
          return { events: [], error: this.getProviderError(context, input.provider) };
        }
        const now = new Date();
        const startOfWeek = new Date(now);
        startOfWeek.setDate(now.getDate() - now.getDay());
        startOfWeek.setHours(0, 0, 0, 0);
        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 7);
        try {
          const events = await provider.calendar.getEvents(provider.accessToken, startOfWeek, endOfWeek);
          return { events: events.map(e => this.formatEvent(e, tz)), count: events.length };
        } catch (error: any) {
          return { events: [], error: this.formatApiError(error, provider) };
        }
      }

      case 'get_calendar_events': {
        const provider = this.getProvider(context, input.provider);
        if (!provider?.calendar || !provider.accessToken) {
          return { events: [], error: this.getProviderError(context, input.provider) };
        }
        try {
          const events = await provider.calendar.getEvents(
            provider.accessToken,
            new Date(input.startDate),
            new Date(input.endDate)
          );
          return { events: events.map(e => this.formatEvent(e, tz)), count: events.length };
        } catch (error: any) {
          return { events: [], error: this.formatApiError(error, provider) };
        }
      }

      case 'create_meeting': {
        const provider = this.getProvider(context, input.provider);
        if (!provider?.calendar || !provider.accessToken) {
          return { success: false, error: this.getProviderError(context, input.provider) };
        }
        try {
          const event = await provider.calendar.createEvent(provider.accessToken, {
            subject: input.subject,
            start: new Date(input.startTime),
            end: new Date(input.endTime),
            attendees: input.attendees || [],
            location: input.location,
            body: input.body,
            isOnlineMeeting: input.isOnlineMeeting ?? true,
            timezone: tz,
          });
          return { success: true, meetingId: event.id, webLink: event.webLink };
        } catch (error: any) {
          return { success: false, error: this.formatApiError(error, provider) };
        }
      }

      case 'update_meeting': {
        const provider = this.getProvider(context, input.provider);
        if (!provider?.calendar || !provider.accessToken) {
          return { success: false, error: this.getProviderError(context, input.provider) };
        }
        try {
          const updates: any = {};
          if (input.subject) updates.subject = input.subject;
          if (input.startTime) updates.start = new Date(input.startTime);
          if (input.endTime) updates.end = new Date(input.endTime);
          if (input.attendees) updates.attendees = input.attendees;
          if (input.location) updates.location = input.location;
          if (input.body) updates.body = input.body;
          await provider.calendar.updateEvent(provider.accessToken, input.meetingId, updates);
          return { success: true, meetingId: input.meetingId };
        } catch (error: any) {
          return { success: false, error: this.formatApiError(error, provider) };
        }
      }

      case 'delete_meeting': {
        const provider = this.getProvider(context, input.provider);
        if (!provider?.calendar || !provider.accessToken) {
          return { success: false, error: this.getProviderError(context, input.provider) };
        }
        try {
          await provider.calendar.deleteEvent(provider.accessToken, input.meetingId);
          return { success: true, meetingId: input.meetingId };
        } catch (error: any) {
          return { success: false, error: this.formatApiError(error, provider) };
        }
      }

      case 'check_availability': {
        const provider = this.getProvider(context, input.provider);
        if (!provider?.calendar || !provider.accessToken) {
          return { available: false, error: this.getProviderError(context, input.provider) };
        }
        try {
          const result = await provider.calendar.checkAvailability(
            provider.accessToken,
            new Date(input.startTime),
            new Date(input.endTime),
            input.attendees
          );
          return result;
        } catch (error: any) {
          return { available: false, error: this.formatApiError(error, provider) };
        }
      }

      case 'find_free_time': {
        const provider = this.getProvider(context, input.provider);
        if (!provider?.calendar || !provider.accessToken) {
          return { freeSlots: [], error: this.getProviderError(context, input.provider) };
        }
        try {
          const events = await provider.calendar.getEvents(
            provider.accessToken,
            new Date(input.startDate),
            new Date(input.endDate)
          );
          const slots = provider.calendar.findFreeTime(provider.accessToken, events, {
            duration: input.duration,
            startDate: input.startDate,
            endDate: input.endDate,
            workingHours: input.workingHoursStart ? {
              start: input.workingHoursStart,
              end: input.workingHoursEnd || '17:00',
            } : undefined,
          });
          return { freeSlots: slots };
        } catch (error: any) {
          return { freeSlots: [], error: this.formatApiError(error, provider) };
        }
      }

      case 'draft_followup_email': {
        const provider = this.getProvider(context, input.provider);
        if (!provider?.email || !provider.accessToken) {
          return { success: false, error: this.getProviderError(context, input.provider) };
        }
        try {
          const draft = await provider.email.createDraft(provider.accessToken, {
            subject: input.subject,
            body: input.body,
            toRecipients: input.toRecipients,
          });
          return { success: true, draftId: draft.id, webLink: draft.webLink };
        } catch (error: any) {
          return { success: false, error: this.formatApiError(error, provider) };
        }
      }

      case 'list_providers': {
        const connected: Array<{ provider: string; hasCalendar: boolean; hasEmail: boolean }> = [];
        for (const [provType, prov] of context.providers) {
          if (prov.accessToken) {
            connected.push({
              provider: provType,
              hasCalendar: !!prov.calendar,
              hasEmail: !!prov.email,
            });
          }
        }
        if (connected.length === 0) {
          return { providers: [], message: 'No providers connected. Use /caleo-auth to connect Microsoft or Google.' };
        }
        return { providers: connected };
      }

      default:
        return { error: `Unknown tool: ${name}` };
    }
  }

  private formatEvent(event: any, timezone: string): any {
    const startTime = event.start?.dateTime
      ? new Date(event.start.dateTime).toLocaleString('en-US', {
          timeZone: timezone, weekday: 'short', month: 'short', day: 'numeric',
          hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
        })
      : 'Unknown';

    const endTime = event.end?.dateTime
      ? new Date(event.end.dateTime).toLocaleString('en-US', {
          timeZone: timezone, hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
        })
      : 'Unknown';

    return {
      id: event.id,
      subject: event.subject,
      start: startTime,
      end: endTime,
      attendees: event.attendees?.map((a: any) => ({
        name: a.emailAddress?.name || a.emailAddress?.address,
        email: a.emailAddress?.address,
      })),
      location: event.location?.displayName || null,
      body: event.body?.content ? DataSanitizer.stripHtml(event.body.content) : undefined,
    };
  }
}
