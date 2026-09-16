import { Pool, types } from 'pg';
import { config } from './config.js';

// node-postgres returns NUMERIC/DECIMAL columns as strings by default (to
// avoid silent precision loss on values too large for a JS number). Every
// numeric column in this schema (sites.rate_limit_rps,
// settings.global_rate_limit_rps) is a plain rate-limit float well within
// JS's safe range, and every consumer - API response types, admin forms -
// expects a real number, so parse it eagerly here instead of leaking a
// string past the DB boundary for callers to coerce (or forget to).
types.setTypeParser(1700 /* numeric/decimal OID */, (value: string) => parseFloat(value));

export const pool = new Pool({ connectionString: config.databaseUrl });

export type Row = Record<string, unknown>;
