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
];

export function isBlockPage(statusCode: number, html: string): boolean {
  if (statusCode === 403 || statusCode === 503 || statusCode === 429) return true;
  const lower = html.slice(0, 5000).toLowerCase();
  return BLOCK_PHRASES.some((phrase) => lower.includes(phrase));
}
