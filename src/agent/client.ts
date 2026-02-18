import { AnthropicAgent, AgentResponse } from './anthropic-agent';
import { UserContext, CalendarProviderType } from '../types';
import { CalendarProvider } from '../calendar/types';
import { EmailProvider } from '../email/types';
import { CrossOrgService } from '../calendar/cross-org';

export interface SlackContext {
  client: any;
  channelId: string;
  threadTs?: string;
}

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
    dbUserId?: string,
    systemPrompt?: string,
    slackContext?: SlackContext,
    userType?: string,
    crossOrgService?: CrossOrgService
  ): Promise<AgentResponse>;
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
    dbUserId?: string,
    systemPrompt?: string,
    slackContext?: SlackContext,
    userType?: string,
    crossOrgService?: CrossOrgService
  ): Promise<AgentResponse> {
    console.log('Using LOCAL agent service (Anthropic)');
    return this.agent.processMessage(userMessage, {
      userContext,
      providers,
      dbUserId,
      slackClient: slackContext?.client,
      slackChannelId: slackContext?.channelId,
      slackThreadTs: slackContext?.threadTs,
      userType,
      workspaceId: userContext.workspaceId,
      actionsPerformed: { meetingsCreated: 0, meetingsUpdated: 0, meetingsDeleted: 0 },
      crossOrgService,
    }, conversationHistory, systemPrompt);
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
    _dbUserId?: string,
    systemPrompt?: string,
    _slackContext?: SlackContext,
    _userType?: string,
    _crossOrgService?: CrossOrgService
  ): Promise<AgentResponse> {
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
          systemPrompt,
          dbUserId: _dbUserId,
          slackBotToken: process.env.SLACK_BOT_TOKEN,
          slackChannelId: _slackContext?.channelId,
          slackThreadTs: _slackContext?.threadTs,
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

      return {
        text: result.response || 'I was unable to generate a response.',
        totalUsage: result.totalUsage || { inputTokens: 0, outputTokens: 0 },
        toolIterations: result.toolIterations || 0,
        actionsPerformed: result.actionsPerformed || { meetingsCreated: 0, meetingsUpdated: 0, meetingsDeleted: 0 },
      };
    } catch (error) {
      console.error('Remote agent client error:', error);
      return {
        text: `I'm experiencing technical difficulties with the remote AI service. Please try again. Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        totalUsage: { inputTokens: 0, outputTokens: 0 },
        toolIterations: 0,
        actionsPerformed: { meetingsCreated: 0, meetingsUpdated: 0, meetingsDeleted: 0 },
      };
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
