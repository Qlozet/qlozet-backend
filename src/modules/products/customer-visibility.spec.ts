import {
  CUSTOMER_VISIBLE_MODERATION,
  isApprovedForCustomers,
  isCustomerVisible,
} from './customer-visibility';

describe('customer visibility (review first)', () => {
  it('shows an approved, active product', () => {
    expect(isCustomerVisible({ status: 'active', moderation: { status: 'approved' } })).toBe(true);
  });

  it('keeps a product that predates moderation visible', () => {
    expect(isCustomerVisible({ status: 'active' })).toBe(true);
    expect(isCustomerVisible({ status: 'active', moderation: {} })).toBe(true);
  });

  it('hides a listing still awaiting review', () => {
    expect(isCustomerVisible({ status: 'active', moderation: { status: 'pending' } })).toBe(false);
    expect(isApprovedForCustomers({ moderation: { status: 'pending' } })).toBe(false);
  });

  it('hides a rejected listing', () => {
    expect(isCustomerVisible({ status: 'active', moderation: { status: 'rejected' } })).toBe(false);
  });

  it('hides an approved listing the vendor took down', () => {
    expect(isCustomerVisible({ status: 'draft', moderation: { status: 'approved' } })).toBe(false);
    expect(isCustomerVisible(null)).toBe(false);
  });

  it('the query fragment matches approved or missing only', () => {
    expect(CUSTOMER_VISIBLE_MODERATION).toEqual({ $in: ['approved', null] });
  });
});
