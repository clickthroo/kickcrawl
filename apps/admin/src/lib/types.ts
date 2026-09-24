export interface Site {
  id: string;
  name: string;
  base_url: string;
  rate_limit_rps: number;
  max_depth: number;
  use_browser_default: boolean;
  /** Skip browser rendering for pages recognized as items even when use_browser_default is on - see their own content already renders fine over plain HTTP. */
  skip_browser_for_items: boolean;
  use_proxy: boolean;
  default_selectors: Record<string, string>;
  allowed_paths: string[];
  denied_paths: string[];
  is_active: boolean;
  /** Seller-trust filters for marketplaces where the listing's own seller matters (e.g. Vinted's Pro badge). */
  require_pro_seller: boolean;
  min_seller_feedback: number | null;
  created_at: string;
  updated_at: string;
  url_count?: number;
  fetched_count?: number;
}

export interface UrlRecord {
  id: string;
  site_id: string;
  site_name?: string;
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
  status_code: number | null;
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
    /** The Kickio `teams` row `team` matched against, when a live list was available - see kickioTeams.ts. */
    team_kickio_match: string | null;
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
    colour_secondary: string | null;
    boxed_edition: string | null;
    /** Always GBP - converted from the site's own currency using an admin-set rate, when needed. */
    price: number | null;
    currency: string | null;
    /** The price/currency exactly as the source site reported it, before conversion - null when no conversion happened. */
    original_price: number | null;
    original_currency: string | null;
    fx_rate_used: number | null;
    quantity: number | null;
    images: string[];
    stock_status: 'In Stock' | 'Out of Stock' | 'Unknown' | null;
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
  type: 'scrape' | 'map' | 'crawl' | 'extract' | 'recheck';
  status: 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
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

export interface Sale {
  id: string;
  url_id: string;
  site_id: string;
  site_name: string;
  url: string;
  title: string | null;
  price: number | null;
  currency: string | null;
  /** Full Kickio profile as it was at the moment the sale was detected - null for a sale recorded before this was added. */
  profile: KickioProfile | null;
  detected_at: string;
}

export interface PriceChange {
  id: string;
  url_id: string;
  site_id: string;
  site_name: string;
  url: string;
  title: string | null;
  old_price: number;
  new_price: number;
  currency: string | null;
  /** Full Kickio profile as it was at the moment the price change was detected. */
  profile: KickioProfile | null;
  detected_at: string;
}

export interface CurrencyRate {
  code: string;
  rate_to_gbp: number;
  updated_at: string;
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
