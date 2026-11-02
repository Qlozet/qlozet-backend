/**
 * Which catalogue fabrics are closest to a fabric read from a photo
 * (measurement/fabric-reading.ts).
 *
 * Colour carries most of the weight: it is what a shopper sees first, and
 * every listing stores its colours as hex. Fabric type and pattern come from
 * the listing's free text (name, material, pattern, description), sorted
 * into the same words the photo reading uses.
 *
 * Pure: the caller loads the fabrics.
 */

import type { FabricPattern, FabricType, ReadFabric } from '../measurement/fabric-reading';

export interface CatalogueFabric {
  id: string;
  name: string;
  image?: string | null;
  vendor_id?: string | null;
  vendor_name?: string | null;
  price_per_yard?: number | null;
  colors: { name?: string; hex?: string }[];
  /** Free text from the listing: name, material, pattern, description. */
  text: string;
}

export interface FabricMatch {
  fabric_id: string;
  name: string;
  image: string | null;
  vendor_id: string | null;
  vendor_name: string | null;
  price_per_yard: number | null;
  /** 0 to 1. */
  score: number;
  reasons: string[];
}

export interface FabricSetMatch {
  vendor_id: string;
  vendor_name: string | null;
  score: number;
  items: { role: ReadFabric['role']; match: FabricMatch }[];
}

// ── The listing's words, sorted into the reading's ──

const TYPE_WORDS: [FabricType, string[]][] = [
  ['ankara', ['ankara', 'wax print', 'dutch wax', 'african print', 'kitenge', 'chitenge', 'hollandais', 'wax']],
  ['lace', ['lace', 'guipure', 'cord lace', 'french lace', 'swiss voile']],
  ['aso_oke', ['aso oke', 'aso-oke', 'asooke', 'aso ofi', 'asoke']],
  ['adire', ['adire', 'tie dye', 'tie-dye', 'batik', 'kampala']],
  ['kente', ['kente']],
  ['brocade', ['brocade', 'jacquard', 'damask', 'shadda', 'guinea']],
  ['silk_satin', ['silk', 'satin', 'charmeuse', 'mikado', 'taffeta']],
  ['chiffon_sheer', ['chiffon', 'georgette', 'organza', 'tulle', 'voile', 'mesh']],
  ['senator', ['senator', 'cashmere']],
  ['cotton', ['cotton', 'poplin', 'atiku', 'cambric', 'broadcloth', 'percale']],
  ['linen', ['linen']],
  ['wool', ['wool', 'tweed', 'suiting', 'gabardine']],
  ['velvet', ['velvet', 'velour']],
  ['denim', ['denim', 'jean']],
  ['sequin', ['sequin', 'sequence', 'beaded', 'stoned']],
  ['stretch_knit', ['jersey', 'knit', 'lycra', 'spandex', 'scuba', 'stretch', 'crepe']],
  ['leather', ['leather', 'suede']],
];

const PATTERN_WORDS: [FabricPattern, string[]][] = [
  ['floral', ['floral', 'flower', 'rose', 'botanical', 'leaf']],
  ['geometric', ['geometric', 'diamond', 'triangle', 'zigzag', 'chevron', 'hexagon']],
  ['stripes', ['stripe', 'pinstripe']],
  ['check', ['check', 'plaid', 'gingham', 'tartan']],
  ['polka_dot', ['polka', 'dots', 'dotted']],
  ['animal', ['leopard', 'zebra', 'animal', 'snake', 'cheetah', 'tiger']],
  ['tie_dye', ['tie dye', 'tie-dye', 'adire', 'batik']],
  ['embroidered', ['embroider']],
  ['beaded_sequined', ['sequin', 'sequence', 'beaded', 'stoned']],
  ['abstract', ['abstract']],
  ['solid', ['plain', 'solid']],
];

const TYPE_NAMES: Record<FabricType, string> = {
  ankara: 'ankara', lace: 'lace', aso_oke: 'aso-oke', adire: 'adire', kente: 'kente',
  brocade: 'brocade', silk_satin: 'silk or satin', chiffon_sheer: 'sheer fabric',
  cotton: 'cotton', senator: 'senator', linen: 'linen', wool: 'wool', velvet: 'velvet',
  denim: 'denim', sequin: 'sequins', stretch_knit: 'stretch fabric', leather: 'leather', other: 'fabric',
};

const findAll = <K extends string>(text: string, table: [K, string[]][]): Set<K> => {
  const t = ` ${text.toLowerCase().replace(/[^a-z0-9#-]+/g, ' ')} `;
  const out = new Set<K>();
  for (const [key, words] of table) {
    if (words.some((w) => t.includes(` ${w}`))) out.add(key);
  }
  return out;
};

export const typesOf = (text: string) => findAll(text, TYPE_WORDS);
export const patternsOf = (text: string) => findAll(text, PATTERN_WORDS);

// ── Colour distance (CIE76 in Lab: close enough for "looks the same") ──

function hexToLab(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex?.trim() ?? '');
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const r = lin((n >> 16) & 255);
  const g = lin((n >> 8) & 255);
  const b = lin(n & 255);
  const x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
  const y = r * 0.2126 + g * 0.7152 + b * 0.0722;
  const z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

