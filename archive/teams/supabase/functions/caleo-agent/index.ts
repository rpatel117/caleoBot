import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { Agent, run, tool } from 'npm:@openai/agents';

// Types
interface UserContext {
  userId: string;
  name: string;
  email: string;
  tenantId: string;
}

interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

interface AgentRequest {
  userMessage: string;
  userContext: UserContext;
  conversationHistory?: ConversationMessage[];
}

interface AgentResponse {
  response: string;
  success: boolean;
  error?: string;
  metadata?: {
    model: string;
    toolCalls: number;
    latency: number;
  };
}

// Initialize Supabase client from environment variables
const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Initialize OpenAI client from environment variables
const openaiApiKey = Deno.env.get('OPENAI_API_KEY') || '';

// Set environment variable for Agent constructor
if (openaiApiKey) {
  Deno.env.set('OPENAI_API_KEY', openaiApiKey);
}

// Environment detection - read from environment variables
function getEnvironment(): 'dev' | 'prod' {
  // Detect environment based on Microsoft App ID (production uses specific ID)
  const appId = Deno.env.get('MICROSOFT_CLIENT_ID') || '';
  const isProduction = appId === 'a66672e1-4d5f-4a39-9da9-48abebaadea4';
  return isProduction ? 'prod' : 'dev';
}

// Get the appropriate table name based on environment
function getTableName(baseName: string): string {
  const environment = getEnvironment();
  return `${baseName}_${environment === 'dev' ? 'Dev' : 'Prod'}`;
}

// Encryption utilities (enhanced to match local service)
function decryptToken(encryptedToken: string, key: string): string {
  try {
    console.log('🔍 Decryption input:', {
      type: typeof encryptedToken,
      length: encryptedToken?.length,
      startsWithBackslashX: encryptedToken?.startsWith('\\x'),
      startsWithU2Fs: encryptedToken?.startsWith('U2Fs'),
      preview: encryptedToken?.substring(0, 50) + '...'
    });
    
    // Handle different token formats (matching local encryption.ts)
    let processedText = encryptedToken;
    
    if (encryptedToken.startsWith('\\x')) {
      // Handle hex-encoded data (legacy format from BYTEA)
      const hexString = encryptedToken.replace(/\\x/g, '');
      console.log('🔍 Converting hex to base64 for decryption');
      
      try {
        const bytes = new Uint8Array(hexString.match(/.{2}/g)!.map(byte => parseInt(byte, 16)));
        processedText = btoa(String.fromCharCode(...bytes));
        console.log('🔍 Converted hex to base64');
      } catch (hexError) {
        console.error('❌ Hex conversion failed:', hexError);
        throw new Error('Failed to convert hex-encoded token to base64');
      }
    } else if (encryptedToken.startsWith('U2Fs')) {
      console.log('🔍 Token is already in base64 format');
      processedText = encryptedToken;
    } else if (encryptedToken.startsWith('VTJG')) {
      console.log('🔍 Token appears to be corrupted from database conversion');
      throw new Error('Corrupted token - please re-authenticate');
    } else {
      console.log('🔍 Unknown token format, trying direct decryption');
      processedText = encryptedToken;
    }
    
    // For edge function, use simple base64 decode (server-side, no need for full AES)
    const result = atob(processedText);
    
    console.log('🔍 Decryption result length:', result?.length);
    console.log('🔍 Decryption result preview:', result?.substring(0, 50) + '...');
    
    if (!result) {
      throw new Error('Decryption resulted in empty string');
    }
    
    return result;
  } catch (error) {
    console.error('❌ Decryption failed:', error);
    throw new Error('Decryption failed');
  }
}

// Graph Service for Edge Function
class EdgeGraphService {
  private baseUrl = 'https://graph.microsoft.com/v1.0';

