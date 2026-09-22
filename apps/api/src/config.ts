import 'dotenv/config';

function env(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v !== undefined && v !== '') return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required environment variable: ${name}`);
}

export const config = {
  databaseUrl: env('DATABASE_URL', 'postgresql://kickcrawl:kickcrawl@localhost:5432/kickcrawl'),
  redisUrl: env('REDIS_URL', 'redis://localhost:6379'),
  port: Number(process.env.PORT ?? 3000),
  appUrl: env('APP_URL', 'http://localhost:3000'),
  openaiApiKey: process.env.OPENAI_API_KEY ?? '',
  openaiModel: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
  openaiBaseUrl: process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
  proxyUrl: process.env.PROXY_URL ?? '',
  // Optional override to point Playwright at an already-installed Chromium
  // binary instead of the one it downloaded itself.
  playwrightExecutablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH ?? '',
  // Sent on every plain HTTP fetch and every robots.txt lookup - Railway
  // production has no DEFAULT_USER_AGENT variable set, so this fallback is
  // what a scraped site's server logs actually see. A named/branded bot
  // string here ("KickioBot/1.0 (+https://kickio.com/bot)", this used to
  // be) announces exactly who's scraping a site, on every retailer this
  // crawls - the opposite of what an anonymous-looking crawler needs.
  // Playwright-driven fetches already rotate a realistic, unbranded
  // browser UA pool (services/userAgents.ts); this is that same style,
  // just a single fixed one for the plain-HTTP/robots path.
  defaultUserAgent: env(
    'DEFAULT_USER_AGENT',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  ),
  adminEmail: process.env.ADMIN_EMAIL ?? '',
  adminPasswordHash: process.env.ADMIN_PASSWORD_HASH ?? '',
  sessionSecret: env('SESSION_SECRET', 'dev-only-insecure-secret-change-me'),
  webhookUrl: process.env.WEBHOOK_URL ?? '',
  // Kickio's own Supabase project - read-only, for the "Kickio Teams"
  // admin page (Part 2 "Team" verification against Kickio's real canonical
  // list). Uses Kickio's public anon/publishable key against its `teams`
  // table, which has an unauthenticated-read RLS policy - safe to hold as
  // plain config, not a secret. Left blank disables that admin page rather
  // than failing startup, since it's a read-only convenience, not a
  // dependency the rest of the app needs.
  kickioSupabaseUrl: process.env.KICKIO_SUPABASE_URL ?? '',
  kickioSupabaseAnonKey: process.env.KICKIO_SUPABASE_ANON_KEY ?? '',
  nodeEnv: process.env.NODE_ENV ?? 'development',
};
