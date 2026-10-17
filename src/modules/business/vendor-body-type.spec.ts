import { vendorBodyType } from './business.service';
import { CLASSIFIER_VERSION } from '../../common/utils/body-type-classifier';

/**
 * What a vendor sees as a customer's body type: the stored result when it is
 * about the default set and from the current classifier, otherwise worked out
 * from the default set on the spot. Never anything for a customer with no set.
 */
const SET = { name: 'me', measurements: { chest: 108, waist: 80, hip: 94 } };

describe('vendorBodyType', () => {
  it('no default set, no body type', () => {
    expect(vendorBodyType(null, null, 'male')).toBeNull();
    expect(vendorBodyType(null, { name: 'me', measurements: {} }, 'male')).toBeNull();
  });

  it('uses a stored classification that is current for the default set', () => {
    const cached = {
      bodyType: 'trapezoid',
      confidence: 'high',
      flattering_fits: ['classic'],
      avoid_fits: [],
      computed_at: new Date('2026-10-01'),
      from_set: 'me',
      classifier_version: CLASSIFIER_VERSION,
    };
    const out = vendorBodyType(cached, SET, 'male');
    expect(out?.type).toBe('trapezoid');
    expect(out?.computed_at).toEqual(new Date('2026-10-01'));
  });

  it('recomputes a stored result from another set or an older classifier', () => {
    const stale = { bodyType: 'round', confidence: 'high', from_set: 'dad', classifier_version: CLASSIFIER_VERSION };
    expect(vendorBodyType(stale, SET, 'male')?.type).toBe('athletic');
    const old = { bodyType: 'round', confidence: 'high', from_set: 'me' };
    const out = vendorBodyType(old, SET, 'male');
    expect(out?.type).toBe('athletic');
    expect(out?.computed_at).toBeNull();
  });
});
