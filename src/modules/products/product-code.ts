/**
 * Product addresses: shop.qlozet.app/p/<name>-<code>, e.g.
 * /p/blue-agbada-set-k3x9q2m7.
 *
 * The name part is for people and search engines and is never looked up, so
 * renaming a product doesn't break its links; the code finds the product. The
 * code is stored on the product (`code`), set when it is created, because a
 * code cut from the id would be either too long or not unique.
 *
 * Old /products/<id> links keep working. Keep the URL form in step with the
 * shop's lib/product-link.ts.
 */
import { randomInt } from 'crypto';

export const PRODUCT_CODE_LENGTH = 8;
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const CODE = new RegExp(`^[a-z0-9]{${PRODUCT_CODE_LENGTH}}$`);
const OBJECT_ID = /^[0-9a-fA-F]{24}$/;

/** A fresh random code: 36^8, about 2.8 trillion. */
export function newProductCode(): string {
  let code = '';
  for (let i = 0; i < PRODUCT_CODE_LENGTH; i++) {
    code += ALPHABET[randomInt(ALPHABET.length)];
  }
  return code;
}

/**
 * What a shop URL segment points at: a product id (old links), or the code at
 * the end of "<name>-<code>" (or a bare code). Null when it is neither.
 */
export function parseProductKey(
  key: unknown,
): { id: string } | { code: string } | null {
  const raw = typeof key === 'string' ? key.trim() : '';
  if (OBJECT_ID.test(raw)) return { id: raw };
  const last = raw.toLowerCase().split('-').pop() ?? '';
  return CODE.test(last) ? { code: last } : null;
}
