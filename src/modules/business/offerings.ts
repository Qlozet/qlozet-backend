/**
 * What a store sells, as the vendor tells us after sign-up.
 *
 * Not a vendor "type": it never limits what a store may list, and what it
 * actually sells is still read from its listings. It exists for the one thing
 * listings can't tell us — whether the store does made-to-measure work — and
 * to pick the store's first steps on the dashboard.
 *
 * `accepts_bespoke` stays the switch that decides whether quote requests are
 * sent. The rules in `offeringsUpdate` keep the two in step:
 *  - the first answer sets the switch (tailoring ticked → on, else off);
 *  - adding tailoring later turns it on, removing it turns it off;
 *  - turning the switch on adds tailoring to the list;
 *  - turning the switch off leaves the list alone (a tailor pausing requests
 *    while fully booked still does tailoring).
 */

export const OFFERINGS = [
  'made_to_measure',
  'ready_to_wear',
  'fabric',
  'accessories',
] as const;

export type Offering = (typeof OFFERINGS)[number];

export const MADE_TO_MEASURE: Offering = 'made_to_measure';

/** Known values only, no repeats, in the fixed order above. */
export function normalizeOfferings(raw: unknown): Offering[] {
  const given = new Set(
    (Array.isArray(raw) ? raw : []).map((v) => String(v).trim().toLowerCase()),
  );
  return OFFERINGS.filter((o) => given.has(o));
}

interface CurrentStore {
  offerings?: string[] | null;
  offerings_answered_at?: Date | null;
  accepts_bespoke?: boolean | null;
}

interface Incoming {
  offerings?: unknown;
  accepts_bespoke?: boolean;
}

/**
 * The fields to $set for a profile update that touches `offerings` or
 * `accepts_bespoke`. Returns {} when neither is in the update.
 */
export function offeringsUpdate(
  current: CurrentStore,
  incoming: Incoming,
  now: Date = new Date(),
): {
  offerings?: Offering[];
  offerings_answered_at?: Date;
  accepts_bespoke?: boolean;
} {
  const hasList = incoming.offerings !== undefined;
  const hasSwitch = typeof incoming.accepts_bespoke === 'boolean';
  if (!hasList && !hasSwitch) return {};

  const before = normalizeOfferings(current.offerings);
  let list = hasList ? normalizeOfferings(incoming.offerings) : before;
  let accepts: boolean | undefined = hasSwitch
    ? incoming.accepts_bespoke
    : undefined;

  if (hasList && !hasSwitch) {
    const firstAnswer = !current.offerings_answered_at;
    const had = before.includes(MADE_TO_MEASURE);
    const has = list.includes(MADE_TO_MEASURE);
    if (firstAnswer) accepts = has;
    else if (has && !had) accepts = true;
    else if (!has && had) accepts = false;
  }

  // Taking bespoke requests means the store does tailoring.
  if (accepts === true && !list.includes(MADE_TO_MEASURE)) {
    list = normalizeOfferings([...list, MADE_TO_MEASURE]);
  }

  const out: ReturnType<typeof offeringsUpdate> = {};
  if (hasList || list.length !== before.length) {
    out.offerings = list;
    if (hasList) out.offerings_answered_at = now;
  }
  if (accepts !== undefined) out.accepts_bespoke = accepts;
  return out;
}

// ─── First steps on the dashboard ───────────────────────────────────────

export type SetupStepKey =
  | 'store_details'
  | 'payout'
  | 'made_to_measure_listing'
  | 'ready_to_wear_listing'
  | 'fabric_listing'
  | 'accessory_listing';

export interface SetupFacts {
  offerings: Offering[];
  hasLogo: boolean;
  hasDescription: boolean;
  hasPayout: boolean;
  /** Saved listings (any status, not deleted) per kind. */
  listings: {
    made_to_measure: number;
    ready_to_wear: number;
    fabric: number;
    accessory: number;
  };
}

export interface SetupStep {
  key: SetupStepKey;
  done: boolean;
}

/**
 * The store's first steps, in order. Everyone gets store details and payout;
 * each thing they sell adds its first listing. Done only when the real thing
 * exists, never ticked by hand.
 */
export function setupSteps(f: SetupFacts): SetupStep[] {
  const steps: SetupStep[] = [
    { key: 'store_details', done: f.hasLogo && f.hasDescription },
    { key: 'payout', done: f.hasPayout },
  ];
  if (f.offerings.includes('made_to_measure')) {
    steps.push({ key: 'made_to_measure_listing', done: f.listings.made_to_measure > 0 });
  }
  if (f.offerings.includes('ready_to_wear')) {
    steps.push({ key: 'ready_to_wear_listing', done: f.listings.ready_to_wear > 0 });
  }
  if (f.offerings.includes('fabric')) {
    steps.push({ key: 'fabric_listing', done: f.listings.fabric > 0 });
  }
  if (f.offerings.includes('accessories')) {
    steps.push({ key: 'accessory_listing', done: f.listings.accessory > 0 });
  }
  return steps;
}
