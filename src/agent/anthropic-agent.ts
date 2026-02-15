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

export interface AgentContext {
  userContext: UserContext;
  providers: Map<CalendarProviderType, ProviderSet>;
  dbUserId?: string;
  slackClient?: any;
  slackChannelId?: string;
  slackThreadTs?: string;
}

export interface AgentResponse {
  text: string;
  totalUsage: { inputTokens: number; outputTokens: number };
  toolIterations: number;
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
    description: 'Search the organization directory for people by name. Use this when the user refers to someone by plain name (e.g. "Kunal", "Sarah from marketing") instead of an @mention. Results are ranked by relevance (most contacted first). Returns name and email for each match. IMPORTANT: Only display the exact results returned by this tool. Never fabricate or guess names/emails if the tool returns an error or empty results.',
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

    return { text, totalUsage, toolIterations };
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
      return { text, totalUsage, toolIterations };
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
          const event = await provider.calendar.createEvent(provider.accessToken, {
            subject: input.subject,
            start: new Date(input.startTime),
            end: new Date(input.endTime),
            attendees: input.attendees || [],
            location: input.location,
            body: eventBody,
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
        const provider = this.getProvider(context, input.provider);
        if (!provider?.accessToken) {
          return { results: [], error: this.getProviderError(context, input.provider) };
        }
        try {
          if (provider.providerType === 'microsoft') {
            return await this.searchPeopleMicrosoft(provider.accessToken, input.query);
          } else if (provider.providerType === 'google') {
            return await this.searchPeopleGoogle(provider.accessToken, input.query);
          }
          return { results: [], error: `People search is not supported for provider: ${provider.providerType}` };
        } catch (error: any) {
          const status = error?.status || error?.response?.status;
          if (status === 401 || status === 403) {
            return { results: [], error: 'People search requires updated permissions. Please run /caleo-auth to reconnect with the new scopes.' };
          }
          return { results: [], error: this.formatApiError(error, provider) };
        }
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
    const params = new URLSearchParams({
      query,
      readMask: 'names,emailAddresses',
      sources: 'DIRECTORY_SOURCE_TYPE_DOMAIN_PROFILE',
      pageSize: '5',
    });
    const url = `https://people.googleapis.com/v1/people:searchDirectoryPeople?${params.toString()}`;
    const response = await fetch(url, {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      const errorText = await response.text();
      const error: any = new Error(`Google People search failed: ${response.status} - ${errorText}`);
      error.status = response.status;
      throw error;
    }

    const data = await response.json() as any;
    const results = (data.people || [])
      .map((person: any) => {
        const name = person.names?.[0]?.displayName || 'Unknown';
        const email = person.emailAddresses?.[0]?.value || null;
        return { name, email };
      })
      .filter((p: any) => p.email);

    return { results };
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
