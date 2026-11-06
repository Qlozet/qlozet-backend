/**
 * Where a made-to-fit piece was off, from the customer's fit feedback.
 *
 * "Minor issues" or "poor" alone can't teach anything; "tight at the chest"
 * on a tailor's slim tops can. Each issue is an area and what was wrong with
 * it. Round-the-body areas are tight or loose; lengths are long or short.
 *
 * This measures the GARMENT (the tailor's cut and the room they added), not
 * the customer's body; it is kept apart from the measurement correction log
 * for that reason. Pure; the shop mirrors the lists.
 */

export const ROUND_AREAS = ['neck', 'chest', 'waist', 'hip', 'shoulder', 'arm', 'thigh'] as const;
export const LENGTH_AREAS = ['sleeve_length', 'top_length', 'trouser_length', 'dress_length'] as const;
export const FIT_AREAS = [...ROUND_AREAS, ...LENGTH_AREAS] as const;
export type FitArea = (typeof FIT_AREAS)[number];

export type FitProblem = 'tight' | 'loose' | 'long' | 'short';

export interface FitIssue {
  area: FitArea;
  problem: FitProblem;
}

export const MAX_FIT_ISSUES = 6;

const isRound = (a: string) => (ROUND_AREAS as readonly string[]).includes(a);
const isLength = (a: string) => (LENGTH_AREAS as readonly string[]).includes(a);

/** The problems that make sense for an area. */
export const problemsFor = (area: string): FitProblem[] =>
  isRound(area) ? ['tight', 'loose'] : isLength(area) ? ['long', 'short'] : [];

/**
 * The issues as sent, checked: known areas, a problem that fits the area,
 * one entry per area (the last one wins), at most six. Throws on nonsense so
 * the shop learns, rather than silently dropping what the customer said.
 */
export function cleanFitIssues(raw: unknown): FitIssue[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new Error('issues must be a list.');
  const byArea = new Map<string, FitIssue>();
  for (const item of raw) {
    const area = String((item as any)?.area ?? '');
    const problem = String((item as any)?.problem ?? '') as FitProblem;
    if (!problemsFor(area).length) throw new Error(`Unknown fit area "${area}".`);
    if (!problemsFor(area).includes(problem)) {
      throw new Error(`"${area}" can be ${problemsFor(area).join(' or ')}, not "${problem}".`);
    }
    byArea.set(area, { area: area as FitArea, problem });
  }
  const issues = [...byArea.values()];
  if (issues.length > MAX_FIT_ISSUES) throw new Error(`Pick at most ${MAX_FIT_ISSUES} areas.`);
  return issues;
}

/** A piece made to the customer's measurements: bespoke, or a custom line. */
export const isMadeToFit = (order: any): boolean =>
  order?.type === 'bespoke' ||
  (order?.items ?? []).some((i: any) => i?.clothing_type === 'customize');
