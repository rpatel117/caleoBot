import pool from './client';
import { AGENT_CONFIG } from '../agent/config';
import { MonthlyUsage } from '../billing/plans';

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

  // ---------- Preferences ----------

  async getPreferences(userId: string): Promise<any> {
    const result = await pool.query(
      `SELECT * FROM user_preferences WHERE user_id = $1`,
      [userId]
    );
    if (result.rows[0]) return result.rows[0];
    // Return defaults if no row exists
    return {
      user_id: userId,
      work_hours_start: '09:00',
      work_hours_end: '17:00',
      default_duration_minutes: 30,
      buffer_minutes: 0,
      preferred_provider: null,
    };
  }

  async updatePreferences(userId: string, updates: Record<string, any>): Promise<any> {
    // Build SET clause dynamically from provided updates
    const columns = ['user_id'];
    const values: any[] = [userId];
    const placeholders = ['$1'];
    const setClauses: string[] = ['updated_at = now()'];
    let idx = 2;

    const allowedFields = ['work_hours_start', 'work_hours_end', 'default_duration_minutes', 'buffer_minutes', 'preferred_provider'];

    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        columns.push(field);
        values.push(updates[field]);
        placeholders.push(`$${idx}`);
        setClauses.push(`${field} = $${idx}`);
        idx++;
      }
    }

    const result = await pool.query(
      `INSERT INTO user_preferences (${columns.join(', ')})
       VALUES (${placeholders.join(', ')})
       ON CONFLICT (user_id) DO UPDATE SET ${setClauses.join(', ')}
       RETURNING *`,
      values
    );
    return result.rows[0];
  }

  // ---------- Balances ----------

  async getBalance(userId: string): Promise<{ balance_cents: number; lifetime_spent_cents: number }> {
    const result = await pool.query(
      `SELECT * FROM user_balances WHERE user_id = $1`,
      [userId]
    );
    if (result.rows[0]) {
      return {
        balance_cents: result.rows[0].balance_cents,
        lifetime_spent_cents: result.rows[0].lifetime_spent_cents,
      };
    }
    // Auto-create row with $1.00 free starting balance
    const inserted = await pool.query(
      `INSERT INTO user_balances (user_id, balance_cents, lifetime_spent_cents)
       VALUES ($1, 100, 0)
       ON CONFLICT (user_id) DO NOTHING
       RETURNING *`,
      [userId]
    );
    if (inserted.rows[0]) {
      return {
        balance_cents: inserted.rows[0].balance_cents,
        lifetime_spent_cents: inserted.rows[0].lifetime_spent_cents,
      };
    }
    // Race condition: another process inserted — re-read
    const reread = await pool.query(
      `SELECT * FROM user_balances WHERE user_id = $1`,
      [userId]
    );
    return {
      balance_cents: reread.rows[0]?.balance_cents ?? 100,
      lifetime_spent_cents: reread.rows[0]?.lifetime_spent_cents ?? 0,
    };
  }

  async creditBalance(userId: string, amountCents: number): Promise<void> {
    await pool.query(
      `INSERT INTO user_balances (user_id, balance_cents, lifetime_spent_cents)
       VALUES ($1, 100 + $2, 0)
       ON CONFLICT (user_id) DO UPDATE
       SET balance_cents = user_balances.balance_cents + $2,
           updated_at = now()`,
      [userId, amountCents]
    );
  }

  /**
   * Atomically deduct balance only if sufficient funds exist.
   * Returns true if deduction succeeded, false if insufficient balance.
   */
  async deductBalance(userId: string, amountCents: number): Promise<boolean> {
    const rounded = Math.ceil(amountCents);
    const result = await pool.query(
      `UPDATE user_balances
       SET balance_cents = balance_cents - $2,
           lifetime_spent_cents = lifetime_spent_cents + $2,
           updated_at = now()
       WHERE user_id = $1 AND balance_cents >= $2
       RETURNING balance_cents`,
      [userId, rounded]
    );
    return result.rowCount !== null && result.rowCount > 0;
  }

  // ---------- Usage logs ----------

  async createUsageLog(params: {
    userId: string;
    conversationId: string;
    inputTokens: number;
    outputTokens: number;
    costCents: number;
    toolIterations: number;
  }): Promise<any> {
    const result = await pool.query(
      `INSERT INTO usage_logs (user_id, conversation_id, input_tokens, output_tokens, cost_cents, tool_iterations)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [params.userId, params.conversationId, params.inputTokens, params.outputTokens, params.costCents, params.toolIterations]
    );
    return result.rows[0];
  }

  // ---------- Stripe event idempotency ----------

  async checkStripeEventProcessed(stripeEventId: string): Promise<boolean> {
    const result = await pool.query(
      `SELECT id FROM stripe_events WHERE stripe_event_id = $1`,
      [stripeEventId]
    );
    return result.rows.length > 0;
  }

  async markStripeEventProcessed(stripeEventId: string, eventType: string, userId: string, amountCents: number): Promise<void> {
    await pool.query(
      `INSERT INTO stripe_events (stripe_event_id, event_type, user_id, amount_cents)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (stripe_event_id) DO NOTHING`,
      [stripeEventId, eventType, userId, amountCents]
    );
  }

  /** Atomic credit + dedup: inserts stripe event and credits balance in one transaction. Returns true if credited. */
  async creditBalanceIfNotProcessed(stripeEventId: string, eventType: string, userId: string, amountCents: number): Promise<boolean> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query(
        `INSERT INTO stripe_events (stripe_event_id, event_type, user_id, amount_cents)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (stripe_event_id) DO NOTHING
         RETURNING id`,
        [stripeEventId, eventType, userId, amountCents]
      );
      if (inserted.rows.length === 0) {
        await client.query('ROLLBACK');
        return false;
      }
      await client.query(
        `UPDATE user_balances SET balance_cents = balance_cents + $2, updated_at = NOW()
         WHERE user_id = $1`,
        [userId, amountCents]
      );
      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // ---------- User type & workspace plan ----------

  async getUserType(userId: string): Promise<string> {
    const result = await pool.query(
      `SELECT user_type FROM users WHERE id = $1`,
      [userId]
    );
    return result.rows[0]?.user_type || 'member';
  }

  async getWorkspacePlan(workspaceId: string): Promise<string> {
    const result = await pool.query(
      `SELECT plan FROM workspaces WHERE id = $1`,
      [workspaceId]
    );
    return result.rows[0]?.plan || 'free';
  }

  // ---------- Workspace usage ----------

  /**
   * Atomically increment a usage counter and return the new value.
   */
  async incrementUsage(workspaceId: string, action: 'meeting_created' | 'meeting_updated' | 'meeting_deleted' | 'message_sent'): Promise<number> {
    const now = new Date();
    const period = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;

    const columnMap: Record<string, string> = {
      meeting_created: 'meetings_created',
      meeting_updated: 'meetings_updated',
      meeting_deleted: 'meetings_deleted',
      message_sent: 'messages_sent',
    };
    const column = columnMap[action];

    const result = await pool.query(
      `INSERT INTO workspace_usage (workspace_id, period, ${column})
       VALUES ($1, $2, 1)
       ON CONFLICT (workspace_id, period) DO UPDATE
       SET ${column} = workspace_usage.${column} + 1,
           updated_at = now()
       RETURNING ${column}`,
      [workspaceId, period]
    );
    return result.rows[0]?.[column] ?? 1;
  }

  /**
   * Atomically increment usage and check against a limit in one operation.
   * Returns { allowed: true, newCount } if within limit, { allowed: false, newCount } if limit reached.
   * When not allowed, the increment is NOT applied (uses a CTE to check first).
   */
  async incrementUsageWithLimit(
    workspaceId: string,
    action: 'meeting_created' | 'message_sent',
    limit: number
  ): Promise<{ allowed: boolean; newCount: number }> {
    // -1 means unlimited
    if (limit === -1) {
      const newCount = await this.incrementUsage(workspaceId, action);
      return { allowed: true, newCount };
    }

    const now = new Date();
    const period = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;

    const columnMap: Record<string, string> = {
      meeting_created: 'meetings_created',
      message_sent: 'messages_sent',
    };
    const column = columnMap[action];

    // Atomic: only increment if current count < limit
    const result = await pool.query(
      `WITH current AS (
        SELECT ${column} as cnt
        FROM workspace_usage
        WHERE workspace_id = $1 AND period = $2
      ),
      upserted AS (
        INSERT INTO workspace_usage (workspace_id, period, ${column})
        VALUES ($1, $2, 1)
        ON CONFLICT (workspace_id, period) DO UPDATE
        SET ${column} = workspace_usage.${column} + 1,
            updated_at = now()
        WHERE workspace_usage.${column} < $3
        RETURNING ${column}
      )
      SELECT
        COALESCE((SELECT ${column} FROM upserted), (SELECT cnt FROM current), 0) as count,
        EXISTS(SELECT 1 FROM upserted) as did_increment`,
      [workspaceId, period, limit]
    );

    const row = result.rows[0];
    const newCount = parseInt(row?.count ?? '0', 10);
    const didIncrement = row?.did_increment ?? false;

    return { allowed: didIncrement, newCount };
  }

  async getMonthlyUsage(workspaceId: string): Promise<MonthlyUsage> {
    const now = new Date();
    const period = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;

    const result = await pool.query(
      `SELECT meetings_created, meetings_updated, meetings_deleted, messages_sent
       FROM workspace_usage
       WHERE workspace_id = $1 AND period = $2`,
      [workspaceId, period]
    );

    if (result.rows[0]) {
      return {
        meetingsCreated: result.rows[0].meetings_created,
        meetingsUpdated: result.rows[0].meetings_updated,
        meetingsDeleted: result.rows[0].meetings_deleted,
        messagesSent: result.rows[0].messages_sent,
      };
    }
    return { meetingsCreated: 0, meetingsUpdated: 0, meetingsDeleted: 0, messagesSent: 0 };
  }

  // ---------- Cross-org lookups ----------

  /**
   * Look up attendee emails across ALL workspaces, returning which are Caleo users
   * and what calendar providers they have connected.
   */
  async findCaleoUsersByEmails(emails: string[]): Promise<Array<{
    email: string;
    dbUserId: string;
    displayName: string | null;
    timezone: string;
    providers: Array<'google' | 'microsoft'>;
  }>> {
    if (emails.length === 0) return [];
    const normalized = emails.map(e => e.toLowerCase());

    const result = await pool.query(
      `SELECT u.id AS db_user_id, u.email, u.display_name, u.timezone,
              COALESCE(array_agg(DISTINCT ot.provider) FILTER (WHERE ot.provider IS NOT NULL), '{}') AS providers
       FROM users u
       LEFT JOIN oauth_tokens ot ON ot.user_id = u.id
       WHERE LOWER(u.email) = ANY($1)
       GROUP BY u.id, u.email, u.display_name, u.timezone`,
      [normalized]
    );

    return result.rows.map((row: any) => ({
      email: row.email,
      dbUserId: row.db_user_id,
      displayName: row.display_name,
      timezone: row.timezone,
      providers: row.providers.filter((p: string) => p === 'google' || p === 'microsoft'),
    }));
  }

  /**
   * Search Caleo users by name or email across all workspaces.
   * Used by search_people to find cross-org contacts.
   */
  async searchUsersByName(query: string, limit: number = 5): Promise<any[]> {
    const result = await pool.query(
      `SELECT DISTINCT ON (LOWER(email)) display_name, email
       FROM users
       WHERE email IS NOT NULL AND email NOT LIKE '%@slack.local'
         AND (LOWER(display_name) LIKE $1 OR LOWER(email) LIKE $1)
       ORDER BY LOWER(email), created_at DESC
       LIMIT $2`,
      [`%${query.toLowerCase()}%`, limit]
    );
    return result.rows;
  }

  // ---------- User settings (ambient features) ----------

  async getUserSettings(userId: string): Promise<any> {
    const result = await pool.query(
      `SELECT * FROM user_settings WHERE user_id = $1`,
      [userId]
    );
    if (result.rows[0]) return result.rows[0];
    return {
      user_id: userId,
      status_sync_enabled: false,
      show_event_titles: false,
      dnd_during_focus: false,
      daily_briefing_enabled: true,
      daily_briefing_time: '08:30',
      focus_time_goal_hours: 0,
      no_meeting_days: [],
    };
  }

  async updateUserSettings(userId: string, updates: Record<string, any>): Promise<any> {
    const columns = ['user_id'];
    const values: any[] = [userId];
    const placeholders = ['$1'];
    const setClauses: string[] = ['updated_at = now()'];
    let idx = 2;

    const allowedFields = [
      'status_sync_enabled', 'show_event_titles', 'dnd_during_focus',
      'daily_briefing_enabled', 'daily_briefing_time', 'focus_time_goal_hours',
      'no_meeting_days',
    ];

    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        columns.push(field);
        values.push(updates[field]);
        placeholders.push(`$${idx}`);
        setClauses.push(`${field} = $${idx}`);
        idx++;
      }
    }

    const result = await pool.query(
      `INSERT INTO user_settings (${columns.join(', ')})
       VALUES (${placeholders.join(', ')})
       ON CONFLICT (user_id) DO UPDATE SET ${setClauses.join(', ')}
       RETURNING *`,
      values
    );
    return result.rows[0];
  }

  async getActiveStatusSyncUsers(): Promise<any[]> {
    const result = await pool.query(
      `SELECT us.*, u.external_id AS slack_user_id, u.timezone, u.id AS db_user_id
       FROM user_settings us
       JOIN users u ON u.id = us.user_id
       WHERE us.status_sync_enabled = true`
    );
    return result.rows;
  }

  async getBriefingUsers(timeStr: string): Promise<any[]> {
    const result = await pool.query(
      `SELECT us.*, u.external_id AS slack_user_id, u.timezone, u.display_name, u.id AS db_user_id
       FROM user_settings us
       JOIN users u ON u.id = us.user_id
       WHERE us.daily_briefing_enabled = true AND us.daily_briefing_time = $1`,
      [timeStr]
    );
    return result.rows;
  }

  // ---------- Audit log ----------

  async logAction(params: {
    userId: string;
    action: string;
    eventId?: string;
    provider?: string;
    details?: Record<string, any>;
    slackChannel?: string;
    slackThreadTs?: string;
  }): Promise<any> {
    const result = await pool.query(
      `INSERT INTO audit_log (user_id, action, event_id, provider, details, slack_channel, slack_thread_ts)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        params.userId, params.action, params.eventId || null,
        params.provider || null, params.details ? JSON.stringify(params.details) : null,
        params.slackChannel || null, params.slackThreadTs || null,
      ]
    );
    return result.rows[0];
  }

  async getAuditLog(userId: string, limit: number = 20): Promise<any[]> {
    const result = await pool.query(
      `SELECT * FROM audit_log WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [userId, limit]
    );
    return result.rows;
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
