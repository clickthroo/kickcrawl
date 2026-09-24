import type { FastifyInstance } from 'fastify';
import { pool } from '../../db.js';
import { requireAdminSession } from '../../middleware/adminAuth.js';
import { scrapePage } from '../../lib/scrapeCore.js';
import { markUrlFetched } from '../../lib/urlStore.js';
import { persistScrapeResult } from '../../lib/persistResult.js';
import { buildKickioProfile } from '../../services/kickioProfile.js';
import { getCurrencyRates } from '../../lib/currencyRates.js';
import { getKickioTeamsForMatching } from '../../lib/kickioTeams.js';
import { persistItemProfileColumns } from '../../lib/persistItemProfile.js';
import { detectAndRecordTransition, getPreviousStockAndPrice } from '../../lib/saleDetection.js';
import { isCrawlItem, passesSellerFilter } from '../../workers/crawlWorker.js';

export interface ItemFilters {
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

/**
 * SQL WHERE fragments for the profile fields (team, stock status, ...) -
 * real `urls` columns since migration 010, kept in sync by
 * lib/persistItemProfile.ts on every crawl/recheck/rescrape. Filters this
 * way instead of building a KickioProfile for every candidate row in JS:
 * that used to mean scanning a capped window of the most-recently-
 * discovered rows (2000) on every request, silently hiding anything older
 * once a site's total url count grew past it, with no way to raise that
 * cap that didn't mean profiling the entire table synchronously in the
 * same process that also runs the crawl/recheck workers.
 *
 * A profile field is free text (team names, player names, colours, etc),
 * so filters match case-insensitively as a substring (ILIKE) rather than
 * requiring an exact value - matching how the "Path contains" filter
 * already works. `stock_status` is the one exact match, same as before.
 */
export function profileFilterConditions(f: ItemFilters, params: unknown[]): string[] {
  const conditions: string[] = [];
  const ilikeParam = (value: string) => {
    params.push(`%${value}%`);
    return `$${params.length}`;
  };
  if (f.stock_status) {
    params.push(f.stock_status);
    conditions.push(`u.stock_status = $${params.length}`);
  }
  if (f.team) conditions.push(`u.team ILIKE ${ilikeParam(f.team)}`);
  if (f.season) conditions.push(`u.season ILIKE ${ilikeParam(f.season)}`);
  if (f.shirt_type) conditions.push(`u.shirt_type ILIKE ${ilikeParam(f.shirt_type)}`);
  if (f.player) conditions.push(`u.player ILIKE ${ilikeParam(f.player)}`);
  if (f.number) conditions.push(`u.player_number ILIKE ${ilikeParam(f.number)}`);
  if (f.colour) {
    const p = ilikeParam(f.colour);
    conditions.push(`(u.colour ILIKE ${p} OR u.colour_secondary ILIKE ${p})`);
  }
  if (f.size) conditions.push(`u.size ILIKE ${ilikeParam(f.size)}`);
  if (f.manufacturer) conditions.push(`u.manufacturer ILIKE ${ilikeParam(f.manufacturer)}`);
  if (f.condition) conditions.push(`u.condition ILIKE ${ilikeParam(f.condition)}`);
  return conditions;
}

export async function adminUrlRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAdminSession);

  // Cross-site item list: every scraped item across every site on one
  // page, filterable by site plus the mapped Kickio profile fields - all
  // filtered and paginated in SQL (see profileFilterConditions above), so
  // this scales to however many rows a site actually has rather than only
  // ever seeing a capped window of the most recently discovered ones.
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
    const offset = (page - 1) * pageSize;

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
    conditions.push(
      ...profileFilterConditions(
        {
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
        },
        params,
      ),
    );
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const { rows: countRows } = await pool.query(`SELECT count(*) FROM urls u ${where}`, params);
    const total = Number(countRows[0].count);

    const currencyRates = await getCurrencyRates();
    const kickioTeams = await getKickioTeamsForMatching();

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
       ${where} ORDER BY u.discovered_at DESC LIMIT ${pageSize} OFFSET ${offset}`,
      params,
    );

    // Only ever built for this one page of rows (<= 200), never the whole
    // matched set - filtering/counting above already happened in SQL
    // against the persisted columns, so this is purely for display.
    const items = rows.map((u) => ({
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
              kickioTeams,
            })
          : null,
    }));

    return reply.send({ success: true, items, total, page, pageSize });
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
    const kickioTeams = await getKickioTeamsForMatching();

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
              kickioTeams,
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
        skip_browser_for_items: row.skip_browser_for_items,
        use_proxy: row.use_proxy,
        default_selectors: row.default_selectors,
        allowed_paths: row.allowed_paths,
        denied_paths: row.denied_paths,
        is_active: row.is_active,
        require_pro_seller: row.require_pro_seller,
        min_seller_feedback: row.min_seller_feedback,
      },
    );

    // Same rule as crawl/recheck: an item that doesn't pass the site's
    // seller filter is skipped rather than kept - a manual re-scrape used
    // to bypass this entirely, letting an admin unintentionally keep (or
    // refresh) an item that the site's own Pro/feedback filter would
    // never have recorded in the first place.
    const isItem = isCrawlItem(row.path, row.allowed_paths ?? []);
    if (result.success && isItem && !passesSellerFilter(result.markdown, row)) {
      await pool.query(`DELETE FROM urls WHERE id = $1`, [id]);
      return reply.send({
        success: false,
        result,
        error: "Item no longer passes the site's seller filter (Pro seller / min feedback) - removed rather than kept.",
      });
    }

    const urlId = await markUrlFetched(row.site_id, row.url, result.metadata.statusCode, result.error);
    await persistScrapeResult(urlId, null, result);

    // Keeps the profile columns (team, stock_status, ...) an admin's
    // manual re-scrape actually refreshed in sync too, the same as a
    // crawl or recheck already does - otherwise a re-scraped item would
    // show fresh markdown/metadata but stale filter values until its next
    // scheduled recheck.
    if (result.success) {
      const profile = buildKickioProfile({
        url: row.url,
        title: result.metadata.title,
        description: result.markdown?.slice(0, 4000) ?? null,
        images: result.metadata.image ? [result.metadata.image] : [],
        extracted: result.extracted,
        currencyRates: await getCurrencyRates(),
        kickioTeams: await getKickioTeamsForMatching(),
      });
      // Read BEFORE persistItemProfileColumns overwrites it - a manual
      // re-scrape can just as easily be the fetch that observes a real
      // In Stock -> Out of Stock transition as the hourly recheck can, so
      // it needs the same before/after comparison, not just a blind
      // overwrite (see lib/saleDetection.ts).
      const previous = await getPreviousStockAndPrice(urlId);
      await detectAndRecordTransition(urlId, row.site_id, result.metadata.title, previous, profile);
      await persistItemProfileColumns(urlId, profile);
    }

    return reply.send({ success: result.success, result });
  });
}
