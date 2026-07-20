# Qlozet Backend

REST API for **Qlozet**, a multi-vendor fashion & tailoring marketplace. Built with **NestJS 11** and **MongoDB (Mongoose)**, with Paystack payments, Shipbubble shipping, and an OpenAI-powered recommendation engine.

## Stack

- **Framework:** NestJS 11 (TypeScript 5.7), Swagger, Helmet, throttling
- **Database:** MongoDB via `@nestjs/mongoose`
- **Payments:** Paystack (checkout, transfers, vendor payouts)
- **Shipping:** Shipbubble (address validation, rates, labels) — per-vendor split shipping
- **Background jobs:** BullMQ + Redis queues, `@nestjs/schedule` cron, `@nestjs/event-emitter`
- **AI:** OpenAI (embeddings, NL search, image generation), HuggingFace/Gradio (body measurement)
- **Media / Mail:** Cloudinary, Handlebars/MJML mailer
- **Deploy:** Fly.io (`fly.toml`, `Dockerfile`)

## Getting started

```bash
npm install
cp .env.example .env   # then fill in the values (see Environment below)
npm run start:dev      # watch mode on http://localhost:5000
```

API is served under the `/api` prefix. Swagger docs are set up via `SetupSwagger` in `src/main.ts`.

## Scripts

| Command | Description |
|---|---|
| `npm run start:dev` | Start in watch mode |
| `npm run start:prod` | Run compiled build (`dist/src/main`) |
| `npm run build` | Nest build + copy mail templates into `dist` |
| `npm run test` | Unit tests (Jest) |
| `npm run test:e2e` | End-to-end tests |
| `npm run lint` | ESLint (with `--fix`) |
| `npm run seed:run` | Seed the database (also `seed:permissions`, `seed:roles`, `seed:users`, `seed:clear`) |

## Environment

Configuration is loaded from `.env` (global `ConfigModule`). Key variables:

```
# Core
PORT=5000
MONGODB_URI=
REDIS_URL=
ACCESS_SECRET=
REFRESH_SECRET=
FRONTEND_URL=
VENDOR_FRONTEND_URL=

# Payments (Paystack)
PAYSTACK_SECRET_KEY=

# Shipping (Shipbubble)
SHIPBUBBLE_BASE_URL=
SHIPBUBBLE_API_KEY=
SERVICE_CODE=
SHIPBUBBLE_DRY_RUN=false   # true = return mock labels, no real charges

# Mail
MAIL_HOST=
MAIL_PORT=587
MAIL_USERNAME=
MAIL_PASSWORD=
MAIL_SENDER=

# AI
OPENAI_API_KEY=
HUGGING_FACE_TOKEN=

# Media
CLOUDINARY_* (see cloudinary module)
```

## Architecture

Every route is protected by a global `JwtAuthGuard` + `ThrottlerGuard`; opt out with `@Public()`. A per-controller `RolesGuard` enforces `@Roles` / `@VendorRoles`. Responses are wrapped by a global `ResponseInterceptor`.

Users are typed `CUSTOMER | VENDOR | PLATFORM`. Vendors belong to `Business` accounts through `TeamMember` records (a user can belong to several businesses).

### Modules

| Area | Modules |
|---|---|
| Identity | `auth`, `ums` (users/roles/permissions/teams) |
| Catalog | `products`, `taxonomy`, `size-guide`, `measurement`, `style-library` |
| Commerce | `cart`, `orders`, `payment`, `transactions`, `wallets` |
| Fulfillment | `logistics` (Shipbubble), `business` (vendor accounts & earnings) |
| Tailoring | `bespoke`, `fabric-reservation` |
| Discovery | `recommendations` (OpenAI embeddings + feeds) |
| Support | `notifications`, `webhook`, `disputes`, `returns`, `ticket`, `waitlist`, `currency`, `platform`, `cloudinary` |

### Checkout & money flow

1. `POST /orders/checkout-preview` splits the cart by vendor and fetches Shipbubble rates **per vendor**, caching them server-side (`CheckoutRateCache`).
2. `POST /orders` re-validates the chosen shipping against the cache (client prices are never trusted) and creates a Paystack transaction.
3. Each vendor fulfills their own `VendorShipment` (`:reference/fulfill` → Shipbubble label). Order status is gated on all vendor shipments.
4. The Shipbubble webhook marks delivery and sets an earnings `release_date`; a cron releases matured vendor earnings, and Paystack transfers the payout.

### Webhooks (public)

- `POST /api/webhook/paystack` — payment success/failure reconciliation
- `POST /api/webhook/shipbubble` — shipment status → order completion & payout release

## Testing

```bash
npm run test        # unit
npm run test:e2e    # e2e
npm run test:cov    # coverage
```
