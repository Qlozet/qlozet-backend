import { permittedAdminActionKinds, validateRefundAmount } from './admin-actions.helpers';

describe('permittedAdminActionKinds', () => {
  it('gives a super admin everything and a role only the kinds its modules cover', () => {
    expect(permittedAdminActionKinds(null)).toHaveLength(7);
    expect(permittedAdminActionKinds(new Set(['support_management']))).toEqual(['assign_ticket', 'reply_to_ticket', 'resolve_dispute']);
    expect(permittedAdminActionKinds(new Set(['product_management', 'vendor_management']))).toEqual(['approve_product', 'reject_product', 'decide_vendor_application', 'nudge_vendor']);
    expect(permittedAdminActionKinds(new Set(['analytics']))).toEqual([]);
  });
});

describe('validateRefundAmount', () => {
  it('requires a positive partial amount below the order total, and derives the full one', () => {
    expect(validateRefundAmount('partial_refund', 0, 50000)).toEqual({ error: expect.stringContaining('above zero') });
    expect(validateRefundAmount('partial_refund', 50000, 50000)).toEqual({ error: expect.stringContaining('below the order total') });
    expect(validateRefundAmount('partial_refund', 12345.678, 50000)).toEqual({ amount: 12345.68 });
    expect(validateRefundAmount('full_refund', undefined, 50000)).toEqual({ amount: 50000 });
    expect(validateRefundAmount('release_to_vendor', 999, 50000)).toEqual({ amount: null });
  });
});
