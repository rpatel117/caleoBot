import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client lazily to ensure environment variables are loaded
let supabase: any = null;

function getSupabaseClient() {
  if (!supabase) {
    const supabaseUrl = process.env.SUPABASE_URL || '';
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Missing Supabase configuration');
    }

    supabase = createClient(supabaseUrl, supabaseKey);
  }
  return supabase;
}

// Environment-specific database service
export class SupabaseDatabaseService {
  private environment: 'dev' | 'prod';
  private supabase: any;

  constructor(environment: 'dev' | 'prod' = 'dev') {
    this.environment = environment;
    this.supabase = getSupabaseClient();
  }

  // Get the appropriate table name based on environment
  private getTableName(baseName: string): string {
    return `${baseName}_${this.environment === 'dev' ? 'Dev' : 'Prod'}`;
  }

  // Tenant operations (shared between environments)
  async createTenant(tenantId: string): Promise<any> {
    const tableName = this.getTableName('Tenant');
    const { data, error } = await this.supabase
      .from(tableName)
      .insert({
        id: tenantId,
        aadTenantId: tenantId,
      })
      .select()
      .single();

    if (error) {
      console.error(`Error creating tenant in ${this.environment}:`, error);
      throw error;
    }
    return data;
  }

  async getTenant(tenantId: string): Promise<any> {
    const tableName = this.getTableName('Tenant');
    const { data, error } = await this.supabase
      .from(tableName)
      .select('*')
      .eq('aadTenantId', tenantId)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error(`Error getting tenant in ${this.environment}:`, error);
      throw error;
    }
    return data;
  }

  // User operations (environment-specific)
  async createUser(tenantId: string, aadObjectId: string, displayName?: string, email?: string): Promise<any> {
    // First, ensure the tenant exists
    await this.createTenant(tenantId);
    
    const tableName = this.getTableName('User');
    const { data, error } = await this.supabase
      .from(tableName)
      .insert({
        id: aadObjectId,
        tenantId: tenantId,
        aadObjectId: aadObjectId,
        displayName: displayName,
        email: email,
      })
      .select()
      .single();

    if (error) {
      console.error(`Error creating user in ${this.environment}:`, error);
      throw error;
    }
    return data;
  }

  async getUserByAadObjectId(aadObjectId: string): Promise<any> {
    const tableName = this.getTableName('User');
    const { data, error } = await this.supabase
      .from(tableName)
      .select('*')
      .eq('aadObjectId', aadObjectId)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error(`Error getting user from ${this.environment}:`, error);
      throw error;
    }
    return data;
  }

  async getUserByEmail(email: string): Promise<any> {
    const tableName = this.getTableName('User');
    const { data, error } = await this.supabase
      .from(tableName)
      .select('*')
      .eq('email', email)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error(`Error getting user by email from ${this.environment}:`, error);
      throw error;
    }
    return data;
  }

  async updateUserAadObjectId(userId: string, aadObjectId: string): Promise<any> {
    const tableName = this.getTableName('User');
    const { data, error } = await this.supabase
      .from(tableName)
      .update({ aadObjectId })
      .eq('id', userId)
      .select()
      .single();

    if (error) {
      console.error(`Error updating user AAD Object ID in ${this.environment}:`, error);
      throw error;
    }
    return data;
  }

  // Token operations (environment-specific)
  async storeToken(
    userId: string,
    provider: string,
    accessToken: string,
    expiresAt: Date,
    scopes: string[],
    refreshToken?: string
  ): Promise<any> {
    const tableName = this.getTableName('OAuthToken');
    const { data, error } = await this.supabase
      .from(tableName)
      .insert({
        id: `${userId}_${provider}_${Date.now()}`,
        userId: userId,
        provider: provider,
        accessToken: accessToken,
        refreshToken: refreshToken,
        scopes: scopes,
        expiresAt: expiresAt.toISOString(),
      })
      .select()
      .single();

    if (error) {
      console.error(`Error storing token in ${this.environment}:`, error);
      throw error;
    }
    return data;
  }

  async getToken(userId: string, provider: string): Promise<any> {
    const tableName = this.getTableName('OAuthToken');
    const { data, error } = await this.supabase
      .from(tableName)
      .select('*')
      .eq('userId', userId)
      .eq('provider', provider)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error(`Error getting token from ${this.environment}:`, error);
      throw error;
    }
    return data;
  }

  async updateToken(userId: string, provider: string, updates: any): Promise<any> {
    const tableName = this.getTableName('OAuthToken');
    const { data, error } = await this.supabase
      .from(tableName)
      .update(updates)
      .eq('userId', userId)
      .eq('provider', provider)
      .select()
      .single();

    if (error) {
      console.error(`Error updating token in ${this.environment}:`, error);
      throw error;
    }
    return data;
  }

  // Conversation operations (environment-specific)
  async createConversation(userId: string, contextType: string, contextId: string): Promise<any> {
    const tableName = this.getTableName('Conversation');
    const { data, error } = await this.supabase
      .from(tableName)
      .insert({
        id: `${userId}_${contextType}_${contextId}_${Date.now()}`,
        userId: userId,
        contextType: contextType,
        contextId: contextId,
      })
      .select()
      .single();

    if (error) {
      console.error(`Error creating conversation in ${this.environment}:`, error);
      throw error;
    }
    return data;
  }

  async getConversation(userId: string, contextType: string, contextId: string): Promise<any> {
    const tableName = this.getTableName('Conversation');
    const { data, error } = await this.supabase
      .from(tableName)
      .select('*')
      .eq('userId', userId)
      .eq('contextType', contextType)
      .eq('contextId', contextId)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error(`Error getting conversation from ${this.environment}:`, error);
      throw error;
    }
    return data;
  }

  // Message operations (environment-specific)
  async createMessage(conversationId: string, role: string, content: string): Promise<any> {
    const tableName = this.getTableName('Message');
    const { data, error } = await this.supabase
      .from(tableName)
      .insert({
        id: `${conversationId}_${role}_${Date.now()}`,
        conversationId: conversationId,
        role: role,
        content: content,
      })
      .select()
      .single();

    if (error) {
      console.error(`Error creating message in ${this.environment}:`, error);
      throw error;
    }
    return data;
  }

  async getMessages(conversationId: string, limit: number = 50): Promise<any[]> {
    const tableName = this.getTableName('Message');
    const { data, error } = await this.supabase
      .from(tableName)
      .select('*')
      .eq('conversationId', conversationId)
      .order('createdAt', { ascending: false })
      .limit(limit);

    if (error) {
      console.error(`Error getting messages from ${this.environment}:`, error);
      throw error;
    }
    return data || [];
  }

  // Test database connection
  async testConnection(): Promise<boolean> {
    try {
      // Test database connection by trying to query a table
      const tableName = this.getTableName('User');
      const { error } = await this.supabase
        .from(tableName)
        .select('id')
        .limit(1);

      if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
        console.error(`❌ Database connection test failed for ${this.environment}:`, error);
        return false;
      }
      
      console.log(`✅ Database connection test successful for ${this.environment}`);
      return true;
    } catch (error) {
      console.error(`❌ Database connection test failed for ${this.environment}:`, error);
      return false;
    }
  }

  // Environment info
  getEnvironment(): 'dev' | 'prod' {
    return this.environment;
  }

  getTablePrefix(): string {
    return this.environment === 'dev' ? 'Dev' : 'Prod';
  }
}
