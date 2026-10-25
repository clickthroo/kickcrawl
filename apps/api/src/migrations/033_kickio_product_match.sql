-- Kickio's import_kickio_product RPC (lib/kickioSync.ts) already returns
-- `matched_by`/`action` on every call - whether this push matched an
-- EXISTING product on Kickio's side (appended to it) or created a brand
-- new one - but neither value was ever persisted or surfaced anywhere;
-- 014_kickio_sync.sql's own kickio_sync_action column was originally
-- meant to carry exactly this ('insert', 'duplicate', 'insert-orphan',
-- 'merge' - that migration's own doc comment), but the code that actually
-- writes it stores the SALE call's action instead (import_kickio_sale's
-- own, separate action vocabulary) - confirmed unused anywhere in the
-- admin UI today, so left alone rather than reinterpreted, to avoid
-- silently changing the meaning of whatever's already sitting in it for
-- every already-synced sale.
--
-- NULL for any sale synced before this existed - there's no way to
-- retroactively know what Kickio's product match outcome was without
-- resending the whole sale (which syncAndPersistOutcome never does on
-- its own - a successful sync is never automatically re-attempted).
ALTER TABLE sales ADD COLUMN IF NOT EXISTS kickio_product_matched_by text;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS kickio_product_action text;
