export type FieldSchema = {
  type: 'enum';
  options: string[];
  default: string;
  metadata_key: string;
};

export type GarmentTypeSchema = {
  label: string;
  description: string;
  fields: Record<string, FieldSchema>;
};

export type ConstructionSchemas = {
  version: string;
  garment_types: Record<string, GarmentTypeSchema>;
};

export const DEFAULT_BASE_PROMPT =
  'Generate a clean, garment-only render of the requested outfit using the provided reference images and metadata. ' +
  'Use the fabric swatch and embroidery references exactly as given, without changing their colours or motifs. ' +
  'Do not show any mannequin, human body, or face. Show only the garment on a plain white background.';
export function buildPrompt(userPrompt?: string): string {
  if (!userPrompt) return DEFAULT_BASE_PROMPT;
  return `${DEFAULT_BASE_PROMPT} Additional user direction:
${userPrompt}`;
}
// Example usage:
export const CONSTRUCTION_SCHEMAS: ConstructionSchemas = {
  version: '1.0.0',
  garment_types: {
    dress: {
      label: 'Dress',
      description: 'One-piece dress with bodice and skirt.',
      fields: {
        neckline: {
          type: 'enum',
          options: [
            'round neck',
            'V-neck',
            'sweetheart',
            'square',
            'button-front neckline',
          ],
          default: 'round neck',
          metadata_key: 'neckline',
        },
        sleeve_style: {
          type: 'enum',
          options: [
            'sleeveless',
            'short sleeve',
            'long sleeve',
            'puff sleeve',
            'cap sleeve',
          ],
          default: 'short sleeve',
          metadata_key: 'sleeve',
        },
        bodice_fit: {
          type: 'enum',
          options: ['fitted bodice', 'semi-fitted bodice', 'relaxed bodice'],
          default: 'fitted bodice',
          metadata_key: 'bodice',
        },
      },
    },
    male_agbada: {
      label: "Men's Agbada Set",
      description:
        'Three-piece traditional agbada: robe, inner kaftan, and trousers.',
      fields: {
        robe_length: {
          type: 'enum',
          options: ['full length', 'three-quarter length'],
          default: 'full length',
          metadata_key: 'robe',
        },
        robe_sleeve: {
          type: 'enum',
          options: ['wide agbada sleeve (classic)'],
          default: 'wide agbada sleeve (classic)',
          metadata_key: 'sleeves',
        },
        inner_kaftan_neckline: {
          type: 'enum',
          options: ['round neck', 'V-slit', 'embroidery-framed slit'],
          default: 'V-slit',
          metadata_key: 'inner_kaftan_neckline',
        },
        trousers_fit: {
          type: 'enum',
          options: ['straight', 'slightly tapered'],
          default: 'straight',
          metadata_key: 'trousers_fit',
        },
        embroidery_panel: {
          type: 'enum',
          options: [
            'strict chest panel embroidery',
            'subtle neckline embroidery',
            'no embroidery',
          ],
          default: 'strict chest panel embroidery',
          metadata_key: 'embroidery',
        },
      },
    },
  },
};
