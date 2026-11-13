/**
 * The bespoke order agreement: one record of what was agreed, frozen when the
 * customer pays the deposit, the same for the customer, the tailor and the
 * Qlozet team (bespoke review, 13 Nov 2026).
 *
 * It holds the design (marked as a design reference), each fabric and who
 * supplies it, the measurements, the price split, the making time, and the
 * terms in naira. The tailor agrees to the terms when sending the quote; the
 * customer ticks "I agree" before paying. Built from the same numbers the
 * charge uses (the quote, its fabric pricing, the payment plan, delivery), so
 * the agreement cannot show one price and the order charge another.
 */
import { createHash } from 'crypto';

/** Bump when the wording of the terms changes in substance. */
export const ORDER_AGREEMENT_TEXT_VERSION = '2026-11-13';

/** Rounds of changes after the finished-piece photos that the price includes. */
export const INCLUDED_CHANGE_ROUNDS = 2;

export const DESIGN_REFERENCE_NOTE =
  'Design reference. The pictures show the design agreed; the finished piece may differ in small details.';

export interface AgreementFabric {
  role: string;
  name: string;
  /** 'tailor_stock' (the tailor's own), 'other_vendor' (another shop), 'tailor_sourced' (the tailor buys it). */
  source: string;
  yards: number | null;
  supplier_name: string | null;
  /** Inside the tailor's quote, or charged on top of it. */
  charged: 'in_quote' | 'on_top';
  amount: number;
}

export interface AgreementTerm {
  key: string;
  text: string;
}

export interface OrderAgreement {
  version: string;
  text_version: string;
  design: {
    name: string;
    reference: string | null;
    image: string | null;
    back_image: string | null;
    note: string;
  };
  tailor: { id: string; name: string };
  fabrics: AgreementFabric[];
  measurements: { set_name: string | null; unit: string | null; values: Record<string, number> } | null;
  price: {
    line_items: { label: string; amount: number }[];
    quote_total: number;
    fabric_on_top: number;
    delivery_to_customer: number;
    fabric_delivery: number;
    total: number;
    pay_now: number;
    remaining_after_photos: number;
  };
  timing: {
    making_days: number;
    balance_days: number;
    ship_after_balance_days: number;
  };
  /** The delivery area only (the tailor is never given the full address here). */
  delivery_area: string | null;
  terms: AgreementTerm[];
  tailor_agreed_at: Date | null;
  customer_agreed_at: Date | null;
}

export interface AgreementInput {
  design: any;
  quote: any;
  tailorName: string;
  /** buildPaymentPlan's result for this quote, or null when paid in one go. */
  plan: { deposit_amount: number; balance_amount: number } | null;
  delivery: { garment: number; fabric: number };
  settings: {
    cancellation_fee_percent: number;
    balance_days: number;
    late_percent_per_day: number;
    late_max_percent: number;
    abandon_after_days: number;
    dispute_window_days: number;
    ship_after_balance_days: number;
  };
  measurements?: { set_name?: string | null; unit?: string | null; measurements?: Record<string, any> } | null;
  address?: { city?: string | null; state?: string | null } | null;
  tailorAgreedAt?: Date | null;
  customerAgreedAt?: Date | null;
}

const naira = (n: number) => `₦${Math.round(n || 0).toLocaleString('en-NG')}`;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

const ROLE_NAME: Record<string, string> = {
  main: 'Main fabric',
  contrast: 'Contrast fabric',
  lining: 'Lining',
  bottom: 'Bottom fabric',
};

/** Each fabric of the quote, from its frozen fabric pricing. */
export function agreementFabrics(quote: any): AgreementFabric[] {
  const all = [quote?.fabric_pricing, ...((quote?.extra_fabric_pricing ?? []) as any[])].filter(Boolean);
  return all.map((p: any) => ({
    role: p.role ?? 'main',
    name: p.name || ROLE_NAME[p.role ?? 'main'] || 'Fabric',
    source: p.source ?? 'tailor_stock',
    yards: Number(p.yards) > 0 ? Number(p.yards) : null,
    supplier_name: p.supplier_name ?? null,
    charged: p.in_quote === false ? 'on_top' : 'in_quote',
    amount: Math.round(Number(p.amount) || 0),
  }));
}

