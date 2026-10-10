import { ProductFacts } from '../catalog/product-facts';

/** One product as the stylist's prompt sees it. */
export interface PromptProduct {
  name: string;
  price?: number;
  vendor?: string;
  type?: string;
  kind?: string;
  description?: string;
  tags?: string[];
  facts?: ProductFacts;
  /** In the customer's pre-computed set of products that fit their saved measurements. */
  fitsCustomer?: boolean;
}

// Descriptions are vendor-authored and can run long; every result's text
// lands in the prompt on every ask, so cap each one.
const DESCRIPTION_CHARS = 220;
const MAX_TAGS = 8;
const MAX_LIST = 6;

const naira = (n?: number) => `₦${Number(n ?? 0).toLocaleString('en-NG')}`;

const shortList = (xs: string[]) =>
  xs.length <= MAX_LIST ? xs.join(', ') : `${xs.slice(0, MAX_LIST).join(', ')} +${xs.length - MAX_LIST} more`;

const AUDIENCE_LABEL: Record<string, string> = { men: "men's", women: "women's", unisex: 'unisex' };

/**
 * The facts line: everything the shopper would ask about, in one line, so
 * the model has it in front of it rather than guessing from the name.
 */
export function factsLine(p: PromptProduct): string {
  const f = p.facts;
  const parts: string[] = [];

  if (p.kind === 'fabric' && f?.price_per_yard) {
    parts.push(`${naira(f.price_per_yard)} per yard`);
  } else if (f?.discounted_price) {
    parts.push(`${naira(f.discounted_price)} (was ${naira(p.price)})`);
  } else {
    parts.push(naira(p.price));
  }

  if (p.vendor) parts.push(`by ${p.vendor}`);
  if (f?.audience) parts.push(AUDIENCE_LABEL[f.audience] ?? f.audience);

  if (p.kind === 'clothing') {
    if (f?.made_to_order) {
      parts.push(f.turnaround_days ? `made to order, about ${f.turnaround_days} days` : 'made to order');
    } else if (f?.made_to_order === false) {
      parts.push('ready to wear');
    }
  }

  if (f?.material) parts.push(`material: ${f.material}`);
  if (f?.pattern) parts.push(`pattern: ${f.pattern}`);
  if (f?.colors?.length) parts.push(`colours: ${shortList(f.colors)}`);

  if (f?.in_stock === false) {
    parts.push('currently out of stock');
  } else if (f?.sizes?.length) {
    parts.push(`${f.made_to_order ? 'sizes' : 'sizes in stock'}: ${shortList(f.sizes)}`);
  }

  if (p.fitsCustomer) parts.push("matches the customer's saved measurements");
  if (f?.rating) parts.push(`rated ${f.rating}/5 by ${f.rating_count}`);

  return parts.join(' · ');
}

export function describeProduct(index: number, p: PromptProduct): string {
  const lines = [`${index + 1}. "${p.name}" — ${factsLine(p)}`];
  const desc = String(p.description ?? '').replace(/\s+/g, ' ').trim();
  if (desc) {
    lines.push(`   ${desc.slice(0, DESCRIPTION_CHARS)}${desc.length > DESCRIPTION_CHARS ? '…' : ''}`);
  }
  if (Array.isArray(p.tags) && p.tags.length) {
    lines.push(`   Tags: ${p.tags.slice(0, MAX_TAGS).join(', ')}`);
  }
  return lines.join('\n');
}

export function buildProductContext(products: PromptProduct[]): string {
  if (!products.length) return 'No products matched the query.';
  return products.map((p, i) => describeProduct(i, p)).join('\n');
}
