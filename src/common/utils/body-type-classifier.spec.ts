import { classifyBodyType, BodyTypeResult } from './body-type-classifier';

describe('classifyBodyType', () => {
  /* ─── Insufficient Data ──────────────────────────────────── */

  describe('insufficient measurements', () => {
    it('returns unclassified with only 1 measurement', () => {
      const result = classifyBodyType({ chest: 90 }, 'female');
      expect(result.bodyType).toBe('unclassified');
      expect(result.confidence).toBe('low');
      expect(result.flattering_fits).toEqual([]);
    });

    it('returns unclassified with empty measurements', () => {
      const result = classifyBodyType({}, 'male');
      expect(result.bodyType).toBe('unclassified');
      expect(result.confidence).toBe('low');
    });

    it('returns unclassified when all values are missing', () => {
      const result = classifyBodyType({ height: 170, neck: 38 });
      expect(result.bodyType).toBe('unclassified');
    });
  });

  /* ─── Confidence Levels ──────────────────────────────────── */

  describe('confidence scoring', () => {
    it('returns high confidence with 4 measurements', () => {
      const result = classifyBodyType(
        { chest: 100, waist: 80, hip: 95, shoulder_breadth: 48 },
        'male',
      );
      expect(result.confidence).toBe('high');
    });

    it('returns medium confidence with 2–3 measurements', () => {
      const result = classifyBodyType({ chest: 90, waist: 70 }, 'female');
      expect(result.confidence).toBe('medium');
    });

    it('returns medium confidence with 3 measurements', () => {
      const result = classifyBodyType(
        { bust: 90, waist: 68, hip: 100 },
        'female',
      );
      expect(result.confidence).toBe('medium');
    });
  });

  /* ─── Male Classifications ───────────────────────────────── */

  describe('male body types', () => {
    it('classifies athletic (V-shape): broad shoulders, narrow waist', () => {
      // upper/lower >= 1.1 and waist/upper < 0.8
      const result = classifyBodyType(
        { chest: 110, waist: 78, hip: 95 },
        'male',
      );
      expect(result.bodyType).toBe('athletic');
      expect(result.flattering_fits).toContain('slim');
    });

    it('classifies round: waist ≥ shoulders', () => {
      const result = classifyBodyType(
        { shoulder_breadth: 48, waist: 48, hip: 46 },
        'male',
      );
      expect(result.bodyType).toBe('round');
    });

    it('classifies triangle: hips wider than shoulders', () => {
      const result = classifyBodyType(
        { shoulder_breadth: 42, waist: 36, hip: 48 },
        'male',
      );
      expect(result.bodyType).toBe('triangle');
    });

    it('classifies rectangle: uniform proportions', () => {
      const result = classifyBodyType(
        { shoulder_breadth: 46, waist: 42, hip: 44 },
        'male',
      );
      expect(result.bodyType).toBe('rectangle');
    });

    it('classifies trapezoid: slightly broader shoulders', () => {
      const result = classifyBodyType(
        { shoulder_breadth: 48, waist: 40, hip: 44 },
        'male',
      );
      expect(result.bodyType).toBe('trapezoid');
    });

    it('two-measurement fallback: chest + waist (athletic)', () => {
      const result = classifyBodyType({ chest: 110, waist: 78 }, 'male');
      expect(result.bodyType).toBe('athletic');
    });

    it('two-measurement fallback: chest + waist (round)', () => {
      const result = classifyBodyType({ chest: 100, waist: 100 }, 'male');
      expect(result.bodyType).toBe('round');
    });
  });

  /* ─── Female Classifications ─────────────────────────────── */

  describe('female body types', () => {
    it('classifies hourglass: balanced bust/hips, defined waist', () => {
      const result = classifyBodyType(
        { bust: 92, waist: 66, hip: 95 },
        'female',
      );
      expect(result.bodyType).toBe('hourglass');
      expect(result.flattering_fits).toContain('wrap');
    });

    it('classifies pear: hips wider than bust', () => {
      const result = classifyBodyType(
        { bust: 80, waist: 68, hip: 102 },
        'female',
      );
      expect(result.bodyType).toBe('pear');
      expect(result.flattering_fits).toContain('A-line');
    });

    it('classifies apple: waist close to bust, bigger than hips', () => {
      const result = classifyBodyType(
        { bust: 100, waist: 95, hip: 98 },
        'female',
      );
      expect(result.bodyType).toBe('apple');
    });

    it('classifies inverted_triangle: bust much larger than hips', () => {
      const result = classifyBodyType(
        { bust: 105, waist: 70, hip: 85 },
        'female',
      );
      expect(result.bodyType).toBe('inverted_triangle');
    });

    it('classifies rectangle: uniform female proportions', () => {
      const result = classifyBodyType(
        { bust: 88, waist: 78, hip: 90 },
        'female',
      );
      expect(result.bodyType).toBe('rectangle');
    });

    it('two-measurement fallback: bust + hip (pear)', () => {
      const result = classifyBodyType({ bust: 80, hip: 100 }, 'female');
      expect(result.bodyType).toBe('pear');
    });

    it('two-measurement fallback: bust + hip (inverted_triangle)', () => {
      const result = classifyBodyType({ bust: 105, hip: 88 }, 'female');
      expect(result.bodyType).toBe('inverted_triangle');
    });

    it('two-measurement fallback: waist + hip (pear)', () => {
      const result = classifyBodyType({ waist: 65, hip: 100 }, 'female');
      expect(result.bodyType).toBe('pear');
    });
  });

  /* ─── Gender Fallback ────────────────────────────────────── */

  describe('gender handling', () => {
    it('defaults to female classification logic when no gender provided', () => {
      // bust ≈ hip, defined waist → should classify as hourglass via female logic
      const result = classifyBodyType({ bust: 92, waist: 66, hip: 95 });
      expect(result.bodyType).toBe('hourglass');
    });

    it('handles gender "m" as male', () => {
      const result = classifyBodyType(
        { chest: 110, waist: 78, hip: 95 },
        'm',
      );
      expect(result.bodyType).toBe('athletic');
    });

    it('handles gender "f" as female', () => {
      const result = classifyBodyType(
        { bust: 80, waist: 68, hip: 102 },
        'f',
      );
      expect(result.bodyType).toBe('pear');
    });

    it('handles uppercase gender "MALE"', () => {
      const result = classifyBodyType(
        { chest: 110, waist: 78 },
        'MALE',
      );
      expect(result.bodyType).toBe('athletic');
    });
  });

  /* ─── Measurement Aliases ────────────────────────────────── */

  describe('measurement name aliases', () => {
    it('accepts "bust" as alias for "chest"', () => {
      const result = classifyBodyType(
        { bust: 92, waist: 66, hip: 95 },
        'female',
      );
      expect(result.bodyType).toBe('hourglass');
    });

    it('accepts "hips" as alias for "hip"', () => {
      const result = classifyBodyType(
        { bust: 80, waist: 68, hips: 102 },
        'female',
      );
      expect(result.bodyType).toBe('pear');
    });

    it('accepts "shoulder" as alias for "shoulder_breadth"', () => {
      // shoulder is used as alias for shoulder_breadth, which becomes "upper"
      // upper/lower >= 1.1 and waist/upper < 0.8 → athletic
      const result = classifyBodyType(
        { shoulder: 110, waist: 78, hip: 95 },
        'male',
      );
      expect(result.bodyType).toBe('athletic');
    });
  });

  /* ─── Return Shape ───────────────────────────────────────── */

  describe('return structure', () => {
    it('returns all required fields', () => {
      const result = classifyBodyType(
        { bust: 92, waist: 66, hip: 95 },
        'female',
      );
      expect(result).toHaveProperty('bodyType');
      expect(result).toHaveProperty('confidence');
      expect(result).toHaveProperty('styleAdvice');
      expect(result).toHaveProperty('flattering_fits');
      expect(result).toHaveProperty('avoid_fits');
      expect(Array.isArray(result.styleAdvice)).toBe(true);
      expect(Array.isArray(result.flattering_fits)).toBe(true);
      expect(Array.isArray(result.avoid_fits)).toBe(true);
    });

    it('style advice is non-empty for classified body types', () => {
      const result = classifyBodyType(
        { bust: 92, waist: 66, hip: 95 },
        'female',
      );
      expect(result.styleAdvice.length).toBeGreaterThan(0);
    });
  });
});
