-- Public v1 API jobs need to record which API key created them, so
-- GET /api/v1/crawl/:jobId can enforce that a caller only ever reads
-- their own job's data. Confirmed missing entirely in an app audit: any
-- valid API key could previously read any other customer's crawl results
-- by guessing/incrementing job ids - the query had no ownership filter
-- of any kind.
--
-- Nullable and left unbacked for rows already in the table: pre-existing
-- public API jobs (whose original caller can no longer be attributed) and
-- every internally-triggered crawl/recheck/kickio_sync job (never tied to
-- an API key at all - those come from the admin UI or the workers
-- themselves, not a v1 API call). Both cases simply never match any real
-- key from here on, which is the correct, safe default: a public-facing
-- job-lookup endpoint should never serve up a job nobody can prove they
-- own, rather than falling back to "allow it because we don't know".
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS api_key_id uuid REFERENCES api_keys(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_api_key_id ON jobs(api_key_id) WHERE api_key_id IS NOT NULL;
