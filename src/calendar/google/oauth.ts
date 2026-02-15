import { OAuthProvider } from '../types';
import { TokenSet } from '../../types';
import { EncryptionService } from '../../encryption';
import { repository } from '../../database/repository';

export class GoogleOAuth implements OAuthProvider {
  private clientId: string;
  private clientSecret: string;
  private encryption: EncryptionService;

  constructor() {
    this.clientId = (process.env.GOOGLE_CLIENT_ID || '').trim();
    this.clientSecret = (process.env.GOOGLE_CLIENT_SECRET || '').trim();
    this.encryption = new EncryptionService();

    if (!this.clientId || !this.clientSecret) {
      console.warn('[Google OAuth] Client ID or Secret not configured');
    } else {
      console.log(`[Google OAuth] Initialized — client_id: ${this.clientId.slice(0, 8)}...${this.clientId.slice(-15)} (len=${this.clientId.length}), secret len=${this.clientSecret.length}`);
    }
  }

  generateAuthUrl(userId: string, workspaceId: string, redirectUri: string): string {
    console.log(`[Google OAuth] Generating auth URL — redirect_uri: ${redirectUri}, client_id len=${this.clientId.length}`);

    const state = Buffer.from(JSON.stringify({
      userId,
      workspaceId,
      provider: 'google',
    })).toString('base64');

    const scopes = [
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/gmail.compose',
      'https://www.googleapis.com/auth/directory.readonly',
    ].join(' ');

    const params = new URLSearchParams({
      client_id: this.clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      state,
      scope: scopes,
      access_type: 'offline',
      prompt: 'consent',
    });

    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  async exchangeCode(code: string, redirectUri: string): Promise<TokenSet> {
    // --- Diagnostic logging (redacted) for debugging invalid_client ---
    const redact = (s: string) => s.length > 16 ? `${s.slice(0, 8)}...${s.slice(-8)}` : `${s.slice(0, 4)}***`;
    console.log('[Google OAuth] Token exchange diagnostics:');
    console.log(`  client_id: ${redact(this.clientId)} (len=${this.clientId.length})`);
    console.log(`  client_secret: len=${this.clientSecret.length}, starts="${this.clientSecret.slice(0, 6)}"`);
    console.log(`  redirect_uri: ${redirectUri}`);
    console.log(`  code: ${redact(code)} (len=${code.length})`);
    console.log(`  grant_type: authorization_code`);
    console.log(`  Content-Type: application/x-www-form-urlencoded`);
    console.log(`  env source: GOOGLE_CLIENT_ID=${process.env.GOOGLE_CLIENT_ID ? 'SET' : 'UNSET'}, GOOGLE_CLIENT_SECRET=${process.env.GOOGLE_CLIENT_SECRET ? 'SET' : 'UNSET'}`);

    // Check for common env var issues
    if (this.clientId !== this.clientId.trim()) {
      console.warn('[Google OAuth] WARNING: client_id has leading/trailing whitespace!');
    }
    if (this.clientSecret !== this.clientSecret.trim()) {
      console.warn('[Google OAuth] WARNING: client_secret has leading/trailing whitespace!');
    }
    if (this.clientSecret.startsWith('"') || this.clientSecret.endsWith('"')) {
      console.warn('[Google OAuth] WARNING: client_secret contains quote characters — likely misconfigured env var');
    }
    if (!this.clientId || !this.clientSecret) {
      console.error('[Google OAuth] ERROR: client_id or client_secret is empty at exchange time!');
    }

    const body = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    });

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Google OAuth] Token exchange FAILED: ${response.status}`);
      console.error(`[Google OAuth] Response body: ${errorText}`);
      console.error(`[Google OAuth] Request body (redacted): client_id=${redact(this.clientId)}&client_secret=REDACTED(len=${this.clientSecret.length})&code=${redact(code)}&redirect_uri=${redirectUri}&grant_type=authorization_code`);
      throw new Error(`Google token exchange failed: ${response.status} - ${errorText}`);
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
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: refreshTokenValue,
        grant_type: 'refresh_token',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Google token refresh failed: ${response.status} - ${errorText}`);
    }

    const data = await response.json() as any;
    return {
      accessToken: data.access_token,
      refreshToken: refreshTokenValue, // Google doesn't always return a new refresh token
      expiresAt: new Date(Date.now() + data.expires_in * 1000),
      scopes: (data.scope || '').split(' '),
    };
  }

  async validateToken(accessToken: string): Promise<boolean> {
    try {
      const response = await fetch(`https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=${accessToken}`);
      return response.ok;
    } catch {
      return false;
    }
  }

  async getValidAccessToken(dbUserId: string): Promise<string | null> {
    const token = await repository.getToken(dbUserId, 'google');
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

      await repository.updateToken(dbUserId, 'google', {
        accessToken: encryptedAccess,
        refreshToken: encryptedRefresh,
        expiresAt: newTokens.expiresAt,
        scopes: newTokens.scopes,
      });

      return newTokens.accessToken;
    } catch (error) {
      console.error('Failed to refresh Google token, removing stale token:', error);
      await repository.deleteToken(dbUserId, 'google');
      return null;
    }
  }
}
