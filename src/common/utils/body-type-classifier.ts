/**
 * Body Type Classifier
 * 
 * Derives body type classification from user measurements + gender.
 * Uses standard proportion ratios to determine body shape.
 */

export type BodyType =
  // Male
  | 'athletic'         // V-shape: broad shoulders, narrow waist/hips
  | 'rectangle'        // Uniform shoulder/waist/hip
  | 'trapezoid'        // Slightly broader shoulders, moderate waist
  | 'round'            // Waist ≥ shoulders/hips
  | 'triangle'         // Hips wider than shoulders
  // Female
  | 'hourglass'        // Balanced bust/hips, defined waist
  | 'pear'             // Hips wider than bust
  | 'apple'            // Carry weight in midsection
  | 'inverted_triangle' // Bust/shoulders wider than hips
  // Shared
  | 'unclassified';

export type Confidence = 'high' | 'medium' | 'low';

export interface BodyTypeResult {
  bodyType: BodyType;
  confidence: Confidence;
  styleAdvice: string[];
  flattering_fits: string[];
  avoid_fits: string[];
}

/* ─── Style Advice Maps ─────────────────────────────────────── */

const MALE_ADVICE: Record<string, Omit<BodyTypeResult, 'bodyType' | 'confidence'>> = {
  athletic: {
    styleAdvice: [
      'Fitted shirts that follow your torso shape',
      'Tapered trousers to complement your V-shape',
      'V-neck tops to broaden your chest visually',
    ],
    flattering_fits: ['slim', 'tailored', 'fitted', 'tapered'],
    avoid_fits: ['boxy', 'oversized_shoulders'],
  },
  rectangle: {
    styleAdvice: [
      'Layering adds dimension and visual interest',
      'Structured jackets create definition',
      'Patterns and textures break up the uniform silhouette',
    ],
    flattering_fits: ['structured', 'layered', 'regular', 'textured'],
    avoid_fits: ['skin_tight', 'very_baggy'],
  },
  trapezoid: {
    styleAdvice: [
      'Most cuts look great on a balanced frame',
      'Classic tailoring works well for your proportions',
      'Straight-leg trousers complement your build',
    ],
    flattering_fits: ['classic', 'regular', 'straight', 'tailored'],
    avoid_fits: [],
  },
  round: {
    styleAdvice: [
      'Vertical stripes and patterns elongate the torso',
      'Structured blazers create a clean silhouette',
      'Dark, solid colors in the midsection are slimming',
    ],
    flattering_fits: ['structured', 'straight', 'relaxed', 'elongating'],
    avoid_fits: ['tight_midsection', 'horizontal_stripes', 'clingy'],
  },
  triangle: {
    styleAdvice: [
      'Broader shoulder details balance proportions',
      'Structured tops and jackets add upper body width',
      'Straight-leg or bootcut trousers even out the silhouette',
    ],
    flattering_fits: ['structured_shoulder', 'straight_leg', 'layered_top'],
    avoid_fits: ['skinny_bottom', 'narrow_shoulder'],
  },
};

const FEMALE_ADVICE: Record<string, Omit<BodyTypeResult, 'bodyType' | 'confidence'>> = {
  hourglass: {
    styleAdvice: [
      'Wrap dresses and tops highlight your waist',
      'Belted outfits accentuate your natural curves',
      'Fitted styles that follow your silhouette',
    ],
    flattering_fits: ['wrap', 'fitted', 'belted', 'bodycon', 'A-line'],
    avoid_fits: ['boxy', 'shapeless', 'oversized'],
  },
  pear: {
    styleAdvice: [
      'Draw attention upward with detailed tops and necklines',
      'A-line skirts and dresses flow over hips beautifully',
      'Structured shoulders balance your proportions',
    ],
    flattering_fits: ['A-line', 'empire_waist', 'bootcut', 'structured_top'],
    avoid_fits: ['skinny_bottom', 'clingy_hips', 'pencil_skirt'],
  },
  apple: {
    styleAdvice: [
      'Empire waist dresses define your shape above the midsection',
      'V-necklines elongate the torso',
      'Flowing fabrics skim over the midsection gracefully',
    ],
    flattering_fits: ['empire_waist', 'A-line', 'wrap', 'flowing', 'V-neck'],
    avoid_fits: ['tight_midsection', 'clingy', 'belted_at_waist'],
  },
  rectangle: {
    styleAdvice: [
      'Peplum tops and ruched details create curves',
      'Belts and waist-defining pieces add shape',
      'Layering and textures add visual dimension',
    ],
    flattering_fits: ['peplum', 'ruched', 'belted', 'layered', 'fit_and_flare'],
    avoid_fits: ['straight_shift', 'column', 'boxy'],
  },
  inverted_triangle: {
    styleAdvice: [
      'Full skirts and wide-leg trousers balance broader shoulders',
      'V-necklines soften the upper body',
      'Volume on the lower half creates harmony',
    ],
    flattering_fits: ['V-neck', 'full_skirt', 'wide_leg', 'A-line_bottom'],
    avoid_fits: ['puffy_sleeves', 'padded_shoulders', 'boat_neck'],
  },
};

/* ─── Core Classifier ───────────────────────────────────────── */