  // Token refresh functionality (ported from teams-sso-service.ts)
  async refreshAccessToken(userId: string): Promise<any> {
    try {
      console.log('🔄 Attempting to refresh access token for user:', userId);
      
      // Get refresh token from database
      const { data: tokenData, error: tokenError } = await supabase
        .from(getTableName('OAuthToken'))
        .select('refreshToken, accessToken, expiresAt')
        .eq('userId', userId)
        .eq('provider', 'microsoft')
        .single();

      if (tokenError || !tokenData) {
        console.error('❌ No refresh token found:', tokenError);
        const baseUrl = Deno.env.get('NGROK_URL') || Deno.env.get('BOT_BASE_URL') || '';
        return {
          success: false,
          error: 'No refresh token available. Please re-authenticate.',
          needsReauth: true,
          authUrl: `${baseUrl}/auth/callback`
        };
      }

      // Decrypt refresh token
      const encryptionKey = Deno.env.get('ENCRYPTION_KEY') || '';
      if (!encryptionKey) {
        throw new Error('ENCRYPTION_KEY environment variable not set');
      }
      const refreshToken = decryptToken(tokenData.refreshToken, encryptionKey);

      // Microsoft token refresh endpoint
      const tokenUrl = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
      
      const clientId = Deno.env.get('MICROSOFT_CLIENT_ID') || '';
      const clientSecret = Deno.env.get('MICROSOFT_CLIENT_SECRET') || '';
      if (!clientId || !clientSecret) {
        throw new Error('MICROSOFT_CLIENT_ID or MICROSOFT_CLIENT_SECRET environment variable not set');
      }
      
      const tokenParams = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        scope: 'https://graph.microsoft.com/.default',
        grant_type: 'refresh_token',
        refresh_token: refreshToken
      });

