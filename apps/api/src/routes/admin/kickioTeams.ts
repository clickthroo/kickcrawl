import type { FastifyInstance } from 'fastify';
import { requireAdminSession } from '../../middleware/adminAuth.js';
import { getKickioTeams, KickioTeamsNotConfiguredError } from '../../lib/kickioTeams.js';

export async function adminKickioTeamRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAdminSession);

  app.get('/api/admin/kickio-teams', async (req, reply) => {
    const refresh = (req.query as { refresh?: string }).refresh === '1';
    try {
      const { teams, fetchedAt, stale } = await getKickioTeams(refresh);
      return reply.send({ success: true, teams, fetchedAt, stale });
    } catch (err) {
      if (err instanceof KickioTeamsNotConfiguredError) {
        return reply.code(501).send({ success: false, error: err.message });
      }
      return reply
        .code(502)
        .send({ success: false, error: err instanceof Error ? err.message : 'Failed to fetch Kickio teams' });
    }
  });
}
