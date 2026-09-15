-- Cache for /api/v1/extract results, keyed by URL + schema so a repeated
-- extract call within 24h skips re-fetching/re-calling the LLM.
CREATE TABLE IF NOT EXISTS extract_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  url text NOT NULL,
  schema_hash text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(url, schema_hash)
);

CREATE INDEX IF NOT EXISTS idx_extract_cache_created ON extract_cache(created_at);

-- Admin dashboard login. Bootstrapped from ADMIN_EMAIL/ADMIN_PASSWORD_HASH on
-- startup if the table is empty; managed thereafter via this table.
CREATE TABLE IF NOT EXISTS admin_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Global settings singleton row, edited from the Settings admin page.
CREATE TABLE IF NOT EXISTS settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  global_rate_limit_rps numeric NOT NULL DEFAULT 2,
  default_user_agent text NOT NULL DEFAULT 'KickioBot/1.0 (+https://kickio.com/bot)',
  proxy_url text,
  llm_provider text NOT NULL DEFAULT 'openai',
  llm_model text NOT NULL DEFAULT 'gpt-4o-mini',
  notification_email text,
  webhook_url text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
