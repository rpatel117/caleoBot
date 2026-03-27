import Anthropic from '@anthropic-ai/sdk';
import { AGENT_CONFIG, AGENT_INSTRUCTIONS } from './config';
import { UserContext, CalendarProviderType } from '../types';
import { CalendarProvider } from '../calendar/types';
import { EmailProvider } from '../email/types';
import { DataSanitizer } from '../data-sanitizer';
import { repository } from '../database/repository';
import { PLAN_LIMITS } from '../billing/plans';
import { CrossOrgService } from '../calendar/cross-org';

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
  crossOrgService?: CrossOrgService;
}

export interface AgentResponse {
  text: string;
  totalUsage: { inputTokens: number; outputTokens: number };
  sonnetUsage?: { inputTokens: number; outputTokens: number };
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
        provider: { type: 'string', description: 'Calendar provider', enum: ['microsoft', 'google'] },
        recurrence: { type: 'string', description: 'Recurrence rule in RRULE format (e.g., "RRULE:FREQ=WEEKLY;COUNT=10", "RRULE:FREQ=DAILY", "RRULE:FREQ=MONTHLY;INTERVAL=1"). Omit for one-time meetings.' }
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
    name: 'rsvp_meeting',
    description: 'Accept, decline, or tentatively accept a calendar meeting invitation.',
    input_schema: {
      type: 'object' as const,
      properties: {
        meetingId: { type: 'string', description: 'Meeting ID to RSVP' },
        response: { type: 'string', description: 'Your response', enum: ['accepted', 'declined', 'tentative'] },
        provider: { type: 'string', description: 'Calendar provider', enum: ['microsoft', 'google'] }
      },
      required: ['meetingId', 'response']
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
    description: 'Search for people by name across the Slack workspace directory, the organization\'s calendar provider directory (Google/Microsoft), saved contacts, email history (people the user has communicated with), and recent calendar event attendees (last 90 days). Also matches meeting titles — if the query appears in a meeting subject (for small meetings ≤5 attendees), attendees from that meeting are included. All sources are always checked and results are merged. Use this when the user refers to someone by plain name (e.g. "Kunal", "Sarah from marketing", "my client John") instead of an @mention. Results are deduplicated and ranked by relevance. Returns name, email, and searchSummary for each query. IMPORTANT: Only display the exact results returned by this tool. Never fabricate or guess names/emails if the tool returns an error or empty results.',
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
  },
  {
    name: 'create_focus_time',
    description: 'Create a focus time block on the calendar. Finds the best available slot and creates a calendar event tagged [Caleo Focus].',
    input_schema: {
      type: 'object' as const,
      properties: {
        duration: { type: 'number', description: 'Duration in minutes (e.g. 60, 90, 120)' },
        preferredDate: { type: 'string', description: 'Preferred date in ISO format (optional, defaults to today or next workday)' },
        title: { type: 'string', description: 'Custom title (optional, defaults to "Focus Time")' },
        provider: { type: 'string', description: 'Calendar provider', enum: ['microsoft', 'google'] }
      },
      required: ['duration']
    }
  },
  {
    name: 'get_focus_time_stats',
    description: 'Get this week\'s focus time statistics: hours blocked, hours preserved, and progress toward weekly goal.',
    input_schema: {
      type: 'object' as const,
      properties: {
        provider: { type: 'string', description: 'Calendar provider', enum: ['microsoft', 'google'] }
      },
      required: []
    }
  },
  {
    name: 'undo_last_change',
    description: 'Undo the last calendar change (create, update, or delete). Only available within 10 minutes of the change.',
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

    // Initial call uses Sonnet for better tool routing decisions
    console.log(`[Agent] Initial call: model=${AGENT_CONFIG.sonnetModel}`);
    let response = await this.client.messages.create({
      model: AGENT_CONFIG.sonnetModel,
      max_tokens: AGENT_CONFIG.maxTokens,
      temperature: AGENT_CONFIG.toolTemperature,
      system,
      tools: toolDefinitions,
      messages,
    });

    // Track Sonnet usage separately for blended cost calculation
    const sonnetUsage = {
      inputTokens: response.usage?.input_tokens || 0,
      outputTokens: response.usage?.output_tokens || 0,
    };

    // Accumulate total usage
    totalUsage.inputTokens += sonnetUsage.inputTokens;
    totalUsage.outputTokens += sonnetUsage.outputTokens;
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

      // Subsequent iterations use Haiku for cost efficiency
      console.log(`[Agent] Tool iteration ${toolIterations}: model=${AGENT_CONFIG.model}`);
      response = await this.client.messages.create({
        model: AGENT_CONFIG.model,
        max_tokens: AGENT_CONFIG.maxTokens,
        temperature: AGENT_CONFIG.toolTemperature,
        system,
        tools: toolDefinitions,
        messages,
      });

      // Accumulate usage (Haiku costs)
      totalUsage.inputTokens += response.usage?.input_tokens || 0;
      totalUsage.outputTokens += response.usage?.output_tokens || 0;
    }

