import {
  ORDER_RULES_TEXT_VERSION,
  hasAcknowledgedOrderRules,
  orderRulesFrom,
} from './order-rules';
import { manualSubmitProblem } from '../qoreid/manual-verification';

const settings = {
  auto_reject_hours: 48,
  default_turnaround_days: 3,
  late_penalty_percent_per_day: 5,
  late_penalty_max_percent: 25,
  abandon_after_days: 7,
  bespoke_deposit_percent: 50,
  bespoke_balance_days: 14,
  custom_cancellation_fee_percent: 30,
  return_window_days: 7,
  return_auto_approve_days: 3,
};

const card = (rules: ReturnType<typeof orderRulesFrom>, key: string) =>
  rules.cards.find((c) => c.key === key);

describe('How orders work: the cards', () => {
  it('states the numbers the platform runs on', () => {
    const rules = orderRulesFrom(settings);
    expect(card(rules, 'confirm')?.title).toBe('Confirm new orders within 48 hours');
    expect(card(rules, 'confirm')?.body).toMatch(/reminder 4 hours before/);
    expect(card(rules, 'late')?.body).toMatch(/5% of your items on the order, up to 25%/);
    expect(card(rules, 'abandon')?.title).toBe('7 days late, the order is cancelled');
    expect(card(rules, 'payout')?.title).toBe('You are paid 14 days after the customer pays');
    expect(card(rules, 'bespoke')?.body).toMatch(/50% of your quote/);
    expect(card(rules, 'bespoke')?.body).toMatch(/within 14 days, the order closes and you keep the deposit/);
    expect(card(rules, 'customer_cancel')?.body).toMatch(/you keep 30% of it/);
    expect(card(rules, 'returns')?.body).toMatch(/within 7 days of delivery\. Answer within 3 days/);
    expect(card(rules, 'disputes')?.title).toBe('Problems can be reported for 30 days');
  });

  it('follows the defaults when settings are missing', () => {
    const rules = orderRulesFrom({});
    expect(card(rules, 'confirm')?.title).toBe('Confirm new orders within 24 hours');
    expect(rules.terms.late_percent_per_day).toBe(5);
    expect(rules.terms.abandon_after_days).toBe(7);
  });

  it('leaves out a rule that is switched off', () => {
    const rules = orderRulesFrom({
      ...settings,
      auto_reject_hours: 0,
      late_penalty_percent_per_day: 0,
      abandon_after_days: 0,
      custom_cancellation_fee_percent: 0,
      return_auto_approve_days: 0,
    });
    expect(card(rules, 'confirm')?.title).toBe('Confirm new orders quickly');
    expect(card(rules, 'confirm')?.body).not.toMatch(/cancelled/);
    expect(card(rules, 'late')).toBeUndefined();
    expect(card(rules, 'abandon')).toBeUndefined();
    expect(card(rules, 'customer_cancel')?.body).toBe(
      'Customers can cancel with a full refund until you ship.',
    );
    expect(card(rules, 'returns')?.body).not.toMatch(/automatically/);
  });

  it('bespoke paid in one go when there is no split', () => {
    expect(card(orderRulesFrom({ ...settings, bespoke_deposit_percent: 100 }), 'bespoke')?.title).toBe(
      'Bespoke: paid when the quote is accepted',
    );
    expect(card(orderRulesFrom({ ...settings, bespoke_deposit_percent: 0 }), 'bespoke')?.body).not.toMatch(
      /deposit/,
    );
  });
});

describe('How orders work: the version and the acknowledgement', () => {
  it('names the wording and every number', () => {
    expect(orderRulesFrom(settings).version).toBe(
      `${ORDER_RULES_TEXT_VERSION}/48-3-5-25-7-14-50-14-30-7-3-30`,
    );
  });

  it('a changed rule asks the vendor again', () => {
    const before = orderRulesFrom(settings).version;
    const after = orderRulesFrom({ ...settings, late_penalty_percent_per_day: 10 }).version;
    expect(after).not.toBe(before);
    const business = { order_rules_ack: { version: before } };
    expect(hasAcknowledgedOrderRules(business, before)).toBe(true);
    expect(hasAcknowledgedOrderRules(business, after)).toBe(false);
    expect(hasAcknowledgedOrderRules({}, before)).toBe(false);
    expect(hasAcknowledgedOrderRules(null, before)).toBe(false);
  });

  it('manual submit waits for the acknowledgement', () => {
    const b = {
      verification_state: 'not_started',
      payout_account_number: '0123456789',
      payout_account_name: 'ADA STORES',
    };
    const ctx = { mode: 'manual' as const, agreementAccepted: true, rcNumber: 'RC123456' };
    expect(manualSubmitProblem(b, { ...ctx, orderRulesAcknowledged: false })).toMatch(
      /How orders work/,
    );
    expect(manualSubmitProblem(b, { ...ctx, orderRulesAcknowledged: true })).toBeNull();
    // The agreement comes first.
    expect(
      manualSubmitProblem(b, { ...ctx, agreementAccepted: false, orderRulesAcknowledged: false }),
    ).toMatch(/agreement/);
  });
});
