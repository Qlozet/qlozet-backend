import { activationProblems, planBulkAction } from './bulk-actions';
import { ProductStatus } from './enums/product-status.enum';

const ready = (over: Record<string, unknown> = {}) => ({
  _id: 'a1',
  kind: 'fabric',
  status: ProductStatus.DRAFT,
  base_price: 12000,
  fabric: {
    name: 'Hand-woven aso-oke fabric',
    description:
      'Woven on a narrow loom in Iseyin from mercerised cotton, then joined ' +
      'into a full panel. Holds a crisp shape for agbada and gele. Dry clean ' +
      'or hand wash cold, and iron on the reverse.',
    images: [{}, {}, {}],
    variants: [{ stock: 5 }],
  },
  ...over,
});

describe('bulk product actions', () => {
  it('activates a ready draft and skips one that would break the listing rules', () => {
    const half = ready({ _id: 'b2', base_price: 0, fabric: { name: 'Fabric' } });
    const plan = planBulkAction(['a1', 'b2'], [ready(), half], 'activate');

    expect(plan.apply).toEqual(['a1']);
    expect(plan.skipped).toHaveLength(1);
    expect(plan.skipped[0]).toMatchObject({ id: 'b2', name: 'Fabric' });
    expect(plan.skipped[0].reason).toMatch(/price above zero/);
    expect(plan.skipped[0].reason).toMatch(/too short/);
  });

  it('names ids outside the store as not found, without saying whose they are', () => {
    const plan = planBulkAction(['a1', 'zz'], [ready()], 'archive');
    expect(plan.apply).toEqual(['a1']);
    expect(plan.skipped).toEqual([
      { id: 'zz', name: 'Unknown product', reason: 'Not found in your store.' },
    ]);
  });

  it('skips no-op changes and repeated ids', () => {
    const active = ready({ status: ProductStatus.ACTIVE });
    expect(planBulkAction(['a1'], [active], 'activate').skipped[0].reason).toBe('Already active.');
    const archived = ready({ status: ProductStatus.ARCHIVED });
    expect(planBulkAction(['a1'], [archived], 'archive').skipped[0].reason).toBe('Already archived.');
    // Delete applies whatever the status, once per product.
    expect(planBulkAction(['a1', 'a1'], [archived], 'delete')).toEqual({ apply: ['a1'], skipped: [] });
  });

  it('reads a stored product the same way the edit form is checked', () => {
    expect(activationProblems(ready())).toEqual([]);
    expect(activationProblems(ready({ base_price: null }))).toContain('Set a price above zero first.');
  });
});