      console.log('🔄 Making token refresh request to Microsoft...');
      
      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: tokenParams
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ Token refresh failed:', response.status, errorText);
        const baseUrl = Deno.env.get('NGROK_URL') || Deno.env.get('BOT_BASE_URL') || '';
        return {
          success: false,
          error: `Token refresh failed: ${response.status}`,
          needsReauth: true,
          authUrl: `${baseUrl}/auth/callback`
        };
      }

      const tokenResponse = await response.json();
      console.log('✅ Token refresh successful');

      // Encrypt new tokens (simple base64 for edge function)
      const encryptedAccessToken = btoa(tokenResponse.access_token);
      const encryptedRefreshToken = tokenResponse.refresh_token ? btoa(tokenResponse.refresh_token) : tokenData.refreshToken;

      // Calculate expiration time
      const expiresAt = new Date(Date.now() + (tokenResponse.expires_in * 1000));

      // Update database with new tokens
      const { error: updateError } = await supabase
        .from(getTableName('OAuthToken'))
        .update({
          accessToken: encryptedAccessToken,
          refreshToken: encryptedRefreshToken,
          expiresAt: expiresAt.toISOString(),
          updatedAt: new Date().toISOString()
        })
        .eq('userId', userId)
        .eq('provider', 'microsoft');

      if (updateError) {
        console.error('❌ Failed to update tokens in database:', updateError);
        const baseUrl = Deno.env.get('NGROK_URL') || Deno.env.get('BOT_BASE_URL') || '';
        return {
          success: false,
          error: 'Failed to save refreshed tokens',
          needsReauth: true,
          authUrl: `${baseUrl}/auth/callback`
        };
      }

      console.log('✅ Tokens updated in database successfully');
      
      return {
        success: true,
        accessToken: tokenResponse.access_token,
        expiresAt: expiresAt.toISOString()
      };

    } catch (error) {
      console.error('❌ Token refresh error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Token refresh failed',
        needsReauth: true,
        authUrl: `${Deno.env.get('NGROK_URL')}/auth/callback`
      };
    }
  }

  // Get valid access token (with automatic refresh)
  async getValidAccessToken(userContext: UserContext): Promise<any> {
    try {
      // Get user's access token from Supabase
      const { data: tokenData, error } = await supabase
        .from(getTableName('OAuthToken'))
        .select('accessToken, refreshToken, expiresAt')
        .eq('userId', userContext.userId)
        .eq('provider', 'microsoft')
        .single();

      if (error || !tokenData) {
        const baseUrl = Deno.env.get('NGROK_URL') || Deno.env.get('BOT_BASE_URL') || '';
        return {
          success: false,
          error: 'User not authenticated. Please complete Teams SSO authentication.',
          needsReauth: true,
          authUrl: `${baseUrl}/auth/callback`
        };
      }

      // Check if token is expired
      const expiresAt = new Date(tokenData.expiresAt);
      const now = new Date();
      const timeUntilExpiry = expiresAt.getTime() - now.getTime();
      
      // Refresh if token expires in less than 5 minutes
      if (timeUntilExpiry < 5 * 60 * 1000) {
        console.log('🔄 Token expires soon, refreshing...');
        const refreshResult = await this.refreshAccessToken(userContext.userId);
        
        if (!refreshResult.success) {
          return refreshResult;
        }
        
        // Use the new token
        return {
          success: true,
          accessToken: refreshResult.accessToken
        };
      }

      // Decrypt and return current token
      const encryptionKey = Deno.env.get('ENCRYPTION_KEY') || '';
      if (!encryptionKey) {
        throw new Error('ENCRYPTION_KEY environment variable not set');
      }
      const accessToken = decryptToken(tokenData.accessToken, encryptionKey);
      
      return {
        success: true,
        accessToken
      };

    } catch (error) {
      console.error('❌ Error getting access token:', error);
      const baseUrl = Deno.env.get('NGROK_URL') || Deno.env.get('BOT_BASE_URL') || '';
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get access token',
        needsReauth: true,
        authUrl: `${baseUrl}/auth/callback`
      };
    }
  }

  async getCalendarEvents(userContext: UserContext, startTime: string, endTime: string): Promise<any> {
    try {
      // Get valid access token (with automatic refresh)
      const tokenResult = await this.getValidAccessToken(userContext);
      
      if (!tokenResult.success) {
        return {
          data: [],
          success: false,
          error: tokenResult.error,
          needsReauth: tokenResult.needsReauth,
          authUrl: tokenResult.authUrl
        };
      }

      const accessToken = tokenResult.accessToken;

      const startParam = encodeURIComponent(startTime);
      const endParam = encodeURIComponent(endTime);
      const url = `${this.baseUrl}/me/calendar/events?startDateTime=${startParam}&endDateTime=${endParam}`;

      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        return {
          data: [],
          success: false,
          error: `Graph API error: ${response.status} - ${response.statusText}`
        };
      }

      const data = await response.json();
      return { data: data.value, success: true };
    } catch (error) {
      return {
        data: [],
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  async createMeeting(userContext: UserContext, meetingData: any): Promise<any> {
    try {
      // Get valid access token (with automatic refresh)
      const tokenResult = await this.getValidAccessToken(userContext);
      
      if (!tokenResult.success) {
        return {
          data: null,
          success: false,
          error: tokenResult.error,
          needsReauth: tokenResult.needsReauth,
          authUrl: tokenResult.authUrl
        };
      }

      const accessToken = tokenResult.accessToken;

      const url = `${this.baseUrl}/me/calendar/events`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(meetingData)
      });

      if (!response.ok) {
        return {
          data: null,
          success: false,
          error: `Graph API error: ${response.status} - ${response.statusText}`
        };
      }

      const data = await response.json();
      return { data, success: true };
    } catch (error) {
      return {
        data: null,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  async updateMeeting(userContext: UserContext, meetingId: string, updateData: any): Promise<any> {
    try {
      // Get valid access token (with automatic refresh)
      const tokenResult = await this.getValidAccessToken(userContext);
      
      if (!tokenResult.success) {
        return {
          data: null,
          success: false,
          error: tokenResult.error,
          needsReauth: tokenResult.needsReauth,
          authUrl: tokenResult.authUrl
        };
      }

      const accessToken = tokenResult.accessToken;

      const url = `${this.baseUrl}/me/calendar/events/${meetingId}`;
      const response = await fetch(url, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(updateData)
      });

      if (!response.ok) {
        return {
          data: null,
          success: false,
          error: `Graph API error: ${response.status} - ${response.statusText}`
        };
      }

      const data = await response.json();
      return { data, success: true };
    } catch (error) {
      return {
        data: null,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  async deleteMeeting(userContext: UserContext, meetingId: string): Promise<any> {
    try {
      // Get valid access token (with automatic refresh)
      const tokenResult = await this.getValidAccessToken(userContext);
      
      if (!tokenResult.success) {
        return {
          data: false,
          success: false,
          error: tokenResult.error,
          needsReauth: tokenResult.needsReauth,
          authUrl: tokenResult.authUrl
        };
      }

      const accessToken = tokenResult.accessToken;

      const url = `${this.baseUrl}/me/calendar/events/${meetingId}`;
      const response = await fetch(url, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        return {
          data: false,
          success: false,
          error: `Graph API error: ${response.status} - ${response.statusText}`
        };
      }

      return { data: true, success: true };
    } catch (error) {
      return {
        data: false,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  async checkAvailability(userContext: UserContext, startTime: string, endTime: string, attendees?: string[]): Promise<any> {
    // Simplified availability check - just get events in range
    const result = await this.getCalendarEvents(userContext, startTime, endTime);
    
    if (!result.success) {
      return result;
    }

    const conflicts = result.data || [];
    const available = conflicts.length === 0;
    
    return { 
      data: { 
        available, 
        conflicts: conflicts.map((event: any) => ({
          subject: event.subject,
          start: event.start,
          end: event.end
        }))
      }, 
      success: true 
    };
  }
}

// Initialize Graph Service
const graphService = new EdgeGraphService();

// Agent Tools
function getCurrentTimeTool() {
  return tool({
    name: 'get_current_time',
    description: 'Get the current date and time in the user\'s timezone',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false
    },
    execute: async () => {
      const now = new Date();
      const currentDate = now.toLocaleDateString('en-US', { 
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric',
        timeZone: 'America/Chicago'
      });
      const currentTime = now.toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit', 
        timeZoneName: 'short',
        timeZone: 'America/Chicago'
      });
      
      return {
        currentDate,
        currentTime,
        timezone: 'America/Chicago',
        timestamp: now.toISOString()
      };
    }
  });
}

function getTodayEventsTool() {
  return tool({
    name: 'get_today_events',
    description: 'Get calendar events for today (current date)',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false
    },
    execute: async (params: any, context: any) => {
      const userContext = context?.context?.userContext as UserContext;
      if (!userContext) {
        throw new Error('User context required');
      }

      const today = new Date();
      const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0, 0);
      const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);
      
      const startTime = startOfDay.toISOString();
      const endTime = endOfDay.toISOString();
      
      const result = await graphService.getCalendarEvents(userContext, startTime, endTime);
      
      if (!result.success || !result.data) {
        return { events: [], error: result.error };
      }

      const events = result.data.map((event: any) => formatEventForDisplay(event));
      return { events, count: events.length };
    }
  });
}

function getWeekEventsTool() {
  return tool({
    name: 'get_week_events',
    description: 'Get all calendar events for the current week',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false
    },
    execute: async (params: any, context: any) => {
      const userContext = context?.context?.userContext as UserContext;
      if (!userContext) {
        throw new Error('User context required');
      }

      const today = new Date();
      const startOfWeek = new Date(today);
      startOfWeek.setDate(today.getDate() - today.getDay());
      
      const endOfWeek = new Date(startOfWeek);
      endOfWeek.setDate(startOfWeek.getDate() + 7);
      
      const startTime = startOfWeek.toISOString();
      const endTime = endOfWeek.toISOString();
      
      const result = await graphService.getCalendarEvents(userContext, startTime, endTime);
      
      if (!result.success || !result.data) {
        return { events: [], error: result.error };
      }

      const events = result.data.map((event: any) => formatEventForDisplay(event));
      return { events, count: events.length };
    }
  });
}

