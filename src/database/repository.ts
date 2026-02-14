import pool from './client';
import { AGENT_CONFIG } from '../agent/config';

export class Repository {
  // Workspace operations
  async getOrCreateWorkspace(platform: string, externalId: string, name?: string): Promise<any> {
    const result = await pool.query(
      `INSERT INTO workspaces (platform, external_id, name)
       VALUES ($1, $2, $3)
       ON CONFLICT (platform, external_id) DO UPDATE SET name = COALESCE($3, workspaces.name)
       RETURNING *`,
      [platform, externalId, name]
    );
    return result.rows[0];
  }

  // User operations
  async createUser(workspaceId: string, externalId: string, displayName?: string, email?: string, timezone?: string): Promise<any> {
    const result = await pool.query(
      `INSERT INTO users (workspace_id, external_id, display_name, email, timezone)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (workspace_id, external_id) DO UPDATE
       SET display_name = COALESCE($3, users.display_name),
           email = COALESCE($4, users.email),
           timezone = COALESCE($5, users.timezone)
       RETURNING *`,
      [workspaceId, externalId, displayName, email, timezone || 'America/Chicago']
    );
    return result.rows[0];
  }

  async getUserByExternalId(workspaceId: string, externalId: string): Promise<any> {
    const result = await pool.query(
      `SELECT * FROM users WHERE workspace_id = $1 AND external_id = $2`,
      [workspaceId, externalId]
    );
    return result.rows[0] || null;
  }

  async getUserById(userId: string): Promise<any> {
    const result = await pool.query(
      `SELECT * FROM users WHERE id = $1`,
      [userId]
    );
    return result.rows[0] || null;
  }

  // Token operations
  async storeToken(
    userId: string,
    provider: string,
    accessToken: string,
    expiresAt: Date,
    scopes: string[],
    refreshToken?: string
  ): Promise<any> {
    const result = await pool.query(
      `INSERT INTO oauth_tokens (user_id, provider, access_token, refresh_token, scopes, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id, provider) DO UPDATE
       SET access_token = $3,
           refresh_token = COALESCE($4, oauth_tokens.refresh_token),
           scopes = $5,
           expires_at = $6,
           updated_at = now()
       RETURNING *`,
      [userId, provider, accessToken, refreshToken, scopes, expiresAt.toISOString()]
    );
    return result.rows[0];
  }

  async getToken(userId: string, provider: string): Promise<any> {
    const result = await pool.query(
      `SELECT * FROM oauth_tokens WHERE user_id = $1 AND provider = $2`,
      [userId, provider]
    );
    return result.rows[0] || null;
  }

  async getTokensByUser(userId: string): Promise<any[]> {
    const result = await pool.query(
      `SELECT * FROM oauth_tokens WHERE user_id = $1`,
      [userId]
    );
    return result.rows;
  }

  async updateToken(userId: string, provider: string, updates: {
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: Date;
    scopes?: string[];
  }): Promise<any> {
    const setClauses: string[] = ['updated_at = now()'];
    const values: any[] = [];
    let paramIndex = 1;

    if (updates.accessToken !== undefined) {
      setClauses.push(`access_token = $${paramIndex++}`);
      values.push(updates.accessToken);
    }
    if (updates.refreshToken !== undefined) {
      setClauses.push(`refresh_token = $${paramIndex++}`);
      values.push(updates.refreshToken);
    }
    if (updates.expiresAt !== undefined) {
      setClauses.push(`expires_at = $${paramIndex++}`);
      values.push(updates.expiresAt.toISOString());
    }
    if (updates.scopes !== undefined) {
      setClauses.push(`scopes = $${paramIndex++}`);
      values.push(updates.scopes);
    }

    values.push(userId, provider);

    const result = await pool.query(
      `UPDATE oauth_tokens SET ${setClauses.join(', ')}
       WHERE user_id = $${paramIndex++} AND provider = $${paramIndex}
       RETURNING *`,
      values
    );
    return result.rows[0] || null;
  }

  async deleteToken(userId: string, provider: string): Promise<void> {
    await pool.query(
      `DELETE FROM oauth_tokens WHERE user_id = $1 AND provider = $2`,
      [userId, provider]
    );
  }

  // Conversation operations
  async getOrCreateConversation(userId: string, channelId: string, threadTs?: string): Promise<any> {
    // Try to find existing conversation
    const existing = await pool.query(
      `SELECT * FROM conversations
       WHERE user_id = $1 AND channel_id = $2 AND thread_ts IS NOT DISTINCT FROM $3
       ORDER BY created_at DESC LIMIT 1`,
      [userId, channelId, threadTs || null]
    );

    if (existing.rows[0]) {
      // Check if the session has timed out based on last message
      const lastMsg = await pool.query(
        `SELECT created_at FROM messages
         WHERE conversation_id = $1
         ORDER BY created_at DESC LIMIT 1`,
        [existing.rows[0].id]
      );

      const timeoutMs = AGENT_CONFIG.sessionTimeoutMinutes * 60 * 1000;
      const isStale = lastMsg.rows[0] &&
        (Date.now() - new Date(lastMsg.rows[0].created_at).getTime()) > timeoutMs;

      if (!isStale) {
        return existing.rows[0];
      }
    }

    const result = await pool.query(
      `INSERT INTO conversations (user_id, channel_id, thread_ts)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [userId, channelId, threadTs || null]
    );
    return result.rows[0];
  }

  // Message operations
  async createMessage(conversationId: string, role: string, content: string): Promise<any> {
    const result = await pool.query(
      `INSERT INTO messages (conversation_id, role, content)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [conversationId, role, content]
    );
    return result.rows[0];
  }

  async getMessages(conversationId: string, limit: number = 20): Promise<any[]> {
    const result = await pool.query(
      `SELECT * FROM messages
       WHERE conversation_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [conversationId, limit]
    );
    return result.rows.reverse();
  }

  // Health check
  async testConnection(): Promise<boolean> {
    try {
      await pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }
}

export const repository = new Repository();