    // Extract text from final response
    const textBlocks = response.content.filter(
      (b): b is Anthropic.TextBlock => b.type === 'text'
    );
    const text = textBlocks.map((b) => b.text).join('\n') || 'I was unable to generate a response.';

    return { text, totalUsage, sonnetUsage, toolIterations, actionsPerformed: context.actionsPerformed };
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
            console.error('Meeting limit check failed, blocking:', err?.message);
            return { success: false, error: 'Unable to verify meeting limits. Please try again.' };
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
          const attendees: string[] = input.attendees || [];
          console.log(`[Agent] create_meeting: subject="${input.subject}", attendees=${JSON.stringify(attendees)}, provider=${provider.providerType}`);

          // Cross-org path: create native events on each Caleo attendee's calendar
          if (context.crossOrgService && attendees.length > 0) {
            try {
              const crossResult = await context.crossOrgService.createCrossOrgEvent(
                provider.accessToken,
                provider.providerType,
                context.userContext.email,
                {
                  subject: input.subject,
                  start: startLocal,
                  end: endLocal,
                  location: input.location,
                  body: eventBody,
                  isOnlineMeeting: input.isOnlineMeeting ?? true,
                  timezone: tz,
                  allAttendeeEmails: attendees,
                }
              );
              context.actionsPerformed.meetingsCreated++;

              const nativeCreated = crossResult.attendeeResults.filter(r => r.success);
              const warnings = crossResult.attendeeResults.filter(r => !r.success).map(r => `${r.email}: ${r.error}`);

              const result: any = {
                success: true,
                meetingId: crossResult.organizerEvent.id,
                webLink: crossResult.organizerEvent.webLink,
                onlineMeetingUrl: crossResult.onlineMeetingUrl,
                attendeesInvited: attendees.length,
                attendeeEmails: attendees,
                standardInvites: crossResult.standardInviteEmails,
                nativeEventsCreated: nativeCreated.map(r => r.email),
              };
              if (warnings.length > 0) result.warnings = warnings;
              return result;
            } catch (crossErr: any) {
              console.error('[Agent] Cross-org create failed, falling back to standard:', crossErr?.message);
              // Fall through to standard single-provider creation
            }
          }

          const event = await provider.calendar.createEvent(provider.accessToken, {
            subject: input.subject,
            start: startLocal,
            end: endLocal,
            attendees,
            location: input.location,
            body: eventBody,
            isOnlineMeeting: input.isOnlineMeeting ?? true,
            timezone: tz,
            recurrence: input.recurrence,
          });
          context.actionsPerformed.meetingsCreated++;

          // Store undo state in DB
          if (context.dbUserId) {
            repository.saveUndoState(context.dbUserId, context.slackChannelId || 'default', {
              action: 'create', eventId: event.id, provider: provider.providerType,
              createdEvent: { subject: input.subject, start: startLocal, end: endLocal, attendees },
            }).catch(err => console.error('[Undo] save error:', err?.message));
          }

          // Audit log
          if (context.dbUserId) {
            repository.logAction({
              userId: context.dbUserId, action: 'create_meeting', eventId: event.id,
              provider: provider.providerType,
              details: { subject: input.subject, start: startLocal, end: endLocal, attendees, recurrence: input.recurrence },
              slackChannel: context.slackChannelId, slackThreadTs: context.slackThreadTs,
            }).catch(err => console.error('[AuditLog] create_meeting error:', err?.message));
          }

