import { OAuthProvider } from '../types';
import { TokenSet } from '../../types';
import { EncryptionService } from '../../encryption';
import { repository } from '../../database/repository';

export class MicrosoftOAuth implements OAuthProvider {
  private clientId: string;
  private clientSecret: string;
  private encryption: EncryptionService;

  constructor() {
    this.clientId = process.env.MICROSOFT_APP_ID || '';
    this.clientSecret = process.env.MICROSOFT_APP_PASSWORD || '';
    this.encryption = new EncryptionService();

    if (!this.clientId || !this.clientSecret) {
      console.warn('Microsoft App ID or Password not configured');
    }
  }

  generateAuthUrl(userId: string, workspaceId: string, redirectUri: string): string {
    const state = Buffer.from(JSON.stringify({
      userId,
      workspaceId,
      provider: 'microsoft',
    })).toString('base64');

    const scopes = [
      'https://graph.microsoft.com/Calendars.ReadWrite',
      'https://graph.microsoft.com/User.Read',
      'https://graph.microsoft.com/Mail.ReadWrite',
      'https://graph.microsoft.com/People.Read',
      'offline_access',
    ].join(' ');

    const params = new URLSearchParams({
      client_id: this.clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      state,
      response_mode: 'query',
      prompt: 'consent',
      scope: scopes,
    });

    return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`;
  }

  async exchangeCode(code: string, redirectUri: string): Promise<TokenSet> {
    const response = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        scope: 'https://graph.microsoft.com/Calendars.ReadWrite https://graph.microsoft.com/User.Read https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/People.Read offline_access',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Microsoft token exchange failed: ${response.status} - ${errorText}`);
    }

    const data = await response.json() as any;
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: new Date(Date.now() + data.expires_in * 1000),
      scopes: (data.scope || '').split(' '),
    };
  }

  async refreshToken(refreshTokenValue: string): Promise<TokenSet> {
    const response = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: refreshTokenValue,
        grant_type: 'refresh_token',
        scope: 'https://graph.microsoft.com/Calendars.ReadWrite https://graph.microsoft.com/User.Read https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/People.Read offline_access',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Microsoft token refresh failed: ${response.status} - ${errorText}`);
    }

    const data = await response.json() as any;
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: new Date(Date.now() + data.expires_in * 1000),
      scopes: (data.scope || '').split(' '),
    };
  }

  async validateToken(accessToken: string): Promise<boolean> {
    try {
      const response = await fetch('https://graph.microsoft.com/v1.0/me', {
        headers: { 'Authorization': `Bearer ${accessToken}` },
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async getValidAccessToken(dbUserId: string): Promise<string | null> {
    const token = await repository.getToken(dbUserId, 'microsoft');
    if (!token) return null;

    if (!token.access_token) {
      if (!token.refresh_token) return null;
      const decryptedRefresh = this.encryption.decrypt(token.refresh_token);
      return this.refreshAndStore(decryptedRefresh, dbUserId);
    }

    // Check expires_at before making an HTTP validation call
    if (token.expires_at) {
      const expiresAt = new Date(token.expires_at);
      const bufferMs = 5 * 60 * 1000; // 5-minute buffer
      if (expiresAt.getTime() - Date.now() > bufferMs) {
        // Token hasn't expired yet — use it directly
        return this.encryption.decrypt(token.access_token);
      }
    }

    // Token expired or no expires_at — try validation, then refresh
    const decryptedAccess = this.encryption.decrypt(token.access_token);
    const isValid = await this.validateToken(decryptedAccess);
    if (isValid) return decryptedAccess;

    if (!token.refresh_token) return null;
    const decryptedRefresh = this.encryption.decrypt(token.refresh_token);
    return this.refreshAndStore(decryptedRefresh, dbUserId);
  }

  private async refreshAndStore(decryptedRefreshToken: string, dbUserId: string): Promise<string | null> {
    try {
      const newTokens = await this.refreshToken(decryptedRefreshToken);
      const encryptedAccess = this.encryption.encrypt(newTokens.accessToken);
      const encryptedRefresh = newTokens.refreshToken
        ? this.encryption.encrypt(newTokens.refreshToken)
        : undefined;

      await repository.updateToken(dbUserId, 'microsoft', {
        accessToken: encryptedAccess,
        refreshToken: encryptedRefresh,
        expiresAt: newTokens.expiresAt,
        scopes: newTokens.scopes,
      });

      return newTokens.accessToken;
    } catch (error) {
      console.error('Failed to refresh Microsoft token, removing stale token:', error);
      await repository.deleteToken(dbUserId, 'microsoft');
      return null;
    }
  }
}
