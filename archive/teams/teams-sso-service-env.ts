import { SupabaseDatabaseService } from './database-env';
import { EncryptionService } from './encryption';

interface UserToken {
  accessToken: string;
  refreshToken?: string;
  expiresAt: Date;
  scopes: string[];
}

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
      // Test database connection
      const testUser = await this.db.getUserByAadObjectId('test');
      return true;
    } catch (error) {
      console.error(`❌ Database connection test failed for ${this.environment}:`, error);
      return false;
    }
  }

  public generateAuthUrl(userContext: TeamsUserContext): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      response_type: 'code',
      redirect_uri: this.redirectUri,
      scope: 'https://graph.microsoft.com/User.Read https://graph.microsoft.com/Calendars.Read https://graph.microsoft.com/Calendars.ReadWrite https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/Files.ReadWrite',
      response_mode: 'query',
      state: Buffer.from(JSON.stringify({
        userId: userContext.userId,
        name: userContext.name,
        email: userContext.email,
        tenantId: userContext.tenantId
      })).toString('base64')
    });

    return `https://login.microsoftonline.com/${this.tenantId}/oauth2/v2.0/authorize?${params.toString()}`;
  }

  public async isUserAuthenticated(userContext: TeamsUserContext): Promise<boolean> {
    try {
      console.log(`🔍 [${this.environment}] Checking authentication for user ID: ${userContext.userId}`);
      
      // First, get the user from the database
      const user = await this.db.getUserByAadObjectId(userContext.userId);
      if (!user) {
        console.log(`🔍 [${this.environment}] User not found in database: NO`);
        return false;
      }
      
      const token = await this.db.getToken(user.id, 'microsoft');
      
      if (!token) {
        console.log(`🔍 [${this.environment}] User token found: NO`);
        return false;
      }

      console.log(`🔍 [${this.environment}] User token found: YES`);
      console.log(`🔍 [${this.environment}] Token expires at: ${token.expiresAt}`);
      console.log(`🔍 [${this.environment}] Has refresh token: ${!!token.refreshToken}`);
      
      // Check if we have a refresh token - if not, user needs to re-authenticate
      if (!token.refreshToken) {
        console.log(`❌ [${this.environment}] No refresh token available - user needs to re-authenticate`);
        return false;
      }
      
      // If access token exists, validate it first
      if (token.accessToken) {
        console.log(`🔍 [${this.environment}] Access token exists, validating...`);
        const decryptedToken = this.encryption.decrypt(token.accessToken);
        const isValid = await this.validateTokenWithMicrosoft(decryptedToken);
        
        if (isValid) {
          console.log(`🔍 [${this.environment}] Access token is valid`);
          console.log(`🔍 [${this.environment}] Is authenticated: true`);
          return true;
        }
        
        console.log(`🔍 [${this.environment}] Access token is invalid, clearing it and attempting to refresh...`);
        // Clear the invalid access token but keep the refresh token
        await this.db.updateToken(user.id, 'microsoft', { accessToken: '' });
      } else {
        console.log(`🔍 [${this.environment}] No access token found, attempting to refresh...`);
      }
      
      // Access token is missing or invalid, try to refresh using refresh token
      console.log(`🔄 [${this.environment}] Attempting to refresh access token using refresh token...`);
      const decryptedRefreshToken = this.encryption.decrypt(token.refreshToken);
      const refreshedToken = await this.refreshAccessToken(decryptedRefreshToken);
      
      if (refreshedToken) {
        console.log(`✅ [${this.environment}] Successfully refreshed access token`);
        const encryptedAccessToken = this.encryption.encrypt(refreshedToken.access_token);
        const newExpiresAt = new Date(Date.now() + (refreshedToken.expires_in * 1000));
        
        await this.db.updateToken(user.id, 'microsoft', {
          accessToken: encryptedAccessToken,
          expiresAt: newExpiresAt.toISOString()
        });
        
        console.log(`🔍 [${this.environment}] Is authenticated: true`);
        return true;
      } else {
        console.log(`❌ [${this.environment}] Failed to refresh access token - user needs to re-authenticate`);
        return false;
      }
    } catch (error) {
      console.error(`❌ [${this.environment}] Error checking authentication:`, error);
      return false;
    }
  }

  private async validateTokenWithMicrosoft(accessToken: string): Promise<boolean> {
    try {
      const response = await fetch('https://graph.microsoft.com/v1.0/me', {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      });
      
      return response.ok;
    } catch (error) {
      console.error(`❌ [${this.environment}] Error validating token with Microsoft:`, error);
      return false;
    }
  }

  private async refreshAccessToken(refreshToken: string): Promise<any> {
    try {
      const response = await fetch(`https://login.microsoftonline.com/${this.tenantId}/oauth2/v2.0/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          refresh_token: refreshToken,
          grant_type: 'refresh_token',
          scope: 'https://graph.microsoft.com/User.Read https://graph.microsoft.com/Calendars.Read https://graph.microsoft.com/Calendars.ReadWrite https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/Files.ReadWrite'
        })
      });

      if (!response.ok) {
        console.error(`❌ [${this.environment}] Token refresh failed:`, await response.text());
        return null;
      }

      return await response.json();
    } catch (error) {
      console.error(`❌ [${this.environment}] Error refreshing token:`, error);
      return null;
    }
  }

  public async exchangeCodeForToken(code: string, state: string): Promise<SSOResponse> {
    try {
      console.log(`🔐 [${this.environment}] Starting token exchange...`);
      
      // Decode state to get user context
      const userInfo = JSON.parse(Buffer.from(state, 'base64').toString());
      console.log(`🔐 [${this.environment}] User info:`, userInfo);

      // Exchange code for token
      const tokenResponse = await fetch(`https://login.microsoftonline.com/${this.tenantId}/oauth2/v2.0/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          code: code,
          redirect_uri: this.redirectUri,
          grant_type: 'authorization_code',
          scope: 'https://graph.microsoft.com/User.Read https://graph.microsoft.com/Calendars.Read https://graph.microsoft.com/Calendars.ReadWrite https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/Files.ReadWrite'
        })
      });

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        console.error(`❌ [${this.environment}] Token exchange failed:`, errorText);
        return {
          success: false,
          message: 'Token exchange failed',
          error: errorText
        };
      }

      const tokenData = await tokenResponse.json() as any;
      console.log(`✅ [${this.environment}] Token exchange successful`);

      // Create or get user first
      let user = await this.db.getUserByAadObjectId(userInfo.userId);
      if (!user) {
        console.log(`📝 [${this.environment}] Creating new user in database...`);
        try {
          user = await this.db.createUser(
            userInfo.tenantId,
            userInfo.userId,
            userInfo.name,
            userInfo.email
          );
          console.log(`✅ [${this.environment}] User created:`, user.id);
        } catch (error: any) {
          // If user already exists (duplicate email), try to find them by email
          if (error.code === '23505' && error.message.includes('email')) {
            console.log(`📝 [${this.environment}] User already exists with this email, finding by email...`);
            user = await this.db.getUserByEmail(userInfo.email);
            if (user) {
              console.log(`✅ [${this.environment}] Found existing user by email:`, user.id);
              // Update the aadObjectId to match the current one
              await this.db.updateUserAadObjectId(user.id, userInfo.userId);
              console.log(`✅ [${this.environment}] Updated user AAD Object ID`);
            } else {
              throw error; // Re-throw if we can't find the user
            }
          } else {
            throw error; // Re-throw other errors
          }
        }
      } else {
        console.log(`✅ [${this.environment}] User found:`, user.id);
      }

      // Store token in database
      const encryptedAccessToken = this.encryption.encrypt(tokenData.access_token);
      const encryptedRefreshToken = tokenData.refresh_token ? this.encryption.encrypt(tokenData.refresh_token) : undefined;
      
      console.log(`🔍 [${this.environment}] Encrypted access token type:`, typeof encryptedAccessToken);
      console.log(`🔍 [${this.environment}] Encrypted access token length:`, encryptedAccessToken.length);
      console.log(`🔍 [${this.environment}] Encrypted access token preview:`, encryptedAccessToken.substring(0, 50) + '...');
      
      // Calculate proper token expiry (access tokens typically expire in 1 hour)
      const expiresAt = new Date(Date.now() + (tokenData.expires_in * 1000));
      
      await this.db.storeToken(
        user.id,
        'microsoft',
        encryptedAccessToken,
        expiresAt,
        tokenData.scope.split(' '),
        encryptedRefreshToken
      );

      console.log(`🔍 [${this.environment}] Token stored. Total tokens: 1`);
      console.log(`🔍 [${this.environment}] Stored token keys: [`, userInfo.userId, ']');

      return {
        success: true,
        message: `Teams SSO authentication successful for user: ${userInfo.name} in ${this.environment} environment`,
        accessToken: 'YES' // Don't return actual token for security
      };
    } catch (error) {
      console.error(`❌ [${this.environment}] Error in token exchange:`, error);
      return {
        success: false,
        message: 'Teams SSO authentication failed',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
}

export default TeamsSSOService;