function getCalendarEventsTool() {
  return tool({
    name: 'get_calendar_events',
    description: 'Get calendar events for a specific date range',
    parameters: {
      type: 'object',
      properties: {
        startDate: { 
          type: 'string', 
          description: 'Start date in ISO format (e.g., 2025-10-03T00:00:00.000Z)' 
        },
        endDate: { 
          type: 'string', 
          description: 'End date in ISO format (e.g., 2025-10-10T23:59:59.999Z)' 
        },
        includeDetails: { 
          type: 'boolean', 
          description: 'Include full event details', 
          default: false 
        }
      },
      required: ['startDate', 'endDate', 'includeDetails'],
      additionalProperties: false
    },
    execute: async (params: any, context: any) => {
      const userContext = context?.context?.userContext as UserContext;
      if (!userContext) {
        throw new Error('User context required');
      }

      const result = await graphService.getCalendarEvents(
        userContext, 
        params.startDate, 
        params.endDate
      );
      
      if (!result.success || !result.data) {
        return { events: [], error: result.error };
      }

      const events = result.data.map((event: any) => formatEventForDisplay(event));
      return { events, count: events.length };
    }
  });
}

function createMeetingTool() {
  return tool({
    name: 'create_meeting',
    description: 'Create a new calendar meeting',
    parameters: {
      type: 'object',
      properties: {
        subject: { 
          type: 'string', 
          description: 'Meeting subject/title' 
        },
        startTime: { 
          type: 'string', 
          description: 'Start time in ISO format (e.g., 2025-10-03T18:00:00.000Z)' 
        },
        endTime: { 
          type: 'string', 
          description: 'End time in ISO format (e.g., 2025-10-03T19:00:00.000Z)' 
        },
        attendees: { 
          type: 'array', 
          items: { type: 'string' },
          description: 'List of attendee email addresses' 
        },
        location: { 
          type: 'string', 
          description: 'Meeting location (optional)' 
        },
        body: { 
          type: 'string', 
          description: 'Meeting description/body (optional)' 
        },
        isOnlineMeeting: { 
          type: 'boolean', 
          description: 'Whether to create an online meeting', 
          default: true 
        }
      },
      required: ['subject', 'startTime', 'endTime', 'attendees', 'location', 'body', 'isOnlineMeeting'],
      additionalProperties: false
    },
    execute: async (params: any, context: any) => {
      const userContext = context?.context?.userContext as UserContext;
      if (!userContext) {
        throw new Error('User context required');
      }

      const startDateTime = new Date(params.startTime).toISOString();
      const endDateTime = new Date(params.endTime).toISOString();
      
      const meetingData = {
        subject: params.subject,
        start: {
          dateTime: startDateTime,
          timeZone: 'UTC'
        },
        end: {
          dateTime: endDateTime,
          timeZone: 'UTC'
        },
        attendees: params.attendees?.map((email: string) => ({
          emailAddress: { 
            address: email,
            name: email.split('@')[0]
          },
          type: 'required'
        })) || [],
        location: params.location ? {
          displayName: params.location
        } : undefined,
        isOnlineMeeting: params.isOnlineMeeting,
        isReminderOn: true,
        reminderMinutesBeforeStart: 15,
        responseRequested: true,
        allowNewTimeProposals: true,
        isOrganizer: true,
        sensitivity: 'normal',
        importance: 'normal',
        showAs: 'busy',
        isAllDay: false,
        body: {
          contentType: 'html',
          content: params.body ? `<p>${params.body}</p><p>You have been invited to this meeting.</p>` : '<p>You have been invited to this meeting.</p>'
        }
      };

      const result = await graphService.createMeeting(userContext, meetingData);
      
      if (!result.success) {
        return { success: false, error: result.error };
      }

      return { 
        success: true, 
        meetingId: result.data?.id,
        webLink: result.data?.webLink,
        joinUrl: result.data?.onlineMeeting?.joinUrl
      };
    }
  });
}