export function colorDistance(a: string, b: string): number | null {
  const la = hexToLab(a);
  const lb = hexToLab(b);
  if (!la || !lb) return null;
  return Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2]);
}

/** Beyond this distance two colours are not alike at all. */
const FAR = 45;

/**
 * How alike the colours are, 0 to 1: each colour read from the photo (the
 * first counts most) against the closest colour the listing comes in.
 */
function colorScore(target: ReadFabric['colors'], fabric: CatalogueFabric['colors']): number | null {
  const hexes = fabric.map((c) => c.hex).filter((h): h is string => !!hexToLab(h ?? ''));
  if (!target.length || !hexes.length) return null;
  const weights = [0.6, 0.25, 0.15].slice(0, target.length);
  const total = weights.reduce((a, b) => a + b, 0);
  let score = 0;
  target.forEach((c, i) => {
    const best = Math.min(...hexes.map((h) => colorDistance(c.hex, h) ?? FAR));
    score += (weights[i] / total) * Math.max(0, 1 - best / FAR);
  });
  return score;
}

const W = { color: 0.6, type: 0.25, pattern: 0.15 };

export function scoreFabric(target: ReadFabric, fabric: CatalogueFabric): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  const types = typesOf(fabric.text);
  const patterns = patternsOf(fabric.text);

  // No colours on the listing: judge it on the rest, at a discount.
  const c = colorScore(target.colors, fabric.colors);
  const colorPart = c ?? 0.25;
  if (c !== null && c >= 0.75) reasons.push('Very close colour');
  else if (c !== null && c >= 0.5) reasons.push('Similar colour');

  let typePart = 0;
  if (target.fabric_type !== 'other' && types.has(target.fabric_type)) {
    typePart = 1;
    reasons.push(`Also ${TYPE_NAMES[target.fabric_type]}`);
  } else if (target.fabric_type === 'other' || types.size === 0) {
    typePart = 0.3; // unknown either side: neither a match nor a clash
  }

  let patternPart = 0;
  if (target.pattern !== 'other' && patterns.has(target.pattern)) {
    patternPart = 1;
    if (target.pattern !== 'solid') reasons.push(`Same ${target.pattern.replace('_', ' ')} pattern`);
    else reasons.push('Plain, like your photo');
  } else if (target.pattern === 'other' || patterns.size === 0) {
    patternPart = 0.3;
  }

  const score = W.color * colorPart + W.type * typePart + W.pattern * patternPart;
  return { score: Math.round(score * 1000) / 1000, reasons };
}

const asMatch = (f: CatalogueFabric, s: { score: number; reasons: string[] }): FabricMatch => ({
  fabric_id: f.id,
  name: f.name,
  image: f.image ?? null,
  vendor_id: f.vendor_id ?? null,
  vendor_name: f.vendor_name ?? null,
  price_per_yard: f.price_per_yard ?? null,
  score: s.score,
  reasons: s.reasons,
});

/** Below this a fabric is not shown as a match at all. */
export const MIN_MATCH = 0.45;

/**
 * The closest fabrics for each fabric read from the photo, and the shops
 * whose fabrics match every one of them (a set: one seller, one transfer).
 */
export function matchFabrics(
  reading: ReadFabric[],
  catalogue: CatalogueFabric[],
  limit = 6,
): { by_role: Record<string, FabricMatch[]>; sets: FabricSetMatch[] } {
  const by_role: Record<string, FabricMatch[]> = {};
  const bestPerVendor = new Map<string, Map<string, FabricMatch>>();

  for (const target of reading) {
    const scored = catalogue
      .map((f) => asMatch(f, scoreFabric(target, f)))
      .filter((m) => m.score >= MIN_MATCH)
      .sort((a, b) => b.score - a.score);
    by_role[target.role] = scored.slice(0, limit);
    for (const m of scored) {
      if (!m.vendor_id) continue;
      const roles = bestPerVendor.get(m.vendor_id) ?? new Map<string, FabricMatch>();
      if (!roles.has(target.role)) roles.set(target.role, m);
      bestPerVendor.set(m.vendor_id, roles);
    }
  }

  const sets: FabricSetMatch[] = [];
  if (reading.length > 1) {
    for (const [vendor_id, roles] of bestPerVendor) {
      // A set needs different fabrics for different roles.
      const items = reading.map((t) => ({ role: t.role, match: roles.get(t.role) }));
      if (items.some((i) => !i.match)) continue;
      const ids = new Set(items.map((i) => i.match!.fabric_id));
      if (ids.size < items.length) continue;
      const score = items.reduce((s, i) => s + i.match!.score, 0) / items.length;
      sets.push({
        vendor_id,
        vendor_name: items[0].match!.vendor_name,
        score: Math.round(score * 1000) / 1000,
        items: items.map((i) => ({ role: i.role, match: i.match! })),
      });
    }
    sets.sort((a, b) => b.score - a.score);
  }
  return { by_role, sets: sets.slice(0, 3) };
}
