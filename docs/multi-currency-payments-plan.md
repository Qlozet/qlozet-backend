# Multi-Currency & Stripe — Implementation Plan

Add **Stripe** alongside **Paystack**, let customers browse/pay in their own
currency, and let vendors settle in the currency of their country — across a
**two-entity** structure (Qlozet Nigeria + Qlozet, Inc. US).

> Status: **proposal / spec.** No code yet — review before Phase 1.

---

## 1. Goals

1. Accept international payments (cards worldwide) in the customer's currency.
2. Show localized pricing in the shop (customer chooses country/currency).
3. Let vendors settle & be paid out in their local currency (default by
   location); support US/UK vendors, not just Nigerian.
4. Keep the books clean per entity, with one consolidated (USD) revenue view.
5. Earn an FX spread on cross-currency orders.

**Non-goals (for now):** per-currency price lists set by vendors; crypto;
customer USD *wallet* balances (refund-to-source instead — see §9).

---

## 2. Entities, processors & settlement domains

| Entity | Holds | Handles |
|---|---|---|
| **Qlozet Nigeria** | Paystack account, ₦ bank accounts | ₦ customer charges, ₦ vendor payouts (Paystack Transfers) |
| **Qlozet, Inc. (US)** | Stripe account (+ Connect) | USD/GBP/… charges, US/UK vendor payouts (Stripe Connect) |

**Two settlement domains.** Most orders live entirely within one:

- **Domestic NG** — NG customer → NG vendor, all ₦, **no FX**, Paystack both legs.
- **Domestic Intl** — e.g. US customer → US vendor, all $, **no FX**, Stripe both legs.
- **Cross-border** — e.g. US customer ($, Stripe) → NG vendor (₦, Paystack).
  Money lands in one entity, the vendor is paid from the other → an
  **inter-entity settlement** (periodic treasury transfer + FX), and this is
  where the 2% spread is earned.

**Routing rule:** processor is chosen by the **charge currency** (₦ → Paystack,
everything else → Stripe) and the **payout rail** by the vendor's settlement
currency (₦ → Paystack Transfers, else → Stripe Connect).

---

## 3. Core concepts

Three currencies, kept distinct (this is the crux):

- **Presentment currency** — what the customer sees & is charged in.
- **Settlement currency** — what the vendor earns & is paid out in (one per
  vendor, defaulted from country).
- **Group currency (USD)** — consolidated reporting for platform revenue.

**FX:** the platform locks a rate at checkout, stamps it on the order, and
applies a configurable markup (default **2%**) over mid-market. The locked rate
is reused for any later refund so there's no drift. Rates come from the existing
`CurrencyService` (extended — see §6).

**Money representation:** store all amounts as **integer minor units** (kobo /
cents) with an explicit currency code. Audit the current code for any float
math on money and migrate. (Today `token_price` already models a USD base with a
derived NGN value — we generalize that pattern.)

---

## 4. Data model changes

### Order
Add the full money breakdown so one order records every leg:

```
presentment_currency   string      // e.g. "USD"
presentment_amount     int         // minor units, what the customer paid
settlement_currency    string      // e.g. "NGN" (vendor's)
settlement_amount      int         // minor units, what the vendor earns
fx_rate                decimal      // locked presentment→settlement rate (incl. markup)
fx_markup_percent      number       // the spread applied (audit)
group_amount_usd       int          // platform-revenue view in USD (consolidation)
processor              enum         // 'paystack' | 'stripe'
entity                 enum         // 'ng' | 'us' (derived from processor)
```

> Multi-vendor orders already split per vendor/shipment; settlement currency &
> amount live at the **per-vendor** grain, not just order level.

### Business (vendor)
```
settlement_currency    string      // default from country (NG→NGN, US→USD, GB→GBP)
payout_rail            enum         // 'paystack' | 'stripe_connect'
stripe_connect_id      string?      // Connect account id (intl vendors)
country                string       // ISO — drives the defaults above
```

### Transaction / wallet
- Tag every transaction with `currency` + `processor` + `entity`.
- Vendor earnings (`BusinessEarning`) and wallet balances become
  **currency-aware** (denominated in the vendor's settlement currency) rather
  than assuming ₦.
- Customer wallet stays local; international refunds go to source (§9).

### PlatformSettings (see §12)
Supported currencies, FX markup, currency→processor map, group currency.

---

## 5. Provider abstraction

Wrap payments behind interfaces so processors are swappable and routable. This
is **Phase 1** and de-risks everything else (no user-visible change).

```ts
interface PaymentProvider {
  initCharge(input): { redirectUrl?; clientSecret?; reference }   // start a payment
  verify(reference): ChargeResult                                  // confirm (webhook/poll)
  refund(reference, amountMinor): RefundResult                     // full/partial
}

interface PayoutProvider {
  ensureAccount(vendor): AccountRef        // Connect onboarding / Paystack recipient
  payout(vendor, amountMinor, ccy): PayoutResult
}
```

- **PaystackProvider** — wraps today's flow (channels `checkout` /
  `wallet_checkout`, existing refund path).
- **StripeProvider** — PaymentIntents / Checkout Sessions, `payment_intent.
  succeeded` / `checkout.session.completed` webhooks, Stripe refunds; Connect for
  payouts.
- A **router** picks the provider by currency/entity. `payment.service` and the
  payout/earnings code call the interface, never a processor directly.

---

## 6. FX service

