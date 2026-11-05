/**
 * Reading measurements from a photo of a tailor's measurement book (or a
 * document) so the shop's manual form fills itself.
 *
 * Claude reads the page and returns each number it can place against one of
 * Qlozet's measurement fields, as written (value + unit + the original text)
 * and whether it read it clearly. Nothing is saved here: the customer checks
 * the filled form and saves it themselves, with method 'photo'.
 *
 * Pure: the request body, the parsing, unit handling. MeasurementPhotoService
 * sends it. The file is sent inline and never stored.
 */

/** The 14 body points of the manual form (shop types.ts MeasurementValues). */
export const CORE_FIELDS = [
  'chest',
  'waist',
  'hip',
  'shoulder_breadth',
  'arm_length',
  'leg_length',
  'bicep',
  'forearm',
  'thigh',
  'calf',
  'wrist',
  'ankle',
  'height',
  'shoulder_to_crotch',
] as const;

/** Tailoring points a measurement book often has (shop TAILORING_LABELS). */
export const TAILORING_FIELDS = [
  'shoulder_width',
  'sleeve_length',
  'neck',
  'knee',
  'inseam',
  'outseam',
  'nape_to_waist',
  'across_back',
  'under_bust',
  'belly_waist',
] as const;

export const PHOTO_FIELDS = [...CORE_FIELDS, ...TAILORING_FIELDS] as const;
export type PhotoField = (typeof PHOTO_FIELDS)[number];

/** Lengths (not round-the-body); used for the sanity range. */
const LENGTHS = new Set<string>([
  'shoulder_breadth',
  'arm_length',
  'leg_length',
  'shoulder_to_crotch',
  'shoulder_width',
  'sleeve_length',
  'inseam',
  'outseam',
  'nape_to_waist',
  'across_back',
]);

export const PHOTO_READING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['is_measurements', 'people', 'note'],
  properties: {
    is_measurements: { type: 'boolean' },
    note: { type: 'string' },
    people: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'unit', 'values', 'unmatched'],
        properties: {
          label: { type: 'string' },
          unit: { type: 'string', enum: ['cm', 'inch', 'unknown'] },
          values: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['field', 'value', 'written_as', 'clear'],
              properties: {
                field: { type: 'string', enum: [...PHOTO_FIELDS] },
                value: { type: 'number' },
                written_as: { type: 'string' },
                clear: { type: 'boolean' },
              },
            },
          },
          unmatched: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
} as const;

export const PHOTO_READING_SYSTEM = `You read body measurements from photos of tailors' measurement books, handwritten notes, printed sheets or documents for Qlozet, a Nigerian marketplace where customers have clothes made to measure. What you return fills a form the customer checks before saving, so never guess: a number you are unsure of is still returned but marked clear: false, and a label you cannot place goes in unmatched.

For each person on the page (usually one; a family book may have several), return:
- label: the name written for them, or "Person 1", "Person 2" in page order. Skip sets that are fully crossed out; when a value is crossed out and rewritten, use the new one.
- unit: inch or cm when the page says so or the numbers make it plain (Nigerian tailors usually write inches: a chest of 36-50 is inches, 90-130 is cm). unknown only when you truly cannot tell.
- values: each number you can place, with field, value (a number in the unit written; "38½", "38 1/2" and "38.5" are all 38.5), written_as (the text exactly as on the page, such as "Ch 38"), and clear (false when the handwriting is ambiguous, e.g. 1 vs 7, 4 vs 9, or the label is a guess).
- unmatched: anything with a number you cannot place on a field, as written (such as "TL 30", "Bottom 16").

Fields and the shorthand tailors use for them:
- chest: Ch, Chest, Bust, B.
- under_bust: UB, Under bust.
- waist: W, Wst, Waist.
- belly_waist: Tummy, Stomach, Belly.
- hip: H, Hip, Hips, Seat.
- shoulder_width: Sh, Shd, Shoulder (tailors measure seam to seam: always this field, never shoulder_breadth).
- across_back: Back, Across back, AB.
- nape_to_waist: Back length, Nape to waist.
- sleeve_length: Sl, SL, Sleeve, Long sleeve (shoulder to wrist on a sleeve). A short-sleeve length goes in unmatched.
- arm_length: Arm length, only when written as a body length.
- bicep: RS, R/S, Round sleeve, Arm (round), Biceps, RA.
- forearm: Forearm, Elbow round.
- wrist: Cuff, Wrist.
- neck: N, Neck, Collar.
- thigh: Th, Thigh, Lap.
- knee: Kn, Knee.
- calf: Calf.
- ankle: Ankle (the body, not a trouser opening; "Bottom", "Leg opening" and "Mouth" go in unmatched).
- outseam: TrL, Trouser length, Trouser L, Outseam, Length on a trouser line.
- inseam: Inseam, Inside leg, Crotch to ankle.
- leg_length: Leg length, only when written as a body length.
- shoulder_to_crotch: Torso length, Shoulder to crotch.
- height: Height, Ht.
Garment lengths with no field (top length, shirt length, gown length, agbada length, half length, crotch/rise, short sleeve) go in unmatched.

Use each field at most once per person. If the image has no measurements, set is_measurements to false and return no people. note: one short sentence the customer would find useful (for example that the unit was not written), or an empty string.`;

