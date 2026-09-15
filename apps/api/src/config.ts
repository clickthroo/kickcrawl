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
  defaultUserAgent: env(
    'DEFAULT_USER_AGENT',
    'KickioBot/1.0 (+https://kickio.com/bot)',
  ),
  adminEmail: process.env.ADMIN_EMAIL ?? '',
  adminPasswordHash: process.env.ADMIN_PASSWORD_HASH ?? '',
  sessionSecret: env('SESSION_SECRET', 'dev-only-insecure-secret-change-me'),
  webhookUrl: process.env.WEBHOOK_URL ?? '',
  nodeEnv: process.env.NODE_ENV ?? 'development',
};