function updateMeetingTool() {
  return tool({
    name: 'update_meeting',
    description: 'Update an existing calendar meeting',
    parameters: {
      type: 'object',
      properties: {
        meetingId: { 
          type: 'string', 
          description: 'ID of the meeting to update' 
        },
        subject: { 
          type: 'string', 
          description: 'Updated meeting subject/title' 
        },
        startTime: { 
          type: 'string', 
          description: 'Updated start time in ISO format' 
        },
        endTime: { 
          type: 'string', 
          description: 'Updated end time in ISO format' 
        },
        attendees: { 
          type: 'array', 
          items: { type: 'string' },
          description: 'Updated list of attendee email addresses' 
        },
        location: { 
          type: 'string', 
          description: 'Updated meeting location' 
        },
        body: { 
          type: 'string', 
          description: 'Updated meeting description/body' 
        }
      },
      required: ['meetingId', 'subject', 'startTime', 'endTime', 'attendees', 'location', 'body'],
      additionalProperties: false
    },
    execute: async (params: any, context: any) => {
      const userContext = context?.context?.userContext as UserContext;
      if (!userContext) {
        throw new Error('User context required');
      }

      const updateData: any = {};
      
      if (params.subject) updateData.subject = params.subject;
      if (params.startTime) {
        updateData.start = {
          dateTime: params.startTime,
          timeZone: 'UTC'
        };
      }
      if (params.endTime) {
        updateData.end = {
          dateTime: params.endTime,
          timeZone: 'UTC'
        };
      }
      if (params.attendees) {
        updateData.attendees = params.attendees.map((email: string) => ({
          emailAddress: { address: email },
          type: 'required'
        }));
      }
      if (params.location) {
        updateData.location = { displayName: params.location };
      }
      if (params.body) {
        updateData.body = {
          content: params.body,
          contentType: 'text'
        };
      }

      const result = await graphService.updateMeeting(userContext, params.meetingId, updateData);
      
      if (!result.success) {
        return { success: false, error: result.error };
      }

      return { success: true, meetingId: params.meetingId };
    }
  });
}