export type PhotoMedia =
  | { kind: 'image'; mediaType: string; base64: string }
  | { kind: 'pdf'; base64: string };

/** The Messages API body for one reading. */
export function photoReadingRequest(file: PhotoMedia, model: string) {
  const source =
    file.kind === 'pdf'
      ? {
          type: 'document',
          source: {
            type: 'base64',
            media_type: 'application/pdf',
            data: file.base64,
          },
        }
      : {
          type: 'image',
          source: {
            type: 'base64',
            media_type: file.mediaType,
            data: file.base64,
          },
        };
  return {
    model,
    max_tokens: 8000,
    system: PHOTO_READING_SYSTEM,
    output_config: {
      effort: 'medium',
      format: { type: 'json_schema', schema: PHOTO_READING_SCHEMA },
    },
    messages: [
      {
        role: 'user',
        content: [
          source,
          { type: 'text', text: 'Read the measurements on this page.' },
        ],
      },
    ],
  };
}

const CM_PER_INCH = 2.54;

export interface ReadValue {
  value_cm: number;
  /** As on the page, e.g. "Ch 38". */
  written_as: string;
  /** False: show it highlighted for the customer to check. */
  clear: boolean;
}

export interface ReadPerson {
  label: string;
  /** The unit the values were read in: written on the page, or worked out. */
  unit: 'cm' | 'inch';
  /** True when the unit was not written and was worked out from the numbers. */
  unit_guessed: boolean;
  values: Partial<Record<PhotoField, ReadValue>>;
  unmatched: string[];
}

export interface PhotoReading {
  is_measurements: boolean;
  people: ReadPerson[];
  note: string;
}

/**
 * The unit when the page didn't say: Nigerian books are mostly inches, and
 * the chest/waist/hip size settles it (a 38 chest is inches, a 96 is cm).
 */
export function inferUnit(
  values: { field: string; value: number }[],
): 'cm' | 'inch' {
  const rounds = values.filter((v) =>
    ['chest', 'waist', 'hip'].includes(v.field),
  );
  const sample = rounds.length
    ? rounds
    : values.filter((v) => v.field !== 'height');
  if (!sample.length) return 'inch';
  const avg = sample.reduce((s, v) => s + v.value, 0) / sample.length;
  return avg >= 65 ? 'cm' : 'inch';
}

/** A believable body value in cm for the field (generous on purpose). */
export function plausibleCm(field: string, cm: number): boolean {
  if (!Number.isFinite(cm) || cm <= 0) return false;
  if (field === 'height') return cm >= 80 && cm <= 230;
  if (LENGTHS.has(field)) return cm >= 8 && cm <= 150;
  return cm >= 10 && cm <= 220;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * The reading from a Messages API response, or null when there is none (a
 * refusal, a cut-off reply, or text that is not the expected JSON). Values
 * come back in cm; unbelievable ones are kept but marked unclear.
 */
export function parsePhotoReading(response: any): PhotoReading | null {
  if (
    !response ||
    response.stop_reason === 'refusal' ||
    response.stop_reason === 'max_tokens'
  ) {
    return null;
  }
  const text = (response.content ?? []).find(
    (b: any) => b?.type === 'text',
  )?.text;
  if (typeof text !== 'string') return null;
  let raw: any;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const fields = new Set<string>(PHOTO_FIELDS);
  const people: ReadPerson[] = [];
  for (const [i, p] of (Array.isArray(raw?.people)
    ? raw.people
    : []
  ).entries()) {
    const rows = (Array.isArray(p?.values) ? p.values : []).filter(
      (v: any) =>
        fields.has(v?.field) &&
        typeof v?.value === 'number' &&
        Number.isFinite(v.value),
    );
    const said = p?.unit === 'cm' || p?.unit === 'inch' ? p.unit : null;
    const unit = said ?? inferUnit(rows);
    const values: ReadPerson['values'] = {};
    for (const v of rows) {
      if (values[v.field as PhotoField]) continue;
      const cm = round1(unit === 'inch' ? v.value * CM_PER_INCH : v.value);
      values[v.field as PhotoField] = {
        value_cm: cm,
        written_as: String(v.written_as ?? '').slice(0, 60),
        clear: v.clear !== false && plausibleCm(v.field, cm),
      };
    }
    const unmatched = (Array.isArray(p?.unmatched) ? p.unmatched : [])
      .filter((u: any) => typeof u === 'string' && u.trim())
      .map((u: string) => u.trim().slice(0, 60))
      .slice(0, 20);
    if (!Object.keys(values).length && !unmatched.length) continue;
    people.push({
      label:
        String(p?.label ?? '')
          .trim()
          .slice(0, 60) || `Person ${i + 1}`,
      unit,
      unit_guessed: !said,
      values,
      unmatched,
    });
  }
  return {
    is_measurements: raw?.is_measurements !== false && people.length > 0,
    people,
    note: String(raw?.note ?? '').slice(0, 240),
  };
}
