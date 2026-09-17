import type { FastifyInstance } from 'fastify';
import { pool } from '../../db.js';
import { requireAdminSession } from '../../middleware/adminAuth.js';
import { scrapePage } from '../../lib/scrapeCore.js';
import { markUrlFetched } from '../../lib/urlStore.js';
import { persistScrapeResult } from '../../lib/persistResult.js';
import { buildKickioProfile, type KickioProfile } from '../../services/kickioProfile.js';
import { getCurrencyRates } from '../../lib/currencyRates.js';

/**
 * A profile field is free text (team names, player names, colours, etc),
 * so filters match case-insensitively as a substring rather than requiring
 * an exact value - matching how the "Path contains" filter already works.
 */
function textMatches(value: string | null | undefined, filter: string | undefined): boolean {
  if (!filter) return true;
  if (!value) return false;
  return value.toLowerCase().includes(filter.toLowerCase());
}

interface ItemFilters {
  stock_status?: string;
  team?: string;
  season?: string;
  shirt_type?: string;
  player?: string;
  number?: string;
  colour?: string;
  size?: string;
  manufacturer?: string;
  condition?: string;
}

function matchesProfileFilters(profile: KickioProfile | null, f: ItemFilters): boolean {
  const hasProfileFilter =
    f.stock_status || f.team || f.season || f.shirt_type || f.player || f.number || f.colour || f.size || f.manufacturer || f.condition;
  if (!hasProfileFilter) return true;
  if (!profile) return false;

  if (f.stock_status && profile.listing.stock_status !== f.stock_status) return false;
  if (!textMatches(profile.identity.team, f.team)) return false;
  if (f.season) {
    const seasons = [profile.identity.season, ...profile.identity.extra_seasons].filter(Boolean) as string[];
    if (!seasons.some((s) => s.toLowerCase().includes(f.season!.toLowerCase()))) return false;
  }
  if (!textMatches(profile.identity.shirt_type, f.shirt_type)) return false;
  if (!textMatches(profile.identity.player, f.player)) return false;
  if (!textMatches(profile.identity.number, f.number)) return false;
  if (
    f.colour &&
    !textMatches(profile.listing.colour, f.colour) &&
    !textMatches(profile.listing.colour_secondary, f.colour)
  ) {
    return false;
  }
  if (!textMatches(profile.listing.size, f.size)) return false;
  if (!textMatches(profile.listing.manufacturer, f.manufacturer)) return false;
  if (!textMatches(profile.listing.condition, f.condition)) return false;
  return true;
}

