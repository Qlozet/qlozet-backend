/**
 * When the courier collects a parcel from the store, and when a collection
 * that never happened needs someone's attention.
 *
 * Every Qlozet delivery is a courier pickup from the store's address. The
 * pickup day is fixed when the vendor fulfils: the same day before the
 * cut-off on a working day, otherwise the next working day (a booking made
 * at 9pm or on a Sunday can't be collected "today"). Times are Lagos time,
 * which has no daylight saving (always UTC+1).
 */

const LAGOS_OFFSET_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Bookings at or after this Lagos hour are collected the next working day. */
export const PICKUP_CUTOFF_HOUR = 16;

/**
 * Hours after the end of the pickup day before an uncollected parcel is
 * flagged. Couriers often collect the next morning, so the alert fires at
 * midday the day after the pickup day.
 */
export const COLLECTION_GRACE_HOURS = 12;

/** The Lagos calendar day for an instant, as YYYY-MM-DD. */
export function lagosDate(at: Date): string {
  return new Date(at.getTime() + LAGOS_OFFSET_MS).toISOString().slice(0, 10);
}

/** The pickup day for a booking made at `now`, as YYYY-MM-DD (Lagos). */
export function pickupDateFor(now: Date, cutoffHour = PICKUP_CUTOFF_HOUR): string {
  const local = new Date(now.getTime() + LAGOS_OFFSET_MS);
  let day = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()));
  const isWorkingDay = (d: Date) => d.getUTCDay() !== 0 && d.getUTCDay() !== 6;
  if (!isWorkingDay(day) || local.getUTCHours() >= cutoffHour) {
    do {
      day = new Date(day.getTime() + DAY_MS);
    } while (!isWorkingDay(day));
  }
  return day.toISOString().slice(0, 10);
}

/**
 * A pickup day in words, relative to `now`: "today", "tomorrow", or
 * "on Monday 30 November". Null when there's no usable date.
 */
export function pickupDayInWords(pickupDate: string | null | undefined, now: Date): string | null {
  if (!pickupDate || !/^\d{4}-\d{2}-\d{2}$/.test(pickupDate)) return null;
  const today = lagosDate(now);
  if (pickupDate === today) return 'today';
  if (pickupDate === lagosDate(new Date(now.getTime() + DAY_MS))) return 'tomorrow';
  const day = new Date(`${pickupDate}T12:00:00Z`);
  const weekday = day.toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
  const date = day.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' });
  return `on ${weekday} ${date}`;
}

/**
 * When an uncollected parcel should be flagged: midday (Lagos) the day after
 * its pickup day. Parts booked before pickup dates were stored fall back to
 * 24 hours after they were booked.
 */
export function collectionDueBy(shipment: {
  pickup_date?: string | null;
  shipped_at?: Date | string | null;
}): Date | null {
  if (shipment.pickup_date && /^\d{4}-\d{2}-\d{2}$/.test(shipment.pickup_date)) {
    const endOfPickupDayUtc =
      new Date(`${shipment.pickup_date}T00:00:00Z`).getTime() + DAY_MS - LAGOS_OFFSET_MS;
    return new Date(endOfPickupDayUtc + COLLECTION_GRACE_HOURS * 60 * 60 * 1000);
  }
  if (shipment.shipped_at) {
    return new Date(new Date(shipment.shipped_at).getTime() + DAY_MS);
  }
  return null;
}

/** Why a part needs the vendor (and the ops team) to look at its pickup. */
export type CollectionProblem = 'not_collected' | 'courier_cancelled';

/**
 * Whether a part's courier collection has gone wrong and nobody has been
 * told yet: booked but never picked up past its due time, or the courier
 * cancelled / failed it. Rejected parts and parts already flagged are left
 * alone.
 */
export function collectionProblem(
  shipment: {
    status?: string;
    rejected?: boolean;
    pickup_alerted_at?: Date | string | null;
    pickup_date?: string | null;
    shipped_at?: Date | string | null;
  },
  now: Date,
): CollectionProblem | null {
  if (shipment.rejected || shipment.pickup_alerted_at) return null;
  if (shipment.status === 'failed') return 'courier_cancelled';
  if (shipment.status !== 'shipped') return null;
  const due = collectionDueBy(shipment);
  return due && now.getTime() >= due.getTime() ? 'not_collected' : null;
}

/**
 * Whether the vendor may book a new courier for a part that's already been
 * booked once: the courier cancelled it, or it was flagged as not collected.
 * A part the courier has picked up (in_transit) can never be rebooked.
 */
export function canRebookCollection(shipment: {
  status?: string;
  rejected?: boolean;
  pickup_alerted_at?: Date | string | null;
}): boolean {
  if (shipment.rejected) return false;
  if (shipment.status === 'failed') return true;
  return shipment.status === 'shipped' && !!shipment.pickup_alerted_at;
}
