import { GarmentConfigDto } from '../dto/generate-outfit.dto';
import { CONSTRUCTION_SCHEMAS } from './constructionBuilder';
export type ConstructionSelection = Record<
  string,
  string | boolean | undefined
>;
const BRAND_PROFILE = {
  brand_name: 'Qlozet',
  tone: 'modern bespoke fashion',
  target_market: 'fashion customers using Qlozet',
  price_tier: 'mid to premium',
};
const RENDER_PREFS = {
  background: 'plain white background',
  camera: 'front-facing garment-only view',
  lighting: 'soft studio lighting',
  mannequin: 'none',
  pose: 'garment-only presentation',
  cropping: 'full garment centered with some margin',
};

export function buildConstructionMetadata(
  garmentType: string,
  selections: ConstructionSelection = {},
): Record<string, string | boolean> {
  const config = CONSTRUCTION_SCHEMAS.garment_types[garmentType];
  if (!config) return {};
  const construction: Record<string, string | boolean> = {};
  for (const [fieldKey, fieldSchema] of Object.entries(config.fields)) {
    const { metadata_key, type, options, default: defaultValue } = fieldSchema;
    if (!metadata_key) continue;
    const rawValue = selections[fieldKey];
    let finalValue: string | boolean | undefined = rawValue as any;
    if (type === 'enum') {
      if (typeof rawValue === 'string' && options?.includes(rawValue)) {
        finalValue = rawValue;
      } else if (typeof defaultValue === 'string') {
        finalValue = defaultValue;
      } else if (options?.length) {
        finalValue = options[0];
      } else {
        finalValue = undefined;
      }
    } else if (type === 'boolean') {
      if (typeof rawValue === 'boolean') {
        finalValue = rawValue;
      } else if (typeof defaultValue === 'boolean') {
        finalValue = defaultValue;
      } else {
        finalValue = false;
      }
    } else {
      // string
      if (typeof rawValue === 'string' && rawValue.trim()) {
        finalValue = rawValue.trim();
      } else if (typeof defaultValue === 'string') {
        finalValue = defaultValue;
      } else {
        finalValue = undefined;
      }
    }
    if (finalValue !== undefined) {
      construction[metadata_key] = finalValue;
    }
  }
  return construction;
}

export function buildMetadataFromConfig(config: GarmentConfigDto): any {
  const construction = buildConstructionMetadata(
    config.garmentType,
    config.constructionSelections ?? {},
  );
  const metadata: any = {
    garment_type: config.garmentType,
    gender: config.gender,
    occasion: config.occasion,
    aesthetic_keywords: config.aestheticKeywords ?? [],
    fit: config.fit,
    fit_notes: config.fitNotes,
    measurement_profile: config.measurementProfile ?? {},
    construction,
    fabric: {},
    colors: {},
    brand_profile: BRAND_PROFILE,
    render_prefs: RENDER_PREFS,
    references: [] as string[],
  };
  if (config.fabricRefId) {
    const fabricUrl = resolveAssetUrl(config.fabricRefId);
    metadata.fabric.use_reference_image = true;
    metadata.colors.use_reference_image = true;
    metadata.references.push(fabricUrl);
  }
  if (config.embroideryRefId) {
    const embroideryUrl = resolveAssetUrl(config.embroideryRefId);
    metadata.embroidery_reference = {
      use_reference_image: true,
      strict_match: !!config.hasStrictEmbroidery,
      no_style_variation: !!config.hasStrictEmbroidery,
      apply_to: 'front chest panel',
      panel_masking: {
        description: 'Apply embroidery only inside the chest panel mask.',
        mask_shape:
          'rectangular chest panel with angled cutout as in reference.',
        mask_reference_image: embroideryUrl,
      },
      metadata_notes:
        'Copy the embroidery exactly, no creative edits. Motifs and layout must match reference.',
    };
    metadata.references.push(embroideryUrl);
  }
  if (config.inspirationImageUrls?.length) {
    metadata.references.push(...config.inspirationImageUrls);
  }
  if (config.silhouetteImageUrl) {
    metadata.references.push(config.silhouetteImageUrl);
  }
  return metadata;
}

function resolveAssetUrl(id: string): string {
  return id; // or `https://cdn.qlozet.com/assets/${id}`
}
