import type { FastifyInstance } from 'fastify';
import { pool } from '../../db.js';
import { requireAdminSession } from '../../middleware/adminAuth.js';
import { MAX_SYNC_ATTEMPTS, syncAndPersistOutcome, type SaleForSync } from '../../lib/kickioSync.js';
import { getKickioTeams, KickioTeamsNotConfiguredError } from '../../lib/kickioTeams.js';
import { enqueueKickioSyncRecoverySweep } from '../../workers/kickioSyncWorker.js';

// A sale's Kickio sync status, derived from the same three columns every
// time - kept as one function so the list filter, the counts breakdown,
// and (implicitly, via MAX_SYNC_ATTEMPTS) the retry route's own "already
// synced"/"still eligible" checks can never drift out of sync with each
// other about what "stuck" means.
const KICKIO_STATUS_SQL: Record<'synced' | 'held' | 'stuck', string> = {
  synced: 'sa.kickio_synced_at IS NOT NULL',
  held: `sa.kickio_synced_at IS NULL AND sa.kickio_sync_attempts < ${MAX_SYNC_ATTEMPTS}`,
  stuck: `sa.kickio_synced_at IS NULL AND sa.kickio_sync_attempts >= ${MAX_SYNC_ATTEMPTS}`,
};

export async function adminSalesRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAdminSession);

  app.get('/api/admin/sales', async (req, reply) => {
    const query = req.query as { site_id?: string; kickio_status?: string; page?: string; pageSize?: string };
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(Math.max(1, Number(query.pageSize) || 25), 200);
    const offset = (page - 1) * pageSize;

    const conditions: string[] = [];
    const params: unknown[] = [];
    if (query.site_id) {
      params.push(query.site_id);
      conditions.push(`sa.site_id = $${params.length}`);
    }
    // Validated against the fixed lookup table above rather than
    // interpolated as-is - it's never user-facing free text, but this
    // keeps it impossible for a bad value to become bad SQL regardless.
    const statusSql =
      query.kickio_status && query.kickio_status in KICKIO_STATUS_SQL
        ? KICKIO_STATUS_SQL[query.kickio_status as keyof typeof KICKIO_STATUS_SQL]
        : null;
    if (statusSql) conditions.push(statusSql);
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Counts use only the site filter, never the status filter - so
    // switching the status tab doesn't also change the numbers on every
    // other tab. A single conditional-aggregation query rather than three
    // separate ones, since they all scan the same filtered row set.
    const countsWhere = query.site_id ? `WHERE sa.site_id = $1` : '';
    const countsParams = query.site_id ? [query.site_id] : [];

    const [{ rows }, { rows: countRows }, { rows: statusCountRows }] = await Promise.all([
      pool.query(
        `SELECT sa.*, s.name AS site_name, u.url,
           CASE
             WHEN ${KICKIO_STATUS_SQL.synced} THEN 'synced'
             WHEN ${KICKIO_STATUS_SQL.stuck} THEN 'stuck'
             ELSE 'held'
           END AS kickio_status
         FROM sales sa
         JOIN sites s ON s.id = sa.site_id
         JOIN urls u ON u.id = sa.url_id
         ${where}
         ORDER BY sa.detected_at DESC LIMIT ${pageSize} OFFSET ${offset}`,
        params,
      ),
      pool.query(`SELECT count(*) FROM sales sa ${where}`, params),
      pool.query(
        `SELECT
           count(*) FILTER (WHERE ${KICKIO_STATUS_SQL.synced}) AS synced,
           count(*) FILTER (WHERE ${KICKIO_STATUS_SQL.held}) AS held,
           count(*) FILTER (WHERE ${KICKIO_STATUS_SQL.stuck}) AS stuck,
           count(*) AS total
         FROM sales sa ${countsWhere}`,
        countsParams,
      ),
    ]);

    const counts = statusCountRows[0];
    return reply.send({
      success: true,
      sales: rows,
      total: Number(countRows[0].count),
      page,
      pageSize,
      kickioCounts: {
        synced: Number(counts.synced),
        held: Number(counts.held),
        stuck: Number(counts.stuck),
        total: Number(counts.total),
      },
    });
  });

  // The only way back for a sale that's either "held" (still within its
  // automatic retry budget, but an admin wants to try now rather than
  // wait for the next hourly cycle) or "stuck" (already exceeded
  // MAX_SYNC_ATTEMPTS, so kickioSyncWorker.ts will never pick it up
  // again on its own) - see that worker's own comment for why this route
  // is the actual fulfilment of "left in place for manual follow-up",
  // not just a promise. Shares syncAndPersistOutcome with the worker, so
  // a manual retry updates kickio_sync_attempts/kickio_sync_error exactly
  // the way an automatic one would.
  app.post('/api/admin/sales/:id/retry-kickio-sync', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { rows } = await pool.query<SaleForSync & { kickio_synced_at: string | null }>(
      `SELECT id, url_id, price, currency, detected_at, profile, kickio_synced_at FROM sales WHERE id = $1`,
      [id],
    );
    const sale = rows[0];
    if (!sale) return reply.code(404).send({ success: false, error: 'Sale not found' });
    if (sale.kickio_synced_at) {
      return reply.code(400).send({ success: false, error: 'This sale has already synced to Kickio' });
    }

    // 200 regardless of outcome.success - the retry request itself ran and
    // its result is now persisted on the sale row either way. A held
    // outcome (no team match, Kickio momentarily down, ...) is routine,
    // not a route failure, so it's the caller's job to read outcome.success,
    // not the HTTP status - a 4xx/5xx here is reserved for the request
    // itself being invalid (sale not found, already synced).
    const outcome = await syncAndPersistOutcome(sale);
    return reply.send({ success: true, outcome });
  });

  // The bulk counterpart to retry-kickio-sync above, for exactly one
  // scenario: an upstream outage (Kickio's own database, a network
  // blip, ...) held back a whole batch of sales at once, some of which
  // have since exceeded MAX_SYNC_ATTEMPTS and dropped out of the normal
  // hourly sweep's reach entirely. Runs as a background job rather than
  // inline (kickioSyncWorker.ts's enqueueKickioSyncRecoverySweep) since a
  // real backlog can take longer than an HTTP request should ever block
  // for - progress shows up on the Jobs page like any other job.
  app.post('/api/admin/sales/retry-all-kickio-sync', async (_req, reply) => {
    await enqueueKickioSyncRecoverySweep();
    return reply.send({ success: true });
  });

  // Lets an admin unstick a sale whose team couldn't be confidently
  // guessed/matched from the listing title (identity.team_kickio_match
  // null - the same reason retry-kickio-sync above keeps holding it).
  // Still enforced against Kickio's own live team list, not accepted as
  // free text - the same "never send a guess" policy matchKickioTeam()
  // already applies automatically, just with a human doing the matching
  // instead of the title-text heuristic.
  app.post('/api/admin/sales/:id/set-team', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { team } = req.body as { team?: unknown };
    if (typeof team !== 'string' || !team.trim()) {
      return reply.code(400).send({ success: false, error: 'A team name is required' });
    }

    const { rows } = await pool.query<SaleForSync & { kickio_synced_at: string | null }>(
      `SELECT id, url_id, price, currency, detected_at, profile, kickio_synced_at FROM sales WHERE id = $1`,
      [id],
    );
    const sale = rows[0];
    if (!sale) return reply.code(404).send({ success: false, error: 'Sale not found' });
    if (sale.kickio_synced_at) {
      return reply.code(400).send({ success: false, error: 'This sale has already synced to Kickio' });
    }
    if (!sale.profile) {
      return reply.code(400).send({ success: false, error: 'This sale has no stored profile to attach a team to' });
    }

    let matchedTeam: string;
    try {
      const { teams } = await getKickioTeams();
      const found = teams.find((t) => t.name.toLowerCase() === team.trim().toLowerCase());
      if (!found) {
        return reply.code(400).send({ success: false, error: 'Not a recognised Kickio team name' });
      }
      matchedTeam = found.name;
    } catch (err) {
      if (err instanceof KickioTeamsNotConfiguredError) {
        return reply.code(501).send({ success: false, error: err.message });
      }
      return reply
        .code(502)
        .send({ success: false, error: err instanceof Error ? err.message : 'Failed to fetch Kickio teams' });
    }

    const updatedProfile = {
      ...sale.profile,
      identity: { ...sale.profile.identity, team_kickio_match: matchedTeam },
    };
    await pool.query(`UPDATE sales SET profile = $2 WHERE id = $1`, [id, JSON.stringify(updatedProfile)]);

    // Same shared sync-and-persist path as retry-kickio-sync, so setting
    // the team also immediately attempts the send it was blocking - the
    // admin doesn't need a second "retry" click for the common case.
    const outcome = await syncAndPersistOutcome({ ...sale, profile: updatedProfile });
    return reply.send({ success: true, outcome });
  });
}
