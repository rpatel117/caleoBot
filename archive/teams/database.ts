import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Supabase connection details loaded

if (!supabaseUrl || !supabaseServiceRoleKey) {
  console.error('⚠️  Supabase URL or Service Role Key not found in environment variables');
  throw new Error('Supabase URL and Service Role Key must be set in environment variables.');
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

export default supabase;

// Database service using Supabase JavaScript client
export class SupabaseDatabaseService {
  private supabase = supabase;

  // Test connection
  async testConnection(): Promise<boolean> {
    try {
      console.log('🔍 Testing Supabase connection...');
      
      // Try a simple query that should work even if tables don't exist
      const { data, error } = await this.supabase
        .from('_prisma_migrations')
        .select('*')
        .limit(1);
      
      if (error && error.code === '42P01') {
        // Table doesn't exist, which is expected for a new database
        console.log('✅ Supabase connection successful (table not found is expected)');
        return true;
      } else if (error && error.message.includes('Could not find the table')) {
        // Alternative error message for missing table
        console.log('✅ Supabase connection successful (table not found is expected)');
        return true;
      } else if (error) {
        console.log('❌ Supabase connection failed:', error);
        console.log('❌ Error details:', JSON.stringify(error, null, 2));
        return false;
      } else {
        console.log('✅ Supabase connection successful');
        return true;
      }
    } catch (err) {
      console.log('❌ Supabase connection failed:', err);
      console.log('❌ Error details:', JSON.stringify(err, null, 2));
      return false;
    }
  }

  // Tenant management
  async createOrGetTenant(tenantId: string) {
    // First try to get existing tenant
    const { data: existingTenant, error: getError } = await this.supabase
      .from('Tenant')
      .select('*')
      .eq('aadTenantId', tenantId)
      .single();

    if (existingTenant) {
      return existingTenant;
    }

    // Create new tenant if it doesn't exist
    const tenantIdGenerated = 'tenant_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    const { data, error } = await this.supabase
      .from('Tenant')
      .insert({
        id: tenantIdGenerated,
        aadTenantId: tenantId
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating tenant:', error);
      throw error;
    }
    return data;
  }

  // User management
  async createUser(tenantId: string, aadObjectId: string, displayName?: string, email?: string) {
    // Ensure tenant exists first and get its ID
    const tenant = await this.createOrGetTenant(tenantId);
    
    // Generate a unique ID (similar to cuid())
    const id = 'user_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    
    const { data, error } = await this.supabase
      .from('User')
      .insert({
        id,
        tenantId: tenant.id, // Use the actual tenant ID from the database
        aadObjectId,
        displayName,
        email
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating user:', error);
      throw error;
    }
    return data;
  }

  async getUserByAadObjectId(aadObjectId: string) {
    const { data, error } = await this.supabase
      .from('User')
      .select('*')
      .eq('aadObjectId', aadObjectId)
      .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
      console.error('Error getting user:', error);
      throw error;
    }
    return data;
  }

  // Token management
  async storeToken(userId: string, provider: string, accessToken: string, expiresAt: Date, scopes: string[], refreshToken?: string) {
    console.log('🔍 Storing token in database...');
    console.log('🔍 Access token type:', typeof accessToken);
    console.log('🔍 Access token length:', accessToken.length);
    console.log('🔍 Access token preview:', accessToken.substring(0, 50) + '...');
    
    // First try to get existing token to preserve the ID
    const existingToken = await this.getToken(userId, provider);
    const tokenId = existingToken?.id || 'token_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    
    const { data, error } = await this.supabase
      .from('OAuthToken')
      .upsert({
        id: tokenId,
        userId,
        provider,
        accessToken,
        refreshToken,
        expiresAt: expiresAt.toISOString(),
        scopes
      })
      .select()
      .single();

    if (error) {
      console.error('Error storing token:', error);
      throw error;
    }
    
    console.log('✅ Token stored successfully');
    return data;
  }

  async getToken(userId: string, provider: string) {
    const { data, error } = await this.supabase
      .from('OAuthToken')
      .select('*')
      .eq('userId', userId)
      .eq('provider', provider)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error('Error getting token:', error);
      throw error;
    }
    return data;
  }

  async updateToken(userId: string, provider: string, updates: {
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: Date;
    scopes?: string[];
  }) {
    const updateData: any = {};
    
    if (updates.accessToken !== undefined) {
      updateData.accessToken = updates.accessToken;
    }
    if (updates.refreshToken !== undefined) {
      updateData.refreshToken = updates.refreshToken;
    }
    if (updates.expiresAt !== undefined) {
      updateData.expiresAt = updates.expiresAt.toISOString();
    }
    if (updates.scopes !== undefined) {
      updateData.scopes = updates.scopes;
    }

    const { data, error } = await this.supabase
      .from('OAuthToken')
      .update(updateData)
      .eq('userId', userId)
      .eq('provider', provider)
      .select()
      .single();

    if (error) {
      console.error('Error updating token:', error);
      throw error;
    }
    return data;
  }

  async deleteToken(userId: string, provider: string) {
    const { data, error } = await this.supabase
      .from('OAuthToken')
      .delete()
      .eq('userId', userId)
      .eq('provider', provider);

    if (error) {
      console.error('Error deleting token:', error);
      throw error;
    }
    return data;
  }

  // Conversation management
  async createConversation(userId: string, contextType: string, contextId: string) {
    // Generate a unique ID for the conversation
    const id = 'conv_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    
    const { data, error } = await this.supabase
      .from('Conversation')
      .insert({
        id,
        userId,
        contextType,
        contextId
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating conversation:', error);
      throw error;
    }
    return data;
  }

  async getConversation(userId: string, contextType: string, contextId: string) {
    const { data, error } = await this.supabase
      .from('Conversation')
      .select('*')
      .eq('userId', userId)
      .eq('contextType', contextType)
      .eq('contextId', contextId)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error('Error getting conversation:', error);
      throw error;
    }
    return data;
  }

  async addMessage(conversationId: string, role: string, content: string) {
    // Generate a unique ID for the message
    const id = 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    
    const { data, error } = await this.supabase
      .from('Message')
      .insert({
        id,
        conversationId,
        role,
        content
      })
      .select()
      .single();

    if (error) {
      console.error('Error adding message:', error);
      throw error;
    }
    return data;
  }

  async getMessages(conversationId: string, limit: number = 20) {
    const { data, error } = await this.supabase
      .from('Message')
      .select('*')
      .eq('conversationId', conversationId)
      .order('createdAt', { ascending: true })
      .limit(limit);

    if (error) {
      console.error('Error getting messages:', error);
      throw error;
    }
    return data || [];
  }
}
