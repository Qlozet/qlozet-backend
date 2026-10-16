/**
 * Body-shape adjustments on top of the height/weight/gender prediction.
 *
 * The tabular model on the Space takes only height, weight and gender, so two
 * people with the same three numbers get the same chest, waist and shoulders.
 * Four plain-language descriptors a person can answer about themselves move
 * the estimate towards where their mass actually sits. The deltas are modest,
 * bounded, and in centimetres; they adjust the model's output, they never
 * replace it, and every adjusted part is tagged so a tailor can see it.
 *
 * Calibration (tailor corrections against estimated sets) is where these
 * numbers should eventually come from; until then they are conservative.
 */
export type BodyBuild = 'slim' | 'average' | 'broad';
export type Stomach = 'flat' | 'average' | 'slightly_protruding' | 'protruding';
export type Shoulders = 'narrow' | 'average' | 'broad';
export type Legs = 'short' | 'average' | 'long';
export type Thighs = 'slim' | 'average' | 'full';

export interface BodyShape {
  build?: BodyBuild;
  stomach?: Stomach;
  shoulders?: Shoulders;
  legs?: Legs;
  thighs?: Thighs;
}

export const BODY_SHAPE_VALUES = {
  build: ['slim', 'average', 'broad'],
  stomach: ['flat', 'average', 'slightly_protruding', 'protruding'],
  shoulders: ['narrow', 'average', 'broad'],
  legs: ['short', 'average', 'long'],
  thighs: ['slim', 'average', 'full'],
} as const;

/** Centimetre deltas per body part for a given shape. Unlisted parts: 0. */
export function bodyShapeDeltas(shape: BodyShape | null | undefined): Record<string, number> {
  const d: Record<string, number> = {};
  const add = (part: string, cm: number) => {
    d[part] = Math.round(((d[part] ?? 0) + cm) * 10) / 10;
  };
  if (!shape) return d;

  if (shape.build === 'slim') {
    add('chest', -2.5); add('bicep', -1); add('thigh', -1.5); add('forearm', -0.5); add('calf', -0.5);
  } else if (shape.build === 'broad') {
    add('chest', 3); add('bicep', 1.5); add('thigh', 2); add('forearm', 0.5); add('calf', 0.5); add('shoulder_breadth', 1);
  }

  if (shape.stomach === 'flat') add('waist', -3);
  else if (shape.stomach === 'slightly_protruding') add('waist', 3);
  else if (shape.stomach === 'protruding') { add('waist', 6); add('hip', 1); }

  if (shape.shoulders === 'narrow') add('shoulder_breadth', -2);
  else if (shape.shoulders === 'broad') add('shoulder_breadth', 2);

  if (shape.legs === 'short') { add('leg_length', -2.5); add('shoulder_to_crotch', 1.5); }
  else if (shape.legs === 'long') { add('leg_length', 2.5); add('shoulder_to_crotch', -1.5); }

  // Thighs vary most between people of the same weight, and trousers forgive
  // it least; the model predicts them from weight alone. Full thighs usually
  // come with fuller hips and calves, so those follow by a little.
  if (shape.thighs === 'slim') { add('thigh', -2.5); add('hip', -1); }
  else if (shape.thighs === 'full') { add('thigh', 3.5); add('hip', 1.5); add('calf', 0.5); }

  for (const k of Object.keys(d)) if (d[k] === 0) delete d[k];
  return d;
}

/**
 * The Space derives the tailoring rows from the 14 predicted parts
 * (hybrid_body_measurement_mask/src/derived.py; fitted coefficients in
 * outputs/models/derived_coeffs.json, read 2026-10-15) BEFORE our nudge
 * exists, so a moved part would leave its derived rows behind: broad
 * shoulders would never reach the sleeve. Every rule there is linear, so the
 * derived row moves by the same rule applied to the deltas. Fitted rules
 * keep their ANSUR II coefficients; the rest are the Space's ratios. Keep in
 * step with derived.py when the Space refits.
 */
const DERIVED_RULES: Record<string, Record<string, number>> = {
  sleeve_length: { shoulder_breadth: 0.7, arm_length: 0.755 }, // centre back neck to wrist (ANSUR fit)
  neck: { chest: 0.064 }, // ANSUR fit
  neck_base: { chest: 0.061 }, // ANSUR fit
  lower_thigh: { thigh: 0.234, calf: 0.41 }, // ANSUR fit
  knee: { calf: 1.03 },
  mid_thigh: { thigh: 0.85 },
  belly_waist: { waist: 0.7, hip: 0.3 }, // waist + 0.30 x (hip - waist)
  top_hip: { waist: 0.6, hip: 0.4 }, // waist + 0.40 x (hip - waist)
  inseam: { leg_length: 1 }, // leg length - ankle height
  under_bust: { chest: 1 }, // chest - 9
};