Extend `CurrencyService`:
- Pull rates from a provider (existing FX source), **cache** (e.g. hourly), and
  expose `quote(from, to)` returning `{ rate, markupPercent, effectiveRate }`.
- Apply the markup from settings; round to the target currency's minor unit.
- `lockRate(order)` stores the effective rate on the order at checkout;
  refunds reuse it.

---

## 7. Checkout flow

1. Customer selects country/currency (persisted — §11).
2. Cart is priced: convert each vendor's settlement-currency prices → presentment
   currency via `CurrencyService.quote`, apply markup, round.
3. On pay: **router → processor** by presentment currency (₦ Paystack / else
   Stripe). Create the charge; store presentment + settlement + fx + group legs.
4. Webhook confirms → mark paid, create per-vendor `BusinessEarning` in the
   vendor's settlement currency, record platform commission + FX spread (group
   USD).

---

## 8. Vendor payouts (Connect)

- **NG vendors** — unchanged: Paystack Transfers in ₦.
- **US/UK vendors** — Stripe **Connect** (Express) onboarding; payouts in
  $/£. `ensureAccount` handles the Connect onboarding link; payout eligibility
  reuses the existing `payout_delay_days` / earnings-release logic, just
  currency-aware.

---

## 9. Refunds, disputes & chargebacks

- Refund via the **same processor** that captured, for the **same amount**, at
  the **locked FX rate** — no drift.
- Card payments (esp. international/Stripe) **refund to source** rather than to a
  ₦ wallet, so a USD buyer isn't credited Naira.
- Disputes/chargebacks: Stripe's dispute webhooks feed the existing dispute
  flow; reserve/hold logic already exists for vendor earnings.

---

## 10. Shop UX (customer)

- A **country/currency selector** (header/profile), persisted per user +
  localStorage; sensible default from geo/IP or account country.
- All prices render via a `useCurrency()` formatter (presentment). The selected
  currency flows into checkout as the charge currency.
- Show "charged in <ccy>" clearly; if a foreign card is charged in ₦ (fallback),
  say so.

---

## 11. Vendor & admin UX

- **Vendor:** a **settlement currency** setting (defaulted from country, per
  your instinct), Connect onboarding for intl vendors, earnings/payouts shown in
  their currency.
- **Admin:** currency/FX settings (§12); reporting toggled between per-entity
  (₦ / $) and consolidated (USD); disputes/refunds show original currency.

---

## 12. New platform settings

Extend `PlatformSettings` (+ the now fully-typed DTO):

```
base_currency            'USD'                      // group/consolidation
supported_currencies     ['NGN','USD','GBP', ...]   // customer display options
fx_markup_percent        2                          // spread over mid-market
currency_processor_map   { NGN: 'paystack', default: 'stripe' }
stripe_enabled           boolean                    // kill-switch
```

---

## 13. Inter-entity settlement (treasury)

Cross-border orders leave money in the "wrong" entity. Run a **periodic
reconciliation**: net cross-border volume per direction, transfer between
entities, book the FX. The app just needs to **report** cross-border liability
per entity (from the order legs); the transfer itself is a treasury action.

---

## 14. Phased rollout

| Phase | Ships | User-visible? |
|---|---|---|
| **1 · Abstraction** | `PaymentProvider`/`PayoutProvider` wrap Paystack; order/vendor currency fields; money-as-minor-units audit | No |
| **2 · Display currency** | Shop currency/country selector + localized prices (still charged via Paystack/₦) | Yes |
| **3 · Stripe (customer)** | USD/intl charges via Stripe, webhooks, refunds, locked FX + 2% markup | Yes |
| **4 · Stripe Connect (vendor)** | US/UK vendor onboarding + payouts, per-vendor settlement currency, treasury reporting | Yes |

Each phase is shippable and reversible. NG-only stays fully working throughout.

---

## 15. Risks & edge cases

- **Existing ₦ data:** backfill orders/vendors with `currency: NGN`,
  `processor: paystack`, `entity: ng`; default vendor `settlement_currency` from
  country.
- **Rounding:** always minor units; define rounding per currency; the displayed
  quote must equal the charged amount (same lesson as the kobo-rounding on token
  price).
- **Partial refunds / multi-vendor:** refund per vendor leg in that leg's
  currency/processor.
- **FX drift between quote and pay:** short quote TTL; re-quote if stale.
- **Stripe availability:** solved by the US entity holding the Stripe/Connect
  account; NG flows never touch Stripe.
- **Reconciliation across two processors:** every transaction tagged with
  processor + entity + currency makes this tractable.

---

## 16. Decisions (locked)

1. **Group currency = USD** — Qlozet, Inc. is the consolidation parent.
2. **Launch currencies: NGN + USD.** GBP/EUR added later (display list is a
   setting, so this is config).
3. **Refund-to-source only.** No per-currency customer wallets; card payments
   refund via the original processor at the locked rate.
4. **Connect launch countries: US + UK.**
5. **FX source: keep UniRate (current `CurrencyService`), hardened:**
   - Charge-path quotes **fail closed** — never use the hardcoded fallback
     rates for a real charge; refuse to quote instead.
   - Persist the last-good rate in the DB (survives restarts) rather than
     in-memory cache only.
   - The 2% markup buffers normal staleness (10-min cache).
   - Provider stays swappable behind `CurrencyService`; revisit a dedicated
     feed (OXR/Fixer) when volume justifies the SLA.
