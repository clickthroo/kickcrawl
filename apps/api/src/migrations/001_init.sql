CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS sites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  base_url text NOT NULL UNIQUE,
  rate_limit_rps numeric NOT NULL DEFAULT 1,
  max_depth integer NOT NULL DEFAULT 2,
  use_browser_default boolean NOT NULL DEFAULT false,
  use_proxy boolean NOT NULL DEFAULT false,
  default_selectors jsonb NOT NULL DEFAULT '{}',
  allowed_paths text[] DEFAULT ARRAY[]::text[],
  denied_paths text[] DEFAULT ARRAY[]::text[],
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS urls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  url text NOT NULL,
  path text NOT NULL,
  status text NOT NULL DEFAULT 'discovered' CHECK (status IN ('discovered','queued','fetched','failed')),
  last_fetched_at timestamptz,
  last_status_code integer,
  last_error text,
  discovered_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(site_id, url)
);

CREATE TABLE IF NOT EXISTS jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid REFERENCES sites(id) ON DELETE SET NULL,
  type text NOT NULL CHECK (type IN ('scrape','map','crawl','extract')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','completed','failed','cancelled')),
  payload jsonb NOT NULL DEFAULT '{}',
  total_pages integer DEFAULT 0,
  completed_pages integer DEFAULT 0,
  error_count integer DEFAULT 0,
  errors jsonb DEFAULT '[]',
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  key_preview text NOT NULL,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scrape_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  url_id uuid NOT NULL REFERENCES urls(id) ON DELETE CASCADE,
  job_id uuid REFERENCES jobs(id) ON DELETE SET NULL,
  format text NOT NULL CHECK (format IN ('markdown','html','links','screenshot','extracted')),
  content jsonb NOT NULL,
  status_code integer,
  fetched_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_urls_site_status ON urls(site_id, status);
CREATE INDEX IF NOT EXISTS idx_urls_site_path ON urls(site_id, path);
CREATE INDEX IF NOT EXISTS idx_jobs_status_created ON jobs(status, created_at);
CREATE INDEX IF NOT EXISTS idx_scrape_results_url_format ON scrape_results(url_id, format);
