export interface UserContext {
  userId: string;
  name: string;
  email: string;
  workspaceId: string;
  timezone?: string;
}

export type UserType = 'developer' | 'member';
export type WorkspacePlan = 'free' | 'pro' | 'enterprise';

export type CalendarProviderType = 'microsoft' | 'google';

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt: Date;
  scopes: string[];
}
