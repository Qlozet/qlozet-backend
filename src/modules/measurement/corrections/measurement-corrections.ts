/**
 * The measurement correction log: every time a number we had is replaced by
 * a better one, we keep the pair.
 *
 * Two moments give us the truth:
 * - tailor_question: a tailor asked about the measurements on an order and
 *   the customer answered with a different number;
 * - profile_edit: the customer typed over an estimated value in their
 *   profile.
 *
 * Each entry keeps the part, the number before and after (in cm), how the
 * number before was taken (its tier and method), and the estimate's inputs
 * (height, weight, gender, body shape), so the log can later:
 *   1. show how far off each estimated part runs on Qlozet's own customers,
 *      and correct new estimates by that bias;
 *   2. become training data to refit the estimator on Nigerian bodies.
 *
 * Nothing here changes a customer's numbers. Pure; the services write it.
 */

export type CorrectionSource = 'tailor_question' | 'profile_edit';

/** Tiers that mean "we guessed": a correction of these measures the estimator. */
export const ESTIMATED_TIERS = new Set(['predicted', 'estimated', 'rough']);

/** A part needs this many corrections before its average is worth acting on. */
export const MIN_SAMPLES_TO_CALIBRATE = 30;

/**
 * A change bigger than this share of the old value is more likely a slip
 * (inches typed as cm, a waist in the hip box) than a measurement. Kept, but
 * left out of the averages.
 */
export const OUTLIER_SHARE = 0.35;

const CM_PER_INCH = 2.54;
const r1 = (n: number) => Math.round(n * 10) / 10;

export const toCm = (value: number, unit?: string | null) =>
  r1(unit === 'inch' || unit === 'in' ? value * CM_PER_INCH : value);

export interface CorrectionInput {
  source: CorrectionSource;
  user: string;
  set_name?: string | null;
  unit?: string | null;
  /** The set's method (manual / estimate / mixed / scan / photo). */
  set_method?: string | null;
  /** The set's per-value notes before the change. */
  meta?: Record<string, { tier?: string; method?: string; mae_cm?: number | null } | null> | null;
  /** The estimate's inputs, if the set was estimated. */
  inputs?: Record<string, any> | null;
  changes: { part: string; before: number | null | undefined; after: number }[];
  order?: string | null;
  business?: string | null;
}

export interface CorrectionEntry {
  source: CorrectionSource;
  user: string;
  set_name: string | null;
  part: string;
  before_cm: number;
  after_cm: number;
  /** after - before: positive means we had it too small. */
  delta_cm: number;
  before_tier: string | null;
  before_method: string | null;
  set_method: string | null;
  /** The number before was a guess (an estimate), not a tape measure. */
  estimated: boolean;
  outlier: boolean;
  inputs: Record<string, any> | null;
  order: string | null;
  business: string | null;
}

/** The estimate inputs worth keeping for refitting (never names or photos). */
function trainingInputs(inputs: Record<string, any> | null | undefined): Record<string, any> | null {
  if (!inputs || typeof inputs !== 'object') return null;
  const keep: Record<string, any> = {};
  for (const k of ['height', 'weight', 'gender', 'age', 'unit', 'body_shape']) {
    if (inputs[k] !== undefined && inputs[k] !== null) keep[k] = inputs[k];
  }
  return Object.keys(keep).length ? keep : null;
}

/**
 * The log entries for a set of changes. Skips parts that had no number
 * before (nothing was wrong, it was just missing) and changes of nothing.
 */
export function correctionEntries(input: CorrectionInput): CorrectionEntry[] {
  const out: CorrectionEntry[] = [];
  const setEstimated = input.set_method === 'estimate' || input.set_method === 'scan';
  for (const c of input.changes) {
    const before = Number(c.before);
    const after = Number(c.after);
    if (!(before > 0) || !(after > 0) || before === after) continue;
    const note = input.meta?.[c.part] ?? null;
    const tier = note?.tier ?? null;
    // A part the customer already measured themselves isn't an estimate,
    // even inside an estimated set.
    const estimated = tier ? ESTIMATED_TIERS.has(tier) : setEstimated;
    const before_cm = toCm(before, input.unit);
    const after_cm = toCm(after, input.unit);
    out.push({
      source: input.source,
      user: input.user,
      set_name: input.set_name ?? null,
      part: c.part,
      before_cm,
      after_cm,
      delta_cm: r1(after_cm - before_cm),
      before_tier: tier,
      before_method: note?.method ?? null,
      set_method: input.set_method ?? null,
      estimated,
      outlier: Math.abs(after - before) / before > OUTLIER_SHARE,
      inputs: estimated ? trainingInputs(input.inputs) : null,
      order: input.order ?? null,
      business: input.business ?? null,
    });
  }
  return out;
}

/**
 * The profile edits worth logging: only values that were estimates. A
 * customer fixing a number they typed themselves tells us nothing about the
 * estimator.
 */
export function estimatedOnly(entries: CorrectionEntry[]): CorrectionEntry[] {
  return entries.filter((e) => e.estimated);
}

export interface AccuracyRow {
  part: string;
  estimated: boolean;
  count: number;
  bias_cm: number;
  mae_cm: number;
}

export interface PartAccuracy {
  part: string;
  /** Corrections of estimated values: how far off the estimator runs. */
  estimated: { count: number; bias_cm: number; mae_cm: number } | null;
  /** Corrections of typed or measured values: how far off people measure. */
  measured: { count: number; bias_cm: number; mae_cm: number } | null;
  /** Enough estimated corrections to correct new estimates by the bias. */
  ready_to_calibrate: boolean;
}

/** Group by part and whether the old value was an estimate; outliers left out. */
export const ACCURACY_PIPELINE = [
  { $match: { outlier: false } },
  {
    $group: {
      _id: { part: '$part', estimated: '$estimated' },
      count: { $sum: 1 },
      bias_cm: { $avg: '$delta_cm' },
      mae_cm: { $avg: { $abs: '$delta_cm' } },
    },
  },
  {
    $project: {
      _id: 0,
      part: '$_id.part',
      estimated: '$_id.estimated',
      count: 1,
      bias_cm: 1,
      mae_cm: 1,
    },
  },
];

export function summariseAccuracy(rows: AccuracyRow[]): PartAccuracy[] {
  const byPart = new Map<string, PartAccuracy>();
  for (const row of rows) {
    const p =
      byPart.get(row.part) ??
      { part: row.part, estimated: null, measured: null, ready_to_calibrate: false };
    const stats = { count: row.count, bias_cm: r1(row.bias_cm), mae_cm: r1(row.mae_cm) };
    if (row.estimated) {
      p.estimated = stats;
      p.ready_to_calibrate = row.count >= MIN_SAMPLES_TO_CALIBRATE;
    } else {
      p.measured = stats;
    }
    byPart.set(row.part, p);
  }
  const total = (p: PartAccuracy) => (p.estimated?.count ?? 0) + (p.measured?.count ?? 0);
  return [...byPart.values()].sort((a, b) => total(b) - total(a) || a.part.localeCompare(b.part));
}
