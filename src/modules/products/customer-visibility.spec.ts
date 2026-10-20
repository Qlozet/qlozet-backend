import {
  customerVisibleModeration,
  getListingReviewMode,
  isApprovedForCustomers,
  isCustomerVisible,
  setListingReviewMode,
} from './customer-visibility';

const p = (status: string, moderation?: string) => ({
  status,
  ...(moderation ? { moderation: { status: moderation } } : {}),
});

describe('customer visibility', () => {
  afterEach(() => setListingReviewMode('review_first'));

  it('starts in review first, and falls back to it for anything unknown', () => {
    expect(getListingReviewMode()).toBe('review_first');
    setListingReviewMode('live_first');
    setListingReviewMode('nonsense');
    expect(getListingReviewMode()).toBe('review_first');
    setListingReviewMode(undefined);
    expect(getListingReviewMode()).toBe('review_first');
  });

  describe('review first', () => {
    it('shows approved listings and ones that predate moderation', () => {
      expect(isCustomerVisible(p('active', 'approved'))).toBe(true);
      expect(isCustomerVisible(p('active'))).toBe(true);
      expect(isCustomerVisible({ status: 'active', moderation: {} })).toBe(true);
    });

    it('hides pending and rejected listings', () => {
      expect(isCustomerVisible(p('active', 'pending'))).toBe(false);
      expect(isApprovedForCustomers(p('active', 'pending'))).toBe(false);
      expect(isCustomerVisible(p('active', 'rejected'))).toBe(false);
    });

    it('queries approved or missing only', () => {
      expect(customerVisibleModeration()).toEqual({ $in: ['approved', null] });
    });
  });

  describe('live first', () => {
    beforeEach(() => setListingReviewMode('live_first'));

    it('shows a pending listing while it waits for review', () => {
      expect(isCustomerVisible(p('active', 'pending'))).toBe(true);
      expect(isCustomerVisible(p('active', 'approved'))).toBe(true);
      expect(isCustomerVisible(p('active'))).toBe(true);
    });

    it('still hides a rejected listing', () => {
      expect(isCustomerVisible(p('active', 'rejected'))).toBe(false);
    });

    it('queries anything except rejected', () => {
      expect(customerVisibleModeration()).toEqual({ $ne: 'rejected' });
    });
  });

  it('never shows a listing the vendor took down, in either mode', () => {
    expect(isCustomerVisible(p('draft', 'approved'))).toBe(false);
    setListingReviewMode('live_first');
    expect(isCustomerVisible(p('draft', 'pending'))).toBe(false);
    expect(isCustomerVisible(null)).toBe(false);
  });
});