/** The terms, in naira, for this order. */
export function agreementTerms(input: AgreementInput, price: OrderAgreement['price']): AgreementTerm[] {
  const s = input.settings;
  const quoteTotal = price.quote_total;
  const deposit = input.plan?.deposit_amount ?? null;
  const terms: AgreementTerm[] = [];

  terms.push({ key: 'design_reference', text: DESIGN_REFERENCE_NOTE });
  terms.push({
    key: 'changes',
    text:
      `The price includes ${plural(INCLUDED_CHANGE_ROUNDS, 'round')} of changes after the finished-piece photos. ` +
      'More, or a change to the design itself, needs a new price agreed in the order chat.',
  });
  terms.push({
    key: 'making_time',
    text:
      `The tailor ships within ${plural(input.quote?.estimated_completion_days || 7, 'day')} of the payment ` +
      '(counted from when the fabric arrives, if it comes from another shop). Delivery time is on top.',
  });
  if (input.plan) {
    terms.push({
      key: 'balance',
      text:
        `You pay ${naira(price.pay_now)} now and the remaining ${naira(price.remaining_after_photos)} after you see photos of the finished piece. ` +
        `Pay it within ${plural(s.balance_days, 'day')} of the photos, or the order closes and the tailor keeps the deposit.`,
    });
  }
  const fee = Math.round((quoteTotal * Math.max(0, s.cancellation_fee_percent)) / 100);
  terms.push({
    key: 'cancel',
    text:
      fee > 0
        ? `If you cancel before the photos, the tailor keeps ${naira(fee)} (${s.cancellation_fee_percent}% of the quote) and the rest is refunded. ` +
          (deposit !== null
            ? `After the photos, the tailor keeps at least the ${naira(Math.max(deposit, fee))} ${deposit >= fee ? 'deposit' : 'fee'}.`
            : 'After the photos the same applies.')
        : 'You can cancel with a refund until the tailor ships, less any fabric already sent to them.',
  });
  if (input.quote && agreementFabrics(input.quote).some((f) => f.source === 'other_vendor')) {
    terms.push({
      key: 'fabric_sent',
      text:
        'Fabric from another shop is not refunded once it has been sent to the tailor, and neither is its delivery to them. ' +
        'If the tailor cancels, you are refunded in full.',
    });
  }
  terms.push({
    key: 'photos_not_final',
    text: `Approving the photos pays the balance; it does not give up your right to report a fit or workmanship problem within ${plural(s.dispute_window_days, 'day')} of delivery.`,
  });
  if (s.late_percent_per_day > 0) {
    terms.push({
      key: 'late',
      text:
        `If the tailor ships late, each day costs them ${s.late_percent_per_day}% of the order, up to ${s.late_max_percent}%, paid to you.` +
        (s.abandon_after_days > 0
          ? ` ${plural(s.abandon_after_days, 'day')} late, the order is cancelled and you are refunded in full.`
          : ''),
    });
  }
  return terms;
}

/** The whole agreement. Pure: the same inputs always give the same record. */
export function buildOrderAgreement(input: AgreementInput): OrderAgreement {
  const q = input.quote ?? {};
  const fabrics = agreementFabrics(q);
  const fabricOnTop = fabrics.filter((f) => f.charged === 'on_top').reduce((t, f) => t + f.amount, 0);
  const quoteTotal = Math.round(Number(q.total) || 0);
  const delivery = Math.round(input.delivery.garment || 0) + Math.round(input.delivery.fabric || 0);
  const payNow = (input.plan ? input.plan.deposit_amount : quoteTotal) + fabricOnTop + delivery;
  const price: OrderAgreement['price'] = {
    line_items: ((q.line_items ?? []) as any[])
      .filter((li) => Number(li?.amount) > 0)
      .map((li) => ({ label: String(li.label), amount: Math.round(Number(li.amount)) })),
    quote_total: quoteTotal,
    fabric_on_top: fabricOnTop,
    delivery_to_customer: Math.round(input.delivery.garment || 0),
    fabric_delivery: Math.round(input.delivery.fabric || 0),
    total: quoteTotal + fabricOnTop + delivery,
    pay_now: payNow,
    remaining_after_photos: input.plan ? input.plan.balance_amount : 0,
  };

  const images: string[] = input.design?.design_images ?? [];
  const front = images[0] ?? null;
  const back = ((input.design?.back_views ?? []) as any[]).find((b) => b?.front === front)?.back ?? null;

  const values: Record<string, number> = {};
  for (const [k, v] of Object.entries(input.measurements?.measurements ?? {})) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) values[k] = n;
  }

  const area = [input.address?.city, input.address?.state].filter(Boolean).join(', ') || null;

  const agreement: OrderAgreement = {
    version: '',
    text_version: ORDER_AGREEMENT_TEXT_VERSION,
    design: {
      name: input.design?.name ?? 'Your design',
      reference: input.design?.reference ?? null,
      image: front,
      back_image: back,
      note: DESIGN_REFERENCE_NOTE,
    },
    tailor: { id: String(q.vendor?._id ?? q.vendor ?? ''), name: input.tailorName },
    fabrics,
    measurements: Object.keys(values).length
      ? { set_name: input.measurements?.set_name ?? null, unit: input.measurements?.unit ?? null, values }
      : null,
    price,
    timing: {
      making_days: q.estimated_completion_days || 7,
      balance_days: input.settings.balance_days,
      ship_after_balance_days: input.settings.ship_after_balance_days,
    },
    delivery_area: area,
    terms: [],
    tailor_agreed_at: input.tailorAgreedAt ?? null,
    customer_agreed_at: input.customerAgreedAt ?? null,
  };
  agreement.terms = agreementTerms(input, price);
  agreement.version = agreementVersion(agreement);
  return agreement;
}

/**
 * What the customer agrees to: the wording, the design picture, the fabrics,
 * the price and the terms. Measurements and the agreement times are left
 * out: they are frozen on the order either way, and a version that changed
 * when someone edited a measurement would refuse a payment for no reason.
 */
export function agreementVersion(a: OrderAgreement): string {
  const basis = JSON.stringify({
    t: a.text_version,
    d: [a.design.image, a.design.back_image],
    f: a.fabrics,
    p: a.price,
    terms: a.terms,
    m: a.timing,
  });
  return `${a.text_version}/${createHash('sha1').update(basis).digest('hex').slice(0, 12)}`;
}
