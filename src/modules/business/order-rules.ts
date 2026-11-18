/**
 * "How orders work": the order rules a vendor reads and acknowledges before
 * their store is reviewed.
 *
 * The agreement is the contract; this is the same rules in plain words, one
 * card each, with the numbers the platform actually runs on today. The
 * numbers come from the admin settings and the same helpers the jobs use
 * (confirm-deadline, late-penalty, settlement, bespoke-payment-plan), so the
 * screen cannot promise something the jobs do not do.
 *
 * The version names the wording AND the numbers. If an admin changes a rule
 * (say the late charge), the version changes, and vendors are asked to read
 * and acknowledge again: they agreed to the numbers they were shown.
 */
import { confirmHoursFrom, confirmWarningLeadHours } from '../orders/confirm-deadline';
import { lateRulesFrom } from '../orders/late-penalty';
import { balanceDaysFrom, depositPercentFrom } from '../orders/bespoke-payment-plan';
import { DISPUTE_WINDOW_DAYS, SETTLEMENT_DAYS } from './settlement';

/** Bump when the wording below changes in substance. */
export const ORDER_RULES_TEXT_VERSION = '2026-11-12';

export interface OrderRuleTerms {
  confirm_hours: number;
  turnaround_days: number;
  late_percent_per_day: number;
  late_max_percent: number;
  abandon_after_days: number;
  settlement_days: number;
  deposit_percent: number;
  balance_days: number;
  cancellation_fee_percent: number;
  return_window_days: number;
  return_answer_days: number;
  dispute_window_days: number;
}

export interface OrderRuleCard {
  key: string;
  title: string;
  body: string;
}

const whole = (value: unknown, fallback: number) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

/** The numbers in force, read from the platform settings. */
export function orderRuleTermsFrom(settings: any): OrderRuleTerms {
  const late = lateRulesFrom(settings);
  return {
    confirm_hours: Math.max(0, confirmHoursFrom(settings)),
    turnaround_days: whole(settings?.default_turnaround_days, 3),
    late_percent_per_day: late.perDayPercent,
    late_max_percent: late.maxPercent,
    abandon_after_days: late.abandonAfterDays,
    settlement_days: SETTLEMENT_DAYS,
    deposit_percent: depositPercentFrom(settings),
    balance_days: balanceDaysFrom(settings),
    cancellation_fee_percent: Math.min(
      whole(settings?.custom_cancellation_fee_percent, 30),
      100,
    ),
    return_window_days: whole(settings?.return_window_days, 7),
    return_answer_days: whole(settings?.return_auto_approve_days, 3),
    dispute_window_days: DISPUTE_WINDOW_DAYS,
  };
}

