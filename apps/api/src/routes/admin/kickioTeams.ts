import type { FastifyInstance } from 'fastify';
import { requireAdminSession } from '../../middleware/adminAuth.js';
import { getKickioTeams, KickioTeamsNotConfiguredError } from '../../lib/kickioTeams.js';
import { config } from '../../config.js';

export async function adminKickioTeamRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAdminSession);

  app.get('/api/admin/kickio-teams', async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    const refresh = (req.query as { refresh?: string }).refresh === '1';
    try {
      const { teams, fetchedAt, stale } = await getKickioTeams(refresh);
      return reply.send({ success: true, teams, fetchedAt, stale });
    } catch (err) {
      if (err instanceof KickioTeamsNotConfiguredError) {
        // TEMPORARY diagnostic - lengths/booleans only, never the actual
        // key value, to help debug a deployment where the env vars are
        // confirmed set in Railway (correct names, correct values, single
        // service, fresh healthy deploy) but this route still reports
        // unconfigured. Remove once that's root-caused.
        return reply.code(501).send({
          success: false,
          error: err.message,
          debug: {
            urlConfigured: config.kickioSupabaseUrl.length > 0,
            urlLength: config.kickioSupabaseUrl.length,
            keyConfigured: config.kickioSupabaseAnonKey.length > 0,
            keyLength: config.kickioSupabaseAnonKey.length,
          },
        });
      }
      return reply
        .code(502)
        .send({ success: false, error: err instanceof Error ? err.message : 'Failed to fetch Kickio teams' });
    }
  });
}
