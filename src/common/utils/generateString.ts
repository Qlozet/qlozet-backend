import { randomBytes } from 'crypto';
import { Model } from 'mongoose';
export function generateSimpleSKU(productName: string): string {
  const cleanName = productName
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase()
    .substring(0, 6);

  const timestamp = Date.now().toString().slice(-6);

  return `${cleanName}${timestamp}`;
}

/**
 * Generate a unique Qlozet reference for any model.
 * Ensures no collision in the database.
 *
 * @param model - The Mongoose model to check uniqueness against
 * @param prefix - e.g. 'ORD' for order, 'TRX' for transaction
 * @returns e.g. QLOZ-ORD-20251016-AB12CD34
 */
export async function generateUniqueQlozetReference(
  model: Model<any>,
  prefix: string,
): Promise<string> {
  let unique = false;
  let reference = '';

  while (!unique) {
    const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, ''); // YYYYMMDD
    const randomPart = randomBytes(4).toString('hex').toUpperCase(); // 8-char random
    reference = `QLOZ-${prefix.toUpperCase()}-${datePart}-${randomPart}`;
    const exists = await model.exists({ reference });
    if (!exists) unique = true;
  }

  return reference;
}
