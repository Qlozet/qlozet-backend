# Vendor Business Analytics Assistant — Technical Spec (Phase 1)

**Status:** Draft for review · **Provider:** Anthropic Claude · **Scope:** Read-only analyst

---

## 1. Goal

Give vendors a conversational business analyst inside the vendor dashboard.
A vendor can ask, in plain English, questions like:

- "How were my sales last month?"
- "Which state buys the most from me?"
- "What's my best-selling category?"
- "How much is pending payout vs available?"
- "Why is my available balance lower than my earnings?"
- "Which products are nearly out of stock?"

The assistant answers using **only** the vendor's own data, pulled through
scoped tools — never by inventing numbers or querying the DB freely.

**Non-goals (Phase 1):** no action-taking (no price changes, no flash sales, no
payouts), no cross-vendor data, no predictions presented as fact.

---

## 2. Core principle — tools, not free-form DB access

Claude does **not** see MongoDB. It sees a fixed menu of **read-only analytics
tools**, each hard-scoped to the authenticated vendor's `businessId`. Claude
picks tools, receives structured JSON, and reasons over it.

```
Vendor question
      │
      ▼
┌─────────────────────────────────────┐
│  POST /business/assistant/chat       │  (NestJS, JWT → businessId server-side)
│                                      │
│  ┌────────────────────────────────┐ │
│  │  LLM provider interface        │ │  ← swappable (Claude today)
│  │  tool-use loop                 │ │
│  └───────────┬────────────────────┘ │
│              │ tool_call             │
│              ▼                        │
│  ┌────────────────────────────────┐ │
│  │  AnalyticsToolRegistry         │ │  each tool filters by businessId
│  │  (wraps existing services)     │ │
│  └───────────┬────────────────────┘ │
└──────────────┼───────────────────────┘
               ▼
    Existing services / aggregations
 (orders, earnings, wallet ledger, products)
```

Why this shape:
- **Accuracy** — numbers come from your aggregations, so they match the dashboard.
- **Security** — a tool physically cannot return another vendor's data.
- **Reuse** — tools are thin wrappers over methods you already have.

---

## 3. Tenant scoping (the non-negotiable)

- `businessId` is resolved **server-side from the JWT** on every request.
- It is injected into every tool call by the registry — it is **never** a tool
  parameter the model can set, and never read from the user message.
- Tools accept only *safe* params (period, limit, threshold). No raw filters,
  no ids from the model.
- Add an integration test that asserts a tool called for Vendor A can never
  return Vendor B rows.

---

## 4. The tools (Phase 1 set)

Each maps to existing or near-existing backend logic. Signatures show only the
*model-visible* params; `businessId` is injected by the registry.

| Tool | Purpose | Backed by |
|---|---|---|
| `get_sales_summary(period)` | revenue, order count, AOV, deltas vs prior period | orders aggregation |
| `get_top_products(period, limit, direction)` | best/worst sellers | orders + products |
| `get_sales_by_location(period)` | orders per state | `getBusinessOrdersByLocationChart` |
| `get_sales_by_audience(period)` | men/women/unisex split | `getBusinessOrdersByGenderChart` (audience) |
| `get_sales_by_product_kind(period)` | custom/ready/fabric/accessory split | `ordersByProductKind` |
| `get_earnings_breakdown(period)` | gross, commission, net, pending vs released | `BusinessEarning` + wallet |
| `get_wallet_ledger(period, type?)` | credits/debits/funding/payouts | `transactions.findByBusiness` |
| `get_inventory_status(threshold)` | low/out-of-stock SKUs | products/inventory |
| `get_order_stats(period)` | fulfilment: avg time, cancellations, returns | orders |

`period` is a controlled enum: `today | this_week | this_month | last_month |
last_30_days | last_90_days | this_year`. No free-form date parsing in Phase 1
(keeps aggregation predictable and cacheable).

### 4a. Candidate tools (Phase 1.5+)

The Phase 1 set answers "what sold, where, how much did I earn." These close the
gaps vendors actually worry about: am I growing, when do I get paid, are
customers happy, what should I fix. Grouped by data-availability confidence.

**Strong adds — data clearly exists today:**

| Tool | Answers | Backed by |
|---|---|---|
| `get_sales_trend(period, granularity)` | "Am I growing?" WoW/MoM growth, seasonality | orders time-series |
| `get_payout_forecast()` | "When do I get paid, how much?" pending vs available, next release dates/amounts | `BusinessEarning` release_date + milestones |
| `get_customer_insights(period)` | new vs **repeat** buyers, repeat rate, top customers, AOV | orders + customers |
| `get_promotion_performance(period)` | "Are my discounts working?" revenue per discount, discounted vs full-price mix | discounts + orders |
| `get_reviews_summary(period)` | "Are customers happy?" avg rating, trend, recent low ratings + why, `success_rate` | reviews/ratings |
| `get_fulfilment_health(period)` | shipments by status, avg dispatch/delivery time, late/failed, orders awaiting dispatch | Shipbubble shipments |
| `get_returns_and_disputes(period)` | return rate, open disputes, top reasons | returns + disputes modules |
| `get_custom_order_pipeline()` | tailors: bespoke orders in production, by milestone, overdue | `clothing_type: customize` + milestones |