          return {
            success: true,
            meetingId: event.id,
            webLink: event.webLink,
            onlineMeetingUrl: event.onlineMeetingUrl,
            attendeesInvited: attendees.length,
            attendeeEmails: attendees,
            isRecurring: !!input.recurrence,
            undoAvailable: true,
          };
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
          // Fetch current state for undo before updating
          let previousState: any = null;
          try {
            const currentEvents = await provider.calendar.getEvents(provider.accessToken, new Date(Date.now() - 365 * 24 * 60 * 60_000), new Date(Date.now() + 365 * 24 * 60 * 60_000));
            const current = currentEvents.find(e => e.id === input.meetingId);
            if (current) previousState = { subject: current.subject, start: current.start.dateTime, end: current.end.dateTime };
          } catch {}

          await provider.calendar.updateEvent(provider.accessToken, input.meetingId, updates);
          context.actionsPerformed.meetingsUpdated++;

          // Store undo state in DB
          if (context.dbUserId) {
            repository.saveUndoState(context.dbUserId, context.slackChannelId || 'default', {
              action: 'update', eventId: input.meetingId, provider: provider.providerType,
              previousState,
            }).catch(err => console.error('[Undo] save error:', err?.message));
          }

          // Audit log
          if (context.dbUserId) {
            repository.logAction({
              userId: context.dbUserId, action: 'update_meeting', eventId: input.meetingId,
              provider: provider.providerType,
              details: { changes: updates },
              slackChannel: context.slackChannelId, slackThreadTs: context.slackThreadTs,
            }).catch(err => console.error('[AuditLog] update_meeting error:', err?.message));
          }

          return { success: true, meetingId: input.meetingId, attendeesUpdated: input.attendees?.length || 0, undoAvailable: true };
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
          // Capture event details before deleting for undo
          let deletedEventDetails: any = null;
          try {
            const allEvents = await provider.calendar.getEvents(provider.accessToken, new Date(Date.now() - 30 * 24 * 60 * 60_000), new Date(Date.now() + 365 * 24 * 60 * 60_000));
            const target = allEvents.find(e => e.id === input.meetingId);
            if (target) {
              deletedEventDetails = {
                subject: target.subject, start: target.start.dateTime, end: target.end.dateTime,
                timezone: target.start.timeZone,
                attendees: target.attendees?.map(a => a.emailAddress.address),
              };
            }
          } catch {}

          await provider.calendar.deleteEvent(provider.accessToken, input.meetingId);
          context.actionsPerformed.meetingsDeleted++;

          // Store undo state in DB
          if (context.dbUserId) {
            repository.saveUndoState(context.dbUserId, context.slackChannelId || 'default', {
              action: 'delete', eventId: input.meetingId, provider: provider.providerType,
              previousState: deletedEventDetails,
            }).catch(err => console.error('[Undo] save error:', err?.message));
          }

          // Audit log
          if (context.dbUserId) {
            repository.logAction({
              userId: context.dbUserId, action: 'delete_meeting', eventId: input.meetingId,
              provider: provider.providerType,
              details: deletedEventDetails,
              slackChannel: context.slackChannelId, slackThreadTs: context.slackThreadTs,
            }).catch(err => console.error('[AuditLog] delete_meeting error:', err?.message));
          }

