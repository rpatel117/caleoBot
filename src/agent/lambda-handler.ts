import { AnthropicAgent } from './anthropic-agent';
import { CalendarProviderType } from '../types';
import { MicrosoftCalendarProvider } from '../calendar/microsoft/provider';
import { GoogleCalendarProvider } from '../calendar/google/provider';
import { MicrosoftEmailProvider } from '../email/microsoft';
import { GoogleEmailProvider } from '../email/google';

interface LambdaEvent {
  body?: string;
  headers?: Record<string, string>;
}

interface LambdaResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

const agent = new AnthropicAgent();

export async function handler(event: LambdaEvent): Promise<LambdaResponse> {
  const corsHeaders = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  };

  try {
    if (!event.body) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, error: 'Missing request body' }),
      };
    }

    const {
      userMessage,
      userContext,
      providerTokens,
      conversationHistory,
      systemPrompt,
      dbUserId,
      slackBotToken,
      slackChannelId,
      slackThreadTs,
    } = JSON.parse(event.body);

    if (!userMessage || !userContext) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, error: 'Missing userMessage or userContext' }),
      };
    }

    // Build providers map from tokens
    const providers = new Map<CalendarProviderType, any>();

    if (providerTokens?.microsoft) {
      providers.set('microsoft', {
        calendar: new MicrosoftCalendarProvider(),
        email: new MicrosoftEmailProvider(),
        accessToken: providerTokens.microsoft,
        providerType: 'microsoft' as CalendarProviderType,
      });
    }

    if (providerTokens?.google) {
      providers.set('google', {
        calendar: new GoogleCalendarProvider(),
        email: new GoogleEmailProvider(),
        accessToken: providerTokens.google,
        providerType: 'google' as CalendarProviderType,
      });
    }

    // Build lightweight Slack client using fetch (no @slack/web-api needed)
    const slackClient = slackBotToken ? createSlackClient(slackBotToken) : undefined;

    const agentResponse = await agent.processMessage(
      userMessage,
      {
        userContext,
        providers,
        dbUserId,
        slackClient,
        slackChannelId,
        slackThreadTs,
      },
      conversationHistory || [],
      systemPrompt
    );

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        response: agentResponse.text,
        totalUsage: agentResponse.totalUsage,
        toolIterations: agentResponse.toolIterations,
      }),
    };
  } catch (error) {
    console.error('Lambda handler error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
      }),
    };
  }
}

/**
 * Lightweight Slack API client using fetch — avoids needing @slack/web-api in Lambda.
 * Implements the minimal interface used by resolve_slack_user and searchPeopleSlack.
 */
function createSlackClient(botToken: string) {
  const slackApi = async (method: string, params: Record<string, string> = {}) => {
    const url = new URL(`https://slack.com/api/${method}`);
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
    const res = await fetch(url.toString(), {
      headers: { 'Authorization': `Bearer ${botToken}` },
    });
    return res.json() as Promise<any>;
  };

  return {
    users: {
      list: (params: any = {}) => slackApi('users.list', {
        ...(params.limit ? { limit: String(params.limit) } : {}),
        ...(params.cursor ? { cursor: params.cursor } : {}),
      }),
      info: (params: any = {}) => slackApi('users.info', {
        user: params.user,
      }),
    },
  };
}
