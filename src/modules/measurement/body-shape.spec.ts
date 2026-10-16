import { applyBodyShape, bodyShapeDeltas, derivedDeltas, hasBodyShape } from './body-shape';

/**
 * The descriptors move the height/weight model's output; they never invent a
 * part the model did not return, and every moved part says so.
 */
const v2 = (): any => ({
  schema_version: 2,
  inputs: { height_cm: 180.6, weight: 94, gender: 'male' },
  measurements: [
    { name: 'chest', value_cm: 107.2, tier: 'estimated', mae_cm: 4, method: 'tabular' },
    { name: 'waist', value_cm: 97.0, tier: 'estimated', mae_cm: 5, method: 'tabular' },
    { name: 'shoulder_breadth', value_cm: 47.6, tier: 'estimated', mae_cm: 2, method: 'tabular' },
    { name: 'leg_length', value_cm: 82.9, tier: 'estimated', mae_cm: 2.5, method: 'tabular' },
    { name: 'wrist', value_cm: 18.1, tier: 'estimated', mae_cm: 1, method: 'tabular' },
  ],
  by_name: { waist: { value_cm: 97.0, tier: 'estimated' } },
  cm: { chest: 107.2, waist: 97.0, wrist: 18.1 },
  in: { chest: 42.2, waist: 38.19, wrist: 7.13 },
});

describe('bodyShapeDeltas', () => {
  it('"average" everywhere is no adjustment at all', () => {
    expect(bodyShapeDeltas({ build: 'average', stomach: 'average', shoulders: 'average', legs: 'average' })).toEqual({});
    expect(hasBodyShape({ build: 'average' })).toBe(false);
  });

  it('a protruding stomach moves the waist most, the hip a little, nothing else', () => {
    expect(bodyShapeDeltas({ stomach: 'protruding' })).toEqual({ waist: 6, hip: 1 });
  });

  it('descriptors stack on the same part', () => {
    // Broad build + broad shoulders: shoulder breadth gets both.
    expect(bodyShapeDeltas({ build: 'broad', shoulders: 'broad' }).shoulder_breadth).toBe(3);
  });

  it('full thighs move the thigh most, the hip and calf a little', () => {
    expect(bodyShapeDeltas({ thighs: 'full' })).toEqual({ thigh: 3.5, hip: 1.5, calf: 0.5 });
    // Broad build + full thighs stack on the thigh.
    expect(bodyShapeDeltas({ build: 'broad', thighs: 'full' }).thigh).toBe(5.5);
  });

  it('long legs lengthen the inseam and shorten the torso by less', () => {
    expect(bodyShapeDeltas({ legs: 'long' })).toEqual({ leg_length: 2.5, shoulder_to_crotch: -1.5 });
  });
});

describe('derivedDeltas', () => {
  it("a nudged part carries its derived rows with it, by the Space's own rules", () => {
    // Sleeve length is centre back neck to wrist; the Space fits it on
    // shoulder breadth (0.7) and arm length. Broad shoulders reach the sleeve.
    expect(derivedDeltas({ shoulder_breadth: 2 })).toEqual({ sleeve_length: 1.4 });
    // belly waist = waist + 0.30 (hip - waist); top hip uses 0.40.
    expect(derivedDeltas({ waist: 6, hip: 1 })).toEqual({ belly_waist: 4.5, top_hip: 4 });
    // Inseam is leg length minus a fixed ankle height, so it moves one to one.
    expect(derivedDeltas({ leg_length: 2.5, shoulder_to_crotch: -1.5 })).toEqual({ inseam: 2.5 });
    expect(derivedDeltas({})).toEqual({});
  });
});

describe('applyBodyShape', () => {
  it('broad shoulders reach the sleeve the Space derived from the shoulder', () => {
    const p = v2();
    p.measurements.push({ name: 'sleeve_length', value_cm: 88.0, tier: 'estimated', mae_cm: 1.3, method: 'ANSUR II fit (n=6068)' });
    const out = applyBodyShape(p, { shoulders: 'broad' });
    const by = Object.fromEntries(out.measurements.map((m: any) => [m.name, m]));
    expect(by.shoulder_breadth.value_cm).toBe(49.6);
    expect(by.sleeve_length.value_cm).toBe(89.4);
    expect(by.sleeve_length.method).toBe('ANSUR II fit (n=6068)+shape');
    expect(out.inputs.body_shape_deltas_cm).toEqual({ shoulder_breadth: 2 });
    expect(out.inputs.body_shape_derived_deltas_cm).toEqual({ sleeve_length: 1.4 });
  });

  it('moves the parts the shape names, in every place the payload carries them', () => {
    const out = applyBodyShape(v2(), { stomach: 'slightly_protruding', shoulders: 'narrow' });
    const by = Object.fromEntries(out.measurements.map((m: any) => [m.name, m]));
    expect(by.waist.value_cm).toBe(100);
    expect(by.waist.method).toBe('tabular+shape');
    expect(by.shoulder_breadth.value_cm).toBe(45.6);
    expect(by.chest.value_cm).toBe(107.2);
    expect(by.chest.method).toBe('tabular');
    expect(out.by_name.waist.value_cm).toBe(100);
    expect(out.cm.waist).toBe(100);
    expect(out.in.waist).toBe(39.37);
    expect(out.cm.wrist).toBe(18.1);
  });

  it('records what was applied in the inputs, for the audit trail', () => {
    const out = applyBodyShape(v2(), { legs: 'short' });
    expect(out.inputs.body_shape).toEqual({ legs: 'short' });
    expect(out.inputs.body_shape_deltas_cm).toEqual({ leg_length: -2.5, shoulder_to_crotch: 1.5 });
    expect(out.inputs.height_cm).toBe(180.6);
  });

  it('never invents a part the model did not return', () => {
    const out = applyBodyShape(v2(), { stomach: 'protruding' });
    expect(out.measurements.find((m: any) => m.name === 'hip')).toBeUndefined();
    expect(out.cm.hip).toBeUndefined();
  });

  it('leaves the payload untouched when the shape is empty or average', () => {
    const input = v2();
    expect(applyBodyShape(input, undefined)).toBe(input);
    expect(applyBodyShape(input, { build: 'average' })).toBe(input);
  });

  it('keeps the tier: an estimate stays an estimate', () => {
    const out = applyBodyShape(v2(), { build: 'broad' });
    expect(out.measurements.find((m: any) => m.name === 'chest').tier).toBe('estimated');
  });
});
