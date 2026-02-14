import { SupabaseDatabaseService } from './database-env';
import { EncryptionService } from './encryption';

interface TeamsUserContext {
  userId: string;
  name: string;
  email: string;
  tenantId: string;
}

interface SSOResponse {
  success: boolean;
  message: string;
  accessToken?: string;
  error?: string;
}

interface UserToken {
  userId: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt: Date;
  scopes: string[];
}

class TeamsSSOService {
  private clientId: string;
  private clientSecret: string;
  private redirectUri: string;
  private tenantId: string;
  private db: SupabaseDatabaseService;
  private encryption: EncryptionService;
  private environment: 'dev' | 'prod';

  constructor(environment: 'dev' | 'prod' = 'dev') {
    this.environment = environment;
    this.clientId = process.env.MICROSOFT_APP_ID || '';
    this.clientSecret = process.env.MICROSOFT_APP_PASSWORD || '';
    this.redirectUri = `${process.env.NGROK_URL || 'http://localhost:3978'}/auth/callback`;
    this.tenantId = process.env.MICROSOFT_TENANT_ID || 'common';
    this.db = new SupabaseDatabaseService(environment);
    this.encryption = new EncryptionService();

    if (!this.clientId || !this.clientSecret) {
      console.warn(`⚠️  Microsoft App ID or Password not found in environment variables for ${environment}`);
    }

    console.log(`🔧 TeamsSSOService initialized for ${environment} environment`);
    console.log(`🔧 Client ID: ${this.clientId}`);
    console.log(`🔧 Redirect URI: ${this.redirectUri}`);
  }

  public async testConnection(): Promise<boolean> {
    try {
      return await this.db.testConnection();
    } catch (error) {
      console.error('❌ Supabase connection test failed:', error);
      return false;
    }
  }

  public generateAuthUrl(userContext: TeamsUserContext): string {
    const state = Buffer.from(JSON.stringify({
      userId: userContext.userId,
      name: userContext.name,
      email: userContext.email,
      tenantId: userContext.tenantId
    })).toString('base64');

    const scopes = [
      'https://graph.microsoft.com/Calendars.ReadWrite',
      'https://graph.microsoft.com/User.Read',
      'https://graph.microsoft.com/offline_access'
    ].join(' ');

    const params = new URLSearchParams({
      client_id: this.clientId,
      response_type: 'code',
      redirect_uri: this.redirectUri,
      state: state,
      response_mode: 'query',
      prompt: 'consent',
      scope: scopes
    });

    return `https://login.microsoftonline.com/${this.tenantId}/oauth2/v2.0/authorize?${params.toString()}`;
  }

  public async isUserAuthenticated(userContext: TeamsUserContext): Promise<boolean> {
    try {
      console.log(`🔍 Checking authentication for user ID: ${userContext.userId}`);
      
      // First, get the user from the database
      const user = await this.db.getUserByAadObjectId(userContext.userId);
      if (!user) {
        console.log('🔍 User not found in database: NO');
        return false;
      }
      
      const token = await this.db.getToken(user.id, 'microsoft');
      
      if (!token) {
        console.log('🔍 User token found: NO');
        return false;
      }

      console.log('🔍 User token found: YES');
      console.log(`🔍 Token expires at: ${token.expiresAt}`);
      console.log(`🔍 Has refresh token: ${!!token.refreshToken}`);
      
      // Check if we have a refresh token - if not, user needs to re-authenticate
      if (!token.refreshToken) {
        console.log('❌ No refresh token available - user needs to re-authenticate');
        return false;
      }
      
      // If access token exists, validate it first
      if (token.accessToken) {
        console.log('🔍 Access token exists, validating...');
        const decryptedToken = this.encryption.decrypt(token.accessToken);
        const isValid = await this.validateTokenWithMicrosoft(decryptedToken);
        
        if (isValid) {
          console.log('🔍 Access token is valid');
          console.log('🔍 Is authenticated: true');
          return true;
        }
        
        console.log('🔍 Access token is invalid, clearing it and attempting to refresh...');
        // Clear the invalid access token but keep the refresh token
        await this.db.updateToken(user.id, 'microsoft', { accessToken: '' });
      } else {
        console.log('🔍 No access token found, attempting to refresh...');
      }
      
      // Access token is missing or invalid, try to refresh using refresh token
      console.log('🔄 Attempting to refresh access token using refresh token...');
      const decryptedRefreshToken = this.encryption.decrypt(token.refreshToken);
      const refreshResult = await this.refreshAccessToken(decryptedRefreshToken, user.id);
      if (refreshResult.success) {
        console.log('✅ Access token refreshed successfully');
        console.log('🔍 Is authenticated: true');
        return true;
      } else {
        console.log('❌ Failed to refresh access token:', refreshResult.error);
      }

      // If we get here, refresh token is also invalid
      console.log('❌ Refresh token is invalid - user needs to re-authenticate');
      return false;
    } catch (error) {
      console.error('❌ Error checking authentication:', error);
      return false;
    }
  }

