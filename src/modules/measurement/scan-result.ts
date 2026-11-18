/**
 * One shape for a body scan's result (video scan and photo scan), whatever
 * the Space returned:
 *
 *   { measurements: { chest: 98.2, waist: 81, …, sleeve_length: 61.5 },  // cm
 *     tailoring_meta: { chest: { tier, mae_cm, method }, … },
 *     inputs: { height_cm, weight, gender, variant, … } }
 *
 * `measurements` is ready to save as-is (POST /measurements/users is
 * open-keyed beyond the core 14). Accepts the schema v2 payload, the v1
 * { cm, derived } file and, as a last resort, the bare DataFrame.
 */

export interface ScanResult {
  measurements: Record<string, number>;
  tailoring_meta: Record<string, { tier?: string; mae_cm?: number | null; method?: string }>;
  inputs?: Record<string, unknown>;
}

/** The Space's table labels, back to their names (DataFrame fallback). */
const LABEL_TO_NAME: Record<string, string> = {
  'ankle circumference': 'ankle',
  'arm length (shoulder to wrist)': 'arm_length',
  'upper arm circumference': 'bicep',
  'calf circumference': 'calf',
  'chest circumference': 'chest',
  'bust circumference (chest at fullest point)': 'chest',
  'forearm circumference': 'forearm',
  height: 'height',
  'hip circumference': 'hip',
  'leg length (crotch to floor)': 'leg_length',
  'shoulder breadth': 'shoulder_breadth',
  'shoulder to crotch': 'shoulder_to_crotch',
  'thigh circumference': 'thigh',
  'waist circumference (natural waist)': 'waist',
  'wrist circumference': 'wrist',
};

const snake = (s: string) =>
  s.trim().toLowerCase().replace(/[\s-]+/g, '_');

const round = (v: number, dp: number) => {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
};

const isObj = (v: unknown): v is Record<string, any> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

export function toScanResult(raw: unknown): ScanResult {
  const out: ScanResult = { measurements: {}, tailoring_meta: {} };
  if (!raw || typeof raw !== 'object') return out;
  const data: any = raw;

  const set = (name: string, value: unknown, dp = 2) => {
    const v = typeof value === 'string' ? Number(value) : value;
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return;
    out.measurements[snake(name)] = round(v, dp);
  };

  // 1) a bare { name: cm } map (v1 file, v2 alongside its rows)
  if (isObj(data.cm)) {
    for (const [k, v] of Object.entries(data.cm)) set(k, v);
  }

  // 2) v2 rows (core + derived) or v1 derived rows — they carry provenance
  const rows = Array.isArray(data.measurements)
    ? data.measurements
    : Array.isArray(data.derived)
      ? data.derived
      : [];
  for (const r of rows) {
    if (!isObj(r) || typeof r.name !== 'string') continue;
    const name = snake(r.name);
    set(name, r.value_cm, Array.isArray(data.measurements) ? 2 : 1);
    if (out.measurements[name] === undefined) continue;
    out.tailoring_meta[name] = {
      ...(typeof r.tier === 'string' ? { tier: r.tier } : {}),
      mae_cm: typeof r.mae_cm === 'number' ? r.mae_cm : null,
      ...(typeof r.method === 'string' ? { method: r.method } : {}),
    };
  }

  // 3) the DataFrame { headers, data: [[label, cm, in, source]] }
  if (Object.keys(out.measurements).length === 0 && Array.isArray(data.data)) {
    const headers: string[] = Array.isArray(data.headers) ? data.headers.map(String) : [];
    const cmCol = Math.max(
      1,
      headers.findIndex((h) => /cm|centimet/i.test(h)),
    );
    for (const row of data.data) {
      if (!Array.isArray(row) || row.length < 2) continue;
      const label = String(row[0]).trim().toLowerCase();
      set(LABEL_TO_NAME[label] ?? label, row[cmCol]);
    }
  }

  if (isObj(data.inputs)) out.inputs = data.inputs;
  return out;
}

/** The core measurements a scan must produce to be worth saving. */
export const SCAN_CORE = [
  'chest',
  'waist',
  'hip',
  'shoulder_breadth',
  'arm_length',
  'leg_length',
] as const;

export function scanResultUsable(r: ScanResult): boolean {
  return SCAN_CORE.every((k) => (r.measurements[k] ?? 0) > 0);
}

/** The scan ran but didn't find a body to measure. Shown to the customer. */
export class ScanUnreadableError extends Error {
  constructor() {
    super(
      "We couldn't measure you from that scan. Stand where your whole body is in view, in fitted clothes and good light, and try again.",
    );
    this.name = 'ScanUnreadableError';
  }
}
