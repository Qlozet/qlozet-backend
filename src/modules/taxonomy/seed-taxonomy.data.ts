import { ProductKind } from '../products/schemas/product.schema';
import { TagAssignableBy } from './schemas/system-tag.schema';

/**
 * Default Qlozet Taxonomy Seed Data
 *
 * This data is used by TaxonomyService.seed() to populate the database
 * with a default set of categories and tags for the Nigerian fashion market.
 *
 * Safe to re-run: duplicates are skipped via the unique compound index.
 */

// ─────────────────────────────────────────────────────────
// CATEGORIES
// ─────────────────────────────────────────────────────────

export const SEED_CATEGORIES = [
  // ── CLOTHING ──────────────────────────────────────────
  {
    kind: ProductKind.CLOTHING,
    product_type: 'Dress',
    categories: ['Maxi', 'Mini', 'Midi', 'A-Line', 'Shift', 'Wrap', 'Evening', 'Wedding'],
    attributes: ['Formal', 'Casual', 'Summer', 'Winter', 'Festive', 'Bridal', 'Office', 'Evening', 'Streetwear'],
    icon: '👗',
    sort_order: 0,
  },
  {
    kind: ProductKind.CLOTHING,
    product_type: 'Top',
    categories: ['Blouse', 'T-Shirt', 'Crop Top', 'Tank Top', 'Tunic', 'Peplum'],
    attributes: ['Formal', 'Casual', 'Summer', 'Winter', 'Festive', 'Office', 'Streetwear'],
    icon: '👚',
    sort_order: 1,
  },
  {
    kind: ProductKind.CLOTHING,
    product_type: 'Trousers',
    categories: ['Palazzo', 'Straight', 'Wide-Leg', 'Joggers', 'Skinny'],
    attributes: ['Formal', 'Casual', 'Summer', 'Winter', 'Office', 'Streetwear'],
    icon: '👖',
    sort_order: 2,
  },
  {
    kind: ProductKind.CLOTHING,
    product_type: 'Shorts',
    categories: ['Bermuda', 'Cargo', 'Denim', 'Athletic', 'High-Waist'],
    attributes: ['Casual', 'Summer', 'Streetwear', 'Athletic'],
    icon: '🩳',
    sort_order: 3,
  },
  {
    kind: ProductKind.CLOTHING,
    product_type: 'Skirt',
    categories: ['Maxi', 'Mini', 'Pencil', 'A-Line', 'Mermaid', 'Pleated'],
    attributes: ['Formal', 'Casual', 'Summer', 'Festive', 'Office', 'Evening'],
    icon: '🩱',
    sort_order: 4,
  },
  {
    kind: ProductKind.CLOTHING,
    product_type: 'Suit',
    categories: ['Two-Piece', 'Three-Piece'],
    attributes: ['Formal', 'Office', 'Evening', 'Wedding'],
    icon: '🤵',
    sort_order: 5,
  },
  {
    kind: ProductKind.CLOTHING,
    product_type: 'Traditional',
    categories: ['Agbada', 'Kaftan', 'Dashiki', 'Buba & Iro', 'Aso-Ebi'],
    attributes: ['Festive', 'Wedding', 'Cultural', 'Formal', 'Casual'],
    icon: '🪘',
    sort_order: 6,
  },
  {
    kind: ProductKind.CLOTHING,
    product_type: 'Jumpsuit',
    categories: ['Full-Length', 'Playsuit', 'Romper'],
    attributes: ['Casual', 'Summer', 'Evening', 'Festive'],
    icon: '🧥',
    sort_order: 7,
  },
  {
    kind: ProductKind.CLOTHING,
    product_type: 'Outerwear',
    categories: ['Blazer', 'Cape', 'Kimono', 'Jacket'],
    attributes: ['Formal', 'Casual', 'Winter', 'Office', 'Streetwear'],
    icon: '🧥',
    sort_order: 8,
  },
  {
    kind: ProductKind.CLOTHING,
    product_type: 'Swimwear',
    categories: ['One-Piece', 'Bikini', 'Cover-Up'],
    attributes: ['Summer', 'Casual', 'Beach'],
    icon: '👙',
    sort_order: 9,
  },

  // ── ACCESSORIES ───────────────────────────────────────
  {
    kind: ProductKind.ACCESSORY,
    product_type: 'Bag',
    categories: ['Tote', 'Clutch', 'Crossbody', 'Backpack', 'Handbag', 'Satchel'],
    attributes: ['Luxury', 'Everyday', 'Statement', 'Minimalist', 'Handmade'],
    icon: '👜',
    sort_order: 0,
  },
  {
    kind: ProductKind.ACCESSORY,
    product_type: 'Jewelry',
    categories: ['Necklace', 'Bracelet', 'Earring', 'Ring', 'Anklet'],
    attributes: ['Luxury', 'Everyday', 'Statement', 'Minimalist', 'Handmade'],
    icon: '💍',
    sort_order: 1,
  },
  {
    kind: ProductKind.ACCESSORY,
    product_type: 'Footwear',
    categories: ['Heels', 'Flats', 'Sandals', 'Boots', 'Sneakers', 'Mules'],
    attributes: ['Luxury', 'Everyday', 'Statement', 'Casual', 'Formal'],
    icon: '👠',
    sort_order: 2,
  },
  {
    kind: ProductKind.ACCESSORY,
    product_type: 'Headwear',
    categories: ['Gele', 'Hat', 'Fascinator', 'Headband', 'Turban'],
    attributes: ['Statement', 'Cultural', 'Festive', 'Everyday'],
    icon: '👒',
    sort_order: 3,
  },
  {
    kind: ProductKind.ACCESSORY,
    product_type: 'Belt',
    categories: ['Waist Belt', 'Chain Belt', 'Obi Belt'],
    attributes: ['Everyday', 'Statement', 'Formal'],
    icon: '🪢',
    sort_order: 4,
  },

  // ── FABRIC (Material → Pattern) ────────────────────────
  {
    kind: ProductKind.FABRIC,
    product_type: 'Cotton',
    categories: ['Wax Print (Ankara)', 'Adire', 'Plain', 'Printed', 'Holland', 'Vlisco', 'Hitarget'],
    attributes: ['Lightweight', 'Heavy-weight', 'Printed', 'Everyday', 'Cultural'],
    icon: '🌿',
    sort_order: 0,
  },
  {
    kind: ProductKind.FABRIC,
    product_type: 'Lace',
    categories: ['French Lace', 'Swiss Lace', 'Cord Lace', 'Guipure'],
    attributes: ['Premium', 'Lightweight', 'Heavy-weight', 'Embroidered'],
    icon: '🪡',
    sort_order: 1,
  },
  {
    kind: ProductKind.FABRIC,
    product_type: 'Silk',
    categories: ['Pure Silk', 'Satin', 'Charmeuse', 'Plain'],
    attributes: ['Premium', 'Lightweight', 'Luxury', 'Elegant'],
    icon: '✨',
    sort_order: 2,
  },
  {
    kind: ProductKind.FABRIC,
    product_type: 'Chiffon',
    categories: ['Georgette', 'Organza', 'Plain'],
    attributes: ['Lightweight', 'Sheer', 'Elegant'],
    icon: '🌬️',
    sort_order: 3,
  },
  {
    kind: ProductKind.FABRIC,
    product_type: 'Polyester',
    categories: ['Wax Print', 'Printed', 'Solid'],
    attributes: ['Everyday', 'Lightweight', 'Durable'],
    icon: '🧵',
    sort_order: 4,
  },
  {
    kind: ProductKind.FABRIC,
    product_type: 'Aso-Oke',
    categories: ['Hand-Woven', 'Machine-Woven'],
    attributes: ['Premium', 'Handmade', 'Cultural'],
    icon: '🧶',
    sort_order: 5,
  },
  {
    kind: ProductKind.FABRIC,
    product_type: 'Wool',
    categories: ['Cashmere', 'Tweed', 'Plain'],
    attributes: ['Premium', 'Heavy-weight', 'Winter'],
    icon: '🐑',
    sort_order: 6,
  },
  {
    kind: ProductKind.FABRIC,
    product_type: 'Velvet',
    categories: ['Crushed', 'Plain', 'Embossed'],
    attributes: ['Premium', 'Heavy-weight', 'Luxury'],
    icon: '👑',
    sort_order: 7,
  },
];