  public async getAccessToken(userContext: TeamsUserContext): Promise<string | null> {
    try {
      console.log('🔍 getAccessToken called with userContext:', {
        userId: userContext.userId,
        name: userContext.name,
        email: userContext.email
      });
      
      // First, get the user from the database
      const user = await this.db.getUserByAadObjectId(userContext.userId);
      if (!user) {
        console.log('❌ User not found in database');
        return null;
      }
      
      console.log('✅ User found in database:', {
        id: user.id,
        name: user.name,
        email: user.email,
        aadObjectId: user.aadObjectId
      });
      
      const token = await this.db.getToken(user.id, 'microsoft');
      
      if (!token) {
        console.log('❌ Token not found in database');
        return null;
      }
      
      console.log('✅ Token found in database:', {
        id: token.id,
        provider: token.provider,
        expiresAt: token.expiresAt,
        accessTokenLength: token.accessToken?.length,
        hasRefreshToken: !!token.refreshToken
      });

      // Check if access token exists
      if (!token.accessToken) {
        console.log('🔍 No access token found, attempting to refresh...');
      } else {
        console.log('🔍 Attempting to decrypt access token...');
        const decryptedAccessToken = this.encryption.decrypt(token.accessToken);
        
        // Validate access token with Microsoft Graph
        const isAccessTokenValid = await this.validateTokenWithMicrosoft(decryptedAccessToken);
        if (isAccessTokenValid) {
          console.log('✅ Access token is valid');
          return decryptedAccessToken;
        }

        console.log('❌ Access token is invalid, checking refresh token...');
      }
      
      // Check if we have a refresh token - if not, user needs to re-authenticate
      if (!token.refreshToken) {
        console.log('❌ No refresh token available - user needs to re-authenticate');
        return null;
      }
      
      // Access token is invalid, try to refresh using refresh token
      console.log('🔄 Attempting to refresh access token using refresh token...');
      const decryptedRefreshToken = this.encryption.decrypt(token.refreshToken);
      const refreshResult = await this.refreshAccessToken(decryptedRefreshToken, user.id);
      if (refreshResult.success && refreshResult.accessToken) {
        console.log('✅ Access token refreshed successfully');
        return refreshResult.accessToken;
      } else {
        console.log('❌ Failed to refresh access token:', refreshResult.error);
      }

      // If we get here, refresh token is also invalid
      console.log('❌ Refresh token is invalid - user needs to re-authenticate');
      return null;
    } catch (error) {
      console.error('❌ Error getting access token:', error);
      return null;
    }
  }

