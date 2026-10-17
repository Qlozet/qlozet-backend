import { ASSISTANT_ACTION_KINDS } from '../../modules/assistant/schema/action.schema';
import {
  ASSISTANT_ACTION_AREA,
  VENDOR_AREA_LIST,
  vendorAreaAllows,
  vendorAreaDeniedMessage,
  vendorAreasFor,
} from './vendor-access';

describe('vendor areas', () => {
  it('the owner may do everything, by role name or by flag', () => {
    for (const area of VENDOR_AREA_LIST) {
      expect(vendorAreaAllows(area, 'owner')).toBe(true);
      expect(vendorAreaAllows(area, 'tailor', true)).toBe(true);
    }
  });

  it('operations runs fulfilment and money movement; marketing runs promotions', () => {
    expect(vendorAreaAllows('orders.reject', 'operations')).toBe(true);
    expect(vendorAreaAllows('wallet.withdraw', 'operations')).toBe(true);
    expect(vendorAreaAllows('discounts.manage', 'operations')).toBe(false);
    expect(vendorAreaAllows('discounts.manage', 'marketing')).toBe(true);
    expect(vendorAreaAllows('orders.fulfil', 'marketing')).toBe(false);
  });

  it('a tailor works production and size guides, and never sees the money', () => {
    expect(vendorAreasFor('tailor')).toEqual(
      expect.arrayContaining(['orders.production', 'size_guides.manage', 'styles.manage', 'tickets']),
    );
    expect(vendorAreasFor('tailor')).not.toEqual(expect.arrayContaining(['money.view']));
    expect(vendorAreaAllows('payout_account.manage', 'tailor')).toBe(false);
  });

  it('an unknown or custom role gets only what every member has', () => {
    expect(vendorAreasFor('finance')).toEqual(
      ['orders.production', 'tickets', 'customers.view', 'assistant.chat'],
    );
    expect(vendorAreasFor(null)).toEqual(vendorAreasFor('finance'));
  });

  it('every vendor assistant action names the area it stands in for', () => {
    const vendorKinds = ['confirm_order', 'reply_to_quote', 'update_stock', 'create_discount', 'update_listing'];
    for (const kind of vendorKinds) {
      expect(ASSISTANT_ACTION_KINDS).toContain(kind);
      expect(ASSISTANT_ACTION_AREA[kind]).toBeDefined();
    }
  });

  it('says who may, in plain words', () => {
    expect(vendorAreaDeniedMessage('orders.fulfil')).toBe(
      'Only the owner, operations or customer support can confirm or fulfil orders.',
    );
    expect(vendorAreaDeniedMessage('payout_account.manage')).toBe(
      'Only the owner can use payout_account.manage.',
    );
  });
});
