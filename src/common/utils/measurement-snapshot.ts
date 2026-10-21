/**
 * The copy of a customer's measurements an order is made to.
 *
 * One builder for the three places that freeze measurements (a made-to-order
 * line, the order itself, a bespoke acceptance) and the one place that shows
 * them before an order exists (a bespoke quote request), so the tailor always
 * gets the same picture: the numbers, how they were taken, and when.
 */

/** How a set was taken, as far as Qlozet knows. */
export type MeasurementMethod = 'manual' | 'estimate' | 'mixed' | 'scan';

export interface MeasurementSnapshot {
  body_type: string | null;
  confidence: string | null;
  measurements: Record<string, number>;
  unit: string;
  fit_preferences: string[];
  set_name: string | null;
  /** Per-measurement { tier, mae_cm, method } from the estimate, if any. */
  tailoring_meta: Record<string, { tier?: string; mae_cm?: number | null; method?: string }> | null;
  /** Null for a set saved before Qlozet recorded it. */
  method: MeasurementMethod | null;
  /** When the set was last taken or edited. */
  measured_at: Date | null;
}

/**
 * How a set was taken. Sets saved before the field existed are read from what
 * they carry: an estimate always left its inputs or per-value metadata.
 */
export function setMethod(set: any): MeasurementMethod | null {
  if (!set) return null;
  if (set.method) return set.method as MeasurementMethod;
  if (set.tailoring_meta || set.inputs) return 'estimate';
  return null;
}

/** A Mongoose Map or a plain object, as a plain object of numbers. */
export function plainMeasurements(m: any): Record<string, number> {
  if (!m) return {};
  if (m instanceof Map) return Object.fromEntries(m.entries());
  return { ...m };
}

/** Pick the set: by name, else the active one, else (optionally) the first. */
export function chooseSet(sets: any[] | undefined, name?: string | null, fallbackToFirst = false): any | null {
  const list = sets ?? [];
  if (!list.length) return null;
  return (
    (name && list.find((s) => s?.name === name)) ||
    list.find((s) => s?.active) ||
    (fallbackToFirst ? list[0] : null) ||
    null
  );
}

export function measurementSnapshot(customer: any, set: any): MeasurementSnapshot | null {
  if (!set) return null;
  return {
    body_type: customer?.body_type_classification?.bodyType ?? null,
    confidence: customer?.body_type_classification?.confidence ?? null,
    measurements: plainMeasurements(set.measurements),
    unit: set.unit || 'cm',
    fit_preferences: customer?.body_fit || [],
    set_name: set.name || null,
    tailoring_meta: set.tailoring_meta ?? null,
    method: setMethod(set),
    measured_at: set.updated_at ?? set.createdAt ?? null,
  };
}