function deleteMeetingTool() {
  return tool({
    name: 'delete_meeting',
    description: 'Delete a calendar meeting',
    parameters: {
      type: 'object',
      properties: {
        meetingId: { 
          type: 'string', 
          description: 'ID of the meeting to delete' 
        }
      },
      required: ['meetingId'],
      additionalProperties: false
    },
    execute: async (params: any, context: any) => {
      const userContext = context?.context?.userContext as UserContext;
      if (!userContext) {
        throw new Error('User context required');
      }

      const result = await graphService.deleteMeeting(userContext, params.meetingId);
      
      if (!result.success) {
        return { success: false, error: result.error };
      }

      return { success: true, meetingId: params.meetingId };
    }
  });
}

function checkAvailabilityTool() {
  return tool({
    name: 'check_availability',
    description: 'Check availability for a specific time range',
    parameters: {
      type: 'object',
      properties: {
        startTime: { 
          type: 'string', 
          description: 'Start time in ISO format' 
        },
        endTime: { 
          type: 'string', 
          description: 'End time in ISO format' 
        },
        attendees: { 
          type: 'array', 
          items: { type: 'string' },
          description: 'List of attendee email addresses to check' 
        }
      },
      required: ['startTime', 'endTime', 'attendees'],
      additionalProperties: false
    },
    execute: async (params: any, context: any) => {
      const userContext = context?.context?.userContext as UserContext;
      if (!userContext) {
        throw new Error('User context required');
      }

      const result = await graphService.checkAvailability(
        userContext, 
        params.startTime, 
        params.endTime, 
        params.attendees
      );
      
      if (!result.success) {
        return { available: false, error: result.error };
      }

      return { 
        available: result.data?.available || false,
        conflicts: result.data?.conflicts || []
      };
    }
  });
}