// ─────────────────────────────────────────────────────────
// TAGS
// ─────────────────────────────────────────────────────────

export const SEED_TAGS = [
  // Admin-only tags
  {
    name: 'Staff Pick',
    assignable_by: TagAssignableBy.ADMIN_ONLY,
    sort_order: 0,
  },
  {
    name: 'Featured',
    assignable_by: TagAssignableBy.ADMIN_ONLY,
    sort_order: 1,
  },
  {
    name: 'Limited Edition',
    assignable_by: TagAssignableBy.ADMIN_ONLY,
    sort_order: 2,
  },
  {
    name: "Editor's Choice",
    assignable_by: TagAssignableBy.ADMIN_ONLY,
    sort_order: 3,
  },

  // Vendor-selectable tags
  {
    name: 'Plus-Size Friendly',
    assignable_by: TagAssignableBy.VENDOR,
    sort_order: 10,
  },
  {
    name: 'Maternity',
    assignable_by: TagAssignableBy.VENDOR,
    sort_order: 11,
  },
  {
    name: 'Petite',
    assignable_by: TagAssignableBy.VENDOR,
    sort_order: 12,
  },
  {
    name: 'Handmade',
    assignable_by: TagAssignableBy.VENDOR,
    sort_order: 13,
  },
  {
    name: 'Eco-Friendly',
    assignable_by: TagAssignableBy.VENDOR,
    sort_order: 14,
  },
  {
    name: 'Made-to-Order',
    assignable_by: TagAssignableBy.VENDOR,
    sort_order: 15,
  },
  {
    name: 'Unisex',
    assignable_by: TagAssignableBy.VENDOR,
    sort_order: 16,
  },
];
