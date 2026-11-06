import {
  GARMENT_NEEDS,
  checkGarment,
  garmentKindOf,
  missingMeasurementsMessage,
} from './garment-measurements';

/** What the manual form's 14 points look like, all filled. */
const manual = {
  chest: 98, waist: 84, hip: 100, shoulder_breadth: 40, arm_length: 60, leg_length: 80,
  bicep: 31, forearm: 27, thigh: 56, calf: 37, wrist: 17, ankle: 23, height: 175,
  shoulder_to_crotch: 70,
};

describe('garment measurements', () => {
  it('reads the garment from the taxonomy and from a bespoke design', () => {
    expect(garmentKindOf({ product_type: 'Traditional', categories: ['Agbada'] })).toBe('robe');
    expect(garmentKindOf({ product_type: 'Trousers', categories: ['Palazzo'] })).toBe('trousers');
    expect(garmentKindOf({ product_type: 'Dress', categories: ['Maxi'] })).toBe('dress');
    expect(garmentKindOf({ product_type: 'Outerwear', categories: ['Blazer'] })).toBe('top');
    expect(garmentKindOf({ product_type: 'Jumpsuit', categories: ['Playsuit'] })).toBe('jumpsuit');
    expect(garmentKindOf({ category: 'Agbada' })).toBe('robe');
    expect(garmentKindOf({ category: 'Pants' })).toBe('trousers');
    expect(garmentKindOf({ category: 'Dresses' })).toBe('dress');
    // Can't tell: the order falls back to the general check.
    expect(garmentKindOf({ product_type: 'Traditional', categories: ['Aso-Ebi'] })).toBeNull();
    expect(garmentKindOf(null)).toBeNull();
  });

  it('a full manual set covers every garment, so no one typing their own numbers is blocked', () => {
    for (const garment of Object.keys(GARMENT_NEEDS) as (keyof typeof GARMENT_NEEDS)[]) {
      expect(checkGarment(garment, manual).missing).toEqual([]);
    }
  });

  it('names exactly what a garment is missing', () => {
    const { arm_length, ...noArm } = manual;
    void arm_length;
    const robe = checkGarment('robe', noArm);
    expect(robe.missing).toEqual(['sleeve']);
    expect(missingMeasurementsMessage(robe)).toBe(
      'To make this agbada or kaftan the tailor needs your sleeve or arm length. Add them in Profile, then My Measurement.',
    );
    // Trousers don't care about the arms.
    expect(checkGarment('trousers', noArm).missing).toEqual([]);
    const trousers = checkGarment('trousers', { chest: 98, waist: 84 });
    expect(trousers.missing).toEqual(['hip', 'thigh', 'trouser_length']);
  });

  it('accepts a tailor\'s own names for the same point', () => {
    const book = { bust: 92, waist: 72, hips: 100, shoulder_width: 38, height: 165 };
    expect(checkGarment('dress', book).missing).toEqual([]);
  });

  it('flags needed points that are only rough estimates, and extras the tailor may want', () => {
    const meta = { shoulder_breadth: { tier: 'rough' }, chest: { tier: 'predicted' } };
    const check = checkGarment('top', manual, meta);
    expect(check.rough).toEqual(['shoulder']);
    expect(check.helpful_missing).toEqual(['neck', 'across_back']);
    // A rough breadth backed by a measured seam width is fine.
    const both = checkGarment('top', { ...manual, shoulder_width: 44 }, meta);
    expect(both.rough).toEqual([]);
  });
});
