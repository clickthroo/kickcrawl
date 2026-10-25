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

// node-postgres's own documented requirement: the pool emits an 'error'
// event on behalf of any IDLE client that hits a connection-level problem
// (Postgres restarting, a network blip, an admin-terminated connection -
// confirmed in production as exactly this: a real `57P01 terminating
// connection due to administrator command`). Node's EventEmitter treats
// an 'error' event with no listener as fatal and throws it uncaught,
// which crashes the entire process outright - not just the one query,
// every in-flight request, every worker, the whole app, requiring a full
// restart. This was the actual root cause of a real production outage:
// nothing else in this app was broken, a single idle client's transient
// connection error took the whole server down because there was nothing
// here to stop Node from treating it as fatal.
pool.on('error', (err) => {
  console.error('[db] idle client error (pool recovers on its own; this is not fatal):', err);
});

export type Row = Record<string, unknown>;
