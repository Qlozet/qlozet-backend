/**
 * Which body measurements a garment needs before a tailor can cut it.
 *
 * A measurement set is one list of body points; a garment uses some of them.
 * Trousers need waist, hip, thigh and a leg length, and nothing about
 * sleeves; an agbada needs the shoulders and sleeves. Each need accepts any
 * of a few keys, because a set can hold the same point under different names
 * (the manual form's 14 points, an estimate's tailoring rows, a tailor's book
 * read from a photo): a shoulder is a seam-to-seam width or a bone-to-bone
 * breadth, a sleeve is a sleeve length or an arm length.
 *
 * Used at checkout and bespoke acceptance (missing needs refuse the order),
 * and saved on the order line so the tailor sees which needed numbers are
 * only rough estimates and which extras they may want to ask for.
 *
 * Pure. The shop mirrors this file (lib/garment-measurements.ts); keep them
 * in step.
 */

export type GarmentKind =
  | 'top'
  | 'trousers'
  | 'shorts'
  | 'skirt'
  | 'dress'
  | 'jumpsuit'
  | 'robe'
  | 'suit'
  | 'set'
  | 'swimwear';

export type NeedId =
  | 'chest'
  | 'waist'
  | 'hip'
  | 'shoulder'
  | 'sleeve'
  | 'top_length'
  | 'torso'
  | 'full_length'
  | 'trouser_length'
  | 'thigh'
  | 'bicep'
  | 'wrist'
  | 'neck'
  | 'under_bust'
  | 'knee'
  | 'ankle'
  | 'across_back';

/** The keys that satisfy each need, best first. */
export const NEED_KEYS: Record<NeedId, string[]> = {
  chest: ['chest', 'bust'],
  waist: ['waist', 'belly_waist'],
  hip: ['hip', 'hips'],
  shoulder: ['shoulder_width', 'shoulder_breadth', 'shoulder'],
  sleeve: ['sleeve_length', 'arm_length'],
  // A top's length is cut from the torso or the height.
  top_length: ['nape_to_waist', 'shoulder_to_crotch', 'front_length', 'back_length', 'height'],
  torso: ['shoulder_to_crotch', 'nape_to_waist'],
  full_length: ['height', 'neck_height'],
  trouser_length: ['outseam', 'inseam', 'leg_length'],
  thigh: ['thigh', 'mid_thigh'],
  bicep: ['bicep', 'upper_arm'],
  wrist: ['wrist'],
  neck: ['neck', 'neck_base', 'neck_circumference'],
  under_bust: ['under_bust'],
  knee: ['knee'],
  ankle: ['ankle'],
  across_back: ['across_back'],
};

export const NEED_LABELS: Record<NeedId, string> = {
  chest: 'chest',
  waist: 'waist',
  hip: 'hips',
  shoulder: 'shoulder',
  sleeve: 'sleeve or arm length',
  top_length: 'torso length or height',
  torso: 'torso length',
  full_length: 'height',
  trouser_length: 'leg length',
  thigh: 'thigh',
  bicep: 'bicep',
  wrist: 'wrist',
  neck: 'neck',
  under_bust: 'under bust',
  knee: 'knee',
  ankle: 'ankle',
  across_back: 'across back',
};

export const GARMENT_LABELS: Record<GarmentKind, string> = {
  top: 'top',
  trousers: 'pair of trousers',
  shorts: 'pair of shorts',
  skirt: 'skirt',
  dress: 'dress',
  jumpsuit: 'jumpsuit',
  robe: 'agbada or kaftan',
  suit: 'suit',
  set: 'set',
  swimwear: 'swimwear piece',
};

interface GarmentNeeds {
  /** Without these the order is refused. All are on the manual form. */
  required: NeedId[];
  /** A tailor often wants these too; shown to them, never blocking. */
  helpful: NeedId[];
}

const TOP: GarmentNeeds = {
  required: ['chest', 'waist', 'shoulder', 'sleeve', 'top_length'],
  helpful: ['neck', 'bicep', 'wrist', 'across_back'],
};
const TROUSERS: GarmentNeeds = {
  required: ['waist', 'hip', 'thigh', 'trouser_length'],
  helpful: ['knee', 'ankle'],
};

export const GARMENT_NEEDS: Record<GarmentKind, GarmentNeeds> = {
  top: TOP,
  trousers: TROUSERS,
  shorts: { required: ['waist', 'hip', 'thigh'], helpful: ['trouser_length'] },
  skirt: { required: ['waist', 'hip', 'full_length'], helpful: ['knee'] },
  dress: {
    required: ['chest', 'waist', 'hip', 'shoulder', 'full_length'],
    helpful: ['under_bust', 'torso', 'sleeve', 'bicep'],
  },
  jumpsuit: {
    required: ['chest', 'waist', 'hip', 'shoulder', 'torso', 'trouser_length'],
    helpful: ['thigh', 'sleeve', 'bicep'],
  },
  // Agbada, kaftan: a long top worn over trousers.
  robe: {
    required: ['chest', 'shoulder', 'sleeve', 'full_length', 'waist', 'trouser_length'],
    helpful: ['neck', 'bicep', 'wrist', 'hip', 'thigh'],
  },
  suit: {
    required: [...TOP.required, 'hip', 'thigh', 'trouser_length'],
    helpful: [...TOP.helpful, 'knee', 'ankle'],
  },
  // A top and a bottom whose shape we don't know (trousers, skirt, wrapper).
  set: {
    required: [...TOP.required, 'hip'],
    helpful: [...TOP.helpful, 'thigh', 'trouser_length', 'full_length'],
  },
  swimwear: { required: ['chest', 'waist', 'hip'], helpful: ['torso', 'under_bust'] },
};

