import { normalizeOfferings, offeringsUpdate, setupSteps } from './offerings';

const now = new Date('2026-11-23T10:00:00Z');
const answered = new Date('2026-11-01T10:00:00Z');

describe('normalizeOfferings', () => {
  it('keeps known values once, in the fixed order', () => {
    expect(normalizeOfferings(['Fabric', 'made_to_measure', 'fabric', 'shoes'])).toEqual([
      'made_to_measure',
      'fabric',
    ]);
  });
  it('treats anything else as empty', () => {
    expect(normalizeOfferings(undefined)).toEqual([]);
    expect(normalizeOfferings('fabric')).toEqual([]);
  });
});

describe('offeringsUpdate', () => {
  it('leaves an update without either field alone', () => {
    expect(offeringsUpdate({}, {}, now)).toEqual({});
  });

  it('first answer without tailoring turns bespoke off', () => {
    expect(offeringsUpdate({ accepts_bespoke: true }, { offerings: ['fabric'] }, now)).toEqual({
      offerings: ['fabric'],
      offerings_answered_at: now,
      accepts_bespoke: false,
    });
  });

  it('first answer with tailoring turns bespoke on', () => {
    expect(
      offeringsUpdate({ accepts_bespoke: false }, { offerings: ['made_to_measure', 'ready_to_wear'] }, now),
    ).toMatchObject({ accepts_bespoke: true, offerings: ['made_to_measure', 'ready_to_wear'] });
  });

  it('a later edit that keeps tailoring does not undo a pause', () => {
    const out = offeringsUpdate(
      { offerings: ['made_to_measure'], offerings_answered_at: answered, accepts_bespoke: false },
      { offerings: ['made_to_measure', 'fabric'] },
      now,
    );
    expect(out.accepts_bespoke).toBeUndefined();
    expect(out.offerings).toEqual(['made_to_measure', 'fabric']);
  });

  it('adding tailoring later turns bespoke on, removing it turns it off', () => {
    expect(
      offeringsUpdate(
        { offerings: ['fabric'], offerings_answered_at: answered, accepts_bespoke: false },
        { offerings: ['fabric', 'made_to_measure'] },
        now,
      ).accepts_bespoke,
    ).toBe(true);
    expect(
      offeringsUpdate(
        { offerings: ['made_to_measure', 'fabric'], offerings_answered_at: answered, accepts_bespoke: true },
        { offerings: ['fabric'] },
        now,
      ).accepts_bespoke,
    ).toBe(false);
  });

  it('turning the switch on adds tailoring to the list', () => {
    expect(
      offeringsUpdate({ offerings: ['fabric'], offerings_answered_at: answered }, { accepts_bespoke: true }, now),
    ).toEqual({ offerings: ['made_to_measure', 'fabric'], accepts_bespoke: true });
  });

  it('turning the switch off keeps the list', () => {
    expect(
      offeringsUpdate(
        { offerings: ['made_to_measure'], offerings_answered_at: answered },
        { accepts_bespoke: false },
        now,
      ),
    ).toEqual({ accepts_bespoke: false });
  });

  it('switch on with a list that leaves tailoring out keeps both true', () => {
    expect(
      offeringsUpdate({}, { offerings: ['fabric'], accepts_bespoke: true }, now),
    ).toMatchObject({ offerings: ['made_to_measure', 'fabric'], accepts_bespoke: true });
  });
});

describe('setupSteps', () => {
  const base = {
    offerings: [] as any[],
    hasLogo: true,
    hasDescription: true,
    hasPayout: false,
    listings: { made_to_measure: 0, ready_to_wear: 0, fabric: 0, accessory: 0 },
  };

  it('everyone gets store details and payout', () => {
    expect(setupSteps(base)).toEqual([
      { key: 'store_details', done: true },
      { key: 'payout', done: false },
    ]);
  });

  it('each thing sold adds its first listing, done only when one exists', () => {
    const steps = setupSteps({
      ...base,
      offerings: ['made_to_measure', 'fabric'],
      listings: { ...base.listings, fabric: 2 },
    });
    expect(steps.map((s) => [s.key, s.done])).toEqual([
      ['store_details', true],
      ['payout', false],
      ['made_to_measure_listing', false],
      ['fabric_listing', true],
    ]);
  });

  it('store details need both a logo and a description', () => {
    expect(setupSteps({ ...base, hasDescription: false })[0].done).toBe(false);
  });
});