/** Deltas for the derived tailoring rows implied by the base-part deltas. */
export function derivedDeltas(base: Record<string, number>): Record<string, number> {
  const d: Record<string, number> = {};
  for (const [row, rule] of Object.entries(DERIVED_RULES)) {
    let cm = 0;
    for (const [part, w] of Object.entries(rule)) cm += (base[part] ?? 0) * w;
    cm = Math.round(cm * 10) / 10;
    if (cm !== 0) d[row] = cm;
  }
  return d;
}

export const hasBodyShape = (shape: BodyShape | null | undefined): boolean =>
  !!shape && Object.values(shape).some((v) => v && v !== 'average');

const CM_PER_INCH = 2.54;
const r1 = (n: number) => Math.round(n * 10) / 10;
const normalise = (name: unknown) =>
  (typeof name === 'string' ? name : '').trim().toLowerCase().replace(/[\s-]+/g, '_');

/**
 * Apply the deltas to a prediction payload in place-safe fashion (returns a
 * new object). Understands the Space's v2 shape (`measurements[]`, `by_name`,
 * `cm`, `in`) and the v1 fallbacks (`cm`, `derived[]`). A part that is not in
 * the payload is left alone - nothing is invented. Adjusted parts get
 * `method: "<method>+shape"`; the descriptors are recorded in `inputs`.
 */
export function applyBodyShape<T extends Record<string, any>>(prediction: T, shape: BodyShape | null | undefined): T {
  if (!prediction || typeof prediction !== 'object' || !hasBodyShape(shape)) return prediction;
  const base = bodyShapeDeltas(shape);
  if (!Object.keys(base).length) return prediction;
  const derived = derivedDeltas(base);
  // A base part wins if a name ever appears in both.
  const deltas: Record<string, number> = { ...derived, ...base };

  const out: any = { ...prediction };
  const bump = (name: string, value: number) => {
    const delta = deltas[name];
    if (delta === undefined || typeof value !== 'number' || !Number.isFinite(value)) return value;
    return r1(Math.max(1, value + delta));
  };

  if (Array.isArray(out.measurements)) {
    out.measurements = out.measurements.map((m: any) => {
      const name = normalise(m?.name);
      if (!(name in deltas) || typeof m?.value_cm !== 'number') return m;
      return {
        ...m,
        value_cm: bump(name, m.value_cm),
        method: m?.method ? `${m.method}+shape` : 'tabular+shape',
      };
    });
  }
  if (Array.isArray(out.derived)) {
    out.derived = out.derived.map((m: any) => {
      const name = normalise(m?.name);
      if (!(name in deltas) || typeof m?.value_cm !== 'number') return m;
      return { ...m, value_cm: bump(name, m.value_cm), method: m?.method ? `${m.method}+shape` : 'tabular+shape' };
    });
  }
  if (out.by_name && typeof out.by_name === 'object') {
    const next: Record<string, any> = {};
    for (const [k, v] of Object.entries(out.by_name)) {
      const name = normalise(k);
      if (name in deltas && v && typeof v === 'object' && typeof (v as any).value_cm === 'number') {
        next[k] = { ...(v as any), value_cm: bump(name, (v as any).value_cm), method: (v as any).method ? `${(v as any).method}+shape` : 'tabular+shape' };
      } else next[k] = v;
    }
    out.by_name = next;
  }
  if (out.cm && typeof out.cm === 'object') {
    const cm: Record<string, any> = {};
    const inch: Record<string, any> = out.in && typeof out.in === 'object' ? { ...out.in } : null;
    for (const [k, v] of Object.entries(out.cm)) {
      const name = normalise(k);
      if (name in deltas && typeof v === 'number') {
        const nv = bump(name, v);
        cm[k] = nv;
        if (inch && k in inch) inch[k] = Math.round((nv / CM_PER_INCH) * 100) / 100;
      } else cm[k] = v;
    }
    out.cm = cm;
    if (inch) out.in = inch;
  }
  out.inputs = {
    ...(out.inputs ?? {}),
    body_shape: { ...shape },
    body_shape_deltas_cm: base,
    body_shape_derived_deltas_cm: derived,
  };
  return out as T;
}
