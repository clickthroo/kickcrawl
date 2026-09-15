import { createHash, randomBytes } from 'node:crypto';

export function generateApiKey(): { plain: string; preview: string } {
  const plain = `kc_${randomBytes(24).toString('hex')}`;
  const preview = `${plain.slice(0, 7)}...${plain.slice(-4)}`;
  return { plain, preview };
}

// API keys are already 192 bits of random entropy, so a deterministic
// SHA-256 digest (rather than bcrypt) is used for storage: it lets us look a
// key up by hash in O(1) instead of bcrypt-comparing against every stored
// key, while remaining infeasible to reverse or brute-force.
export function hashApiKey(plain: string): string {
  return createHash('sha256').update(plain).digest('hex');
}
