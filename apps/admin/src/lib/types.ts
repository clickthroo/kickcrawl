export interface Site {
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
  created_at: string;
  updated_at: string;
  url_count?: number;
  fetched_count?: number;
}

export interface UrlRecord {
  id: string;
  site_id: string;
  url: string;
  path: string;
  status: 'discovered' | 'queued' | 'fetched' | 'failed';
  last_fetched_at: string | null;
  last_status_code: number | null;
  last_error: string | null;
  discovered_at: string;
  preview_title: string | null;
  preview_image: string | null;
  preview_extracted: Record<string, string> | null;
  preview_profile: KickioProfile | null;
}

export interface JobPageItem {
  url: string;
  last_status_code: number | null;
  last_error: string | null;
  fetched_at: string;
  title: string | null;
  image: string | null;
  extracted: Record<string, string> | null;
  markdown: string | null;
  profile: KickioProfile | null;
}

/**
 * Read-only Kickio product profile derived per scraped item, following
 * "Shirt Feature Mapping Guide for a Third-Party Scraper". Never written to
 * Kickio's own database - it's a preview so an admin can see how the item
 * would map before any such write happens.
 */
export interface KickioProfile {
  source: { marketplace: string | null; url: string; scraped_at: string };
  category: string;
  identity: {
    team: string | null;
    season: string | null;
    extra_seasons: string[];
    shirt_type: string | null;
    gender: string;
    issue: string | null;
    special_edition: string | null;
    sleeves: string | null;
    signed: string | null;
    player: string | null;
    number: string | null;
  };
  listing: {
    condition: string | null;
    size: string | null;
    manufacturer: string | null;
    colour: string | null;
    boxed_edition: string | null;
    price: number | null;
    currency: string | null;
    quantity: number | null;
    images: string[];
  };
  custom_attributes: Record<string, string>;
  confidence: Record<string, 'certain' | 'inferred'>;
  needs_review: boolean;
  review_reason: string | null;
}

export interface Job {
  id: string;
  site_id: string | null;
  site_name: string | null;
  type: 'scrape' | 'map' | 'crawl' | 'extract';
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  payload: Record<string, unknown>;
  total_pages: number;
  completed_pages: number;
  error_count: number;
  errors: { message: string; at?: string }[];
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

export interface ApiKey {
  id: string;
  name: string;
  key_preview: string;
  last_used_at: string | null;
  created_at: string;
}

export interface Settings {
  global_rate_limit_rps: number;
  default_user_agent: string;
  proxy_url: string | null;
  llm_provider: string;
  llm_model: string;
  notification_email: string | null;
  webhook_url: string | null;
}
