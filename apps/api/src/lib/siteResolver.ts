import { pool } from '../db.js';

export interface SiteConfig {
  id: string;
  name: string;
  base_url: string;
  rate_limit_rps: number;
  max_depth: number;
  use_browser_default: boolean;
  use_proxy: boolean;
  default_selectors: Record<string, string>;
  allowed_paths: string[];
  denied_paths: string[];
  is_active: boolean;
  require_pro_seller: boolean;
  min_seller_feedback: number | null;
}

/** Finds the configured site whose base_url hostname matches the given URL, if any. */
export async function resolveSiteForUrl(url: string): Promise<SiteConfig | null> {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return null;
  }

  // Sites are admin-managed and few in number, so it's simplest (and
  // correct, since base_url may carry a path) to compare hostnames in JS
  // rather than trying to express this match in SQL.
  const { rows } = await pool.query<SiteConfig>('SELECT * FROM sites WHERE is_active = true');
  for (const site of rows) {
    try {
      const siteHost = new URL(site.base_url).hostname;
      if (siteHost === hostname || hostname.endsWith(`.${siteHost}`)) return site;
    } catch {
      continue;
    }
  }
  return null;
}

export async function getOrCreateSiteForUrl(url: string): Promise<SiteConfig> {
  const existing = await resolveSiteForUrl(url);
  if (existing) return existing;

  const origin = new URL(url).origin;
  const { rows } = await pool.query<SiteConfig>(
    `INSERT INTO sites (name, base_url)
     VALUES ($1, $2)
     ON CONFLICT (base_url) DO UPDATE SET base_url = EXCLUDED.base_url
     RETURNING *`,
    [new URL(url).hostname, origin],
  );
  return rows[0];
}
