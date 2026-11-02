/**
 * Reading the fabrics in a reference outfit photo.
 *
 * Claude looks at the photo and returns each fabric the garment is made
 * from, by role (main, contrast, lining), with its colours, its type and its
 * pattern. The reply is constrained to FABRIC_READING_SCHEMA, so it always
 * parses. products/fabric-match.ts then ranks the catalogue against it.
 *
 * Pure: the request body and the parsing. FabricVisionService sends it.
 */

/** Fabric types the reading may name, and the catalogue is sorted into. */
export const FABRIC_TYPES = [
  'ankara',
  'lace',
  'aso_oke',
  'adire',
  'kente',
  'brocade',
  'silk_satin',
  'chiffon_sheer',
  'cotton',
  'senator',
  'linen',
  'wool',
  'velvet',
  'denim',
  'sequin',
  'stretch_knit',
  'leather',
  'other',
] as const;
export type FabricType = (typeof FABRIC_TYPES)[number];

export const FABRIC_PATTERNS = [
  'solid',
  'floral',
  'geometric',
  'stripes',
  'check',
  'polka_dot',
  'animal',
  'abstract',
  'tie_dye',
  'embroidered',
  'beaded_sequined',
  'other',
] as const;
export type FabricPattern = (typeof FABRIC_PATTERNS)[number];

export type FabricRole = 'main' | 'contrast' | 'lining' | 'bottom';

export interface ReadFabric {
  role: FabricRole;
  colors: { name: string; hex: string }[];
  fabric_type: FabricType;
  pattern: FabricPattern;
  description: string;
}

export interface FabricReading {
  is_outfit: boolean;
  fabrics: ReadFabric[];
}

export const FABRIC_READING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['is_outfit', 'fabrics'],
  properties: {
    is_outfit: { type: 'boolean' },
    fabrics: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['role', 'colors', 'fabric_type', 'pattern', 'description'],
        properties: {
          role: { type: 'string', enum: ['main', 'contrast', 'lining', 'bottom'] },
          colors: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['name', 'hex'],
              properties: {
                name: { type: 'string' },
                hex: { type: 'string' },
              },
            },
          },
          fabric_type: { type: 'string', enum: [...FABRIC_TYPES] },
          pattern: { type: 'string', enum: [...FABRIC_PATTERNS] },
          description: { type: 'string' },
        },
      },
    },
  },
} as const;

export const FABRIC_READING_SYSTEM = `You read the fabrics in photos of outfits for Qlozet, a Nigerian marketplace where customers have clothes made by tailors from fabric sold on the platform. Your reading is used to find the closest fabrics in the catalogue, so describe what the fabric looks like, not what the garment is.

List each distinct fabric the garment is made from, at most four:
- main: the fabric covering most of the garment, or the top's fabric in a two-piece outfit. Always list it when the photo shows an outfit.
- bottom: in a two-piece outfit (a top with separate trousers or a skirt), the bottom's fabric when it clearly differs from the top's. Leave it out when both pieces are the same fabric.
- contrast: a clearly different fabric used for panels, a yoke, cuffs, collar or trim. Only when one is visible.
- lining: only when the inside layer is visible and differs from the outside.

For each fabric:
- colors: one to three dominant colours, most prominent first, each with a plain name ("deep teal") and a six-digit hex code (#1F6F6B) as seen in the photo.
- fabric_type: the closest match. ankara is wax print; aso_oke is hand-woven strip cloth; adire is indigo resist-dyed; senator is the smooth suiting used for men's native wear; silk_satin covers shiny smooth fabrics; chiffon_sheer covers see-through fabrics such as chiffon, organza and tulle. Use other only when nothing fits.
- pattern: the visible pattern (solid when plain).
- description: up to fifteen words a shopper would recognise, such as "royal blue cord lace with scalloped edges".

If the photo does not show clothing, set is_outfit to false and return no fabrics.`;

const HEX = /^#[0-9a-f]{6}$/i;

/** The Messages API body for one reading. */
export function fabricReadingRequest(imageUrl: string, model: string) {
  return {
    model,
    max_tokens: 8000,
    system: FABRIC_READING_SYSTEM,
    // A small, well-specified extraction: low effort is enough.
    output_config: {
      effort: 'low',
      format: { type: 'json_schema', schema: FABRIC_READING_SCHEMA },
    },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'url', url: imageUrl } },
          { type: 'text', text: 'Read the fabrics in this outfit.' },
        ],
      },
    ],
  };
}

/**
 * The reading from a Messages API response, or null when there is none
 * (a refusal, a cut-off reply, or text that is not the expected JSON).
 * Bad entries are dropped rather than failing the whole reading.
 */
export function parseFabricReading(response: any): FabricReading | null {
  if (!response || response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') {
    return null;
  }
  const text = (response.content ?? []).find((b: any) => b?.type === 'text')?.text;
  if (typeof text !== 'string') return null;
  let raw: any;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const seen = new Set<string>();
  const fabrics: ReadFabric[] = [];
  for (const f of Array.isArray(raw?.fabrics) ? raw.fabrics : []) {
    if (!['main', 'contrast', 'lining', 'bottom'].includes(f?.role) || seen.has(f.role)) continue;
    seen.add(f.role);
    fabrics.push({
      role: f.role,
      colors: (Array.isArray(f.colors) ? f.colors : [])
        .filter((c: any) => typeof c?.hex === 'string' && HEX.test(c.hex.trim()))
        .slice(0, 3)
        .map((c: any) => ({ name: String(c.name ?? '').trim(), hex: c.hex.trim().toUpperCase() })),
      fabric_type: (FABRIC_TYPES as readonly string[]).includes(f.fabric_type) ? f.fabric_type : 'other',
      pattern: (FABRIC_PATTERNS as readonly string[]).includes(f.pattern) ? f.pattern : 'other',
      description: String(f.description ?? '').slice(0, 160),
    });
  }
  // Main first, then contrast, then lining.
  const order = { main: 0, contrast: 1, lining: 2 };
  fabrics.sort((a, b) => order[a.role] - order[b.role]);
  return { is_outfit: raw?.is_outfit !== false, fabrics };
}