export async function adminUrlRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAdminSession);

  // Cross-site item list: every scraped item across every site on one page,
  // filterable by site plus the mapped Kickio profile fields. Profile
  // fields aren't stored columns (they're derived on the fly), so the SQL
  // side only filters what's actually indexed (site/status/path) and the
  // profile-based filters are applied in JS afterwards, over a capped
  // window of the most recently discovered rows.
  app.get('/api/admin/items', async (req, reply) => {
    const query = req.query as {
      site_id?: string;
      status?: string;
      path?: string;
      stock_status?: string;
      team?: string;
      season?: string;
      shirt_type?: string;
      player?: string;
      number?: string;
      colour?: string;
      size?: string;
      manufacturer?: string;
      condition?: string;
      page?: string;
      pageSize?: string;
    };
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(Math.max(1, Number(query.pageSize) || 25), 200);

    const conditions: string[] = [];
    const params: unknown[] = [];
    if (query.site_id) {
      params.push(query.site_id);
      conditions.push(`u.site_id = $${params.length}`);
    }
    if (query.status) {
      params.push(query.status);
      conditions.push(`u.status = $${params.length}`);
    }
    if (query.path) {
      params.push(`%${query.path}%`);
      conditions.push(`u.path ILIKE $${params.length}`);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const currencyRates = await getCurrencyRates();

    const SCAN_LIMIT = 2000;
    const { rows } = await pool.query(
      `SELECT u.*, s.name AS site_name,
              m.content->>'title' AS preview_title, m.content->>'image' AS preview_image,
              m.content->'images' AS preview_images,
              e.content AS preview_extracted, md.content AS preview_markdown
       FROM urls u
       JOIN sites s ON s.id = u.site_id
       LEFT JOIN LATERAL (
         SELECT content FROM scrape_results sr
         WHERE sr.url_id = u.id AND sr.format = 'metadata'
         ORDER BY sr.fetched_at DESC LIMIT 1
       ) m ON true
       LEFT JOIN LATERAL (
         SELECT content FROM scrape_results sr
         WHERE sr.url_id = u.id AND sr.format = 'extracted'
         ORDER BY sr.fetched_at DESC LIMIT 1
       ) e ON true
       LEFT JOIN LATERAL (
         SELECT content FROM scrape_results sr
         WHERE sr.url_id = u.id AND sr.format = 'markdown'
         ORDER BY sr.fetched_at DESC LIMIT 1
       ) md ON true
       ${where} ORDER BY u.discovered_at DESC LIMIT ${SCAN_LIMIT}`,
      params,
    );

    const filters: ItemFilters = {
      stock_status: query.stock_status,
      team: query.team,
      season: query.season,
      shirt_type: query.shirt_type,
      player: query.player,
      number: query.number,
      colour: query.colour,
      size: query.size,
      manufacturer: query.manufacturer,
      condition: query.condition,
    };

    const items = rows
      .map((u) => ({
        ...u,
        preview_profile:
          u.preview_title || u.preview_extracted || u.preview_markdown
            ? buildKickioProfile({
                url: u.url,
                title: u.preview_title,
                description: u.preview_markdown?.slice(0, 4000) ?? null,
                // preview_images is only absent for rows scraped before this
                // field existed - fall back to the single image they do have.
                images: u.preview_images ?? [u.preview_image],
                extracted: u.preview_extracted,
                scrapedAt: u.last_fetched_at,
                currencyRates,
              })
            : null,
      }))
      .filter((u) => matchesProfileFilters(u.preview_profile, filters));

    const total = items.length;
    const offset = (page - 1) * pageSize;
    const pageItems = items.slice(offset, offset + pageSize);

    return reply.send({ success: true, items: pageItems, total, page, pageSize });
  });

  app.get('/api/admin/sites/:siteId/urls', async (req, reply) => {
    const { siteId } = req.params as { siteId: string };
    const query = req.query as { status?: string; path?: string; page?: string; pageSize?: string };
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(Math.max(1, Number(query.pageSize) || 50), 200);
    const offset = (page - 1) * pageSize;

    const conditions = ['u.site_id = $1'];
    const params: unknown[] = [siteId];
    if (query.status) {
      params.push(query.status);
      conditions.push(`u.status = $${params.length}`);
    }
    if (query.path) {
      params.push(`%${query.path}%`);
      conditions.push(`u.path ILIKE $${params.length}`);
    }
    const where = conditions.join(' AND ');
    const currencyRates = await getCurrencyRates();

    const { rows } = await pool.query(
      `SELECT u.*, m.content->>'title' AS preview_title, m.content->>'image' AS preview_image,
              m.content->'images' AS preview_images,
              e.content AS preview_extracted, md.content AS preview_markdown
       FROM urls u
       LEFT JOIN LATERAL (
         SELECT content FROM scrape_results sr
         WHERE sr.url_id = u.id AND sr.format = 'metadata'
         ORDER BY sr.fetched_at DESC LIMIT 1
       ) m ON true
       LEFT JOIN LATERAL (
         SELECT content FROM scrape_results sr
         WHERE sr.url_id = u.id AND sr.format = 'extracted'
         ORDER BY sr.fetched_at DESC LIMIT 1
       ) e ON true
       LEFT JOIN LATERAL (
         SELECT content FROM scrape_results sr
         WHERE sr.url_id = u.id AND sr.format = 'markdown'
         ORDER BY sr.fetched_at DESC LIMIT 1
       ) md ON true
       WHERE ${where} ORDER BY u.discovered_at DESC LIMIT ${pageSize} OFFSET ${offset}`,
      params,
    );
    const { rows: countRows } = await pool.query(
      `SELECT count(*) FROM urls u WHERE ${where}`,
      params,
    );

    const urlsWithProfile = rows.map((u) => ({
      ...u,
      // Only map a profile once there's something to map - an undiscovered/
      // not-yet-fetched URL has no title, extracted fields or markdown at
      // all. The markdown (full page text) matters here: a lot of real
      // stock signals - e.g. a "SOLD OUT" button - live in the page body,
      // not the <title> tag or meta description, so leaving it out (as
      // this route previously did, unlike the Job Detail one) meant the
      // stock detector never actually saw them.
      preview_profile:
        u.preview_title || u.preview_extracted || u.preview_markdown
          ? buildKickioProfile({
              url: u.url,
              title: u.preview_title,
              description: u.preview_markdown?.slice(0, 4000) ?? null,
              images: u.preview_images ?? [u.preview_image],
              extracted: u.preview_extracted,
              scrapedAt: u.last_fetched_at,
              currencyRates,
            })
          : null,
    }));

    return reply.send({ success: true, urls: urlsWithProfile, total: Number(countRows[0].count), page, pageSize });
  });

  app.post('/api/admin/urls/:id/rescrape', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { rows } = await pool.query(
      `SELECT u.*, s.* FROM urls u JOIN sites s ON s.id = u.site_id WHERE u.id = $1`,
      [id],
    );
    const row = rows[0];
    if (!row) return reply.code(404).send({ success: false, error: 'URL not found' });

    const result = await scrapePage(
      row.url,
      { formats: ['markdown', 'links'] },
      {
        id: row.site_id,
        name: row.name,
        base_url: row.base_url,
        rate_limit_rps: row.rate_limit_rps,
        max_depth: row.max_depth,
        use_browser_default: row.use_browser_default,
        use_proxy: row.use_proxy,
        default_selectors: row.default_selectors,
        allowed_paths: row.allowed_paths,
        denied_paths: row.denied_paths,
        is_active: row.is_active,
        require_pro_seller: row.require_pro_seller,
        min_seller_feedback: row.min_seller_feedback,
      },
    );

    const urlId = await markUrlFetched(row.site_id, row.url, result.metadata.statusCode, result.error);
    await persistScrapeResult(urlId, null, result);

    return reply.send({ success: result.success, result });
  });
}
