import { describe, expect, it } from 'vitest';
import { acquireSlot } from '../src/services/rateLimiter.js';

describe('acquireSlot', () => {
  it('serializes requests to the same domain to roughly respect the configured RPS', async () => {
    const domain = `test-${Math.random()}.example.com`;
    const rps = 5; // ~200ms minimum interval
    const start = Date.now();

    await acquireSlot(domain, rps);
    await acquireSlot(domain, rps);
    await acquireSlot(domain, rps);

    const elapsed = Date.now() - start;
    // Three slots at 5rps should take at least ~2 intervals (with jitter
    // tolerance), i.e. well over a single request's time.
    expect(elapsed).toBeGreaterThanOrEqual(300);
  });

  it('does not serialize requests to different domains', async () => {
    const start = Date.now();
    await Promise.all([
      acquireSlot(`a-${Math.random()}.example.com`, 1),
      acquireSlot(`b-${Math.random()}.example.com`, 1),
      acquireSlot(`c-${Math.random()}.example.com`, 1),
    ]);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(500);
  });
});
