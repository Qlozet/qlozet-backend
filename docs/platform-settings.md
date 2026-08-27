# Platform Settings — Implementation Documentation

Admin-configurable, platform-wide settings that drive payouts, commission/fees,
order lifecycle timers, inventory thresholds, and AI/token pricing.

- **Module:** `src/modules/platform`
- **Schema:** `src/modules/platform/schema/platformSettings.schema.ts`
- **Service:** `src/modules/platform/platform.service.ts`
- **Controller:** `src/modules/platform/platform.controller.ts`
- **DTO:** `src/modules/platform/dto/update-settings.dto.ts`

---

## 1. Model

There is exactly **one** `PlatformSettings` document for the whole platform (a
singleton). It is created lazily the first time settings are read.

- `getSettings()` → `findOne()`; if none exists, it calls `create()` which
  seeds the doc from `defaultSettings()`.
- `update(dto)` → `findOneAndUpdate({}, dto, { new: true, upsert: true })` — the
  empty filter `{}` always targets the single doc.
- Fields **not** listed in `defaultSettings()` get their Mongoose `@Prop`
  schema default at creation time.

> **Effective default = the value in `defaultSettings()` if present, otherwise
> the `@Prop` default.** These sometimes differ (see [§6](#6-known-gaps--caveats)).

---

## 2. Endpoints

All live on the `Admin` controller, base path `/api/admin`, guarded by
`JwtAuthGuard` + `RolesGuard` with `@Roles(UserType.PLATFORM)`.

| Method  | Path                              | Handler                          | Purpose |
|---------|-----------------------------------|----------------------------------|---------|
| `GET`   | `/api/admin/settings`             | `getSettings()`                  | Read current settings (seeds defaults if missing) |
| `PATCH` | `/api/admin/settings`             | `update(dto)`                    | Update one or more settings |
| `POST`  | `/api/admin/refresh-token-price`  | `updateNgnTokenPrice()`          | Recompute the NGN token price from the USD price via FX |

**Auth:** send `Authorization: Bearer <admin access token>`. A non-platform
token is rejected by `RolesGuard`.

**Update semantics:** `PATCH /settings` accepts a partial body and merges it.
Because the pipe is `ValidationPipe({ transform: true })` **without
`whitelist`**, any schema field sent in the body is persisted — even fields the
DTO does not declare (see [§6](#6-known-gaps--caveats)).

### Example

```http
PATCH /api/admin/settings
Authorization: Bearer <admin-token>
Content-Type: application/json

{
  "platform_commission_percent": 12,
  "return_window_days": 14,
  "auto_reject_hours": 48
}
```

---

## 3. Settings reference

Grouped by concern. "Used by" is where the value is actually read at runtime.

### Payouts & earnings

| Field | Type | Default | Used by | Notes |
|---|---|---|---|---|
| `payout_cycle` | `weekly \| bi-weekly \| monthly` | `weekly` | — | **No runtime consumer** — informational only today |
| `minimum_payout` | number (₦) | `2000` | `wallets.service.ts` | Minimum balance before a payout can run |
| `payout_delay_days` | number (days) | `3` | `platform.service.compute()` | Days after completion before earnings become payout-eligible |
| `auto_release_days` | number (days) | `10` | `business/business-earning-cron.ts` | Safety net: auto-release completion earnings N days after **dispatch** if the delivery webhook never fires |
| `tailored_order_upfront_percent` | number (%) | `65` | `business/business.service.ts` | Milestone split for custom orders: this % on vendor confirm, remainder on delivery |
| `reservation_fee_percent` | number (%) | `10` | `fabric-reservation/fabric-reservation.service.ts` | Fabric reservation fee |

### Commission, fees & tax

| Field | Type | Default | Used by | Notes |
|---|---|---|---|---|
| `platform_commission_percent` | number (%) | `10` | `business.service.ts`, `orders.service.ts` | Commission when type = `percent` |
| `platform_commission_type` | `percent \| fixed` | `percent` | `business.service.ts`, `orders.service.ts` | Switches between % and flat commission |
| `platform_commission_flat` | number (₦) | `0` | `business.service.ts` | Commission when type = `fixed` |
| `payment_handling_fee_percent` | number (%) | `0` | `platform.service.compute()` | Gateway handling fee (%) |
| `payment_handling_fee_flat` | number (₦) | `0` | `platform.service.compute()` | Gateway handling fee (flat) |
| `tax_percent` | number (%) | `0.75` | `platform.service.compute()` | Tax applied to the order total |

### Order lifecycle timers

| Field | Type | Default | Used by | Notes |
|---|---|---|---|---|
| `return_window_days` | number (days) | `7` | `returns/returns.service.ts` | Return eligibility window from delivery |
| `auto_reject_hours` | number (hours) | `24` | `orders/orders.service.ts` | Auto-reject orders a vendor never confirms |
| `late_penalty_percent_per_day` | number (%) | `5` | `orders/orders.service.ts` | Late-fulfilment penalty accrual per day |
| `late_penalty_max_percent` | number (%) | `25` | `orders/orders.service.ts` | Cap on the late penalty |

### Inventory thresholds

| Field | Type | Default | Used by | Notes |
|---|---|---|---|---|
| `low_stock_threshold` | number (units) | `5` | `products/products.service.ts` | A variant at/under this is flagged low stock |
| `low_fabric_yards` | number (yards) | `0` | `products/products.service.ts` | Fabric under this is "low"; `0` → fall back to 2× the fabric's `min_cut` |

### AI / token pricing (token cost per feature)

| Field | Type | Default | Used by |
|---|---|---|---|
| `image_measurement_token_price` | number (tokens) | `25` | `measurement.*`, `wallets/token.service.ts` |
| `video_measurement_token_price` | number (tokens) | `45` | `measurement.*`, `wallets/token.service.ts` |
| `outfit_generation_token_price` | number (tokens) | `45` | `measurement.*`, `wallets/token.service.ts` |
| `edit_garment_token_price` | number (tokens) | `45` | `wallets/token.service.ts` |
| `run_prediction_token_price` | number (tokens) | `45` | `wallets/token.service.ts` |
| `ai_ask_token_price` | number (tokens) | `0` | `wallets/token.service.ts` |
| `analyze_reference_token_price` | number (tokens) | `10` | `measurement.*`, `wallets/token.service.ts` |
| `ai_ask_requires_auth` | boolean | `false` | `recommendations/router/router.controller.ts` | Gate the AI-ask feature behind auth |

### Token price (FX)

| Field | Type | Default | Notes |
|---|---|---|---|
| `token_price.usd.amount` | number (USD) | `0.01` | Base price of one token |
| `token_price.usd.currency` | string | `USD` | |
| `token_price.ngn.amount` | number (₦) | `0` (seeded), refreshed by FX | Derived from USD via the currency service |
| `token_price.ngn.currency` | string | `NGN` | |
| `token_price.ngn.last_updated` | Date | now | Stamp of the last FX refresh |

---

## 4. Earnings & fee computation

`platform.service.compute(totalAmount)` is a helper that returns:

```
commission   = platform_commission_percent% × total
handling     = payment_handling_fee_percent% × total + payment_handling_fee_flat
tax          = tax_percent% × total
totalFees    = handling + tax
vendorEarnings = total − commission − totalFees
payoutEligibleAt = now + payout_delay_days days
```

> **Important:** `compute()` only implements the **percentage** commission path
> and is **not** used for real order earnings. `payment.service.ts` explicitly
> avoids it ("commission was already computed"). The authoritative per-order
> earnings calculation — including `platform_commission_type` (`percent` vs
> `fixed`) — lives in `business.service.ts` (~L1435). Treat `compute()` as a
> legacy/utility helper.

---

## 5. Token price & FX flow

Tokens are priced in USD; the NGN price is derived:

1. Admin (or the seed) sets `token_price.usd.amount`.
2. `updateNgnTokenPrice()` reads the USD amount, converts to NGN via
   `CurrencyService.convertUsdTo(usd, 'NGN')`, rounds to whole kobo
   (`Math.round(raw × 100) / 100`), and stamps `ngn.last_updated`.
   - Rounding to whole kobo is deliberate: Paystack rejects fractional-kobo
     totals, and it keeps the displayed price consistent with the charged one.
3. This runs **automatically** via a cron at **03:00 Africa/Lagos daily**
   (`@Cron('0 3 * * *')` → `autoRefreshTokenPrice()`), and **on demand** via
   `POST /api/admin/refresh-token-price`.

Per-feature token costs (§3) are charged against the customer's token balance
in `wallets/token.service.ts`.

---

## 6. Known gaps & caveats

1. **DTO only documents 7 of ~30 fields.** `UpdatePlatformSettingsDto` declares
   only `payout_cycle`, `minimum_payout`, `payout_delay_days`,
   `tailored_order_upfront`, `platform_commission_percent`,
   `payment_handling_fee_percent`, `payment_handling_fee_flat`. The rest are
   updatable (no `whitelist` on the pipe) but **untyped/undocumented and
   unvalidated**. Any typo in a field name is silently written as a new key.

2. **Field-name mismatch → silent no-op.** The DTO exposes
   `tailored_order_upfront`, but the schema and payout logic read
   `tailored_order_upfront_percent`. Sending the *documented* field writes a key
   nothing reads, so the upfront % never changes. Fix: rename the DTO field to
   `tailored_order_upfront_percent`.

3. **`payout_cycle` is unused.** No scheduler or service reads it; changing it
   has no effect today.

4. **`defaultSettings()` vs `@Prop` defaults diverge** for a few fields (e.g.
   `tailored_order_upfront_percent`: schema `0` vs seed `65`; `tax_percent`:
   schema `0` vs seed `0.75`; `token_price.ngn.amount`: schema `15` vs seed
   `0`). The seed wins on first create; the `@Prop` default only applies to
   fields the seed omits. The tables in §3 list the **effective** default.

5. **No input validation.** Values like percentages accept any number
   (negative, >100). Consider adding `class-validator` constraints when the DTO
   is expanded.

---

## 7. Adding a new setting

1. Add the `@Prop` to `platformSettings.schema.ts` with a sensible default.
2. (Recommended) Add the field to `UpdatePlatformSettingsDto` with
   `@ApiPropertyOptional` + `class-validator` decorators so it's typed,
   validated, and shows in Swagger.
3. If it should ship with a non-`@Prop` default, add it to
   `defaultSettings()` in `platform.service.ts`.
4. Read it via `platformService.getSettings()` (or inject the model) in the
   consuming service. Prefer `?? <fallback>` so existing settings docs that
   predate the field still work.
5. If the admin app should expose it, wire it into the admin Settings page +
   its settings API slice.