const norm = (s: unknown) =>
  String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z&]+/g, ' ')
    .trim();

/** Taxonomy categories that name the garment better than the product type. */
const CATEGORY_KINDS: Record<string, GarmentKind> = {
  agbada: 'robe',
  kaftan: 'robe',
  kaftans: 'robe',
  dashiki: 'top',
  'buba & iro': 'set',
  blazer: 'top',
  jacket: 'top',
  kimono: 'top',
  cape: 'top',
  playsuit: 'jumpsuit',
  romper: 'jumpsuit',
  'cover up': 'top',
};

/** Product types (taxonomy) and bespoke design categories. */
const TYPE_KINDS: Record<string, GarmentKind> = {
  dress: 'dress',
  dresses: 'dress',
  top: 'top',
  tops: 'top',
  shirt: 'top',
  shirts: 'top',
  blouse: 'top',
  trousers: 'trousers',
  pants: 'trousers',
  shorts: 'shorts',
  skirt: 'skirt',
  skirts: 'skirt',
  suit: 'suit',
  suits: 'suit',
  jumpsuit: 'jumpsuit',
  jumpsuits: 'jumpsuit',
  outerwear: 'top',
  swimwear: 'swimwear',
  sets: 'set',
  set: 'set',
  agbada: 'robe',
  kaftan: 'robe',
};

/**
 * The garment a listing or design is, from its taxonomy (product type and
 * categories) or a bespoke design's category. Null when we can't tell
 * ("Traditional / Aso-Ebi"): the order then falls back to the general check.
 */
export function garmentKindOf(source: {
  product_type?: string | null;
  categories?: (string | null | undefined)[] | null;
  category?: string | null;
} | null | undefined): GarmentKind | null {
  if (!source) return null;
  const cats = [...(source.categories ?? []), source.category].map(norm).filter(Boolean);
  for (const c of cats) {
    if (CATEGORY_KINDS[c]) return CATEGORY_KINDS[c];
  }
  const type = norm(source.product_type);
  if (TYPE_KINDS[type]) return TYPE_KINDS[type];
  for (const c of cats) {
    if (TYPE_KINDS[c]) return TYPE_KINDS[c];
  }
  return null;
}

type Meta = Record<string, { tier?: string } | null | undefined> | null | undefined;

const positive = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0;
};

/** The key that satisfies a need in these measurements, if any. */
export function keyFor(need: NeedId, measurements: Record<string, unknown> | null | undefined): string | null {
  const m = measurements ?? {};
  return NEED_KEYS[need].find((k) => positive((m as any)[k])) ?? null;
}

export interface GarmentCheck {
  garment: GarmentKind;
  /** Required needs nothing in the set satisfies. Non-empty refuses the order. */
  missing: NeedId[];
  /** Required needs met only by rough estimates. The tailor should confirm. */
  rough: NeedId[];
  /** Helpful extras the set doesn't have; the tailor may ask for them. */
  helpful_missing: NeedId[];
}

/**
 * How well a set covers a garment. A need is rough when every key that
 * satisfies it is a rough estimate (tier 'rough' in the set's notes).
 */
export function checkGarment(
  garment: GarmentKind,
  measurements: Record<string, unknown> | null | undefined,
  meta?: Meta,
): GarmentCheck {
  const needs = GARMENT_NEEDS[garment];
  const missing: NeedId[] = [];
  const rough: NeedId[] = [];
  for (const need of needs.required) {
    const present = NEED_KEYS[need].filter((k) => positive((measurements ?? ({} as any))[k]));
    if (!present.length) missing.push(need);
    else if (meta && present.every((k) => meta[k]?.tier === 'rough')) rough.push(need);
  }
  const helpful_missing = needs.helpful.filter((n) => !keyFor(n, measurements));
  return { garment, missing, rough, helpful_missing };
}

const list = (items: string[]) =>
  items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

/** What the customer is told when a garment's needs aren't in their set. */
export function missingMeasurementsMessage(check: GarmentCheck): string {
  const names = list(check.missing.map((n) => NEED_LABELS[n]));
  return (
    `To make this ${GARMENT_LABELS[check.garment]} the tailor needs your ${names}. ` +
    'Add them in Profile, then My Measurement.'
  );
}
