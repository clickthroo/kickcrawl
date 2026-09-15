import { describe, expect, it } from 'vitest';
import { generateApiKey, hashApiKey } from '../src/lib/apiKeys.js';

describe('apiKeys', () => {
  it('generates a key with a kc_ prefix and a preview that never exposes the full secret', () => {
    const { plain, preview } = generateApiKey();
    expect(plain).toMatch(/^kc_[0-9a-f]{48}$/);
    expect(preview.length).toBeLessThan(plain.length);
    expect(preview).not.toBe(plain);
  });

  it('hashes deterministically so the same key always looks up the same row', () => {
    const { plain } = generateApiKey();
    expect(hashApiKey(plain)).toBe(hashApiKey(plain));
  });

  it('produces different hashes for different keys', () => {
    const a = generateApiKey().plain;
    const b = generateApiKey().plain;
    expect(hashApiKey(a)).not.toBe(hashApiKey(b));
  });
});
