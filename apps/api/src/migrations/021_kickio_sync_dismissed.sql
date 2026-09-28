-- Lets an admin permanently exclude a sale from Kickio sync (both the
-- hourly worker and the manual "retry all" recovery sweep) without ever
-- faking a success - some listings genuinely shouldn't be sent (a
-- one-off/novelty item Kickio's catalog has no home for, a listing whose
-- team can never be resolved, ...), and previously the only way to make
-- "Stuck" go away for one of those was to keep clicking Retry forever.
-- A timestamp (not a plain boolean) so the admin UI can show when and
-- - same reasoning as kickio_synced_at - support undoing it cleanly by
-- just clearing it back to null.
ALTER TABLE sales ADD COLUMN IF NOT EXISTS kickio_sync_dismissed_at timestamptz;
