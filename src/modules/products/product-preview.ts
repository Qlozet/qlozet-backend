import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Preview links: a vendor opens their own listing on the real shop page
 * before it is live (draft, waiting for review, store not approved yet).
 *
 * The token is `<expiry ms>.<signature>`, signed for one product id. It only
 * lifts the "is this live?" check on that product's page read; it signs
 * nobody in and is useless for anything else (carts and checkout keep their
 * own visibility rules, so a preview can't be bought).
 *
 * The purpose prefix keeps these signatures apart from anything else signed
 * with the same secret.
 */

export const PREVIEW_TTL_MS = 30 * 60 * 1000;

const PURPOSE = 'qlozet:product-preview:v1';

const sign = (secret: string, productId: string, expires: number) =>
  createHmac('sha256', secret)
    .update(`${PURPOSE}:${productId}:${expires}`)
    .digest('base64url');

export function signProductPreview(
  secret: string,
  productId: string,
  now = Date.now(),
  ttlMs = PREVIEW_TTL_MS,
): { token: string; expires_at: Date } {
  const expires = now + ttlMs;
  return {
    token: `${expires}.${sign(secret, productId, expires)}`,
    expires_at: new Date(expires),
  };
}

/** True when `token` is an unexpired preview for exactly this product. */
export function verifyProductPreview(
  secret: string,
  productId: string,
  token: string | undefined | null,
  now = Date.now(),
): boolean {
  if (!secret || !token || typeof token !== 'string') return false;
  const dot = token.indexOf('.');
  if (dot <= 0) return false;
  const expiresText = token.slice(0, dot);
  if (!/^\d{1,15}$/.test(expiresText)) return false;
  const expires = Number(expiresText);
  if (expires <= now) return false;
  const given = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(sign(secret, String(productId), expires));
  return given.length === expected.length && timingSafeEqual(given, expected);
}