export function classifyBodyType(
  measurements: Record<string, number>,
  gender?: string,
): BodyTypeResult {
  const normalizedGender = (gender || '').toLowerCase();
  const isMale = normalizedGender === 'male' || normalizedGender === 'm';
  const isFemale = normalizedGender === 'female' || normalizedGender === 'f';

  // Extract key measurements (normalize names)
  const chest = measurements['chest'] ?? measurements['bust'] ?? null;
  const waist = measurements['waist'] ?? null;
  const hip = measurements['hip'] ?? measurements['hips'] ?? null;
  const shoulder = measurements['shoulder_breadth'] ?? measurements['shoulder'] ?? null;

  // Count available key measurements for confidence
  const available = [chest, waist, hip, shoulder].filter((v) => v !== null).length;
  const confidence: Confidence =
    available >= 4 ? 'high' : available >= 2 ? 'medium' : 'low';

  // Need at least 2 measurements to classify
  if (available < 2) {
    return {
      bodyType: 'unclassified',
      confidence: 'low',
      styleAdvice: ['Complete your measurements for personalized body type classification'],
      flattering_fits: [],
      avoid_fits: [],
    };
  }

  let bodyType: BodyType;

  if (isMale) {
    bodyType = classifyMale(chest, waist, hip, shoulder);
  } else if (isFemale) {
    bodyType = classifyFemale(chest, waist, hip, shoulder);
  } else {
    // Default to a unisex approach (use female logic since it covers more types)
    bodyType = classifyFemale(chest, waist, hip, shoulder);
  }

  const adviceMap = isMale ? MALE_ADVICE : FEMALE_ADVICE;
  const advice = adviceMap[bodyType] || {
    styleAdvice: ['Most styles will work well for your proportions'],
    flattering_fits: ['regular', 'classic'],
    avoid_fits: [],
  };

  return {
    bodyType,
    confidence,
    ...advice,
  };
}

/* ─── Male Classification ───────────────────────────────────── */

function classifyMale(
  chest: number | null,
  waist: number | null,
  hip: number | null,
  shoulder: number | null,
): BodyType {
  // Use shoulder as primary upper metric, fall back to chest
  const upper = shoulder ?? chest;
  const lower = hip;

  if (upper !== null && waist !== null && lower !== null) {
    const waistToUpper = waist / upper;
    const upperToLower = upper / lower;

    // Round: waist is close to or exceeds upper/lower
    if (waistToUpper >= 0.95) return 'round';

    // Athletic/V-Shape: broad upper, narrow waist
    if (upperToLower >= 1.1 && waistToUpper < 0.8) return 'athletic';

    // Triangle: hips wider than shoulders
    if (upperToLower < 0.95) return 'triangle';

    // Trapezoid: slightly broader shoulders, moderate proportions
    if (upperToLower >= 1.05 && upperToLower < 1.1) return 'trapezoid';

    // Rectangle: everything roughly equal
    return 'rectangle';
  }

  // Two-measurement fallback
  if (upper !== null && waist !== null) {
    const ratio = waist / upper;
    if (ratio >= 0.95) return 'round';
    if (ratio < 0.75) return 'athletic';
    return 'rectangle';
  }

  if (upper !== null && lower !== null) {
    const ratio = upper / lower;
    if (ratio >= 1.1) return 'athletic';
    if (ratio < 0.95) return 'triangle';
    return 'trapezoid';
  }

  return 'rectangle'; // safe default
}

/* ─── Female Classification ─────────────────────────────────── */

function classifyFemale(
  chest: number | null,
  waist: number | null,
  hip: number | null,
  shoulder: number | null,
): BodyType {
  const bust = chest;
  const upper = shoulder ?? bust;

  if (bust !== null && waist !== null && hip !== null) {
    const bustToHip = bust / hip;
    const waistToBust = waist / bust;
    const waistToHip = waist / hip;

    // Hourglass: bust ≈ hips, defined waist
    if (bustToHip >= 0.9 && bustToHip <= 1.1 && waistToBust < 0.75) {
      return 'hourglass';
    }

    // Pear: hips significantly larger than bust
    if (bustToHip < 0.9) return 'pear';

    // Apple: waist close to or larger than bust, and bigger than hips
    if (waistToBust >= 0.85 && waistToHip >= 0.9) return 'apple';

    // Inverted triangle: bust/shoulder much larger than hips
    if (bustToHip > 1.1) return 'inverted_triangle';

    // Rectangle: relatively uniform
    if (waistToBust >= 0.75) return 'rectangle';

    return 'hourglass'; // bust ≈ hip with moderate waist
  }

  // Two-measurement fallback
  if (bust !== null && hip !== null) {
    const ratio = bust / hip;
    if (ratio < 0.9) return 'pear';
    if (ratio > 1.1) return 'inverted_triangle';
    return 'hourglass';
  }

  if (bust !== null && waist !== null) {
    const ratio = waist / bust;
    if (ratio < 0.75) return 'hourglass';
    if (ratio >= 0.85) return 'apple';
    return 'rectangle';
  }

  if (waist !== null && hip !== null) {
    const ratio = waist / hip;
    if (ratio < 0.75) return 'pear';
    if (ratio >= 0.9) return 'apple';
    return 'hourglass';
  }

  return 'rectangle'; // safe default
}