          return { success: true, meetingId: input.meetingId, undoAvailable: true };
        } catch (error: any) {
          return { success: false, error: this.formatApiError(error, provider) };
        }
      }

      case 'rsvp_meeting': {
        const provider = this.getProvider(context, input.provider);
        if (!provider?.calendar || !provider.accessToken) {
          return { success: false, error: this.getProviderError(context, input.provider) };
        }
        try {
          await provider.calendar.rsvpEvent(provider.accessToken, input.meetingId, input.response);

          // Audit log
          if (context.dbUserId) {
            repository.logAction({
              userId: context.dbUserId, action: 'rsvp_meeting', eventId: input.meetingId,
              provider: provider.providerType,
              details: { response: input.response },
              slackChannel: context.slackChannelId, slackThreadTs: context.slackThreadTs,
            }).catch(err => console.error('[AuditLog] rsvp_meeting error:', err?.message));
          }

          return { success: true, meetingId: input.meetingId, response: input.response };
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
          // Cross-org federated availability: check Caleo users via their own tokens
          if (context.crossOrgService && input.attendees && input.attendees.length > 0) {
            try {
              const fedResult = await context.crossOrgService.checkFederatedAvailability(
                provider.accessToken,
                provider.providerType,
                input.attendees,
                context.userContext.email,
                new Date(input.startTime),
                new Date(input.endTime)
              );
              return fedResult;
            } catch (fedErr: any) {
              console.error('[Agent] Federated availability failed, falling back to standard:', fedErr?.message);
              // Fall through to standard check
            }
          }

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

          // Add impact scores
          const prefs = context.dbUserId ? await repository.getPreferences(context.dbUserId) : null;
          const settings = context.dbUserId ? await repository.getUserSettings(context.dbUserId) : null;
          const scoredSlots = slots.map(slot => this.scoreSlot(slot, events, prefs, settings, tz));

          return { freeSlots: scoredSlots };
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

          // Get availability — use federated check if cross-org service available
          let availability;
          if (context.crossOrgService && emails.length > 0) {
            try {
              availability = await context.crossOrgService.checkFederatedAvailability(
                provider.accessToken, provider.providerType, emails,
                context.userContext.email, startDate, endDate
              );
            } catch (fedErr: any) {
              console.error('[Agent] Federated availability failed in mutual free time, falling back:', fedErr?.message);
            }
          }
          if (!availability) {
            availability = await provider.calendar.checkAvailability(
              provider.accessToken, startDate, endDate, emails
            );
          }

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
        const searchedSources: string[] = [];
        const userEmail = (context.userContext.email || '').toLowerCase();

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
            searchedSources.push(provider.providerType === 'google' ? 'Google directory' : 'Microsoft directory');
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
            searchedSources.push('Slack workspace');
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

        // 3. Search Caleo DB (scoped to user's workspace to prevent cross-workspace data leakage)
        if (context.crossOrgService) {
          try {
            const caleoResults = await repository.searchUsersByName(input.query, 5, context.workspaceId);
            searchedSources.push('Caleo user database');
            console.log(`[search_people] Caleo DB returned ${caleoResults.length} result(s)`);
            for (const r of caleoResults) {
              if (r.email) {
                allResults.push({ name: r.display_name || r.email, email: r.email, source: 'caleo' });
              }
            }
          } catch (error: any) {
            console.error('[search_people] Caleo DB search failed:', error?.message);
          }
        }

        // 4. Search recent calendar event attendees (always — supplements other sources)
        let nameMatchCount = 0;
        let titleMatchCount = 0;
        if (provider?.calendar && provider.accessToken) {
          try {
            const now = new Date();
            const lookbackMs = AGENT_CONFIG.peopleSearchLookbackDays * 24 * 60 * 60_000;
            const lookbackDate = new Date(now.getTime() - lookbackMs);
            const recentEvents = await provider.calendar.getEvents(provider.accessToken, lookbackDate, now);
            const queryLower = input.query.toLowerCase();

            // 4a. Name/email matching on attendees (with self-exclusion)
            for (const event of recentEvents) {
              for (const attendee of (event.attendees || [])) {
                const email = (attendee.emailAddress.address || '').toLowerCase();
                if (email === userEmail) continue; // Self-exclusion
                const name = (attendee.emailAddress.name || '').toLowerCase();
                if (name.includes(queryLower) || email.includes(queryLower)) {
                  allResults.push({
                    name: attendee.emailAddress.name || attendee.emailAddress.address,
                    email: attendee.emailAddress.address,
                    source: 'calendar_history',
                  });
                  nameMatchCount++;
                }
              }
            }

            // 4b. Title matching — if query appears in meeting subject, include attendees from small meetings
            for (const event of recentEvents) {
              const subject = (event.subject || '').toLowerCase();
              const attendees = event.attendees || [];
              if (!subject.includes(queryLower)) continue;
              if (attendees.length > AGENT_CONFIG.titleMatchMaxAttendees) continue;
              for (const attendee of attendees) {
                const email = (attendee.emailAddress.address || '').toLowerCase();
                if (email === userEmail) continue; // Self-exclusion
                allResults.push({
                  name: attendee.emailAddress.name || attendee.emailAddress.address,
                  email: attendee.emailAddress.address,
                  source: 'calendar_history_title_match',
                });
                titleMatchCount++;
              }
            }

            searchedSources.push(`${AGENT_CONFIG.peopleSearchLookbackDays}-day calendar history (attendees and meeting titles)`);
            console.log(`[search_people] Calendar history (${AGENT_CONFIG.peopleSearchLookbackDays}d): ${nameMatchCount} name match(es), ${titleMatchCount} title match(es)`);
          } catch (error: any) {
            console.error('[search_people] Calendar history search failed:', error?.message);
          }
        }

        // 5. Deduplicate by email (prefer calendar provider over Slack over Caleo over calendar_history over title_match)
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

        // Build searchSummary
        const searchSummary = `Searched: ${searchedSources.join(', ')}. Found ${deduped.length} result(s)` +
          (nameMatchCount > 0 ? `, ${nameMatchCount} from attendee name/email match` : '') +
          (titleMatchCount > 0 ? `, ${titleMatchCount} from meeting title match` : '') +
          '.';

        // Always include permission hints so the agent can inform the user
        const result: any = { results: deduped.slice(0, 5), searchSummary };
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

      case 'create_focus_time': {
        const provider = this.getProvider(context, input.provider);
        if (!provider?.calendar || !provider.accessToken) {
          return { success: false, error: this.getProviderError(context, input.provider) };
        }
        try {
          const duration = input.duration || 60;
          const title = input.title || 'Focus Time';
          const prefs = context.dbUserId ? await repository.getPreferences(context.dbUserId) : null;
          const workStart = prefs?.work_hours_start || '09:00';
          const workEnd = prefs?.work_hours_end || '17:00';

          // Determine search date range
          let searchStart: Date;
          let searchEnd: Date;
          if (input.preferredDate) {
            searchStart = new Date(input.preferredDate);
            searchEnd = new Date(searchStart.getTime() + 24 * 60 * 60_000);
          } else {
            const { start } = this.getTimezoneDay(tz);
            searchStart = new Date(Math.max(start.getTime(), Date.now()));
            searchEnd = new Date(start.getTime() + 5 * 24 * 60 * 60_000); // Search up to 5 days out
          }

          // Find free slots
          const events = await provider.calendar.getEvents(provider.accessToken, searchStart, searchEnd);
          const slots = provider.calendar.findFreeTime(provider.accessToken, events, {
            duration,
            startDate: searchStart.toISOString(),
            endDate: searchEnd.toISOString(),
            workingHours: { start: workStart, end: workEnd },
          });

          // Prefer longer unbroken blocks (sort by gap size descending)
          // Pick the slot that falls in the morning if possible
          let bestSlot = slots[0];
          for (const slot of slots) {
            const hour = new Date(slot.start).getHours();
            if (hour < 11) { bestSlot = slot; break; }
          }

          if (!bestSlot) {
            return { success: false, error: `No ${duration}-minute free slot found in the next 5 workdays. Try a shorter duration or check your calendar.` };
          }

          const startLocal = bestSlot.start.replace(/Z$/, '').replace(/[+-]\d{2}:?\d{2}$/, '');
          const endLocal = bestSlot.end.replace(/Z$/, '').replace(/[+-]\d{2}:?\d{2}$/, '');

          const event = await provider.calendar.createEvent(provider.accessToken, {
            subject: title,
            start: startLocal,
            end: endLocal,
            body: '[Caleo Focus] This time is blocked for focused work.',
            isOnlineMeeting: false,
            timezone: tz,
          });

          // Audit log
          if (context.dbUserId) {
            repository.logAction({
              userId: context.dbUserId, action: 'create_focus_time', eventId: event.id,
              provider: provider.providerType,
              details: { title, duration, start: startLocal, end: endLocal },
              slackChannel: context.slackChannelId, slackThreadTs: context.slackThreadTs,
            }).catch(err => console.error('[AuditLog] create_focus_time error:', err?.message));
          }

          // Store undo state in DB
          if (context.dbUserId) {
            repository.saveUndoState(context.dbUserId, context.slackChannelId || 'default', {
              action: 'create', eventId: event.id, provider: provider.providerType,
              createdEvent: { subject: title, start: startLocal, end: endLocal },
            }).catch(err => console.error('[Undo] save error:', err?.message));
          }

          // Check weekly goal progress
          let goalProgress = '';
          if (context.dbUserId) {
            const settings = await repository.getUserSettings(context.dbUserId);
            if (settings.focus_time_goal_hours > 0) {
              const stats = await this.getFocusTimeStats(provider, tz);
              goalProgress = ` You have ${stats.totalHours.toFixed(1)}/${settings.focus_time_goal_hours} focus hours this week.`;
            }
          }

          return {
            success: true,
            meetingId: event.id,
            title,
            start: new Date(bestSlot.start).toLocaleString('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }),
            end: new Date(bestSlot.end).toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }),
            duration,
            goalProgress,
            undoAvailable: true,
          };
        } catch (error: any) {
          return { success: false, error: this.formatApiError(error, provider) };
        }
      }

      case 'get_focus_time_stats': {
        const provider = this.getProvider(context, input.provider);
        if (!provider?.calendar || !provider.accessToken) {
          return { error: this.getProviderError(context, input.provider) };
        }
        try {
          const stats = await this.getFocusTimeStats(provider, tz);
          let goalHours = 0;
          if (context.dbUserId) {
            const settings = await repository.getUserSettings(context.dbUserId);
            goalHours = settings.focus_time_goal_hours || 0;
          }
          return {
            totalHoursBlocked: stats.totalHours,
            blocksCount: stats.blocksCount,
            goalHours,
            goalProgress: goalHours > 0 ? `${stats.totalHours.toFixed(1)}/${goalHours} hours` : 'No goal set',
          };
        } catch (error: any) {
          return { error: this.formatApiError(error, provider) };
        }
      }

      case 'undo_last_change': {
        if (!context.dbUserId) {
          return { success: false, error: 'No recent changes to undo, or the undo window (10 minutes) has expired.' };
        }

        const channelId = context.slackChannelId || 'default';
        const state = await repository.getUndoState(context.dbUserId, channelId);

        if (!state) {
          return { success: false, error: 'No recent changes to undo, or the undo window (10 minutes) has expired.' };
        }

        const provider = this.getProvider(context, state.provider);
        if (!provider?.calendar || !provider.accessToken) {
          return { success: false, error: 'Calendar provider no longer available.' };
        }

        try {
          let result: any;
          switch (state.action) {
            case 'create':
              // Undo create = delete the event
              await provider.calendar.deleteEvent(provider.accessToken, state.eventId);
              result = { success: true, undoneAction: 'create', message: `Deleted the event "${state.createdEvent?.subject || 'Unknown'}"` };
              break;
            case 'update':
              // Undo update = restore previous state
              if (state.previousState) {
                await provider.calendar.updateEvent(provider.accessToken, state.eventId, {
                  subject: state.previousState.subject,
                  start: state.previousState.start,
                  end: state.previousState.end,
                  timezone: tz,
                });
                result = { success: true, undoneAction: 'update', message: 'Reverted to previous version.' };
              } else {
                result = { success: false, error: 'Could not restore — previous state was not captured.' };
              }
              break;
            case 'delete':
              // Undo delete = recreate the event
              if (state.previousState) {
                const recreated = await provider.calendar.createEvent(provider.accessToken, {
                  subject: state.previousState.subject,
                  start: state.previousState.start,
                  end: state.previousState.end,
                  timezone: state.previousState.timezone || tz,
                  attendees: state.previousState.attendees,
                  isOnlineMeeting: true,
                });
                result = { success: true, undoneAction: 'delete', message: `Recreated "${state.previousState.subject}"`, meetingId: recreated.id };
              } else {
                result = { success: false, error: 'Could not recreate — event details were not captured.' };
              }
              break;
          }

          // Audit log the undo
          repository.logAction({
            userId: context.dbUserId, action: `undo_${state.action}`, eventId: state.eventId,
            provider: state.provider, details: { originalAction: state.action },
            slackChannel: context.slackChannelId, slackThreadTs: context.slackThreadTs,
          }).catch(err => console.error('[AuditLog] undo error:', err?.message));

          await repository.clearUndoState(context.dbUserId, channelId);
          return result;
        } catch (error: any) {
          return { success: false, error: `Undo failed: ${error?.message || 'Unknown error'}` };
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

  private scoreSlot(
    slot: { start: string; end: string },
    events: any[],
    prefs: any,
    settings: any,
    tz: string
  ): { start: string; end: string; score: number; reason: string } {
    let score = 10;
    const reasons: string[] = [];
    const slotStart = new Date(slot.start).getTime();
    const slotEnd = new Date(slot.end).getTime();
    const slotHour = new Date(slot.start).getHours();
    const slotDay = new Date(slot.start).getDay();

    const bufferMs = ((prefs?.buffer_minutes || 0)) * 60_000;
    const noMeetingDays: number[] = settings?.no_meeting_days || [];

    // No-meeting day violation
    if (noMeetingDays.includes(slotDay)) {
      score -= 5;
      reasons.push('Falls on a no-meeting day');
    }

    // Check for focus block fragmentation
    const focusBlocks = events.filter(e => {
      const desc = e.body?.content || e.subject || '';
      return desc.includes('[Caleo Focus]') || desc.toLowerCase().includes('focus time');
    });
    for (const fb of focusBlocks) {
      const fbStart = new Date(fb.start.dateTime).getTime();
      const fbEnd = new Date(fb.end.dateTime).getTime();
      if (fbStart < slotEnd && fbEnd > slotStart && (fbEnd - fbStart) >= 90 * 60_000) {
        score -= 2;
        reasons.push('Fragments a focus block');
        break;
      }
    }

    // Back-to-back penalty
    for (const e of events) {
      const eStart = new Date(e.start.dateTime).getTime();
      const eEnd = new Date(e.end.dateTime).getTime();
      if ((Math.abs(eEnd - slotStart) < (bufferMs || 5 * 60_000)) ||
          (Math.abs(slotEnd - eStart) < (bufferMs || 5 * 60_000))) {
        score -= 1;
        const eventName = e.subject || 'another meeting';
        reasons.push(`Back-to-back with ${eventName}`);
        break;
      }
    }

    // Morning preference for short meetings
    const durationMin = (slotEnd - slotStart) / 60_000;
    if (slotHour < 12 && durationMin <= 45) {
      score += 0.5;
    }

    // Working hours alignment
    const workStart = prefs?.work_hours_start || '09:00';
    const workEnd = prefs?.work_hours_end || '17:00';
    const [wsH] = workStart.split(':').map(Number);
    const [weH] = workEnd.split(':').map(Number);
    if (slotHour >= wsH && slotHour < weH) {
      score += 1;
    } else {
      score -= 1;
      reasons.push('Outside preferred work hours');
    }

    const reason = reasons.length > 0 ? reasons[0] : 'Good slot — no conflicts';
    return { start: slot.start, end: slot.end, score: Math.max(0, Math.round(score * 10) / 10), reason };
  }

  private async getFocusTimeStats(provider: any, tz: string): Promise<{ totalHours: number; blocksCount: number }> {
    // Get this week's events and count focus time blocks
    const { start: todayStart } = this.getTimezoneDay(tz);
    const dayOfWeek = todayStart.getDay();
    const startOfWeek = new Date(todayStart.getTime() - dayOfWeek * 24 * 60 * 60_000);
    const endOfWeek = new Date(startOfWeek.getTime() + 7 * 24 * 60 * 60_000);

    const events = await provider.calendar.getEvents(provider.accessToken, startOfWeek, endOfWeek);
    let totalMinutes = 0;
    let blocksCount = 0;

    for (const e of events) {
      const desc = e.body?.content || '';
      const subject = e.subject || '';
      if (desc.includes('[Caleo Focus]') || subject.toLowerCase().includes('focus time')) {
        const duration = (new Date(e.end.dateTime).getTime() - new Date(e.start.dateTime).getTime()) / 60_000;
        totalMinutes += duration;
        blocksCount++;
      }
    }

    return { totalHours: totalMinutes / 60, blocksCount };
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

    const result: any = {
      id: event.id,
      subject: event.subject,
      start: startTime,
      end: endTime,
      attendees: event.attendees?.map((a: any) => {
        const att: any = {
          name: a.emailAddress?.name || a.emailAddress?.address,
          email: a.emailAddress?.address,
        };
        if (a.responseStatus && a.responseStatus !== 'accepted') att.response = a.responseStatus;
        return att;
      }),
      location: event.location?.displayName || null,
      body: event.body?.content ? DataSanitizer.stripHtml(event.body.content) : undefined,
    };
    if (event.isRecurring) result.isRecurring = true;
    if (event.status && event.status !== 'confirmed') result.status = event.status;
    if (event.selfResponseStatus && event.selfResponseStatus !== 'accepted') result.yourResponse = event.selfResponseStatus;
    return result;
  }
}
