import { blendVectors, cosine } from './vectors';

describe('blendVectors', () => {
  const query = [1, 0, 0];
  const taste = [0, 1, 0];

  it('leans towards the query but is pulled by the taste vector', () => {
    const out = blendVectors(query, taste, 0.2);
    expect(cosine(out, query)).toBeGreaterThan(cosine(out, taste));
    expect(cosine(out, taste)).toBeGreaterThan(0);
    expect(Math.sqrt(out.reduce((s, v) => s + v * v, 0))).toBeCloseTo(1);
  });

  it('returns the query untouched when the taste vector is missing, empty, zero, or the wrong size', () => {
    expect(blendVectors(query, null, 0.2)).toBe(query);
    expect(blendVectors(query, [], 0.2)).toBe(query);
    expect(blendVectors(query, [0, 0, 0], 0.2)).toBe(query);
    expect(blendVectors(query, [0, 1], 0.2)).toBe(query);
    expect(blendVectors(query, taste, 0)).toBe(query);
  });
});