Highest ROI of the group: **`get_payout_forecast`** (cash-flow is the #1 vendor
anxiety, and the release/milestone data answers it precisely) and
**`get_customer_insights`** (repeat-rate is the best single health metric).

**Situational adds:**

- `get_catalog_health()` — dead stock (no sales in N days), out-of-stock,
  listings missing images/description, price outliers. Merchandising nudge.
- `get_fabric_stock()` — remaining yardage + active reservations, for fabric
  vendors (fabric-reservation module).

**Data-dependent — verify tracking exists first:**

- `get_traffic_conversion(period)` — views → cart → order funnel. **Only if
  product views are logged.** If not, this is the tracking most worth adding —
  "lots of views, few sales" is the most actionable insight there is.
- `get_search_demand(period)` — what shoppers searched that led to / missed the
  store. Only if search queries are logged.
- `get_category_benchmark(period)` — "you vs category median." Powerful, but
  **cross-tenant aggregate** — needs a strict privacy guard: aggregates only,
  enforce a minimum cohort size, nothing vendor-identifiable.

**Not new tools — synthesized behaviors:** "restock this" / "promote that"
recommendations come from combining `get_inventory_status` + `get_sales_trend` +
`get_promotion_performance` via the system prompt (especially the digest). Don't
build endpoints for them.

**Deprioritized:** follower/social analytics — low revenue signal in early phases.

**Tool output contract:** every tool returns
`{ period, generated_at, currency: 'NGN', data }` so the model always knows the
window and unit it's describing.

---

## 5. Chat endpoint

```
POST /business/assistant/chat
Auth: vendor JWT
Body: { message: string, conversation_id?: string }
Returns (streamed): { role, content_blocks[], chart_specs?[], conversation_id }
```

- Runs the provider tool-use loop until the model returns a final answer.
- **Turn cap** (e.g. max 6 tool round-trips) to bound cost/latency.
- Streams tokens to the UI.
- Persists conversation turns (see §9).

---

## 6. Provider abstraction (swappable)

Keep Claude behind one interface so a future swap is a day, not a rewrite.

```ts
interface LlmProvider {
  runToolLoop(input: {
    system: string;
    messages: LlmMessage[];
    tools: LlmToolDef[];
    onToolCall: (name: string, args: unknown) => Promise<unknown>;
    model: string;
    stream?: boolean;
  }): AsyncIterable<LlmEvent>;
}
```

`ClaudeProvider implements LlmProvider` using the Anthropic Messages API over
your existing `HttpModule`. The registry, prompts, and endpoint never import the
Anthropic SDK directly.

---

## 7. Model tiering + caching

- **Router / simple lookups:** Claude Haiku 4.5 (`claude-haiku-4-5`) — cheap, fast.
- **Real analysis / multi-tool reasoning:** Claude Sonnet 5 (`claude-sonnet-5`);
  escalate to Opus 4.8 only for genuinely hard synthesis.
- **Prompt caching:** system prompt + tool definitions are constant per vendor
  session → cache them so each turn only pays for the new tokens.
- Simple heuristic to start: first pass on Haiku decides whether the question
  needs deep analysis; escalate if so. (Can be a single Sonnet call at first —
  optimize later once you see real traffic.)

---

## 8. System prompt (guardrails baked in)

Key clauses:
- "You are a business analyst for **this one vendor's** store on Qlozet."
- "Use **only** numbers returned by tools. Never estimate, extrapolate, or
  invent figures. If a tool has no data, say so."
- "Always state the **time period** and use **₦ (NGN)**."
- "You give **insight, not financial or legal advice**; add a light disclaimer
  when a vendor asks what they *should* do with money."
- "You cannot take actions or change anything. If asked, explain how they can do
  it in the dashboard."
- "Keep answers short and scannable; lead with the number, then the 'so what'."

---

## 9. Conversation state

- Store `Conversation` + `Message` docs keyed by `businessId` + `conversation_id`.
- Send the last N turns as context (trim old turns; rely on tool re-fetch for
  fresh numbers rather than trusting stale numbers in history).
- Never persist tool payloads containing PII beyond what's needed; store the
  rendered answer + which tools ran (for auditing accuracy).

---

## 10. Visual answers (Phase 2 preview)

