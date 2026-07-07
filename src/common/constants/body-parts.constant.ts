/**
 * Canonical list of body-part keys used by the Measurement module
 * AND the Size-Guide module.  Keep this single source of truth.
 */
export const SUPPORTED_BODY_PARTS = [
  'chest',
  'waist',
  'hip',
  'bicep',
  'calf',
  'forearm',
  'height',
  'leg_length',
  'shoulder_breadth',
  'shoulder_to_crotch',
  'thigh',
  'wrist',
  'ankle',
  'arm_length',
] as const;

export type BodyPart = (typeof SUPPORTED_BODY_PARTS)[number];

/** cm ↔ inch helpers */
export const CM_PER_INCH = 2.54;
export const cmToInch = (cm: number) => cm / CM_PER_INCH;
export const inchToCm = (inch: number) => inch * CM_PER_INCH;
