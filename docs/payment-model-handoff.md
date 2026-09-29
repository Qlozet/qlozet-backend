# Qlozet Payment, Commission, Payout, Refund & Settlement Model — Handoff

**Status of this document.** This is a **code-derived** description of what the
Qlozet backend does **today**. It was produced by reading the implementation,
not by transcribing a design decision. Nothing here is a commercial commitment.

**Why that matters for the reader.** If you are writing the Vendor Acquisition
Handbook or any vendor-facing terms, treat every figure below as *"this is what
the system currently does"*, not *"this is what Qlozet has promised"*. Several
behaviours are almost certainly unintended (§21). Anything a vendor will rely on
contractually needs a human decision before publication.

**Companion documents already in this repo** — read them alongside this one
rather than restating them:

- `docs/platform-settings.md` — every financial setting, its **effective**
  default, where it is read, and known gaps.
- `docs/multi-currency-payments-plan.md` — §16 "Decisions (locked)" for
  multi-currency/Stripe.

**Two defaults per setting.** `PlatformService.defaultSettings()`
(`platform.service.ts:29-49`) seeds the first settings document; the Mongoose
`@Prop` default only applies to fields the seed omits. Where they diverge, the
**seed wins on first create**. This document quotes the *effective* value and
flags the divergence.

---

## 1. PAYMENT MODEL OVERVIEW

### 1.1 The single charge

There is exactly one customer charge per order: `Order.total`. The order
document holds only three money fields — `subtotal`, `shipping_fee`, `total`
(`orders.schema.ts:380-386`) — and

```
total = subtotal + shipping_fee
```

