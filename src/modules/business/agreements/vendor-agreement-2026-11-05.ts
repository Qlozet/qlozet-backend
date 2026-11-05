/**
 * Vendor service agreement, version 2026-11-05.
 *
 * What changed from 2026-10-31: verification can be done by hand while our
 * identity provider is not available (qoreid/manual-verification.ts). In
 * manual mode the vendor gives their CAC number and links a payout account
 * whose name the bank confirms; the Qlozet team checks the CAC register,
 * compares the payout name and calls the owner. A manually approved vendor
 * must complete the provider checks within the notice period we give once
 * they are available (currently 30 days); past it, listings are hidden and
 * no new orders are taken until they finish. Clause 1 no longer assumes the
 * identity was verified by a provider.
 *
 * Everything else is carried over unchanged from 2026-10-31 (bespoke
 * deposit and balance; fixed 14-day payout schedule, never held).
 *
 * NOT LEGAL ADVICE. This is a product-accurate draft: every operative clause
 * matches what the platform actually does, with the figures taken from
 * PlatformService.defaultSettings(). It must be reviewed by a Nigerian lawyer
 * before it is relied on.
 *
 * Kept as a TypeScript string rather than a .md file on purpose: the build
 * only copies the mail templates into dist. Old versions stay in this folder
 * forever; never edit a published version in place.
 */