  /**
   * Validate token with Microsoft Graph API
   */
  private async validateTokenWithMicrosoft(accessToken: string): Promise<boolean> {
    try {
      console.log('🔍 Validating token with Microsoft Graph...');
      
      // Test the token by making a simple request to Graph API
      const response = await fetch('https://graph.microsoft.com/v1.0/me', {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        console.log('✅ Token is valid and working');
        return true;
      } else {
        const errorText = await response.text();
        console.log(`❌ Token validation failed: ${response.status} ${response.statusText}`);
        console.log(`Error details: ${errorText}`);
        return false;
      }
    } catch (error) {
      console.error('❌ Error validating token:', error);
      return false;
    }
  }

  /**
   * Refresh access token using refresh token
   */
  private async refreshAccessToken(refreshToken: string, userId: string): Promise<{
    success: boolean;
    accessToken?: string;
    refreshToken?: string;
    error?: string;
  }> {
    try {
      console.log('🔄 Refreshing access token...');
      
      const response = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          refresh_token: refreshToken,
          grant_type: 'refresh_token',
          scope: 'https://graph.microsoft.com/Calendars.ReadWrite https://graph.microsoft.com/User.Read offline_access'
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.log(`❌ Token refresh failed: ${response.status} ${response.statusText}`);
        console.log(`Error details: ${errorText}`);
        return { success: false, error: `Token refresh failed: ${response.status}` };
      }

      const tokenData = await response.json() as any;
      console.log('✅ Token refresh successful');

      // Encrypt the new tokens
      const encryptedAccessToken = this.encryption.encrypt(tokenData.access_token);
      const encryptedRefreshToken = tokenData.refresh_token ? this.encryption.encrypt(tokenData.refresh_token) : undefined;

      // Calculate expiration time (typically 1 hour for access tokens)
      const expiresAt = new Date(Date.now() + (tokenData.expires_in * 1000));

      // Update the token in the database
      await this.db.updateToken(
        userId,
        'microsoft',
        {
          accessToken: encryptedAccessToken,
          refreshToken: encryptedRefreshToken,
          expiresAt: expiresAt,
          scopes: ['https://graph.microsoft.com/.default']
        }
      );

      console.log('✅ New tokens stored in database');
      return {
        success: true,
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token
      };
    } catch (error) {
      console.error('❌ Error refreshing token:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Get authentication status for user
   */
  public async getAuthStatus(userContext: TeamsUserContext): Promise<{
    authenticated: boolean;
    needsAuth: boolean;
    authUrl?: string;
  }> {
    const authenticated = await this.isUserAuthenticated(userContext);
    
    if (authenticated) {
      return { authenticated: true, needsAuth: false };
    }

    return {
      authenticated: false,
      needsAuth: true,
      authUrl: this.generateAuthUrl(userContext)
    };
  }

  public async exchangeCodeForToken(code: string, state: string): Promise<SSOResponse> {
    try {
      const userInfo = JSON.parse(Buffer.from(state, 'base64').toString());
      console.log(`🔐 Exchanging code for token for user: ${userInfo.name}`);
      console.log(`🔍 Storing token for user ID: ${userInfo.userId}`);
      console.log('🔍 User info:', userInfo);

      const tokenResponse = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          code: code,
          redirect_uri: this.redirectUri,
          grant_type: 'authorization_code',
          scope: 'https://graph.microsoft.com/Calendars.ReadWrite https://graph.microsoft.com/User.Read offline_access'
        }),
      });

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        console.error('❌ Token exchange failed:', errorText);
        return {
          success: false,
          message: 'Token exchange failed',
          error: errorText
        };
      }

      const tokenData = await tokenResponse.json() as any;
      console.log('✅ Token exchange successful');
      console.log('🔍 Token data received:', {
        hasAccessToken: !!tokenData.access_token,
        hasRefreshToken: !!tokenData.refresh_token,
        expiresIn: tokenData.expires_in,
        scope: tokenData.scope
      });

      // Create or get user first
      let user = await this.db.getUserByAadObjectId(userInfo.userId);
      if (!user) {
        console.log('📝 Creating new user in database...');
        user = await this.db.createUser(
          userInfo.tenantId,
          userInfo.userId,
          userInfo.name,
          userInfo.email
        );
        console.log('✅ User created:', user.id);
      } else {
        console.log('✅ User found:', user.id);
      }

      // Store token in database
      const encryptedAccessToken = this.encryption.encrypt(tokenData.access_token);
      const encryptedRefreshToken = tokenData.refresh_token ? this.encryption.encrypt(tokenData.refresh_token) : undefined;
      
      console.log('🔍 Encrypted access token type:', typeof encryptedAccessToken);
      console.log('🔍 Encrypted access token length:', encryptedAccessToken.length);
      console.log('🔍 Encrypted access token preview:', encryptedAccessToken.substring(0, 50) + '...');
      
      // Calculate proper token expiry (access tokens typically expire in 1 hour)
      const expiresAt = new Date(Date.now() + (tokenData.expires_in * 1000));
      
      await this.db.storeToken(
        user.id, // Use the database user ID, not the Teams user ID
        'microsoft',
        encryptedAccessToken,
        expiresAt,
        tokenData.scope.split(' '),
        encryptedRefreshToken
      );

      console.log('🔍 Token stored. Total tokens: 1');
      console.log('🔍 Stored token keys: [', userInfo.userId, ']');

      return {
        success: true,
        message: `Teams SSO authentication successful for user: ${userInfo.name}`,
        accessToken: 'YES' // Don't return actual token for security
      };
    } catch (error) {
      console.error('❌ Error in token exchange:', error);
      return {
        success: false,
        message: 'Teams SSO authentication failed',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
}

export default TeamsSSOService;
