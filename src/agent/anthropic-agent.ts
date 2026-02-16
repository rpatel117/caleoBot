import Anthropic from '@anthropic-ai/sdk';
import { AGENT_CONFIG, AGENT_INSTRUCTIONS } from './config';
import { UserContext, CalendarProviderType } from '../types';
import { CalendarProvider } from '../calendar/types';
import { EmailProvider } from '../email/types';
import { DataSanitizer } from '../data-sanitizer';
import { repository } from '../database/repository';
import { PLAN_LIMITS } from '../billing/plans';

interface ProviderSet {
  calendar?: CalendarProvider;
  email?: EmailProvider;
  accessToken?: string;
  providerType: CalendarProviderType;
}

export interface AgentContext {
  userContext: UserContext;
  providers: Map<CalendarProviderType, ProviderSet>;
  dbUserId?: string;
  slackClient?: any;
  slackChannelId?: string;
  slackThreadTs?: string;
  userType?: string;
  workspaceId?: string;
  actionsPerformed: { meetingsCreated: number; meetingsUpdated: number; meetingsDeleted: number };
}

export interface AgentResponse {
  text: string;
  totalUsage: { inputTokens: number; outputTokens: number };
  toolIterations: number;
  actionsPerformed: { meetingsCreated: number; meetingsUpdated: number; meetingsDeleted: number };
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
    description: 'Check availability for a specific time range. Supports checking multiple people\'s calendars simultaneously — returns per-attendee conflict details.',
    input_schema: {
      type: 'object' as const,
      properties: {
        startTime: { type: 'string', description: 'Start time in ISO format' },
        endTime: { type: 'string', description: 'End time in ISO format' },
        attendees: { type: 'array', items: { type: 'string' }, description: 'Email addresses of attendees to check availability for (cross-calendar lookup)' },
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
    name: 'find_mutual_free_time',
    description: 'Find time slots when all specified attendees (and the requesting user) are free. Use this when scheduling a meeting with multiple people and no specific time is given.',
    input_schema: {
      type: 'object' as const,
      properties: {
        attendeeEmails: { type: 'array', items: { type: 'string' }, description: 'Email addresses of all attendees to check' },
        duration: { type: 'number', description: 'Meeting duration in minutes' },
        startDate: { type: 'string', description: 'Start of search range (ISO format)' },
        endDate: { type: 'string', description: 'End of search range (ISO format)' },
        workingHoursStart: { type: 'string', description: 'Working hours start (e.g., "09:00")' },
        workingHoursEnd: { type: 'string', description: 'Working hours end (e.g., "17:00")' },
        provider: { type: 'string', description: 'Calendar provider', enum: ['microsoft', 'google'] }
      },
      required: ['attendeeEmails', 'duration', 'startDate', 'endDate']
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
  },
  {
    name: 'resolve_slack_user',
    description: 'Resolve a Slack user mention (e.g. <@U12345>) to their name, email, timezone, and title. Use this when the user mentions someone with @ and you need their email for meeting invites.',
    input_schema: {
      type: 'object' as const,
      properties: {
        slackUserId: { type: 'string', description: 'Slack user ID (e.g. U12345ABC)' }
      },
      required: ['slackUserId']
    }
  },
  {
    name: 'search_people',
    description: 'Search for people by name across the Slack workspace directory, the organization\'s calendar provider directory (Google/Microsoft), saved contacts, and email history (people the user has communicated with). Use this when the user refers to someone by plain name (e.g. "Kunal", "Sarah from marketing", "my client John") instead of an @mention. Results are deduplicated and ranked by relevance. Returns name and email for each match. IMPORTANT: Only display the exact results returned by this tool. Never fabricate or guess names/emails if the tool returns an error or empty results.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Name or partial name to search for (e.g. "Kunal", "Sarah")' },
        provider: {
          type: 'string',
          description: 'Calendar provider to search against. If omitted, uses the first connected provider.',
          enum: ['microsoft', 'google']
        }
      },
      required: ['query']
    }
  },
  {
    name: 'get_preferences',
    description: 'Get the user\'s preferences including work hours, default meeting duration, buffer time, and preferred provider.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: []
    }
  },
  {
    name: 'update_preferences',
    description: 'Update user preferences. Pass only the fields you want to change.',
    input_schema: {
      type: 'object' as const,
      properties: {
        workHoursStart: { type: 'string', description: 'Work hours start time (e.g. "08:00")' },
        workHoursEnd: { type: 'string', description: 'Work hours end time (e.g. "17:00")' },
        defaultDurationMinutes: { type: 'number', description: 'Default meeting duration in minutes' },
        bufferMinutes: { type: 'number', description: 'Buffer time between meetings in minutes' },
        preferredProvider: { type: 'string', description: 'Preferred calendar provider', enum: ['microsoft', 'google'] }
      },
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
    conversationHistory: Array<{ role: string; content: string }>,
    systemPrompt?: string
  ): Promise<AgentResponse> {
    const totalUsage = { inputTokens: 0, outputTokens: 0 };
    let toolIterations = 0;

    // Initialize action counters if not already set
    if (!context.actionsPerformed) {
      context.actionsPerformed = { meetingsCreated: 0, meetingsUpdated: 0, meetingsDeleted: 0 };
    }

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

    const system = systemPrompt || AGENT_INSTRUCTIONS;

    // Tool use loop
    let response = await this.client.messages.create({
      model: AGENT_CONFIG.model,
      max_tokens: AGENT_CONFIG.maxTokens,
      system,
      tools: toolDefinitions,
      messages,
    });

    // Accumulate usage
    totalUsage.inputTokens += response.usage?.input_tokens || 0;
    totalUsage.outputTokens += response.usage?.output_tokens || 0;
    console.log(`[Agent] Initial response: stop_reason=${response.stop_reason}, blocks=${response.content.length}`);

    // Process tool calls in a loop until we get a final text response
    const MAX_TOOL_ITERATIONS = 10;
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
          const toolInput = block.input as Record<string, any>;
          console.log(`[Tool Call] ${block.name}`, JSON.stringify(toolInput));
          const result = await this.executeTool(block.name, toolInput, context);
          const resultStr = JSON.stringify(result);
          // Log a summary: truncate large results
          const summary = resultStr.length > 500 ? resultStr.slice(0, 500) + '...' : resultStr;
          console.log(`[Tool Result] ${block.name}: ${summary}`);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: resultStr,
          });
        }
      }

      messages.push({ role: 'user', content: toolResults });

      response = await this.client.messages.create({
        model: AGENT_CONFIG.model,
        max_tokens: AGENT_CONFIG.maxTokens,
        system,
        tools: toolDefinitions,
        messages,
      });

      // Accumulate usage
      totalUsage.inputTokens += response.usage?.input_tokens || 0;
      totalUsage.outputTokens += response.usage?.output_tokens || 0;
    }

    // Extract text from final response
    const textBlocks = response.content.filter(
      (b): b is Anthropic.TextBlock => b.type === 'text'
    );
    const text = textBlocks.map((b) => b.text).join('\n') || 'I was unable to generate a response.';

    return { text, totalUsage, toolIterations, actionsPerformed: context.actionsPerformed };
    } catch (error: any) {
      console.error('Anthropic API error:', error?.message || error);
      let text: string;
      if (error?.status === 400 && error?.message?.includes('credit balance')) {
        text = 'Caleo is temporarily unavailable: the Anthropic API account needs credits. Please check billing at console.anthropic.com.';
      } else if (error?.status === 401) {
        text = 'Caleo configuration error: invalid Anthropic API key.';
      } else if (error?.status === 429) {
        text = 'Caleo is rate-limited right now. Please try again in a moment.';
      } else {
        text = `Sorry, I encountered an error processing your request: ${error?.message || 'Unknown error'}`;
      }
      return { text, totalUsage, toolIterations, actionsPerformed: context.actionsPerformed };
    }
  }

  private getTimezoneDay(tz: string, offsetDays: number = 0): { start: Date; end: Date } {
    const now = new Date();
    let refDate = now;
    if (offsetDays !== 0) {
      refDate = new Date(now.getTime() + offsetDays * 24 * 60 * 60 * 1000);
    }
    const dateStr = refDate.toLocaleDateString('en-CA', { timeZone: tz }); // YYYY-MM-DD
    const midnightUtc = new Date(`${dateStr}T00:00:00Z`);
    const utcFmt = midnightUtc.toLocaleString('en-US', { timeZone: 'UTC' });
    const tzFmt = midnightUtc.toLocaleString('en-US', { timeZone: tz });
    const offsetMs = new Date(utcFmt).getTime() - new Date(tzFmt).getTime();
    const start = new Date(midnightUtc.getTime() + offsetMs);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
    return { start, end };
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
        const { start: startOfDay, end: endOfDay } = this.getTimezoneDay(tz);
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
        const { start: todayStart } = this.getTimezoneDay(tz);
        const dayOfWeek = todayStart.getDay();
        const startOfWeek = new Date(todayStart.getTime() - dayOfWeek * 24 * 60 * 60 * 1000);
        const endOfWeek = new Date(startOfWeek.getTime() + 7 * 24 * 60 * 60 * 1000);
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
        // Meeting limit pre-check
        if (context.userType !== 'developer' && context.workspaceId) {
          try {
            const plan = await repository.getWorkspacePlan(context.workspaceId);
            const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.free;
            if (limits.meetingsPerMonth !== -1) {
              const usage = await repository.getMonthlyUsage(context.workspaceId);
              if (usage.meetingsCreated >= limits.meetingsPerMonth) {
                return {
                  success: false,
                  error: `You've reached your free plan limit of ${limits.meetingsPerMonth} meetings this month. Upgrade to Pro to continue. Use \`/caleo-upgrade\` to learn more.`,
                };
              }
            }
          } catch (err: any) {
            console.error('Meeting limit check failed, allowing:', err?.message);
          }
        }

        const provider = this.getProvider(context, input.provider);
        if (!provider?.calendar || !provider.accessToken) {
          return { success: false, error: this.getProviderError(context, input.provider) };
        }
        try {
          let eventBody = input.body || '';
          if (context.slackChannelId && context.slackThreadTs) {
            const threadLink = `https://slack.com/archives/${context.slackChannelId}/p${context.slackThreadTs.replace('.', '')}`;
            eventBody = eventBody
              ? `${eventBody}\n\nScheduled from Slack: ${threadLink}`
              : `Scheduled from Slack: ${threadLink}`;
          }
          // Strip Z/offset — the LLM generates times in the user's local timezone
          const startLocal = input.startTime.replace(/Z$/, '').replace(/[+-]\d{2}:?\d{2}$/, '');
          const endLocal = input.endTime.replace(/Z$/, '').replace(/[+-]\d{2}:?\d{2}$/, '');
          const event = await provider.calendar.createEvent(provider.accessToken, {
            subject: input.subject,
            start: startLocal,
            end: endLocal,
            attendees: input.attendees || [],
            location: input.location,
            body: eventBody,
            isOnlineMeeting: input.isOnlineMeeting ?? true,
            timezone: tz,
          });
          context.actionsPerformed.meetingsCreated++;
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
          if (input.startTime) updates.start = input.startTime.replace(/Z$/, '').replace(/[+-]\d{2}:?\d{2}$/, '');
          if (input.endTime) updates.end = input.endTime.replace(/Z$/, '').replace(/[+-]\d{2}:?\d{2}$/, '');
          updates.timezone = tz;
          if (input.attendees) updates.attendees = input.attendees;
          if (input.location) updates.location = input.location;
          if (input.body) updates.body = input.body;
          await provider.calendar.updateEvent(provider.accessToken, input.meetingId, updates);
          context.actionsPerformed.meetingsUpdated++;
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
          context.actionsPerformed.meetingsDeleted++;
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

      case 'find_mutual_free_time': {
        const provider = this.getProvider(context, input.provider);
        if (!provider?.calendar || !provider.accessToken) {
          return { freeSlots: [], error: this.getProviderError(context, input.provider) };
        }
        try {
          const startDate = new Date(input.startDate);
          const endDate = new Date(input.endDate);
          const emails: string[] = input.attendeeEmails || [];
          const durationMs = (input.duration || 30) * 60 * 1000;
          const workStart = input.workingHoursStart || '09:00';
          const workEnd = input.workingHoursEnd || '17:00';

          // Get availability for all attendees (includes per-attendee breakdown)
          const availability = await provider.calendar.checkAvailability(
            provider.accessToken, startDate, endDate, emails
          );

          // Also get the requesting user's own events as busy periods
          const ownEvents = await provider.calendar.getEvents(provider.accessToken, startDate, endDate);
          const allBusy: Array<{ start: number; end: number }> = [];

          // Add own events
          for (const e of ownEvents) {
            allBusy.push({
              start: new Date(e.start.dateTime).getTime(),
              end: new Date(e.end.dateTime).getTime(),
            });
          }

          // Add all attendee conflicts from the availability check
          for (const conflict of availability.conflicts) {
            allBusy.push({
              start: new Date(conflict.start).getTime(),
              end: new Date(conflict.end).getTime(),
            });
          }

          // Merge overlapping busy blocks
          allBusy.sort((a, b) => a.start - b.start);
          const merged: Array<{ start: number; end: number }> = [];
          for (const b of allBusy) {
            if (merged.length > 0 && b.start <= merged[merged.length - 1].end) {
              merged[merged.length - 1].end = Math.max(merged[merged.length - 1].end, b.end);
            } else {
              merged.push({ ...b });
            }
          }

          // Scan for free slots within working hours, skip weekends
          const slots: Array<{ start: string; end: string }> = [];
          const current = new Date(startDate);
          while (current < endDate && slots.length < 5) {
            if (current.getDay() === 0 || current.getDay() === 6) {
              current.setDate(current.getDate() + 1);
              current.setHours(0, 0, 0, 0);
              continue;
            }

            const [sH, sM] = workStart.split(':').map(Number);
            const [eH, eM] = workEnd.split(':').map(Number);
            const dayStart = new Date(current);
            dayStart.setHours(sH, sM, 0, 0);
            const dayEnd = new Date(current);
            dayEnd.setHours(eH, eM, 0, 0);

            let slotStart = dayStart.getTime();
            while (slotStart + durationMs <= dayEnd.getTime() && slots.length < 5) {
              const slotEnd = slotStart + durationMs;
              const hasConflict = merged.some(b => b.start < slotEnd && b.end > slotStart);
              if (!hasConflict) {
                slots.push({
                  start: new Date(slotStart).toISOString(),
                  end: new Date(slotEnd).toISOString(),
                });
              }
              slotStart += 30 * 60 * 1000;
            }

            current.setDate(current.getDate() + 1);
            current.setHours(0, 0, 0, 0);
          }

          return {
            freeSlots: slots,
            attendees: availability.attendees || [],
          };
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

      case 'resolve_slack_user': {
        if (!context.slackClient) {
          return { error: 'Slack user resolution is not available in this mode. Ask the user for the email address directly.' };
        }
        try {
          const userInfo = await context.slackClient.users.info({ user: input.slackUserId });
          const profile = userInfo?.user?.profile || {};
          return {
            name: userInfo?.user?.real_name || userInfo?.user?.name || input.slackUserId,
            email: profile?.email || null,
            timezone: userInfo?.user?.tz || null,
            title: profile?.title || null,
          };
        } catch (error: any) {
          return { error: `Could not resolve Slack user ${input.slackUserId}: ${error?.message || 'Unknown error'}` };
        }
      }

      case 'search_people': {
        const allResults: Array<{ name: string; email: string; source: string }> = [];
        const errors: string[] = [];

        console.log(`[search_people] Query: "${input.query}", slackClient: ${!!context.slackClient}, provider: ${this.getProvider(context, input.provider)?.providerType || 'none'}`);

        // 1. Search calendar provider directory (Google/Microsoft)
        const provider = this.getProvider(context, input.provider);
        if (provider?.accessToken) {
          try {
            let providerResults: any;
            if (provider.providerType === 'microsoft') {
              providerResults = await this.searchPeopleMicrosoft(provider.accessToken, input.query);
            } else if (provider.providerType === 'google') {
              providerResults = await this.searchPeopleGoogle(provider.accessToken, input.query);
            }
            console.log(`[search_people] ${provider.providerType} returned ${providerResults?.results?.length || 0} result(s)`);
            if (providerResults?.results) {
              for (const r of providerResults.results) {
                allResults.push({ ...r, source: provider.providerType });
              }
            }
          } catch (error: any) {
            const status = error?.status || error?.response?.status;
            if (status === 401 || status === 403) {
              const provName = provider.providerType === 'google' ? 'Google' : 'Microsoft';
              console.log(`[search_people] ${provider.providerType} directory search returned ${status}, needs re-auth`);
              errors.push(`${provName} directory search needs updated permissions. The user can run /caleo-auth and click "Reconnect ${provName}" to enable organization-wide people search.`);
            } else {
              errors.push(this.formatApiError(error, provider));
            }
          }
        }

        // 2. Search Slack workspace directory
        if (context.slackClient) {
          try {
            const slackResults = await this.searchPeopleSlack(context.slackClient, input.query);
            console.log(`[search_people] Slack returned ${slackResults?.results?.length || 0} result(s)`);
            if (slackResults?.results) {
              for (const r of slackResults.results) {
                allResults.push({ ...r, source: 'slack' });
              }
            }
          } catch (error: any) {
            console.error('[search_people] Slack directory search failed:', error?.message, error?.data || '');
          }
        } else {
          console.warn('[search_people] No slackClient available — skipping Slack search');
        }

        // 3. Deduplicate by email (prefer calendar provider over Slack)
        const seen = new Set<string>();
        const deduped: Array<{ name: string; email: string; source: string }> = [];
        for (const r of allResults) {
          const key = r.email.toLowerCase();
          if (!seen.has(key)) {
            seen.add(key);
            deduped.push(r);
          }
        }

        console.log(`[search_people] Final: ${deduped.length} deduped result(s) from ${allResults.length} total`);

        // Always include permission hints so the agent can inform the user
        const result: any = { results: deduped.slice(0, 5) };
        if (errors.length > 0) {
          result.note = errors.join('; ');
        }
        return result;
      }

      case 'get_preferences': {
        if (!context.dbUserId) {
          return { error: 'User not found in database.' };
        }
        try {
          const prefs = await repository.getPreferences(context.dbUserId);
          return prefs;
        } catch (error: any) {
          return { error: `Failed to load preferences: ${error?.message || 'Unknown error'}` };
        }
      }

      case 'update_preferences': {
        if (!context.dbUserId) {
          return { error: 'User not found in database.' };
        }
        try {
          const updates: Record<string, any> = {};
          if (input.workHoursStart !== undefined) updates.work_hours_start = input.workHoursStart;
          if (input.workHoursEnd !== undefined) updates.work_hours_end = input.workHoursEnd;
          if (input.defaultDurationMinutes !== undefined) updates.default_duration_minutes = input.defaultDurationMinutes;
          if (input.bufferMinutes !== undefined) updates.buffer_minutes = input.bufferMinutes;
          if (input.preferredProvider !== undefined) updates.preferred_provider = input.preferredProvider;

          const updated = await repository.updatePreferences(context.dbUserId, updates);
          return { success: true, preferences: updated };
        } catch (error: any) {
          return { success: false, error: `Failed to update preferences: ${error?.message || 'Unknown error'}` };
        }
      }

      default:
        return { error: `Unknown tool: ${name}` };
    }
  }

  private async searchPeopleSlack(slackClient: any, query: string): Promise<any> {
    // Paginate through all workspace members
    const allMembers: any[] = [];
    let cursor: string | undefined;
    const MAX_PAGES = 10; // Safety cap
    let pages = 0;

    do {
      const result = await slackClient.users.list({
        limit: 200,
        ...(cursor ? { cursor } : {}),
      });
      const members = result?.members || [];
      allMembers.push(...members);
      cursor = result?.response_metadata?.next_cursor || undefined;
      pages++;
    } while (cursor && pages < MAX_PAGES);

    console.log(`[search_people] Slack users.list returned ${allMembers.length} members (${pages} page(s))`);

    const queryLower = query.toLowerCase();
    const matched = allMembers.filter((m: any) => {
      if (m.deleted || m.is_bot || m.id === 'USLACKBOT') return false;
      const realName = (m.real_name || '').toLowerCase();
      const displayName = (m.profile?.display_name || '').toLowerCase();
      return realName.includes(queryLower) || displayName.includes(queryLower);
    });

    console.log(`[search_people] Slack name filter for "${query}": ${matched.length} match(es)`);

    const results = matched
      .slice(0, 5)
      .map((m: any) => ({
        name: m.real_name || m.profile?.display_name || m.name,
        email: m.profile?.email || null,
      }))
      .filter((p: any) => p.email);

    if (matched.length > 0 && results.length === 0) {
      console.warn(`[search_people] Slack matched ${matched.length} user(s) by name but none had email addresses`);
    }

    return { results };
  }

  private async searchPeopleMicrosoft(accessToken: string, query: string): Promise<any> {
    const url = `https://graph.microsoft.com/v1.0/me/people?$search="${encodeURIComponent(query)}"&$top=5`;
    const response = await fetch(url, {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      const errorText = await response.text();
      const error: any = new Error(`Microsoft People search failed: ${response.status} - ${errorText}`);
      error.status = response.status;
      throw error;
    }

    const data = await response.json() as any;
    const results = (data.value || [])
      .map((person: any) => {
        const email = person.scoredEmailAddresses?.[0]?.address || null;
        return {
          name: person.displayName || 'Unknown',
          email,
        };
      })
      .filter((p: any) => p.email);

    return { results };
  }

  private async searchPeopleGoogle(accessToken: string, query: string): Promise<any> {
    const headers = { 'Authorization': `Bearer ${accessToken}` };
    const notes: string[] = [];

    const extractPeople = (data: any, listKey: string) =>
      (data[listKey] || [])
        .map((person: any) => {
          const name = person.names?.[0]?.displayName || 'Unknown';
          const email = person.emailAddresses?.[0]?.value || null;
          return { name, email };
        })
        .filter((p: any) => p.email);

    // Search 3 sources in parallel: Directory, Contacts, Other Contacts
    const [directoryResult, contactsResult, otherContactsResult] = await Promise.allSettled([
      // 1. Directory (existing) — org domain profiles
      (async () => {
        const params = new URLSearchParams({
          query,
          readMask: 'names,emailAddresses',
          sources: 'DIRECTORY_SOURCE_TYPE_DOMAIN_PROFILE',
          pageSize: '5',
        });
        const resp = await fetch(`https://people.googleapis.com/v1/people:searchDirectoryPeople?${params}`, { headers });
        if (!resp.ok) {
          const errorText = await resp.text();
          if (resp.status === 403) {
            notes.push('Directory search unavailable (missing directory.readonly scope — reconnect Google via /caleo-auth)');
            return [];
          }
          const error: any = new Error(`Google Directory search failed: ${resp.status} - ${errorText}`);
          error.status = resp.status;
          throw error;
        }
        return extractPeople(await resp.json(), 'people');
      })(),

      // 2. Contacts — saved Google Contacts
      (async () => {
        const params = new URLSearchParams({
          query,
          readMask: 'names,emailAddresses',
          pageSize: '5',
        });
        const resp = await fetch(`https://people.googleapis.com/v1/people:searchContacts?${params}`, { headers });
        if (!resp.ok) {
          if (resp.status === 403) {
            notes.push('Contacts search unavailable (missing contacts.readonly scope — reconnect Google via /caleo-auth)');
            return [];
          }
          const errorText = await resp.text();
          const error: any = new Error(`Google Contacts search failed: ${resp.status} - ${errorText}`);
          error.status = resp.status;
          throw error;
        }
        return extractPeople(await resp.json(), 'results');
      })(),

      // 3. Other Contacts — auto-saved from Gmail interactions
      (async () => {
        const params = new URLSearchParams({
          query,
          readMask: 'names,emailAddresses',
          pageSize: '5',
        });
        const resp = await fetch(`https://people.googleapis.com/v1/otherContacts:search?${params}`, { headers });
        if (!resp.ok) {
          if (resp.status === 403) {
            notes.push('Email contacts search unavailable (missing contacts.other.readonly scope — reconnect Google via /caleo-auth)');
            return [];
          }
          const errorText = await resp.text();
          const error: any = new Error(`Google Other Contacts search failed: ${resp.status} - ${errorText}`);
          error.status = resp.status;
          throw error;
        }
        return extractPeople(await resp.json(), 'results');
      })(),
    ]);

    const results = [
      ...(directoryResult.status === 'fulfilled' ? directoryResult.value : []),
      ...(contactsResult.status === 'fulfilled' ? contactsResult.value : []),
      ...(otherContactsResult.status === 'fulfilled' ? otherContactsResult.value : []),
    ];

    // Collect rejection reasons as notes
    for (const [label, r] of [['Directory', directoryResult], ['Contacts', contactsResult], ['Other Contacts', otherContactsResult]] as const) {
      if (r.status === 'rejected') {
        notes.push(`${label} search failed: ${r.reason?.message || r.reason}`);
      }
    }

    return { results, ...(notes.length > 0 && { notes }) };
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