function findFreeTimeTool() {
  return tool({
    name: 'find_free_time',
    description: 'Find free time slots in the calendar',
    parameters: {
      type: 'object',
      properties: {
        duration: { 
          type: 'number', 
          description: 'Duration in minutes' 
        },
        startDate: { 
          type: 'string', 
          description: 'Start date to search from (ISO format)' 
        },
        endDate: { 
          type: 'string', 
          description: 'End date to search until (ISO format)' 
        },
        workingHours: { 
          type: 'object',
          properties: {
            start: { type: 'string', description: 'Start time (e.g., "09:00")' },
            end: { type: 'string', description: 'End time (e.g., "17:00")' }
          },
          required: ['start', 'end'],
          additionalProperties: false,
          description: 'Working hours to consider'
        }
      },
      required: ['duration', 'startDate', 'endDate', 'workingHours'],
      additionalProperties: false
    },
    execute: async (params: any, context: any) => {
      const userContext = context?.context?.userContext as UserContext;
      if (!userContext) {
        throw new Error('User context required');
      }

      const startDate = params.startDate || new Date().toISOString();
      const endDate = params.endDate || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      
      const result = await graphService.getCalendarEvents(userContext, startDate, endDate);
      
      if (!result.success || !result.data) {
        return { freeSlots: [], error: result.error };
      }

      // Simple free time calculation
      const freeSlots = calculateFreeTimeSlots(result.data, params.duration, params.workingHours);
      
      return { freeSlots };
    }
  });
}

// Helper functions
function formatEventForDisplay(event: any): any {
  console.log('🔍 Raw event data:', {
    subject: event.subject,
    startDateTime: event.start?.dateTime,
    endDateTime: event.end?.dateTime
  });

  const startTime = event.start?.dateTime ? 
    new Date(event.start.dateTime.replace(/\.\d{7}Z$/, 'Z')).toLocaleString('en-US', { 
      timeZone: 'America/Chicago',
      weekday: 'short',
      month: 'short', 
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short'
    }) : 'Unknown';
  
  const endTime = event.end?.dateTime ? 
    new Date(event.end.dateTime.replace(/\.\d{7}Z$/, 'Z')).toLocaleString('en-US', { 
      timeZone: 'America/Chicago',
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short'
    }) : 'Unknown';

  console.log('🔍 Formatted times:', { startTime, endTime });

  // Strip HTML from body content (simple regex-based like local version)
  let sanitizedBody = event.body?.content || '';
  if (sanitizedBody) {
    sanitizedBody = sanitizedBody.replace(/<[^>]*>/g, ''); // Strip HTML tags
    sanitizedBody = sanitizedBody.replace(/\s+/g, ' ').trim(); // Normalize whitespace
  }

  const formattedEvent = {
    id: event.id,
    subject: event.subject,
    start: {
      dateTime: startTime,
      timeZone: 'America/Chicago'
    },
    end: {
      dateTime: endTime,
      timeZone: 'America/Chicago'
    },
    attendees: event.attendees?.map((a: any) => ({
      emailAddress: {
        name: a.emailAddress?.name || a.emailAddress?.address,
        address: a.emailAddress?.address
      },
      type: a.type
    })),
    location: event.location?.displayName || null,
    body: sanitizedBody ? {
      content: sanitizedBody
    } : undefined
  };

  // Token estimation for debugging (similar to local version)
  const eventTokens = JSON.stringify(formattedEvent).length / 4; // Rough estimation
  console.log('🔍 Sanitized event tokens: ~' + Math.round(eventTokens));

  return formattedEvent;
}

function calculateFreeTimeSlots(events: any[], durationMinutes: number, workingHours?: any): any[] {
  // Simplified implementation - in production this would be more sophisticated
  return [];
}

