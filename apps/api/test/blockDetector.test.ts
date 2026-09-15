import { describe, expect, it } from 'vitest';
import { isBlockPage } from '../src/services/blockDetector.js';

describe('isBlockPage', () => {
  it('flags 403/503/429 status codes regardless of body', () => {
    expect(isBlockPage(403, '<html>ok</html>')).toBe(true);
    expect(isBlockPage(503, '<html>ok</html>')).toBe(true);
    expect(isBlockPage(429, '<html>ok</html>')).toBe(true);
  });

  it('flags known Cloudflare/bot-challenge phrases on a 200 response', () => {
    expect(isBlockPage(200, '<title>Just a moment...</title>')).toBe(true);
    expect(isBlockPage(200, 'Checking your browser before accessing')).toBe(true);
  });

  it('does not flag normal content', () => {
    expect(isBlockPage(200, '<h1>Manchester United Home Shirt</h1><p>£49.99</p>')).toBe(false);
  });
});
