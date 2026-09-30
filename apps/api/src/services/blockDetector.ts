const BLOCK_PHRASES = [
  'just a moment',
  'checking your browser',
  'ddos protection by',
  'access denied',
  'attention required',
  'cf-browser-verification',
  'please enable cookies',
  'are you a human',
  'verify you are a human',
  'unusual traffic',
  'pardon our interruption',
  // Confirmed live on thekitman.co.uk: a full 202-status page titled
  // "Robot Challenge Screen" with no real site content or links - not
  // caught by any phrase above, so it silently got mapped as if it were a
  // real product listing (its own title read as a "team" name) instead of
  // being reported as blocked.
  'robot challenge',
];

export function isBlockPage(statusCode: number, html: string): boolean {
  if (statusCode === 403 || statusCode === 503 || statusCode === 429) return true;
  const lower = html.slice(0, 5000).toLowerCase();
  return BLOCK_PHRASES.some((phrase) => lower.includes(phrase));
}