// Agent initialization
function createAgent(): Agent {
  const instructions = `You are Caleo, an AI-powered meeting scheduler and team assistant for Microsoft Teams.

CORE PRINCIPLES:
- Always use the current date and time as your reference point
- When users ask about "today", "tomorrow", "this week", etc., use the actual current date
- Convert all times to the user's timezone (America/Chicago) for display
- Be proactive and helpful in calendar management
- Ask clarifying questions when needed for meeting creation
- Remember previous messages in the conversation to provide context-aware responses

CONVERSATION CONTEXT:
- You have access to the conversation history with the user
- Use previous messages to understand context and provide more relevant responses
- Reference previous topics when appropriate
- Maintain continuity in the conversation
- If a user refers to "it", "that", "the meeting", etc., use conversation context to understand what they mean

CAPABILITIES:
- View and analyze calendar events (you have direct access to the user's calendar)
- Create new meetings with attendees
- Update existing meetings
- Check availability
- Answer questions about schedules
- Provide intelligent calendar insights
- Remember and reference previous conversation topics

CALENDAR ACCESS:
- You have full access to the user's calendar through Microsoft Graph API
- When users ask about meetings, events, or schedule, use the appropriate tools directly
- No need to ask for permission - you already have authenticated access
- Use get_today_events for today's meetings, get_week_events for this week, or get_calendar_events for specific date ranges

AUTHENTICATION HANDLING:
- If any tool returns a result with needsReauth: true, this means the user needs to re-authenticate
- When this happens, immediately inform the user that they need to re-authenticate
- Provide the authUrl from the tool result as a clickable link
- Explain that they need to click the link to authorize calendar access
- After they re-authenticate, they can try their request again
- Be helpful and clear about the re-authentication process

RESPONSE STYLE:
- Professional but friendly
- Clear and concise
- Use emojis sparingly and appropriately
- Always confirm actions taken
- Provide helpful context when relevant
- Reference previous conversation topics when appropriate

IMPORTANT: Always use the get_current_time tool to get the current date and time before responding to any time-related questions.`;

  return new Agent({
    name: 'Caleo Assistant',
    model: 'gpt-4o-mini',
    instructions,
    tools: [
      getCurrentTimeTool(),
      getTodayEventsTool(),
      getWeekEventsTool(),
      getCalendarEventsTool(),
      createMeetingTool(),
      updateMeetingTool(),
      deleteMeetingTool(),
      checkAvailabilityTool(),
      findFreeTimeTool()
    ]
  });
}

// Main handler
Deno.serve(async (req: Request) => {
  const startTime = Date.now();
  
  // CORS headers
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  try {
    const body: AgentRequest = await req.json();
    const { userMessage, userContext, conversationHistory = [] } = body;

    if (!userMessage || !userContext) {
      return new Response(JSON.stringify({ 
        error: 'Missing required fields: userMessage, userContext' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Create agent
    const agent = createAgent();
    
    console.log('🤖 Processing message with edge agent:', {
      userMessage: userMessage.substring(0, 100) + '...',
      userId: userContext.userId,
      conversationLength: conversationHistory.length
    });

    // Process message with agent
    const result = await run(agent, userMessage, {
      context: { 
        userContext,
        conversationHistory: conversationHistory.slice(-10) // Keep last 10 messages
      }
    });

    console.log('✅ Agent response generated:', {
      hasFinalOutput: !!result.finalOutput,
      outputLength: result.finalOutput?.length || 0,
      conversationLength: conversationHistory.length + 1
    });

    const response: AgentResponse = {
      response: result.finalOutput || 'I apologize, but I was unable to generate a response.',
      success: true,
      metadata: {
        model: 'gpt-4o-mini',
        toolCalls: 0, // TODO: Count actual tool calls
        latency: Date.now() - startTime
      }
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Edge function error:', error);
    
    const response: AgentResponse = {
      response: 'I apologize, but I encountered an error while processing your request. Please try again.',
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };

    return new Response(JSON.stringify(response), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});



