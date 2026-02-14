import { AnthropicAgent } from './anthropic-agent';
import { UserContext, CalendarProviderType } from '../types';
import { CalendarProvider } from '../calendar/types';
import { EmailProvider } from '../email/types';

export interface IAgentClient {
  processMessage(
    userMessage: string,
    userContext: UserContext,
    providers: Map<CalendarProviderType, {
      calendar?: CalendarProvider;
      email?: EmailProvider;
      accessToken?: string;
      providerType: CalendarProviderType;
    }>,
    conversationHistory?: Array<{ role: string; content: string }>,
    dbUserId?: string
  ): Promise<string>;
}

export class LocalAgentClient implements IAgentClient {
  private agent: AnthropicAgent;

  constructor() {
    this.agent = new AnthropicAgent();
  }

  async processMessage(
    userMessage: string,
    userContext: UserContext,
    providers: Map<CalendarProviderType, {
      calendar?: CalendarProvider;
      email?: EmailProvider;
      accessToken?: string;
      providerType: CalendarProviderType;
    }>,
    conversationHistory: Array<{ role: string; content: string }> = [],
    dbUserId?: string
  ): Promise<string> {
    console.log('Using LOCAL agent service (Anthropic)');
    return this.agent.processMessage(userMessage, {
      userContext,
      providers,
      dbUserId,
    }, conversationHistory);
  }
}

export class RemoteAgentClient implements IAgentClient {
  private endpoint: string;

  constructor(endpoint: string) {
    this.endpoint = endpoint;
  }

  async processMessage(
    userMessage: string,
    userContext: UserContext,
    providers: Map<CalendarProviderType, {
      calendar?: CalendarProvider;
      email?: EmailProvider;
      accessToken?: string;
      providerType: CalendarProviderType;
    }>,
    conversationHistory: Array<{ role: string; content: string }> = [],
    dbUserId?: string
  ): Promise<string> {
    console.log('Using REMOTE agent service (AWS Lambda)');

    // Collect access tokens from providers
    const providerTokens: Record<string, string> = {};
    for (const [provType, prov] of providers) {
      if (prov.accessToken) {
        providerTokens[provType] = prov.accessToken;
      }
    }

    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.AGENT_API_KEY || ''}`,
        },
        body: JSON.stringify({
          userMessage,
          userContext,
          providerTokens,
          conversationHistory,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Agent endpoint error: ${response.status} - ${errorText}`);
      }

      const result = await response.json() as any;
      if (!result.success) {
        throw new Error(result.error || 'Remote agent returned error');
      }

      return result.response || 'I was unable to generate a response.';
    } catch (error) {
      console.error('Remote agent client error:', error);
      return `I'm experiencing technical difficulties with the remote AI service. Please try again. Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }
}

export function getAgentClient(): IAgentClient {
  const useRemote = process.env.USE_REMOTE_AGENT === 'true';
  const endpoint = process.env.AGENT_ENDPOINT;

  if (useRemote && endpoint) {
    console.log('Using REMOTE agent (AWS Lambda)');
    return new RemoteAgentClient(endpoint);
  }

  console.log('Using LOCAL agent (Anthropic)');
  return new LocalAgentClient();
}
