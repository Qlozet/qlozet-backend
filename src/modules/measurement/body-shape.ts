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

export interface BodyShape {
  build?: BodyBuild;
  stomach?: Stomach;
  shoulders?: Shoulders;
  legs?: Legs;
}

export const BODY_SHAPE_VALUES = {
  build: ['slim', 'average', 'broad'],
  stomach: ['flat', 'average', 'slightly_protruding', 'protruding'],
  shoulders: ['narrow', 'average', 'broad'],
  legs: ['short', 'average', 'long'],
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

  for (const k of Object.keys(d)) if (d[k] === 0) delete d[k];
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
  const deltas = bodyShapeDeltas(shape);
  if (!Object.keys(deltas).length) return prediction;

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
  out.inputs = { ...(out.inputs ?? {}), body_shape: { ...shape }, body_shape_deltas_cm: deltas };
  return out as T;
}