export const VENDOR_AGREEMENT_2026_11_05 = `
# Qlozet Vendor Agreement

**Version 2026-11-05**

This Agreement governs your use of the Qlozet marketplace as a Vendor. It
takes effect when you accept it in the Qlozet vendor console, and it applies
to every order you receive through the platform.

## 1. Who this is between

**Qlozet** ("we", "the Marketplace") operates the Qlozet marketplace.

**You** ("the Vendor") are the business identified by the records on your
vendor account — your registered business name, your CAC registration, your
payout account and the person who verified on its behalf. You confirm that
you are authorised to enter into this Agreement on behalf of that business,
and that everything you give us during verification is true.

## 2. How you accept this Agreement, and how it changes

You accept this Agreement by ticking the acceptance box in the vendor console.
No signature is required and none is implied; your acceptance is recorded with
the version you accepted, the date and time, the account that accepted it, and
the originating IP address.

When we change this Agreement we publish it under a new version. You will be
asked to accept the new version before you can continue to submit your store
for review or receive new orders. Orders already placed remain governed by the
version in force when they were placed.

## 3. Verification is a condition of selling

You may create an account, build your catalogue and prepare your store at any
time. **Your products become visible to customers, and you may receive orders,
only after your business has passed verification and been approved by us.**

Verification covers your identity, your CAC registration and your payout
account. We may decline to approve a business, ask you to correct something,
or withdraw approval later, acting reasonably.

**How we verify.** Normally you complete checks with our identity provider:
your identity (including a live selfie), your CAC registration and your
payout account. We store the result of each check — whether it passed, the
provider's reference, and the name that was confirmed. **We do not store your
identity numbers.**

**Manual verification.** While those checks are not available, we may verify
you by hand instead. You give us your CAC registration number and link your
payout account (your bank confirms the account name to us); we check your
registration on the public CAC register, compare the payout account name with
your business or its owner, and speak to you before approving. You agree to
answer our questions truthfully and to provide any further document we
reasonably ask for.

**Finishing full verification.** If you were approved by hand, you must
complete the identity provider's checks when we ask you to, within the notice
period we give you (currently 30 days). You may keep selling during that
period. If you have not finished by the end of it, your products are hidden
and you cannot take new orders until you finish and we approve your store
again. Orders already placed are not affected, and earnings already due to
you are paid on the normal schedule in clause 8.

## 4. Your products and listings

You are responsible for everything you list.

- Descriptions, measurements, materials, colours and prices must be accurate.
- Photographs must be of the actual item you are selling, at or above the
  minimum resolution the console enforces, and must not be stock imagery of
  another seller's work.
- Each variant's SKU must be unique within your own catalogue.
- You must hold the right to sell every item you list.

You may not list counterfeit goods, items that infringe another party's trade
mark, copyright or design, or anything whose sale is restricted under Nigerian
law.

Listings that breach this clause may be removed without notice. Repeated
breaches are grounds for suspension.

## 5. Orders, timelines and capacity

Different products carry different obligations, and the platform reflects
this:

- **Ready-to-wear, fabric and accessories** — you must confirm and dispatch
  within the time stated on the listing, and within 48 hours of payment where
  no time is stated.
- **Tailored and bespoke orders** — you must confirm within 48 hours, and
  complete within the turnaround you set on the listing or quoted to the
  customer. The turnaround you publish is a commitment to the customer.
- **Bespoke orders from a quote** — when you finish the piece you send photos
  of it through the platform before shipping. You ship once the customer has
  paid the balance (see clause 8). You are not late while you are waiting for
  that payment.

You control your own capacity. When you reach the limit of orders you can have
in progress, the platform stops accepting new ones on your behalf. Setting a
realistic limit is part of meeting these timelines: a full workshop is not a
breach, an undeliverable promise is.

Repeated late confirmation, late dispatch or failure to complete may lead to
reduced visibility, suspension of listings, or termination.

## 6. Fabric supplied by another vendor

Where a customer applies fabric from another Qlozet vendor to a garment you
are making, that fabric is shipped to you before you begin. You are
responsible for it from the point you receive it, must use it only for that
order, and must return or account for any usable remainder if the order is
cancelled.

## 7. Commission, fees and what you are paid

We retain a commission on each completed sale. **The current rate is 10% of
the order value.** Payment-processing fees and any applicable taxes are
deducted in addition. The rates in force are always shown in your vendor
console, and any change is published there before it takes effect.

You keep the remainder of the order value, less any refunds, chargebacks and
penalties properly attributable to you.

## 8. When you are paid

Your earnings from an order become available to withdraw **14 days after the
customer's payment** for that order. This applies to every order type,
including tailored and bespoke work, and the date is fixed when the customer
pays. It does not depend on delivery, on the return window or on whether the
customer confirms or raises a problem. The date each amount becomes available
is shown in your vendor console.

**Bespoke orders from a quote are paid in two parts.** The customer pays a
deposit when they accept your quote (currently 50% of your quoted price, or
the cost of the fabric in your quote if that is more) and the balance when
you send photos of the finished piece. Fabric from your own listings is
priced at your listed price; where you buy the fabric yourself, you state its
cost on the quote and must state it honestly. Each part becomes
available 14 days after the customer pays that part. Fabric from another
vendor is paid in full by the customer up front and is not part of the
split. If the customer does not pay the balance within the published period
after your photos (currently 14 days, paused while they ask you for
changes), the order closes, you keep the deposit, and you are not required to
ship. The current deposit share and payment period are shown in your vendor
console and on each quote.

You may withdraw your available balance at any time, provided it is at least
the published minimum (currently ₦2,000). Funds are paid to the bank account
verified on your account; we will not pay to an account that has not been
verified as belonging to you.

Where a withdrawal fails for a reason outside our control — an incorrect or
closed account, a bank outage — we will return the funds to your available
balance and tell you.

## 9. Returns, refunds and chargebacks

You set your own return window, which is shown to customers before they buy.
You must honour it.

Where an order is cancelled before dispatch, the customer is refunded in full
and no commission is charged, except that a customer who cancels tailored or
bespoke work after you confirmed it gives up the published cancellation fee
(currently 30% of your price, never more than they paid), which is paid to
you. A customer who cancels a bespoke order after you have sent photos of the
finished piece gives up the whole deposit, which is paid to you.

Where a return or refund is agreed, or an order is cancelled, the refund is
taken from your earnings for that order. Where those earnings have already
become available or been withdrawn, the amount is deducted from your available
balance. If your balance does not cover it, the shortfall is recorded as owed
to us, is deducted from your next earnings as they become available, and must
be cleared before you can withdraw again.

**Chargebacks** raised by a customer's bank or card issuer are charged to you
where the chargeback relates to the item, its description, its condition or
its delivery. We bear chargebacks arising from a failure of our own payment
systems.

## 10. Disputes

Where a customer raises a dispute, you will be notified and given the
opportunity to respond. We expect a response within 48 hours.

We will attempt to resolve the dispute between you and the customer. Where it
cannot be resolved, **we will decide the outcome**, and that decision is final
as between us for the purposes of any refund to the customer. Nothing in
this clause prevents either you or the customer from pursuing any remedy
available at law.

A customer may raise a dispute up to 30 days after delivery. Your payouts are
not held while a dispute is open. Where a dispute is decided in the customer's
favour, the refund is recovered as described in clause 9.

## 11. Customer information

Through the platform you will receive information about customers that you
need in order to fulfil their orders — names, delivery addresses, contact
details and, for tailored work, **body measurements**.

You may use that information only to fulfil the order it relates to. You must
not:

- retain it after it is no longer needed for that order or for your own
  statutory record-keeping;
- share or sell it to anyone;
- use it to market to the customer, whether on or off the platform;
- contact the customer other than about their order.

Body measurements are sensitive. Treat them accordingly, and secure them as
you would your own financial records. You must comply with the Nigeria Data
Protection Act and any other applicable data protection law.

A breach of this clause is grounds for immediate suspension.

## 12. Selling around the platform

You may not use the platform to direct customers to transact with you off it —
by including contact details, payment details or links to other stores in your
listings, product photographs, packaging inserts or messages to customers, or
by inviting a customer who found you here to buy elsewhere.

This is not a restriction on your own business. You remain free to sell
anywhere, to anyone who did not come to you through Qlozet.

## 13. Your brand and ours

You keep ownership of your brand, your designs and your photographs. You grant
us a non-exclusive, royalty-free licence to use your product images,
descriptions and business name to display, promote and sell your products, on
the platform and in our marketing. That licence ends when your account closes,
except for material already published, which we will remove within a
reasonable time.

You may describe yourself as a Qlozet vendor while this Agreement is in force.
You may not use our name or marks in a way that suggests we endorse products
or claims we have not endorsed.

## 14. The platform itself

We will use reasonable efforts to keep the platform available and secure, and
to give advance notice of planned maintenance. We do not guarantee
uninterrupted availability, and we are not liable for loss of profit or sales
arising from an interruption.

We may promote your products at our discretion. Promotion is not guaranteed,
and inclusion in any campaign is not a term of this Agreement.

## 15. Tax

You are responsible for your own tax. Where we are required by law to withhold
or remit tax on a payment to you, we will do so and account to you for it.
Nothing in this Agreement makes us your employer or your agent for tax.

## 16. Suspension and termination

You may close your account at any time by giving us 30 days' written notice.

We may suspend or terminate your account, with notice where practicable and
immediately where necessary, if you:

- breach this Agreement;
- list counterfeit, infringing or prohibited items;
- fail verification or are found to have given false information;
- repeatedly fail to meet the obligations in clauses 4, 5 or 9;
- misuse customer information; or
- fail to comply with applicable law.

**Money in flight.** Suspension or termination does not cancel orders already
placed. You must complete orders you have already accepted, or we will refund
those customers and recover the amount from your balance. Earnings properly
due to you become available on the normal schedule in clause 8. Amounts you
owe us under clause 9 remain payable after termination.

## 17. Liability

Neither of us excludes liability for fraud, for death or personal injury
caused by negligence, or for anything else that cannot lawfully be excluded.

Subject to that, our total liability to you arising out of this Agreement in
any twelve-month period is limited to the total commission we retained from
your sales in that period. We are not liable to you for loss of profit, loss
of business or loss of goodwill.

You are responsible for the products you sell, and you will indemnify us
against claims brought by a customer or a third party arising from a product
you listed, a right you did not hold, or information you misused.

## 18. Events outside our control

Neither of us is liable for a failure to perform caused by something outside
our reasonable control, including natural events, government action, failure
of public communications networks, or a security incident at a third party we
rely on. The affected party will tell the other as soon as it reasonably can.

## 19. General

**Not an exclusive relationship.** Nothing here prevents either of us from
dealing with anyone else.

**Independent businesses.** This Agreement does not create a partnership, a
joint venture, or an employment relationship. You sell your own products on
your own account.

**Assignment.** You may not transfer this Agreement without our written
consent. We may transfer it to a company that acquires our business.

**Severability.** If a provision is held invalid, the rest of this Agreement
continues in effect.

**Entire agreement.** This Agreement, together with the policies published in
the vendor console, is the whole of what is agreed between us about your use
of the platform.

## 20. Governing law

This Agreement is governed by the laws of the Federal Republic of Nigeria.

If a dispute arises between us, we will first try in good faith to resolve it
by discussion. If it is not resolved within 14 days, it will be referred to
mediation, and failing that to the courts of the Federal Republic of Nigeria.
`.trim();
