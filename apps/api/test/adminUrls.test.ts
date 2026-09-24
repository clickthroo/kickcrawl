import { describe, expect, it } from 'vitest';
import { profileFilterConditions, type ItemFilters } from '../src/routes/admin/urls.js';

describe('profileFilterConditions', () => {
  it('returns no conditions and adds no params when nothing is filtered', () => {
    const params: unknown[] = [];
    expect(profileFilterConditions({}, params)).toEqual([]);
    expect(params).toEqual([]);
  });

  it('matches stock_status exactly, not as a substring', () => {
    const params: unknown[] = [];
    const conditions = profileFilterConditions({ stock_status: 'In Stock' }, params);
    expect(conditions).toEqual(['u.stock_status = $1']);
    expect(params).toEqual(['In Stock']);
  });

  it('matches team/season/shirt_type/size/manufacturer/condition as a case-insensitive substring, the same way the "Path contains" filter already works', () => {
    const params: unknown[] = [];
    const conditions = profileFilterConditions({ team: 'Arsenal' }, params);
    expect(conditions).toEqual(['u.team ILIKE $1']);
    expect(params).toEqual(['%Arsenal%']);
  });

  it('maps the "number" filter to the player_number column, not a bare "number" one', () => {
    const params: unknown[] = [];
    const conditions = profileFilterConditions({ number: '10' }, params);
    expect(conditions).toEqual(['u.player_number ILIKE $1']);
    expect(params).toEqual(['%10%']);
  });

  it('matches a colour filter against either colour or colour_secondary with a single shared param, the same OR behaviour the old in-JS filter had', () => {
    const params: unknown[] = [];
    const conditions = profileFilterConditions({ colour: 'Yellow' }, params);
    expect(conditions).toEqual(['(u.colour ILIKE $1 OR u.colour_secondary ILIKE $1)']);
    expect(params).toEqual(['%Yellow%']);
  });

  it('combines every active filter, numbering params in order and reusing the same params array a caller already started filling', () => {
    const params: unknown[] = ['existing-site-id'];
    const filters: ItemFilters = {
      stock_status: 'Out of Stock',
      team: 'Arsenal',
      manufacturer: 'Adidas',
    };
    const conditions = profileFilterConditions(filters, params);
    expect(conditions).toEqual([
      'u.stock_status = $2',
      'u.team ILIKE $3',
      'u.manufacturer ILIKE $4',
    ]);
    expect(params).toEqual(['existing-site-id', 'Out of Stock', '%Arsenal%', '%Adidas%']);
  });
});