/** The wording version plus every number, readable in the record. */
export function orderRulesVersion(terms: OrderRuleTerms): string {
  const numbers = [
    terms.confirm_hours,
    terms.turnaround_days,
    terms.late_percent_per_day,
    terms.late_max_percent,
    terms.abandon_after_days,
    terms.settlement_days,
    terms.deposit_percent,
    terms.balance_days,
    terms.cancellation_fee_percent,
    terms.return_window_days,
    terms.return_answer_days,
    terms.dispute_window_days,
  ];
  return `${ORDER_RULES_TEXT_VERSION}/${numbers.join('-')}`;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

const hoursText = (hours: number) => {
  if (hours >= 1) return plural(Math.round(hours * 10) / 10, 'hour');
  return plural(Math.round(hours * 60), 'minute');
};

/** The cards, in the order a vendor meets them on an order. */
export function orderRuleCards(terms: OrderRuleTerms): OrderRuleCard[] {
  const cards: OrderRuleCard[] = [];

  if (terms.confirm_hours > 0) {
    cards.push({
      key: 'confirm',
      title: `Confirm new orders within ${hoursText(terms.confirm_hours)}`,
      body:
        'The time starts when the customer pays. An order you have not confirmed or rejected by then is cancelled and the customer refunded. ' +
        `You get a reminder ${hoursText(confirmWarningLeadHours(terms.confirm_hours))} before.`,
    });
  } else {
    cards.push({
      key: 'confirm',
      title: 'Confirm new orders quickly',
      body: 'Confirm or reject each new order as soon as you can. The customer is waiting on your answer.',
    });
  }

  cards.push({
    key: 'ship_by',
    title: 'Ship by the date on the order',
    body:
      'Every order you confirm shows a ship-by date. It is counted from when you confirm, using the longest making time among your items; ' +
      `an item without its own making time gets ${plural(terms.turnaround_days, 'day')}. If the fabric comes from another shop, your time starts when it arrives, and time waiting for a customer's measurement answer (up to 3 days) is added. You get a reminder before it is due.`,
  });

  if (terms.late_percent_per_day > 0 && terms.late_max_percent > 0) {
    cards.push({
      key: 'late',
      title: 'Shipping late costs you',
      body:
        `Each day past the ship-by date costs ${terms.late_percent_per_day}% of your items on the order, up to ${terms.late_max_percent}%. ` +
        'It is taken from your earnings and paid to the customer. Orders waiting on a bespoke balance are not counted as late.',
    });
  }

  if (terms.abandon_after_days > 0) {
    cards.push({
      key: 'abandon',
      title: `${plural(terms.abandon_after_days, 'day')} late, the order is cancelled`,
      body:
        'If it still has not shipped, the customer gets a full refund and your earnings from the order are reversed. ' +
        (terms.abandon_after_days >= 4 ? 'You are warned 2 days before.' : 'You are warned before it happens.'),
    });
  }

  cards.push({
    key: 'payout',
    title: `You are paid ${plural(terms.settlement_days, 'day')} after the customer pays`,
    body:
      'The money becomes withdrawable then, whatever stage the order is at. A refund after that (a return, a dispute, a cancellation) ' +
      'is taken from your balance, and anything the balance cannot cover is owed and taken from your next earnings.',
  });

  const split = terms.deposit_percent > 0 && terms.deposit_percent < 100;
  cards.push({
    key: 'bespoke',
    title: split ? 'Bespoke: a deposit first, the balance after photos' : 'Bespoke: paid when the quote is accepted',
    body: split
      ? `The customer pays ${terms.deposit_percent}% of your quote when they accept it, or the fabric cost if that is more. ` +
        'The rest is charged after you send photos of the finished piece. ' +
        `If they do not pay it within ${plural(terms.balance_days, 'day')}, the order closes and you keep the deposit. ` +
        'Your price includes 2 rounds of changes after the photos; agree anything more in the order chat.'
      : 'The customer pays your whole quote when they accept it. You are paid on the usual schedule. Your price includes 2 rounds of changes after the photos.',
  });

  cards.push({
    key: 'customer_cancel',
    title: 'When a customer cancels',
    body:
      terms.cancellation_fee_percent > 0
        ? 'Before you confirm, they cancel for free. A ready-made item can be cancelled with a full refund until you ship it. ' +
          `After you confirm a custom or bespoke piece, you keep ${terms.cancellation_fee_percent}% of it; ` +
          'once you have sent photos of the finished piece, you keep at least the whole deposit. ' +
          'Fabric another shop has already sent to you stays paid to that shop. If you cancel after it was sent, its cost comes from your balance.'
        : 'Customers can cancel with a full refund until you ship.',
  });

  cards.push({
    key: 'returns',
    title: 'Returns are for ready-made items',
    body:
      `A customer can ask to return a ready-made item within ${plural(terms.return_window_days, 'day')} of delivery. ` +
      (terms.return_answer_days > 0
        ? `Answer within ${plural(terms.return_answer_days, 'day')} or the return is approved automatically. `
        : 'Answer each request as soon as you can. ') +
      'Pieces made to a customer’s measurements cannot be returned.',
  });

  cards.push({
    key: 'disputes',
    title: `Problems can be reported for ${plural(terms.dispute_window_days, 'day')}`,
    body:
      `A customer can report a problem up to ${plural(terms.dispute_window_days, 'day')} after delivery. ` +
      'You can answer before our team decides. A refund from a dispute is taken from your balance.',
  });

  return cards;
}

/** Everything the screen needs, from the settings. */
export function orderRulesFrom(settings: any) {
  const terms = orderRuleTermsFrom(settings);
  return { version: orderRulesVersion(terms), terms, cards: orderRuleCards(terms) };
}

/** Whether this business acknowledged the rules exactly as they stand. */
export function hasAcknowledgedOrderRules(
  business: { order_rules_ack?: { version?: string } | null } | null | undefined,
  currentVersion: string,
): boolean {
  return business?.order_rules_ack?.version === currentVersion;
}
