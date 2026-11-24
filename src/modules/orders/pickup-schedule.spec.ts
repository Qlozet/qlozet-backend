import {
  canRebookCollection,
  collectionDueBy,
  collectionProblem,
  pickupDateFor,
  pickupDayInWords,
} from './pickup-schedule';

/**
 * The courier's pickup day (Lagos time, cut-off 4pm, working days only) and
 * when an uncollected parcel gets flagged.
 */

// Lagos is UTC+1, so 09:00Z is 10:00 in Lagos. 2026-11-24 is a Tuesday.
const at = (iso: string) => new Date(iso);

describe('pickup day', () => {
  it('is today before the cut-off on a working day', () => {
    expect(pickupDateFor(at('2026-11-24T09:00:00Z'))).toBe('2026-11-24');
    expect(pickupDateFor(at('2026-11-24T14:59:00Z'))).toBe('2026-11-24'); // 15:59 Lagos
  });

  it('is the next working day from the cut-off on', () => {
    expect(pickupDateFor(at('2026-11-24T15:00:00Z'))).toBe('2026-11-25'); // 16:00 Lagos
    expect(pickupDateFor(at('2026-11-24T22:30:00Z'))).toBe('2026-11-25'); // 23:30 Lagos
  });

  it('uses the Lagos date, not the UTC one, just after midnight', () => {
    // 23:30Z Tuesday is 00:30 Wednesday in Lagos: before the cut-off.
    expect(pickupDateFor(at('2026-11-24T23:30:00Z'))).toBe('2026-11-25');
  });

  it('skips the weekend', () => {
    expect(pickupDateFor(at('2026-11-27T16:00:00Z'))).toBe('2026-11-30'); // Fri 17:00 -> Mon
    expect(pickupDateFor(at('2026-11-28T09:00:00Z'))).toBe('2026-11-30'); // Sat -> Mon
    expect(pickupDateFor(at('2026-11-29T09:00:00Z'))).toBe('2026-11-30'); // Sun -> Mon
  });

  it('reads as today, tomorrow or a named day', () => {
    const now = at('2026-11-24T09:00:00Z');
    expect(pickupDayInWords('2026-11-24', now)).toBe('today');
    expect(pickupDayInWords('2026-11-25', now)).toBe('tomorrow');
    expect(pickupDayInWords('2026-11-30', now)).toBe('on Monday 30 November');
    expect(pickupDayInWords(null, now)).toBeNull();
    expect(pickupDayInWords('soon', now)).toBeNull();
  });
});

describe('uncollected parcels', () => {
  it('are due by midday Lagos the day after the pickup day', () => {
    // End of 24 Nov in Lagos is 23:00Z; plus 12h is 11:00Z on the 25th.
    expect(collectionDueBy({ pickup_date: '2026-11-24' })?.toISOString()).toBe(
      '2026-11-25T11:00:00.000Z',
    );
  });

  it('fall back to 24 hours after booking without a pickup day', () => {
    expect(collectionDueBy({ shipped_at: '2026-11-24T09:00:00Z' })?.toISOString()).toBe(
      '2026-11-25T09:00:00.000Z',
    );
    expect(collectionDueBy({})).toBeNull();
  });

  it('are flagged once past due, and a courier cancellation straight away', () => {
    const booked = { status: 'shipped', pickup_date: '2026-11-24' };
    expect(collectionProblem(booked, at('2026-11-25T10:59:00Z'))).toBeNull();
    expect(collectionProblem(booked, at('2026-11-25T11:00:00Z'))).toBe('not_collected');
    expect(collectionProblem({ status: 'failed' }, at('2026-11-24T09:00:00Z'))).toBe('courier_cancelled');
  });

  it('are left alone once picked up, rejected or already flagged', () => {
    const late = at('2026-12-10T00:00:00Z');
    expect(collectionProblem({ status: 'in_transit', pickup_date: '2026-11-24' }, late)).toBeNull();
    expect(collectionProblem({ status: 'shipped', rejected: true, pickup_date: '2026-11-24' }, late)).toBeNull();
    expect(
      collectionProblem({ status: 'shipped', pickup_date: '2026-11-24', pickup_alerted_at: late }, late),
    ).toBeNull();
  });

  it('can be rebooked when cancelled or flagged, never once picked up', () => {
    expect(canRebookCollection({ status: 'failed' })).toBe(true);
    expect(canRebookCollection({ status: 'shipped', pickup_alerted_at: new Date() })).toBe(true);
    expect(canRebookCollection({ status: 'shipped' })).toBe(false);
    expect(canRebookCollection({ status: 'in_transit', pickup_alerted_at: new Date() })).toBe(false);
    expect(canRebookCollection({ status: 'failed', rejected: true })).toBe(false);
  });
});
