import {
  MIN_SAMPLES_TO_CALIBRATE,
  correctionEntries,
  estimatedOnly,
  summariseAccuracy,
} from './measurement-corrections';

describe('measurement correction log', () => {
  const base = {
    source: 'tailor_question' as const,
    user: '64b000000000000000000001',
    set_name: 'Me',
    unit: 'cm',
    set_method: 'estimate',
    inputs: { height: 175, weight: 80, gender: 'male', full_name: 'never kept' },
  };

  it('keeps before, after and the gap in cm, with how the old number was taken', () => {
    const [e] = correctionEntries({
      ...base,
      meta: { waist: { tier: 'predicted', method: 'tabular', mae_cm: 3 } },
      changes: [{ part: 'waist', before: 82, after: 86 }],
      order: '64b000000000000000000002',
    });
    expect(e).toMatchObject({
      part: 'waist', before_cm: 82, after_cm: 86, delta_cm: 4,
      before_tier: 'predicted', before_method: 'tabular', estimated: true, outlier: false,
    });
    // Only the estimate's inputs are kept, never anything else on them.
    expect(e.inputs).toEqual({ height: 175, weight: 80, gender: 'male' });
  });

  it('converts inches and skips parts that had no number or did not change', () => {
    const entries = correctionEntries({
      ...base,
      unit: 'inch',
      changes: [
        { part: 'chest', before: 40, after: 41 },
        { part: 'neck', before: null, after: 15 },
        { part: 'hip', before: 42, after: 42 },
      ],
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ before_cm: 101.6, after_cm: 104.1, delta_cm: 2.5 });
  });

  it('marks slips as outliers and tells estimates from typed numbers', () => {
    const entries = correctionEntries({
      ...base,
      set_method: 'mixed',
      meta: { chest: { tier: 'measured' }, hip: { tier: 'rough' } },
      changes: [
        { part: 'chest', before: 40, after: 101 },
        { part: 'hip', before: 100, after: 104 },
      ],
    });
    expect(entries[0]).toMatchObject({ estimated: false, outlier: true, inputs: null });
    expect(entries[1]).toMatchObject({ estimated: true, outlier: false });
    // Profile edits keep only replaced estimates.
    expect(estimatedOnly(entries).map((e) => e.part)).toEqual(['hip']);
  });

  it('summarises per part and says when there is enough to calibrate', () => {
    const parts = summariseAccuracy([
      { part: 'waist', estimated: true, count: MIN_SAMPLES_TO_CALIBRATE, bias_cm: 2.04, mae_cm: 3.17 },
      { part: 'waist', estimated: false, count: 4, bias_cm: -0.5, mae_cm: 1 },
      { part: 'neck', estimated: true, count: 3, bias_cm: 1, mae_cm: 1 },
    ]);
    expect(parts[0]).toEqual({
      part: 'waist',
      estimated: { count: 30, bias_cm: 2, mae_cm: 3.2 },
      measured: { count: 4, bias_cm: -0.5, mae_cm: 1 },
      ready_to_calibrate: true,
    });
    expect(parts[1]).toMatchObject({ part: 'neck', ready_to_calibrate: false, measured: null });
  });
});