Nothing else is ever added: no tax, no processing fee, no platform fee, no
order-level discount (`orders.price-calculation.ts:62`, which states outright
*"Tax and platform discounts removed. Shipping is handled externally via
Shipbubble."*).

### 1.2 Flow — standard (Ready-to-Wear and Customizable)

```
Customer checkout
  → checkout-preview quotes Shipbubble rates per vendor, caches them (30-min TTL)
  → createOrder: prices items server-side, reads the CACHED rate (never the client's)
  → Order created status=pending, payment_status=unpaid
  → Payment (wallet = instant; Paystack/Stripe = redirect)
  → On settle: payment_status=paid, status → in_review
                recordBusinessEarnings() creates BusinessEarning rows
                vendor wallet pending_balance += net
  → Vendor confirms shipment (or auto-rejected after auto_reject_hours = 24)
      · custom items: 'upfront' earning scheduled → release_date = now + 3 days
      · all shipments confirmed → status = processing
  → Vendor fulfils → Shipbubble label → status = in_transit
  → Courier delivery webhook (all shipments delivered) → status = completed
                'completion' earnings scheduled → release_date = now + 3 days
  → Customer may confirm satisfaction → release_date = NOW (immediate)
  → releaseFunds cron (every 30 min) moves pending_balance → balance
  → Vendor withdraws on demand (min ₦2,000, bank account required)
```

### 1.3 Where the three order types differ

| | Ready-to-Wear | Customizable | Bespoke |
|---|---|---|---|
| Price source | catalogue, `discounted_price` applied to base | catalogue, `applied_discount` applied to the **whole** composed total | vendor's quote line items only |
| Discount | base price only; components never discounted | whole total | none possible |
| Delivery | customer pays Shipbubble rate | customer pays Shipbubble rate | **₦0 — free to customer, platform pays the courier** |
| Milestone split | no | **intended yes, but dead in practice — see §5.3** | **yes, 65/35** |
| Vendor confirm step | required | required | pre-confirmed at order creation |
| `pricing` snapshot | yes | yes | **none** |

Bespoke is the only path where `order.shipping_fee = 0`
(`bespoke.service.ts:719, 730, 736`) and no rate is ever quoted.

---

## 2. DEFINITIONS

Terms as the **code** uses them. Where a term in the brief has no counterpart in
the system, that is stated.

| Term | Definition in this system |
|---|---|
| **Base price** | `product.base_price`. In the `pricing` snapshot, `base` is **always** `base_price × quantity`, undiscounted. |
| **Discounted price** | `product.discounted_price`, precomputed by `discount.service.ts` from the single best matching discount. Used for RTW/fabric/accessory; **ignored** for `customize`. |
| **Effective price** | `discounted_price` if `0 < discounted_price < base_price`, else `base_price` (`orders.price-calculation.ts:266-271`). |
| **Style price** | `style.price × selection.quantity`, summed → `styles_total`. |
| **Fabric price** | `resolvedYardage × fabric.price_per_yard × selection.quantity` → `fabric_total`. Yardage below `min_cut` is silently raised to `min_cut` on clothing, but **throws** on a standalone fabric product. |
| **Accessories** | `accessory.price × selection.quantity` → `accessories_total`. |
| **Add-ons** | `addon.variant.price × selection.quantity` → `addons_total`. |
| **Variant total** | Size/colour **surcharge only** (`variant.price`), never the base again. |
| **External fabric** | `round(price_per_yard × applied_fabric_yards)` when the fabric belongs to a **different** vendor. Recorded as `pricing.external_fabric` and **excluded from `final`/`total_price`**; added at order level. It is the fabric vendor's revenue. |
| **Item price / `total_price`** | The item's charged amount. Equals `pricing.final`. |
| **`before_discount`** | `base + styles + fabric + accessories + variant + addons` (excludes external fabric). |
| **`discount`** (snapshot) | RTW: `base − effectivePrice × qty`. Customize: the discount applied to the whole `before_discount`. |
| **Subtotal** | `Σ item.total_price + Σ pricing.external_fabric`. (Also duplicated onto each item as `item.subtotal = item.total_price`.) |
| **Delivery fee / `shipping_fee`** | Sum of cached Shipbubble rates: one `vendor_to_customer` leg per vendor, plus any `fabric_transfer` legs. Paid entirely by the customer. |
| **Taxes** | **Not charged.** A `tax_percent` setting exists but its only consumer is dead code (§16). |
| **Payment processing fee** | **Not modelled anywhere** (§15). |
| **Qlozet commission** | Per **order item**: `gross × platform_commission_percent/100`, or `min(platform_commission_flat, gross)` when type is `fixed`. |
| **Vendor gross** | `BusinessEarning.amount` — the item's `total_price`. There is no field named `gross`. |
| **Vendor net** | `BusinessEarning.net_amount = amount − commission`. The only amount ever paid to a vendor. |
| **Upfront milestone** | `BusinessEarning` with `milestone: 'upfront'`, `net = net × 65%`. |
| **Completion milestone** | `milestone: 'completion'`, the remainder. Default milestone for all non-split earnings. |
| **`pending_balance`** | Vendor wallet bucket holding earned-but-unreleased money. **Not withdrawable.** |
| **`balance`** | Vendor wallet spendable bucket. The only withdrawable money. |
| **`release_date`** | When an earning becomes releasable. `null` = frozen/unscheduled. |
| **`released` / `released_at`** | Whether the release cron has moved it to `balance`. |
| **Reserved amount** | No such concept for payouts. The nearest thing is the **fabric reservation fee** (§8.4), which is unrelated to vendor payout holds. |
| **Refund** | A credit to the customer's **Qlozet wallet** in every implemented path (§11, §15.4). |
| **Late fee / penalty** | `min(daysLate × 5%, 25%)` of the vendor's items' **gross**, funded by the vendor, paid to the customer's wallet. |
| **Payout cycle** | Setting exists (`weekly`) with **no runtime consumer**. Payouts are vendor-initiated withdrawals, not scheduled. |

---

## 3. CUSTOMER CHECKOUT CALCULATION

### 3.1 Formulas

```
# Clothing, type = 'customize'
final = max(0, (base_price × qty
               + styles_total + fabric_total + accessories_total
               + variant_total + addons_total)
              − applied_discount_on_that_total)

# Clothing, ready-to-wear
final = effectivePrice × qty
        + styles_total + fabric_total + accessories_total
        + variant_total + addons_total
# effectivePrice = discounted_price if 0 < discounted_price < base_price else base_price
# → components are NEVER discounted

# Fabric product
final = selections ? Σ(yards × price_per_yard × sel.qty) : effectivePrice × item.qty

# Accessory product
final = Σ(unit × sel.qty), unit = effectivePrice || accessory.price

# ORDER (standard)
subtotal     = Σ item.final + Σ round(price_per_yard × applied_fabric_yards)
shipping_fee = Σ vendor_to_customer rates + Σ fabric_transfer rates
total        = subtotal + shipping_fee

# ORDER (bespoke)
total = Σ quote.line_items[].amount + fabricCost(if foreign) ; shipping_fee = 0

# CHARGED
NGN   : round(total × 100) kobo via Paystack
non-NGN: round(total × fxRate × (1 + fx_markup_percent/100) × 100) via Stripe
```

### 3.2 Worked examples

**A. Ready-to-Wear, no discount.** Base ₦20,000 × 1, no components, shipping
₦2,500.
`final = 20,000` · `subtotal = 20,000` · `total = ₦22,500`.

**B. Customizable.** Base ₦40,000 × 1; styles ₦6,000; fabric 4 yd × ₦3,500 =
₦14,000; accessories ₦2,000; no discount; shipping ₦3,000.
`final = 40,000 + 6,000 + 14,000 + 2,000 = 62,000` · `total = ₦65,000`.

**C. Bespoke.** Quote line items total ₦90,000; fabric from another vendor
5 yd × ₦4,000 = ₦20,000; shipping ₦0.
`subtotal = 110,000` · `total = ₦110,000`.

**D. With a discount (RTW).** Base ₦30,000, `discounted_price` ₦24,000, one
style +₦3,000, shipping ₦3,000.
`effectivePrice = 24,000` → `final = 24,000 + 3,000 = 27,000`.
Snapshot: `base = 30,000`, `before_discount = 33,000`, `discount = 6,000`,
`final = 27,000`. `total = ₦30,000`.
**Note the style was not discounted.**

**E. Involving fabric (cross-vendor, standard checkout).** Tailor's garment
`final = ₦50,000`; external fabric 5 yd × ₦4,000 = ₦20,000; garment delivery
₦3,000; fabric-transfer leg ₦2,000.
`subtotal = 50,000 + 20,000 = 70,000` · `shipping_fee = 5,000` ·
`total = ₦75,000`.

**F. Multiple items / multiple vendors.** One `Order` holds all vendors' items;
`subtotal` is the flat sum, and there is **one shipment with its own
`shipping_fee` per vendor**. No pooling, no free-shipping threshold. The
per-vendor split is derived on read by `computeVendorBreakdown`
(`orders.service.ts:1755-1780`), never stored.

### 3.3 Who pays what

| Charge | Paid by |
|---|---|
| Product cost, customizations, fabric, accessories, add-ons | Customer |
| Delivery | **Customer** (except bespoke, where it is **₦0 to the customer and the platform pays the courier**) |
| Payment processing | **Not modelled** — absorbed by Qlozet by omission (§15) |
| Taxes | **Not charged** (§16) |
| FX spread (non-NGN) | Customer, via a 2% markup on the locked rate |
| Qlozet commission | Deducted from the vendor, not added to the customer |

---

## 4. QLOZET COMMISSION

### 4.1 Rate

- `platform_commission_percent` — **10** (effective).
- `platform_commission_type` — **`percent`** (alternative: `fixed`).
- `platform_commission_flat` — **0**.

There is exactly **one global rate**. No per-vendor, per-category, or
per-product-kind override exists, and bespoke uses the same rate as everything
else. Hard-coded fallbacks `?? 'percent'`, `?? 10`, `?? 0` apply if no settings
document exists (`business.service.ts:1899-1905`).

### 4.2 Base and formula

Applied **per order item**, to `item.total_price`
(`business.service.ts:1920-1927`):

```ts
const gross = item.total_price || 0;
const commission = commissionType === 'fixed'
  ? Math.min(commissionFlat, gross)
  : gross * (commissionPercent / 100);
const net = gross - commission;
```

No rounding is applied.

| Component | Commissionable? |
|---|---|
| Base price | **Yes** |
| Customization / styles / add-ons | **Yes** (inside `total_price`) |
| Fabric selected from the same vendor | **Yes** |
| Accessories | **Yes** |
| Size/colour surcharge | **Yes** |
| **External (cross-vendor) fabric** | **Yes, but charged to the fabric vendor** on a separate earning at the same rate |
| **Delivery / shipping** | **No** — never in any earning; Qlozet retains the whole fee |
| Taxes | N/A (none charged) |
| Payment processing fees | N/A (not modelled) |

**A `fixed` commission is charged per item, not per order** — a 3-item order at
`platform_commission_flat = 500` yields ₦1,500.

### 4.3 Discounts and commission

Commission is charged on the **post-discount** amount, because the discount is
already inside `total_price`. So a discount reduces vendor net **and** Qlozet
commission proportionally. This is an implicit shared split; it is nowhere
modelled or recorded (§7).

### 4.4 When commission is recognised

At payment settlement, inside `recordBusinessEarnings` — the commission is
never a separate money movement. The customer's full `total` lands in Qlozet's
Paystack/Stripe balance, and only `net_amount` is ever transferred out to a
vendor. Commission is what remains by construction.

Callers: `webhook.service.ts:394` (Paystack), `orders.service.ts:515` (wallet),
`bespoke.service.ts:139` (bespoke), plus a backfill.

Idempotency: an atomic claim on `order.earnings_recorded`
(`business.service.ts:1869-1891`).

### 4.5 Commission during refunds — **inconsistent by mechanism**

| Mechanism | Customer receives | Vendor debited | Commission |
|---|---|---|---|
| **Cancellation** | full `order.total` (goods + all shipping) | full earning reversed | **Refunded** (Qlozet keeps nothing) |
| **Return** | items' **gross** `total_price` | only `net_amount` | **Qlozet absorbs its own commission** |
| **Dispute → full refund** | **Σ `net_amount`** (post-commission) | unreleased earnings deleted | **Qlozet keeps the commission** |
| **Dispute → partial refund** | admin-entered amount | `net_amount` decremented | Kept |

Pinned by test: earning `amount 60,000 / commission 6,000 / net 54,000` →
`refund_amount = 54,000` (`dispute-flow.spec.ts:78-88, 160-172`).

---

## 5. VENDOR PAYOUT MODEL

### 5.1 Mechanics common to all types

1. **At payment** — `BusinessEarning` rows created, `release_date = null`,
   `released = false`, vendor `pending_balance += net`.
2. **Scheduling** — an event stamps `release_date` (§13.3).
3. **Release** — `releaseFunds` cron, **every 30 minutes**
   (`business-earning-cron.ts:135`), selects
   `{ released: false, release_date: { $ne: null, $lte: now } }`, atomically
   claims each row, then `balance += net`, `pending_balance -= net`.
4. **Withdrawal** — vendor-initiated, **minimum ₦2,000**, requires a linked bank
   account (`transfer_recipient_code`). Only `balance` is withdrawable.
   `payout_cycle` is **not implemented**.

### 5.2 Ready-to-Wear

- **Eligible:** at payment, the full `net_amount` exists as one `completion`
  earning with `release_date = null`.
- **Held:** 100% until delivery.
- **Released:** when **all** shipments are delivered, `release_date = delivery +
  payout_delay_days (3)`; the cron then credits it.
- **Customer confirmation:** optional. If the customer confirms satisfaction,
  `release_date = now` — immediate.
- **Automatic release:** if the delivery webhook never fires, the safety-net
  cron (every 6 h) releases earnings **`auto_release_days` = 10 days after
  dispatch** (`shipped_at`), provided the order is `processing`/`in_transit`/
  `completed`.

### 5.3 Customizable orders

**Intended:** 65% on vendor confirm, 35% after delivery.

**Actual:** the split condition is

```ts
const isCustom = order.type === 'bespoke' || item.clothing_type === 'customize';
```

but `clothing_type` **does not exist on the persisted `OrderItem` schema**
(`orders.schema.ts:147-229`). With Mongoose `strict` at its default `true`, the
field is dropped on save, and `recordBusinessEarnings` re-reads the order from
Mongo — so `item.clothing_type` is always `undefined` there.

**Consequence: a customizable catalogue order gets no milestone split. It pays
out exactly like Ready-to-Wear (100% after delivery).** Only
`order.type === 'bespoke'` produces a split today. See §21.

### 5.4 Bespoke orders

- **Upfront:** `tailored_order_upfront_percent` = **65%** (effective; schema
  default is 0 — see §21), applied to the **post-commission net**. Gross and
  commission are pro-rated by the same ratio across the two rows.
- **Trigger:** bespoke shipments are pre-confirmed at order creation, so the
  upfront is scheduled at **payment settlement**
  (`webhook.service.ts:610-633` Paystack, `bespoke.service.ts:143-157` wallet)
  with `release_date = now + payout_delay_days (3)`. For non-bespoke custom
  orders the trigger would be `confirmVendorShipment`
  (`orders.service.ts:3332-3358`), also +3 days — deliberately delayed so a
  confirm-then-cancel can still be reversed.
- **Remaining 35%:** `completion` milestone, `release_date = delivery + 3 days`.
- **Confirmation window:** none specific to bespoke. Customer confirmation
  accelerates to immediate; otherwise +3 days after delivery; otherwise the
  10-days-after-dispatch safety net.
- **On a bespoke order the split applies to every item, including the fabric
  vendor's**, because `isCustom` tests `order.type`.

---

## 6. PAYOUT FORMULAS

```
# Per order item, at payment
gross      = item.total_price
commission = type === 'fixed' ? min(flat, gross) : gross × percent/100
net        = gross − commission

# Milestone split (bespoke; intended for customize)
upfrontNet    = net × upfrontPercent/100          # 65%
completionNet = net − upfrontNet                  # 35%
upfrontGross      = gross × upfrontPercent/100
upfrontCommission = commission × upfrontPercent/100

# External fabric (standard checkout) — separate earning, fabric vendor
fabricGross      = pricing.external_fabric
fabricCommission = same formula
fabricNet        = fabricGross − fabricCommission   # milestone always 'completion'

# Release
release_date = <trigger date> + payout_delay_days (3)   # or NOW for the immediate triggers
on release:  balance += net ; pending_balance −= net

# Late penalty
penaltyPercent = min(daysLate × 5, 25)
penalty        = round(vendorItemsGrossTotal × penaltyPercent/100)

# Withdrawal
withdrawable = wallet.balance   (≥ ₦2,000, bank account required)
```

### 6.1 Example 1 — Ready-to-Wear, end to end

Base ₦20,000 × 1; shipping ₦2,500. Commission 10%.

| Step | Amount |
|---|---|
| Customer pays | **₦22,500** |
| → vendor gross | 20,000 |
| → commission (10%) | 2,000 |
| → vendor net | **18,000** |
| → Qlozet commission | **2,000** |
| → Qlozet shipping receipts | **2,500** (pays Shipbubble from this) |
| Reconciliation | 18,000 + 2,000 + 2,500 = **22,500** ✓ |

Timeline: payment → `pending_balance` 18,000 → delivery → `release_date = +3d`
→ cron → `balance` 18,000 → withdrawal.

### 6.2 Example 2 — RTW with a discount

Base ₦30,000, `discounted_price` ₦24,000, style +₦3,000, shipping ₦3,000.

| Step | Amount |
|---|---|
| Item final | 27,000 (style undiscounted) |
| Customer pays | **₦30,000** |
| Vendor gross | 27,000 |
| Commission (10%) | 2,700 |
| Vendor net | **24,300** |
| Qlozet commission | **2,700** |
| Qlozet shipping | **3,000** |
| Reconciliation | 24,300 + 2,700 + 3,000 = **30,000** ✓ |

Versus no discount (₦33,000 item): vendor would net 29,700 and Qlozet 3,300 —
so the ₦6,000 discount cost the vendor ₦5,400 and Qlozet ₦600.

### 6.3 Example 3 — Bespoke with cross-vendor fabric and the 65/35 split

Quote ₦90,000 (tailor); fabric 5 yd × ₦4,000 = ₦20,000 (other vendor);
shipping ₦0.

Customer pays **₦110,000**.

| Party | Gross | Commission | Net | Upfront (65%) | Completion (35%) |
|---|---|---|---|---|---|
| Tailor | 90,000 | 9,000 | 81,000 | **52,650** | **28,350** |
| Fabric vendor | 20,000 | 2,000 | 18,000 | **11,700** | **6,300** |
| Qlozet | — | **11,000** | — | — | — |

Reconciliation: 81,000 + 18,000 + 11,000 = **110,000** ✓
(Delivery: ₦0 charged, courier paid by the platform — an unfunded cost.)

Settlement timeline: payment → upfront rows `release_date = +3d` → cron credits
₦52,650 and ₦11,700 → delivery → completion rows `release_date = +3d` → cron
credits ₦28,350 and ₦6,300.

### 6.4 Example 3b — the same order, delivered 3 days late

Tailor's `fulfillment_deadline` passed by 3 days before dispatch.

```
penaltyPercent = min(3 × 5, 25) = 15%
penalty        = round(90,000 × 15%) = ₦13,500     # base is GROSS
```

Taken from the tailor's unreleased earnings first, then clawed from `balance`;
credited to the **customer's wallet** as a partial refund.

| Party | Final |
|---|---|
| Customer net outlay | 110,000 − 13,500 = **96,500** |
| Tailor net | 81,000 − 13,500 = **67,500** |
| Fabric vendor net | **18,000** |
| Qlozet commission | **11,000** (unchanged) |
| Reconciliation | 67,500 + 18,000 + 11,000 + 13,500 = **110,000** ✓ |

Qlozet contributes **nothing** to late compensation.

---

## 7. DISCOUNTS

- **Created by vendors only.** The `Discount` schema requires `business`
  (`discount.schema.ts`). There is **no** platform-wide discount, no admin
  promotion, and **no coupon/promo-code/voucher model at all**.
- **One discount per product.** `syncProductWithDiscounts` picks the single best
  (largest saving) and writes `applied_discount`, `discounted_price`,
  `discount_percentage`. Discounts never stack.
- **Types:** `percentage`, `fixed`, `flash_percentage`, `flash_fixed`,
  `store_wide`, `category_specific`. The amount is capped at the base price
  (never negative).
- **Timing:** RTW/fabric/accessory — applied to the **base price before**
  components are added, so components are never discounted. Customize — applied
  to the **whole composed total at the end**.
- **Commission is computed after the discount** (§4.3).

### 7.1 Who absorbs a discount — **NOT MODELLED**

There is no funding/attribution field anywhere: no `funded_by`,
`vendor_funded`, `platform_funded`, or equivalent. Because commission is a
percentage of the discounted amount, the cost is *de facto* shared in the
commission ratio — 90% vendor, 10% Qlozet at the default rate — but this is an
arithmetic side-effect, not a decision, and it is never recorded.

```
vendorCost   = discount × (1 − commissionPercent/100)   # ₦5,400 of a ₦6,000 discount
platformCost = discount × commissionPercent/100         # ₦600
```

**UNRESOLVED:** vendor-funded vs Qlozet-funded vs shared promotions (§19).

---

## 8. FABRIC PAYMENT LOGIC

### 8.1 Same-vendor fabric

A `fabric_selection` on the vendor's own clothing product is priced into
`fabric_total`, is part of `total_price`, and is therefore part of that vendor's
gross and commission. No separate earning, no separate shipment.

### 8.2 Cross-vendor fabric — standard checkout ("use my own fabric")

- **Gated at add-to-cart** by `product.clothing.accepts_external_fabric`,
  falling back to `business.accepts_external_fabric ?? true`.
- **Goods:** `external_fabric = round(price_per_yard × applied_fabric_yards)`,
  held in `pricing.external_fabric`, **excluded** from the tailor's
  `total_price`, and added to `order.subtotal` at order level. Not multiplied by
  item quantity.
- **Delivery:** a second `FABRIC_TRANSFER` shipment, fabric vendor → tailor,
  with its own Shipbubble `shipping_fee`, also charged to the customer.
- **Who is paid:** a **separate `BusinessEarning` for the fabric vendor**
  (`business.service.ts:2000-2051`), same commission rate, `milestone:
  'completion'` (never split), linked to the **tailor's** item id so rejecting
  that item reverses the fabric vendor's earning too. The tailor is never
  credited for the fabric.
- **When paid:** on the same completion trigger as everyone else.

### 8.3 Cross-vendor fabric — bespoke

`fabricCost = round(price_per_yard × fabricYards)` where `fabricYards =
quote.required_fabric_yards || fabric.min_cut || 1`, added **on top of the
quote** and stored as a **real second order item** owned by the fabric vendor.
Because `order.type === 'bespoke'`, this earning **is** split 65/35.

### 8.4 Reserved fabric (event reservations)

- **Fee:** `reservation_fee_percent` = **10%** of `totalYards ×
  price_per_yard`, rounded up (`Math.ceil`).
- Inventory (`yard_length`) is deducted at reservation time.
- On fee settlement the fee order is marked `completed`/`paid` and the
  reservation activated. **No `BusinessEarning` is created** — the reservation
  fee is **100% Qlozet revenue**. Reservation-fee orders are deliberately hidden
  from the vendor console as "platform revenue with nothing to fulfil".
- Claims against a reservation (guests buying yards) become
  `reservation_claim` orders, which the vendor fulfils; a pickup claim completes
  by handover with earnings scheduled at +3 days.

### 8.5 Cancellation after fabric is involved

Reversal is **item-scoped**: `reverseBusinessEarnings(order, undefined, itemId)`
catches the linked fabric-vendor earning because it shares the tailor's item id.
Refund components on a vendor item rejection:

```
refundAmount = item.total_price + pricing.external_fabric
             + failed fabric-transfer leg shipping
             + that vendor's garment shipping (if they have no active items left)
```

**Customer-owned fabric is not part of the model** — "external fabric" always
means another *vendor's* catalogue fabric.

---

## 9. DELIVERY

- **Customer pays 100%** of `shipping_fee` (bespoke excepted: ₦0).
- **Never commissionable, never shared.** `shipping_fee` appears in no
  `BusinessEarning`; the vendor receives none of it and is charged none of it.
  Qlozet retains the entire fee.
- **Logistics is paid by Qlozet** — a single platform Shipbubble API key and
  balance; the label is bought at fulfilment.
- **Rate integrity:** rates are quoted at preview, cached per
  `{customer, request_token, business_id}` with a **30-minute TTL**, and
  `createOrder` uses the **cached** value, never the client's.
- **Re-quote drift is absorbed by Qlozet:** if the token is older than 25
  minutes at fulfilment, rates are re-fetched and the courier/token overwritten,
  but **`shipment.shipping_fee` is not updated** — the customer already paid the
  old quote, and the platform pays the new courier price.
- **Insurance** is quoted in the preview but never charged to the customer and
  never purchased at fulfilment.
- **Refunds** subtract the relevant legs back out of `order.shipping_fee`.

**Not defined:** failed-delivery handling, redelivery cost allocation, and
vendor-caused vs customer-caused delivery fault. See §19.

---

## 10. ORDER CANCELLATIONS

Allowed from `pending`, `in_review`, `processing`. Blocked from `in_transit`,
`completed`, `returned` — message: *"has shipped. Please request a return
instead."*

Sequence is deliberately **cancel-first, then refund** (test-pinned): the status
is saved before money moves, so `refund_status = 'refunded'` is only set after a
successful credit.

| Stage | Customer refund | Vendor receives | Qlozet keeps | Deductions |
|---|---|---|---|---|
| Before vendor acceptance (`pending`/`in_review`) | **Full `order.total`** incl. all shipping | ₦0 — earnings deleted, `pending_balance` reduced | ₦0 | none |
| After acceptance, before/after production starts (`processing`) | **Full `order.total`** | ₦0 — same reversal; if the upfront had already released, it is clawed from `balance` | ₦0 | none |
| After fabric/materials purchased | **Full `order.total`** — the system does not recognise materials cost | ₦0 | ₦0 | **No material-cost protection exists** (§19) |
| After completion / during delivery | **Not cancellable** — must be a return | — | — | — |
| Vendor never confirms (24 h) | Auto-reject: that vendor's items + their shipping, to wallet; whole order cancelled if nothing remains | ₦0 | ₦0 | none |

Reversal mechanics: unreleased earnings are **deleted** and `pending_balance`
decremented; released earnings are clawed from `balance`, mirrored as a `REFUND`
debit with `metadata.clawback: true`, and `net_amount` set to 0. Inventory is
restored. Clawback **floors at zero** — unrecoverable if already withdrawn.

---

## 11. RETURNS & REFUNDS

- **Window:** `return_window_days` = **7 days**, measured from the **latest**
  `delivered_at` across shipments. Order must be `completed`.
- **Approver: the VENDOR**, not Qlozet. There is **no admin endpoint in the
  returns module at all**.
- **Flow:** request (earnings frozen, `release_date = null`) → vendor approves
  (no money moves) or rejects (earnings **unfrozen**, `release_date = now`) →
  `markReceived` is the only money step.

```
refundAmount = Σ returned items' total_price        # GROSS, items only
# Delivery fee is NOT refunded on a return
```

- **Vendor is debited `net_amount`** (released → from `balance`; unreleased →
  deleted from `pending_balance`). Since the customer receives **gross**,
  **Qlozet absorbs its own commission on returns** — the opposite of a dispute.
- Inventory restored; order → `returned` only when every non-rejected item is
  covered.
- **Return shipping is neither charged nor refunded.** `return_shipping_fee` and
  `return_shipping_paid_by` exist on the schema but are never written or read.

### 11.1 Partial refunds

The real partial-refund rail is `processPartialRefund`, always crediting the
customer's **wallet** and writing a ledger row (success or failure). Callers and
their amounts:

| Cause | Amount |
|---|---|
| Vendor rejects item(s) | `Σ(total_price + external_fabric)` + failed fabric leg shipping + that vendor's garment shipping if they have no active items left |
| Fabric transfer declined | tailor items + external fabric + fabric leg shipping + tailor shipping |
| 24 h auto-reject | that vendor's items + their shipping |
| Late penalty | the penalty amount (§12) |

### 11.2 Fault-based rules — **NOT DEFINED**

The code has **no** notion of fault. There is no distinction between
vendor-fault and customer-fault refunds, no incorrect-sizing rule, no
measurement-error rule, no damaged-item rule, no incorrect-product rule, and no
**remake** mechanism of any kind (a remake is not a dispute resolution option).
A `measurement_issue` dispute can be raised **by the vendor**
(`flagMeasurement`), but it does not freeze earnings and has no defined money
outcome. See §19.

### 11.3 Recovering released payouts

Three paths attempt a clawback from the wallet — cancellation reversal, return
`markReceived`, and the late penalty. All go through `reconcileBusinessWallet`,
which **clamps both buckets at zero**. There is **no negative balance, no
arrears/debt ledger, no offset against future earnings, and no reversal of a
completed bank transfer.** Once withdrawn, money is unrecoverable — the code
says so explicitly. Disputes avoid the problem by refusing to open once anything
has been released.

---

## 12. LATE ORDER PENALTIES

- **What is measured: dispatch lateness, not delivery lateness.** The cron looks
  for confirmed shipments whose `fulfillment_deadline` has passed and which are
  not yet `shipped`/`in_transit`/`delivered`. **Once a vendor dispatches, no
  penalty can ever accrue**, and there is no SLA on courier transit time
  anywhere in the system.
- **Deadline origin:** set at vendor confirmation as `confirmed_at + max product
  turnaround_days` (default 3 days for fabric/accessories).
- **Grace period: none.** `daysLate = ceil(msLate / 86,400,000)`, so the first
  5% lands the moment the deadline passes.

```
penaltyPercent = min(daysLate × late_penalty_percent_per_day (5), late_penalty_max_percent (25))
totalPenalty   = round(vendorItemsGrossTotal × penaltyPercent/100)
incremental    = totalPenalty − previouslyApplied
```

- **Base:** the vendor's items' **gross** `total_price` (commission included,
  shipping excluded).
- **Maximum:** **25%**.
- **Funded entirely by the vendor** — unreleased `net_amount` first
  (per-earning, `min(remaining, net)`), then clawed from `balance`.
- **Paid to the customer's Qlozet wallet** via `processPartialRefund`. **Qlozet
  contributes nothing.**
- Runs hourly at :30 (Africa/Lagos). Each daily tier is claimed atomically, so
  it cannot double-charge.
- **Repeated lateness:** no cumulative consequence, no rating impact, no
  suspension. Not defined.

**Example.** Vendor items gross ₦90,000, 3 days late → 15% → **₦13,500** from
the vendor to the customer's wallet. At 5+ days it caps at ₦22,500.

---

## 13. CUSTOMER CONFIRMATION & AUTOMATIC RELEASE

### 13.1 How a customer confirms

`confirmCustomerSatisfaction` on a `completed` order. It sets
`customer_satisfied`/`customer_satisfied_at`, stamps `release_date = now` on
**all** unreleased earnings for the order, and notifies each vendor. It is
once-only and cannot be reversed.

### 13.2 If the customer does nothing

Nothing is required of them. Earnings release at `delivery + 3 days` regardless.
Confirmation is purely an **accelerator**, not a gate.

The only true customer-facing deadline is the **7-day return window**, which
runs independently of payout release — so a vendor can be paid on day 3 and a
return can still be requested on day 6.

### 13.3 Every trigger that sets `release_date`

| Trigger | Value |
|---|---|
| All shipments delivered (webhook) | `now + 3 days`; also sets `payout_eligible_at`, `payout_status = 'eligible'` |
| Vendor confirms (upfront milestone) | `now + 3 days` |
| Bespoke payment settles (upfront) | `now + 3 days` |
| Reservation claim handover | `now + 3 days` |
| **Customer confirms satisfaction** | **`now`** |
| Dispute resolved partial / release-to-vendor | **`now`** |
| Return **rejected** by vendor | **`now`** |
| Safety-net cron (dispatch + 10 days) | **`now`** |

Freezes (`release_date = null`): dispute filed, return requested.

### 13.4 Does payout pause during a dispute?

Intended yes — but **the freeze is not durable**. Three paths re-populate
`release_date` without checking for an open dispute or return:

1. the **safety-net cron**, whose input filter is precisely
   `{released: false, release_date: null}` — the frozen state;
2. `confirmCustomerSatisfaction`;
3. a later shipment delivery on the same order.

`dispute.status` is never consulted by the release cron. See §21.

---

## 14. DISPUTES

- **Only on `completed` orders**, by the customer, one open dispute per
  (order, vendor).
- **Hard precondition:** if **any** earning for that vendor is already
  `released`, filing is refused — *"Vendor payment has already been released.
  Please contact support."* This is the system's only protection against
  clawback, and it means **disputes cannot touch released funds at all**.
- On filing, unreleased earnings are frozen and platform admins notified.
- **Resolution is admin-only**, with exactly three outcomes:

| Outcome | Customer | Vendor | Qlozet |
|---|---|---|---|
| `full_refund` | **Σ `net_amount`** credited (commission **not** refunded) | unreleased earnings **deleted** | **keeps commission** |
| `partial_refund` | **admin-entered amount**, uncapped and unvalidated | `net_amount` decremented; remaining rows unfrozen | keeps commission |
| `release_to_vendor` | nothing | earnings unfrozen, `release_date = now` | keeps commission |

- **Vendor wins** = `release_to_vendor`. **Customer wins** = `full_refund` or
  `partial_refund`. There is **no remake outcome**.
- **Funds already released:** no offset, no clawback, nothing. If an earning
  releases between filing and resolution (possible via §13.4),
  `full_refund` finds zero unreleased rows, computes ₦0, and the customer
  receives **nothing, silently**.
- A vendor-initiated `measurement_issue` dispute exists via `flagMeasurement`
  but freezes nothing and has no money path.

---

## 15. PAYMENT PROCESSING FEES

1. **Not modelled anywhere.** The customer is charged exactly `order.total`
   (`round(total × 100)` kobo). Paystack's `data.fees` is stored in metadata but
   **never read**. Stripe has no `application_fee_amount`.
2. **They do not reduce vendor payout.** Transfers send `net_amount` verbatim,
   with a code comment confirming the amount is already final.
3. **They do not affect commission.** `payment_handling_fee_percent` and
   `payment_handling_fee_flat` exist (**both 0**) but are read only by dead code.
4. **No Paystack split/subaccount settlement.** All money lands in Qlozet's
   single balance and is paid out by `source: 'balance'` transfers.
5. **By omission, Qlozet absorbs the processor fee out of its commission.** That
   is an accounting consequence of the code doing nothing — not a recorded
   decision.
6. **Refund treatment:** no fee is recovered or re-charged on any refund.
7. **The only processor-adjacent charge the customer bears** is the **2% FX
   markup** on non-NGN checkout (`total × rate × 1.02`), which is an FX spread,
   not a processing fee. Non-NGN is gated off by `stripe_enabled = false`.

---

## 16. TAXES

**No tax is charged to the customer and no tax is withheld from any vendor
payout.**

A `tax_percent` setting exists (schema default 0, **seed default 0.75**), and
`PlatformService.compute()` would apply it — but that function is **dead code**,
never called anywhere, and the real earnings path carries an explicit comment
forbidding its use. The order schema has no tax field. There is no VAT
registration, no tax-inclusive/exclusive flag, no jurisdiction logic, and no tax
line on any receipt. The only other hit is a passive `vat` field on Shipbubble's
rate-response DTO, which is never read.

> **Tax treatment has not yet been finalized.**

---

## 17. COMPLETE MONEY-FLOW EXAMPLE

**Scenario.** Customizable garment from Vendor A with cross-vendor fabric from
Vendor B, one discount, standard (non-bespoke) checkout.

### Customer side

```
Base price (₦45,000 × 1)                          45,000
+ Styles (contrast collar 4,000 + cuffs 2,500)     6,500
+ Same-vendor fabric (3 yd × 3,000)                9,000
+ Accessories (buttons)                            1,500
+ Add-ons (express finishing)                      3,000
+ Size surcharge (XXL)                             2,000
--------------------------------------------------------
before_discount                                   67,000
− Discount (10% of the whole total, customize)     6,700
--------------------------------------------------------
Item final (= total_price, Vendor A)              60,300

+ External fabric, Vendor B (4 yd × 4,000)        16,000   (order-level)
--------------------------------------------------------
subtotal                                          76,300

+ Delivery, Vendor A → customer                    3,200
+ Delivery, Vendor B → Vendor A (fabric leg)       1,800
--------------------------------------------------------
shipping_fee                                       5,000
+ Tax                                                  0   (none charged)
========================================================
CUSTOMER TOTAL                                    81,300
```

### Allocation

| Recipient | Basis | Amount |
|---|---|---|
| **Vendor A** (clothing) net | 60,300 − 6,030 | **54,270** |
| **Vendor B** (fabric) net | 16,000 − 1,600 | **14,400** |
| **Qlozet commission** | 6,030 + 1,600 | **7,630** |
| **Qlozet shipping receipts** | pays Shipbubble from this | **5,000** |
| **Logistics (Shipbubble)** | out of the 5,000 above | (platform cost) |
| **Payment processor** | not modelled — absorbed from commission | **0** |
| **Tax authority** | none | **0** |
| **Total** | | **81,300** ✓ |

### Settlement timeline

```
Payment settles
  Vendor A pending_balance += 54,270   (one 'completion' row — see §5.3:
                                        a customize order gets NO split today)
  Vendor B pending_balance += 14,400   ('completion', never split)
  Both release_date = null             → nothing releasable

Vendor A confirms shipment → order processing
  (no upfront row exists, so nothing is scheduled)

Fabric delivered B → A ; garment fulfilled ; dispatched

All shipments delivered (webhook)
  release_date = delivery + 3 days on both rows
  payout_status = 'eligible'

Customer confirms satisfaction (optional) → release_date = now

releaseFunds cron (≤30 min later)
  Vendor A: balance += 54,270 ; pending_balance −= 54,270
  Vendor B: balance += 14,400 ; pending_balance −= 14,400

Adjustments (if any)
  Late dispatch by Vendor A, 2 days → min(10,25)% × 60,300 = 6,030
    → Vendor A −6,030 ; customer wallet +6,030
    → Vendor A final net 48,240 ; reconciles: 48,240+14,400+7,630+5,000+6,030 = 81,300 ✓

Withdrawal
  Either vendor may withdraw from `balance` (≥ ₦2,000, bank account linked)
```

**If this had been bespoke instead:** `shipping_fee` would be ₦0 (platform pays
both couriers), the customer total would be ₦76,300, and both vendors' nets
would split 65/35 — Vendor A ₦35,275.50 / ₦18,994.50, Vendor B ₦9,360 / ₦5,040.

---

## 18. EDGE CASES

| Case | Treatment |
|---|---|
| **Vendor cancels** | Same `cancelOrder` path as the customer. **Any vendor owner/ops can cancel any order by reference — there is no ownership check on the vendor route** (§21). Full `order.total` to the customer's wallet; earnings reversed. |
| **Customer cancels** | Allowed while `pending`/`in_review`/`processing`. Full refund to wallet. |
| **Vendor is late** | §12 — dispatch lateness only, 5%/day capped 25% of gross, vendor-funded, to the customer's wallet. |
| **Customer never confirms delivery** | Nothing happens to them. Earnings release at delivery + 3 days anyway. |
| **Customer disputes after delivery** | Only if nothing has been released yet; otherwise refused and routed to support. |
| **Vendor already received a milestone** | If still in `pending_balance`, reversal deletes it. If released to `balance`, it is clawed back, floored at zero. If **withdrawn**, unrecoverable. |
| **Product requires remake** | **No remake mechanism exists** anywhere. |
| **Partial refund** | §11.1. Dispute partial refunds are an uncapped admin figure and are applied to *every* unreleased row (§21). |
| **Fabric already purchased** | No material-cost recognition. A cancellation refunds the customer in full and reverses the vendor's earning regardless of what the vendor has spent. |
| **Multiple vendors in one checkout** | One order, one shipment and one `shipping_fee` per vendor, per-item earnings, per-vendor scoped views. Rejecting one vendor's items refunds only that slice. |
| **Discounted order** | Commission on the post-discount amount; cost shared 90/10 by arithmetic, not by policy. |
| **Failed delivery** | **Not defined** — no failed-delivery state, cost rule, or redelivery charge. |
| **Vendor cannot complete a bespoke order** | No dedicated path. In practice: cancel (full refund, earnings reversed) — but a bespoke order's upfront may already have released, making recovery dependent on the wallet balance. |
| **Reservation fee** | 10%, 100% Qlozet revenue, no vendor earning, hidden from the vendor console. |
| **Non-NGN checkout** | `total × rate × 1.02`, Stripe. Disabled by default (`stripe_enabled = false`). A Stripe-charged order that is cancelled is refunded as an **NGN wallet credit** (§21). |

---

## 19. UNRESOLVED DECISIONS

These are genuine gaps in the system. **None of them was decided in the
conversation that produced this document.**

**UNRESOLVED: Tax treatment.** `tax_percent` exists (seed 0.75%) but its only
consumer is dead code. No tax is charged or withheld. Options implied by the
code: enable it at order level via the legacy `compute()`, model it properly per
jurisdiction, or state that prices are tax-inclusive.

**UNRESOLVED: Who funds a discount.** No attribution field exists. Today the
cost falls 90% vendor / 10% Qlozet purely because commission is charged
post-discount. Options: vendor-funded, Qlozet-funded promotions, or an explicit
shared split with a recorded funding field.

**UNRESOLVED: Payment processing fees.** Not modelled at all.
`payment_handling_fee_percent`/`_flat` exist but are read only by dead code.
Options: absorb from commission (current de-facto), deduct from vendor payout,
or add to the customer total.

**UNRESOLVED: Payout cycle.** The `payout_cycle` setting (`weekly`) has no
runtime consumer; payouts are on-demand withdrawals. Options: implement
scheduled payouts, or remove the setting.

**UNRESOLVED: Material-cost protection on cancellation.** A vendor who has cut
fabric receives nothing if the customer cancels during `processing`. Options: a
non-refundable deposit, a cancellation cut-off once production starts, or a
materials claim.

**UNRESOLVED: Whether customizable orders should get the 65/35 milestone
split.** The code intends it but cannot deliver it (§5.3). Options: fix so
customize behaves like bespoke, or confirm that only bespoke gets a milestone.

**UNRESOLVED: Fault attribution for returns and refunds.** No vendor-fault vs
customer-fault distinction, no sizing/measurement/damage/wrong-item rules.

**UNRESOLVED: Remake as an outcome.** Not implemented in returns or disputes.

**UNRESOLVED: Failed delivery and redelivery.** No state, no cost rule, no
allocation between customer, vendor and platform.

**UNRESOLVED: Return shipping cost.** Schema fields exist
(`return_shipping_fee`, `return_shipping_paid_by`) but are never written or
read.

**UNRESOLVED: Commission asymmetry between returns and disputes.** Returns have
Qlozet absorb its commission; disputes have Qlozet keep it (§4.5). Which is
intended has never been decided.

**UNRESOLVED: Bespoke delivery cost.** Bespoke delivery is free to the customer
and paid by the platform, with no cap and no recovery from the vendor.

**UNRESOLVED: Repeated lateness consequences.** No escalation, rating effect or
suspension.

**UNRESOLVED: Clawback beyond the wallet.** No arrears ledger or negative
balance; withdrawn money is unrecoverable.

---

## 20. FINAL SOURCE-OF-TRUTH SUMMARY

| Rule | Current Qlozet policy (as implemented) |
|---|---|
| **Qlozet Commission** | **10%** (`platform_commission_percent`), or a flat ₦ amount if `platform_commission_type = 'fixed'` (flat default ₦0). One global rate — no per-vendor, per-category or bespoke variation. |
| **Commission Calculation Base** | Per **order item**, on `item.total_price` — i.e. **post-discount**, including styles, same-vendor fabric, accessories, add-ons and size surcharge. **Excludes delivery.** Cross-vendor fabric is commissioned separately against the fabric vendor. |
| **Payment Processing Fee** | **Not modelled.** Absorbed by Qlozet from commission by omission. Settings exist but are dead. |
| **Delivery Fee** | **Customer pays 100%**; Qlozet retains it and pays Shipbubble. Never commissionable, never charged to the vendor. **Bespoke: ₦0 to the customer, platform pays the courier.** |
| **RTW Vendor Payout** | 100% of net, released at **delivery + 3 days** (`payout_delay_days`). Immediate if the customer confirms satisfaction. Safety net: **dispatch + 10 days** (`auto_release_days`). |
| **Custom Vendor Initial Payout** | **Intended 65% — but not applied.** `clothing_type` is not persisted, so customizable catalogue orders receive **no split** and pay out as RTW (§5.3, §21). |
| **Custom Vendor Final Payout** | As above — currently 100% at delivery + 3 days. |
| **Bespoke Initial Payout** | **65%** of **net** (`tailored_order_upfront_percent`), scheduled at payment settlement, released at **+3 days**. Applies to every vendor on the order, including the fabric vendor. |
| **Bespoke Final Payout** | Remaining **35%** of net, at **delivery + 3 days**. |
| **Customer Confirmation Window** | **None.** Confirmation is optional and only accelerates release to immediate. The independent **7-day** return window is the only customer deadline. |
| **Automatic Release** | `releaseFunds` cron every **30 minutes** once `release_date` has passed; fallback release **10 days after dispatch** if the delivery webhook never fires. |
| **Late Penalty** | **5% per day, capped at 25%**, of the vendor's items' **gross**. Measures **dispatch** lateness only. No grace period. **Vendor-funded**, paid to the **customer's wallet**. Qlozet contributes nothing. |
| **Refund Rule** | Cancellation (`pending`/`in_review`/`processing`): **full `order.total`** incl. delivery, **to the customer's Qlozet wallet**. Return (7 days, **vendor-approved**): items' **gross**, delivery **not** refunded, **Qlozet absorbs its commission**. Dispute full refund: **Σ net**, **Qlozet keeps commission**. No refunds to card/Stripe in any path today. |
| **Discount Treatment** | Vendor-created only; one best discount per product, never stacked. RTW: base price only — components never discounted. Customize: applied to the whole composed total. Commission charged after the discount, so cost falls ~90/10 vendor/Qlozet by arithmetic. **Funding attribution: none.** |
| **Fabric Treatment** | Same-vendor fabric is inside the vendor's own item and commission. Cross-vendor fabric is a **separate earning for the fabric vendor** at the same commission rate, plus a customer-paid `fabric_transfer` delivery leg. Reservation fee **10%**, **100% Qlozet revenue** with no vendor earning. Customer-owned fabric is not part of the model. |
| **Tax Treatment** | **Tax treatment has not yet been finalized.** No tax is charged or withheld. |

---

## 21. IMPLEMENTATION DEFECTS AFFECTING THESE TERMS

Separated deliberately: these are **not policy**, and a handbook that describes
them as policy would be wrong. They are behaviours that appear unintended and
should be confirmed or fixed before any vendor-facing commitment is published.

1. **Card refunds do not reach the card.** Cancellation credits the customer's
   Qlozet **wallet** even for Paystack and Stripe charges; the Paystack `/refund`
   API is deliberately bypassed and **no Stripe refund is ever issued by any
   flow**. Contradicts the locked "refund-to-source only" decision in
   `docs/multi-currency-payments-plan.md` §16.
2. **A partial return on a card order triggers a full-order card refund** —
   `refundPaystackPayment` refunds the entire original transaction, ignoring the
   computed partial amount.
3. **The customizable 65/35 split never applies** (§5.3) — `clothing_type` is
   not on the persisted item schema.
4. **The dispute/return payout freeze is not durable** (§13.4) — three paths
   re-populate `release_date`, one of which uses the frozen state as its input
   filter.
5. **Dispute resolutions never adjust `pending_balance`.** `deleteMany` on
   earnings leaves the credited `pending_balance` orphaned on the vendor's wallet.
6. **Dispute partial refunds decrement every unreleased earning row by the full
   amount**, so a split or multi-item order is over-debited, and `net_amount` can
   go negative (no floor).
7. **A dispute resolved after its earnings released silently refunds ₦0** to the
   customer.
8. **The vendor cancel route has no ownership check** — any vendor owner/ops can
   cancel any order by reference.
9. **Cancellation is not idempotent against prior partial refunds** — it refunds
   the original transaction amount even if a rejection already refunded part of
   the order and shrank `order.total`.
10. **Re-quote drift and bespoke delivery are unfunded platform costs** (§9).
11. **Insurance is quoted but never charged or purchased.**
12. **`BusinessEarning.currency` is never written** — always the `'NGN'` default,
    despite a comment saying it should follow the vendor's settlement currency.
13. **Cart and order disagree on external fabric for quantity > 1** — the cart
    multiplies it by quantity, the order does not, so the preview subtotal can
    exceed the charged subtotal.
