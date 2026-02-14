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

    const agentResponse = await agent.processMessage(
      userMessage,
      { userContext, providers },
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
