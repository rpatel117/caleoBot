import { GoogleOAuth } from '../calendar/google/oauth';
import { MicrosoftOAuth } from '../calendar/microsoft/oauth';
import { EncryptionService } from '../encryption';
import { repository } from '../database/repository';

const googleOAuth = new GoogleOAuth();
const microsoftOAuth = new MicrosoftOAuth();
const encryption = new EncryptionService();

const REDIRECT_URI = process.env.OAUTH_REDIRECT_URI || '';

interface LambdaEvent {
  rawPath?: string;
  queryStringParameters?: Record<string, string>;
  requestContext?: {
    http?: { method: string };
  };
}

interface LambdaResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

export async function handler(event: LambdaEvent): Promise<LambdaResponse> {
  const htmlHeaders = { 'Content-Type': 'text/html' };

  try {
    const code = event.queryStringParameters?.code;
    const state = event.queryStringParameters?.state;

    if (!code || !state) {
      return {
        statusCode: 400,
        headers: htmlHeaders,
        body: errorPage('Missing code or state parameter. Please try authenticating again from Slack.'),
      };
    }

    const stateData = JSON.parse(Buffer.from(state, 'base64').toString());
    const { userId: slackUserId, workspaceId, provider } = stateData;

    if (!slackUserId || !workspaceId || !provider) {
      return {
        statusCode: 400,
        headers: htmlHeaders,
        body: errorPage('Invalid state parameter. Please try authenticating again from Slack.'),
      };
    }

    console.log(`OAuth callback: provider=${provider}, slackUser=${slackUserId}, workspace=${workspaceId}`);

    let tokens;
    if (provider === 'google') {
      tokens = await googleOAuth.exchangeCode(code, REDIRECT_URI);
    } else if (provider === 'microsoft') {
      tokens = await microsoftOAuth.exchangeCode(code, REDIRECT_URI);
    } else {
      return {
        statusCode: 400,
        headers: htmlHeaders,
        body: errorPage(`Unknown provider: ${provider}`),
      };
    }

    const workspace = await repository.getOrCreateWorkspace('slack', workspaceId);
    const user = await repository.createUser(workspace.id, slackUserId);

    const encryptedAccess = encryption.encrypt(tokens.accessToken);
    const encryptedRefresh = tokens.refreshToken
      ? encryption.encrypt(tokens.refreshToken)
      : undefined;

    await repository.storeToken(
      user.id,
      provider,
      encryptedAccess,
      tokens.expiresAt,
      tokens.scopes,
      encryptedRefresh,
    );

    const providerName = provider === 'google' ? 'Google Calendar' : 'Microsoft Outlook';
    console.log(`OAuth success: ${providerName} connected for user ${slackUserId}`);

    return {
      statusCode: 200,
      headers: htmlHeaders,
      body: successPage(providerName),
    };
  } catch (error) {
    console.error('OAuth callback error:', error);
    return {
      statusCode: 500,
      headers: htmlHeaders,
      body: errorPage(
        error instanceof Error ? error.message : 'An unexpected error occurred. Please try again.',
      ),
    };
  }
}

function successPage(providerName: string): string {
  return `<!DOCTYPE html>
<html><head><title>Caleo - Connected</title></head>
<body style="font-family:system-ui,sans-serif;text-align:center;padding:60px 20px;background:#f8f9fa">
  <div style="max-width:400px;margin:0 auto;background:white;padding:40px;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,0.1)">
    <h2 style="color:#2d8659">Connected to ${providerName}!</h2>
    <p style="color:#555">You can close this window and return to Slack.</p>
    <p style="color:#888;font-size:14px">Try asking Caleo: "What's on my calendar today?"</p>
  </div>
</body></html>`;
}

function errorPage(message: string): string {
  return `<!DOCTYPE html>
<html><head><title>Caleo - Error</title></head>
<body style="font-family:system-ui,sans-serif;text-align:center;padding:60px 20px;background:#f8f9fa">
  <div style="max-width:400px;margin:0 auto;background:white;padding:40px;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,0.1)">
    <h2 style="color:#d14">Authentication Error</h2>
    <p style="color:#555">${message}</p>
    <p style="color:#888;font-size:14px">Please use /caleo-auth in Slack to try again.</p>
  </div>
</body></html>`;
}