The assistant can emit a `chart_specs` array alongside text:
`{ type: 'bar'|'line'|'pie', title, series }`. The vendor app renders these with
the **existing recharts components** — same look as the dashboard. No
Claude-generated HTML needed for the embedded surface. (Reserve HTML/PDF
"artifacts" for downloadable reports later.)

---

## 11. Proactive digest (Phase 3 preview)

Same tools, no user prompt. A cron builds a weekly per-vendor summary
("Sales +12% WoW, Lagos leading, 3 SKUs low on stock") and delivers it in-app /
push. This is the feature that reaches vendors who'd never open a chat box —
arguably the highest-ROI phase, but it depends on Phase 1's tools existing.

---

## 12. Guardrails & failure modes

| Risk | Mitigation |
|---|---|
| Cross-tenant leak | `businessId` server-side only; injected, never a tool param; integration test |
| Hallucinated numbers | tools-only rule in system prompt; every figure traceable to a tool result |
| Runaway cost | turn cap, model tiering, prompt caching, response length cap, per-vendor rate limit |
| Empty/new vendor | tools return explicit "no data"; assistant says so instead of guessing |
| Prompt injection via data | tool outputs are data, not instructions; system prompt says treat tool text as data |
| Latency | stream tokens; cache tool results within a turn; Haiku for simple asks |
| Liability | insight-not-advice framing + disclaimer on "what should I do with my money" |

---

## 13. Cost sketch (to refine with real numbers)

- Dominant cost = tokens per conversation × conversations/vendor/month × active vendors.
- Prompt caching + Haiku routing are the two biggest levers.
- Action item before build: estimate avg tokens/turn and expected usage to get a
  monthly figure. (Separate estimate deliverable.)

---

## 14. Rollout

1. **Phase 1 — Text analyst.** Provider wrapper + 6–9 scoped tools + chat
   endpoint + system prompt. Text answers only. Ship to a pilot group of
   higher-volume vendors.
2. **Phase 2 — Visual answers.** `chart_specs` rendered natively in the app.
3. **Phase 3 — Proactive digest.** Weekly cron summary + downloadable report
   artifacts.

Gate each phase on real engagement from the prior one. Hold the read-only line
until the analyst has earned trust; only then consider action-taking (which
needs a whole separate confirmation/audit design).

---

## 15. Metering & monetization

The platform already has a token economy the assistant plugs straight into —
`TokenService.spend()` already defines an **`ai_ask`** type with an admin-tunable
`ai_ask_token_price`, plus a spend-then-refund-on-failure pattern and atomic
insufficient-balance guards. Vendors already pay tokens for bespoke-studio AI
(edit/outfit/analyze/prediction), so "AI features cost tokens" is an understood
concept — not a new one to teach.

**Economics:**
- 1 token ≈ **$0.01** to buy (`getTokenPurchasePrice`, `pricePerTokenUsd`).
- A conversation costs ≈ **$0.02–0.04** in Claude API.
- Charging **~3–5 tokens per query** roughly covers or slightly beats cost;
  `ai_ask_token_price` tunes it without a deploy.

**Recommended shape — fair-use cost recovery, NOT a hard paywall:**
1. **Free daily allowance, then tokens.** First N queries/day free; spend
   `ai_ask` tokens beyond that. Caps abuse/cost without nickel-and-diming casual use.
2. **Proactive weekly digest stays free.** It's the engagement hook and it's
   cheap (~$0.025/vendor/week); don't charge for unsolicited insight.
3. **Price to cover cost, not profit.** The assistant is a retention/GMV lever
   (informed vendor → sells more → more commission). Recoup API spend only.
4. **Spend-then-refund.** Charge on submit via `spend('ai_ask', businessId)`;
   refund on error via `refund('ai_ask', businessId)` — same pattern as
   generation jobs, so a failed answer never burns a vendor's tokens.
5. **Depth-based pricing later (optional).** `amountOverride` allows a deep
   multi-tool analysis to cost more than a one-tool lookup. Skip in v1 (flat
   price); add only if usage data justifies it.

**Wiring:** ~1 day — call `spend('ai_ask', businessId)` before the tool loop
(after the free-allowance check), `refund(...)` in the catch. No new subsystem.

**Metering decisions to settle:** free-allowance size (per day? per week?),
flat price per query, and whether the allowance resets daily or is a monthly pool.

---

## 16. Open decisions before building

1. Pilot cohort — which vendors get it first (volume threshold?).
2. Surface — chat panel only, or chat + weekly digest from the start?
3. Data window — is the controlled `period` enum enough, or do vendors need
   custom date ranges in Phase 1?
4. Retention — how long to keep conversation history.
5. Escalation policy — start single-model (Sonnet) for simplicity, or wire the
   Haiku→Sonnet router on day one?
