-- Caleo Database Schema
-- Run with: psql $DATABASE_URL -f src/database/schema.sql

CREATE TABLE IF NOT EXISTS workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform VARCHAR(20) NOT NULL,
  external_id VARCHAR(255) NOT NULL,
  name VARCHAR(255),
  plan VARCHAR(20) DEFAULT 'free',
  stripe_customer_id VARCHAR(255),
  stripe_subscription_id VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(platform, external_id)
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id),
  external_id VARCHAR(255) NOT NULL,
  display_name VARCHAR(255),
  email VARCHAR(255),
  timezone VARCHAR(100) DEFAULT 'America/Chicago',
  user_type VARCHAR(20) DEFAULT 'member',
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(workspace_id, external_id)
);

CREATE TABLE IF NOT EXISTS oauth_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  provider VARCHAR(20) NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  scopes TEXT[],
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, provider)
);

CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  channel_id VARCHAR(255),
  thread_ts VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES conversations(id),
  role VARCHAR(20) NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- User preferences (work hours, defaults, etc.)
CREATE TABLE IF NOT EXISTS user_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) UNIQUE,
  work_hours_start VARCHAR(10) DEFAULT '09:00',
  work_hours_end VARCHAR(10) DEFAULT '17:00',
  default_duration_minutes INTEGER DEFAULT 30,
  buffer_minutes INTEGER DEFAULT 0,
  preferred_provider VARCHAR(20),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- User billing balances
CREATE TABLE IF NOT EXISTS user_balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) UNIQUE,
  balance_cents INTEGER DEFAULT 100,
  lifetime_spent_cents INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Per-conversation usage logs
CREATE TABLE IF NOT EXISTS usage_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  conversation_id UUID REFERENCES conversations(id),
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cost_cents NUMERIC(10,4) NOT NULL,
  tool_iterations INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Stripe event idempotency
CREATE TABLE IF NOT EXISTS stripe_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id VARCHAR(255) UNIQUE NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  user_id UUID REFERENCES users(id),
  amount_cents INTEGER,
  processed_at TIMESTAMPTZ DEFAULT now()
);

-- Workspace usage tracking (plan-based limits)
CREATE TABLE IF NOT EXISTS workspace_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id),
  period VARCHAR(7) NOT NULL,
  meetings_created INTEGER DEFAULT 0,
  meetings_updated INTEGER DEFAULT 0,
  meetings_deleted INTEGER DEFAULT 0,
  messages_sent INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(workspace_id, period)
);
CREATE INDEX IF NOT EXISTS idx_workspace_usage_ws_period ON workspace_usage(workspace_id, period);

CREATE INDEX IF NOT EXISTS idx_users_external_id ON users(external_id);
CREATE INDEX IF NOT EXISTS idx_oauth_tokens_user_provider ON oauth_tokens(user_id, provider);
CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_usage_logs_user_id ON usage_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_stripe_events_stripe_id ON stripe_events(stripe_event_id);

-- User settings (ambient features: status sync, daily briefing, focus time, etc.)
CREATE TABLE IF NOT EXISTS user_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  status_sync_enabled BOOLEAN DEFAULT false,
  show_event_titles BOOLEAN DEFAULT false,
  dnd_during_focus BOOLEAN DEFAULT false,
  daily_briefing_enabled BOOLEAN DEFAULT true,
  daily_briefing_time VARCHAR(5) DEFAULT '08:30',
  focus_time_goal_hours INTEGER DEFAULT 0,
  no_meeting_days INTEGER[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

-- Audit log for calendar modifications
CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  action VARCHAR(50) NOT NULL,
  event_id VARCHAR(500),
  provider VARCHAR(20),
  details JSONB,
  slack_channel VARCHAR(50),
  slack_thread_ts VARCHAR(50),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id, created_at DESC);

-- Undo state (DB-backed, replaces in-memory store for Lambda compatibility)
CREATE TABLE IF NOT EXISTS undo_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  channel_id VARCHAR(255) NOT NULL,
  action VARCHAR(20) NOT NULL,
  event_id VARCHAR(500) NOT NULL,
  provider VARCHAR(20) NOT NULL,
  previous_state JSONB,
  created_event JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_undo_state_user_channel ON undo_state(user_id, channel_id);

-- Rate limiting (database-backed for multi-instance consistency)
CREATE TABLE IF NOT EXISTS rate_limit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rate_limit_key_time ON rate_limit_events(key, created_at DESC);

-- Cross-workspace email lookup (case-insensitive) for cross-org meeting support
-- In production, use CREATE INDEX CONCURRENTLY to avoid table locks
CREATE INDEX IF NOT EXISTS idx_users_email_lower ON users(LOWER(email));

-- ============================================================
-- Row-Level Security (RLS) Policies
-- IMPORTANT: Phase 1 + Phase 2 combined — FORCE is required
-- because caleo_admin is the table owner and would bypass
-- RLS policies without it.
--
-- Application code MUST call set_app_context() before each
-- query to set transaction-local session variables.
-- Without set_app_context(), queries return zero rows.
-- ============================================================

-- Helper function to set transaction-local app context
CREATE OR REPLACE FUNCTION set_app_context(p_workspace_id TEXT, p_user_id TEXT)
RETURNS VOID AS $$
BEGIN
  PERFORM set_config('app.workspace_id', p_workspace_id, true);
  PERFORM set_config('app.user_id', p_user_id, true);
END;
$$ LANGUAGE plpgsql;

-- Users: scoped by workspace_id
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS users_workspace_policy ON users;
CREATE POLICY users_workspace_policy ON users
  USING (workspace_id::text = current_setting('app.workspace_id', true));

-- OAuth tokens: scoped by user_id
ALTER TABLE oauth_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE oauth_tokens FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS oauth_tokens_user_policy ON oauth_tokens;
CREATE POLICY oauth_tokens_user_policy ON oauth_tokens
  USING (user_id::text = current_setting('app.user_id', true));

-- Conversations: scoped by user_id
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS conversations_user_policy ON conversations;
CREATE POLICY conversations_user_policy ON conversations
  USING (user_id::text = current_setting('app.user_id', true));

-- Messages: scoped by conversation ownership (user_id via conversation)
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS messages_user_policy ON messages;
CREATE POLICY messages_user_policy ON messages
  USING (conversation_id IN (
    SELECT id FROM conversations
    WHERE user_id::text = current_setting('app.user_id', true)
  ));

-- User settings: scoped by user_id
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_settings_user_policy ON user_settings;
CREATE POLICY user_settings_user_policy ON user_settings
  USING (user_id::text = current_setting('app.user_id', true));
