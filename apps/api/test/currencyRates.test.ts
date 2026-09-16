import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('getCurrencyRates', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('returns a code -> rate_to_gbp map built from the currency_rates table', async () => {
    const query = vi.fn(async () => ({
      rows: [
        { code: 'USD', rate_to_gbp: 0.75 },
        { code: 'EUR', rate_to_gbp: 0.85 },
      ],
    }));
    vi.doMock('../src/db.js', () => ({ pool: { query } }));

    const { getCurrencyRates } = await import('../src/lib/currencyRates.js');
    const rates = await getCurrencyRates();

    expect(rates).toEqual({ USD: 0.75, EUR: 0.85 });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('returns an empty map when no rates are configured', async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    vi.doMock('../src/db.js', () => ({ pool: { query } }));

    const { getCurrencyRates } = await import('../src/lib/currencyRates.js');
    expect(await getCurrencyRates()).toEqual({});
  });
});
