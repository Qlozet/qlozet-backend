// Token packs: the one list of what people can buy, set by the admin in
// Settings and read by the shop, the vendor app and the phone apps.
//
// The packs used to be written into each app (5 / 15 / 30 / 60 tokens) while
// one AI design costs 45, so most packs could not pay for a single design,
// and "Best value" labels sat on packs with the same price per token. Now
// each pack has a round naira price set by the admin, and bigger packs carry
// bonus tokens, so "best value" is true. The server prices every purchase
// from the pack; the app only names it.

export interface TokenPack {
  id: string;
  name: string;
  /** Tokens paid for. */
  tokens: number;
  /** Extra tokens given free with the pack. */
  bonus_tokens: number;
  /** What the pack costs, in whole naira. */
  price_ngn: number;
  /** A short label such as "Most popular"; null for none. */
  tag: string | null;
  active: boolean;
}

export const MAX_TOKEN_PACKS = 8;

// About ₦13 a token; one AI design (45 tokens) is about ₦600.
export const DEFAULT_TOKEN_PACKS: TokenPack[] = [
  { id: 'starter', name: 'Starter', tokens: 150, bonus_tokens: 0, price_ngn: 2000, tag: null, active: true },
  { id: 'popular', name: 'Popular', tokens: 400, bonus_tokens: 40, price_ngn: 5000, tag: 'Most popular', active: true },
  { id: 'pro', name: 'Pro', tokens: 800, bonus_tokens: 160, price_ngn: 10000, tag: null, active: true },
  { id: 'studio', name: 'Studio', tokens: 2000, bonus_tokens: 600, price_ngn: 25000, tag: 'Best value', active: true },
];

const slug = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/**
 * Clean an admin-saved list: drop broken rows, give each a unique id, order
 * by price. Returns the defaults when nothing usable was saved.
 */
export function normalizeTokenPacks(raw: unknown): TokenPack[] {
  if (!Array.isArray(raw) || raw.length === 0) return DEFAULT_TOKEN_PACKS;
  const seen = new Set<string>();
  const packs: TokenPack[] = [];
  for (const r of raw.slice(0, MAX_TOKEN_PACKS) as any[]) {
    const name = String(r?.name ?? '').trim();
    const tokens = Math.floor(Number(r?.tokens));
    const price = Math.round(Number(r?.price_ngn));
    if (!name || !(tokens >= 1) || !(price >= 100)) continue;
    let id = slug(String(r?.id || name)) || 'pack';
    while (seen.has(id)) id = `${id}-2`;
    seen.add(id);
    const bonus = Math.max(0, Math.floor(Number(r?.bonus_tokens) || 0));
    const tag = String(r?.tag ?? '').trim();
    packs.push({
      id,
      name: name.slice(0, 30),
      tokens,
      bonus_tokens: bonus,
      price_ngn: price,
      tag: tag ? tag.slice(0, 24) : null,
      active: r?.active !== false,
    });
  }
  if (!packs.length) return DEFAULT_TOKEN_PACKS;
  return packs.sort((a, b) => a.price_ngn - b.price_ngn);
}

export const packTotalTokens = (p: TokenPack) => p.tokens + p.bonus_tokens;

/** What the shop shows: active packs with the total they give and how many AI designs that covers. */
export function publicTokenPacks(raw: unknown, designPrice: number) {
  const perDesign = Number(designPrice) > 0 ? Number(designPrice) : 0;
  return normalizeTokenPacks(raw)
    .filter((p) => p.active)
    .map((p) => ({
      ...p,
      total_tokens: packTotalTokens(p),
      designs: perDesign ? Math.floor(packTotalTokens(p) / perDesign) : null,
    }));
}

/**
 * Naira for a bare token count, for apps that still send one instead of a
 * pack: the dearest per-token rate among the packs, no bonus, so it never
 * beats buying a pack.
 */
export function legacyTokenPrice(raw: unknown, tokens: number): number {
  const packs = normalizeTokenPacks(raw).filter((p) => p.active);
  const list = packs.length ? packs : DEFAULT_TOKEN_PACKS;
  const dearest = list.reduce((a, b) =>
    b.price_ngn / b.tokens > a.price_ngn / a.tokens ? b : a,
  );
  // Whole naira, rounded up; the epsilon absorbs float error (15 × 2000/150).
  return Math.ceil((tokens * dearest.price_ngn) / dearest.tokens - 1e-9);
}
