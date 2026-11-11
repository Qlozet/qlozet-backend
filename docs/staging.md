# Staging

A copy of Qlozet to try changes on before they reach customers.

```
feature branch → merge to `staging` → click through on staging → merge to `main` → live
```

| Piece | Production | Staging |
|---|---|---|
| Backend | `qlozet-backend` (Fly, from `main`) | `qlozet-backend-staging` (Fly, from `staging`) — `fly.staging.toml` |
| Database | production Atlas | **its own** Atlas database — never production's |
| Redis (job queue, live chat) | production Redis | **its own** Redis |
| Shop / vendor / admin | Vercel production deploys | Vercel **preview** deploys, pointed at the staging backend |
| Payments, identity | live keys | **test / sandbox** keys |
| Couriers | live | `SHIPBUBBLE_DRY_RUN=true` (set in `fly.staging.toml`) |
| Phone push | Firebase | off (no Firebase secrets) |
| Assistant | keyless (workload identity, production app only) | off, unless you add an `ANTHROPIC_API_KEY` |

Staging sleeps when nobody is using it, so scheduled jobs (payout releases,
reminders, auto-reject) only run while it's awake. See the note in
`fly.staging.toml` to keep it always on while testing one of those.

---

## One-time setup

### 1. Create the Fly app and its Redis

```sh
fly apps create qlozet-backend-staging
fly redis create            # name it qlozet-staging-redis, region lhr, free plan
```

`fly redis create` prints a `redis://…` URL: that is staging's `REDIS_URL`.
The job queue checks Redis often; if the free plan's daily limit is reached
(the dashboard shows it), switch that Redis to pay-as-you-go — cents a month at
staging's use.

### 2. Create the staging database

In MongoDB Atlas, create a **separate free (M0) cluster** in AWS eu-west-1
(Ireland), with its own database user. A separate cluster means a staging
mistake can't reach production data even if a setting is copied wrongly.
Allow access from anywhere (`0.0.0.0/0`) — Fly machines don't have fixed
addresses — and keep the password strong.

The connection string is staging's `MONGO_URI`. It starts empty; sign up on
the staging shop and vendor sites to create test accounts.

To make yourself an admin on staging, do it the same way as on production,
but against the staging database.

### 3. Set the secrets

`fly secrets set -a qlozet-backend-staging NAME=value …` — or paste them in the
Fly dashboard under the staging app → Secrets.

**Must be different from production:**

| Secret | Staging value |
|---|---|
| `MONGO_URI` | the staging cluster from step 2 |
| `REDIS_URL` | the staging Redis from step 1 |
| `ACCESS_SECRET`, `REFRESH_SECRET`, `JWT_SECRET` | new random values (`openssl rand -hex 32` each), so a production sign-in never works on staging or the other way round |
| `PAYSTACK_SECRET_KEY` **and** `PAYSTACK_SECRET` | Paystack **test** secret key (`sk_test_…`) — both names, the webhook check reads the second |
| `FLW_SECRET_KEY`, `FLW_SECRET_HASH` | Flutterwave **test mode** secret key, and a webhook hash you choose (enter the same in the dashboard) |
| `QOREID_BASE_URL`, `QOREID_CLIENT_ID`, `QOREID_SECRET`, `QOREID_WORKFLOW_ID`, `QOREID_WEBHOOK_SECRET` | QoreID **sandbox** values |
| `SHIPBUBBLE_API_KEY`, `SHIPBUBBLE_WEBHOOK_SECRET` | Shipbubble sandbox key if you have one; with dry run on, real bookings never happen either way |
| `FRONTEND_URL`, `VENDOR_FRONTEND_URL`, `ADMIN_FRONTEND_URL` | the staging addresses of the shop, vendor and admin sites (step 5) — used for links in emails and payment returns |

**Can be the same as production:**

| Secret | Note |
|---|---|
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Same is fine (staging uploads land in the same folders). A free second Cloudinary account keeps them apart if you prefer. |
| `OPENAI_API_KEY` | Same, or a separate project key with a monthly limit so testing can't run up a bill. |
| `HUGGING_FACE_TOKEN` | Same (measurement and image-editor Spaces). |
| `MAIL_HOST`, `MAIL_PORT`, `MAIL_USERNAME`, `MAIL_PASSWORD`, `MAIL_SENDER` | Same. Staging only emails its own test accounts. |
| `GOOGLE_CLIENT_ID` | Same — add the staging site addresses to the OAuth client's allowed origins in Google Cloud. |
| `RATE_API_KEY`, `COMPANY_NAME`, `COMPANY_ADDRESS`, `COMPANY_LOGO_URL`, `SUPPORT_EMAIL`, `SERVICE_CODE`, `ZOHO_*` | Same. |

**Leave unset on staging:** `FIREBASE_*` (push off), `ANTHROPIC_API_KEY` (add
one only to test the assistant), `STRIPE_*` (or test keys when testing Stripe),
`ZEPTOMAIL_WEBHOOK_*`.

Already set by `fly.staging.toml`, don't add as secrets: `PORT`, `NODE_ENV`,
`SHIPBUBBLE_DRY_RUN`, `ASSISTANT_DIGEST_ENABLED`.

### 4. Let GitHub deploy it

```sh
fly tokens create deploy -a qlozet-backend-staging
```

Add the printed token in GitHub → this repo → Settings → Secrets and
variables → Actions → **New repository secret** named
`FLY_API_TOKEN_STAGING`. It can only deploy the staging app.

Then, **once the commit that adds this file has been merged to `main`** (the
`staging` branch needs `fly.staging.toml` and the staging workflow in it),
create the branch and push it — that runs the first deploy:

```sh
git checkout -b staging origin/main
git push -u origin staging
```

The backend is then at `https://qlozet-backend-staging.fly.dev/api`.

### 5. Point the web apps' preview deploys at staging

In Vercel, for **each** project (shop, vendor, admin) → Settings →
Environment Variables, add the variable with the staging value and tick
**Preview only** (leave Production as it is):

| Project | Variable | Preview value |
|---|---|---|
| Shop | `NEXT_PUBLIC_API_URL` | `https://qlozet-backend-staging.fly.dev/api` |
| Vendor | `NEXT_PUBLIC_BASE_URL` | `https://qlozet-backend-staging.fly.dev/api` |
| Admin | `NEXT_PUBLIC_BASE_URL` | `https://qlozet-backend-staging.fly.dev/api` |
| Vendor | `NEXT_PUBLIC_SHOP_URL` | the shop's staging address |
| Shop | `NEXT_PUBLIC_VENDOR_URL` | the vendor site's staging address |

Every branch except the production one then builds a preview that talks to
staging. For a fixed address, give each project's `staging` branch a domain
(Settings → Domains → add e.g. `staging.shop.qlozet.app` and assign it to
the `staging` branch); otherwise use the preview link Vercel posts.

Use those addresses for `FRONTEND_URL`, `VENDOR_FRONTEND_URL` and
`ADMIN_FRONTEND_URL` in step 3.

### 6. Webhooks (test dashboards)

Point each provider's **test / sandbox** webhook at staging (their live
settings stay on production):

| Provider | Test webhook URL |
|---|---|
| Paystack (test mode) | `https://qlozet-backend-staging.fly.dev/api/webhook/paystack` |
| Flutterwave (test mode) | `https://qlozet-backend-staging.fly.dev/api/webhook/flutterwave` |
| QoreID (sandbox) | `https://qlozet-backend-staging.fly.dev/api/webhook/qoreid` |
| Shipbubble (sandbox) | `https://qlozet-backend-staging.fly.dev/api/webhook/shipbubble` |

---

## Day to day

- **Try a backend change:** merge its branch into `staging` and push. GitHub runs
  the flow tests and deploys (Actions → "Fly Deploy (staging)").
- **Try a web change:** push the branch; Vercel's preview for it uses staging.
- **Pay on staging** with Paystack's test cards (e.g. `4084 0840 8408 4081`,
  any future expiry, CVV `408`, PIN `0000`, OTP `123456`).
- **Ship:** merge the same branch into `main` as before.
- `staging` drifts from `main` over time; reset it now and then:
  `git checkout staging && git reset --hard origin/main && git push --force-with-lease`.

## Never

- Point staging at production's `MONGO_URI` or `REDIS_URL`.
- Put live Paystack, Flutterwave or QoreID keys on staging.
- Run more than one staging machine (the scheduled jobs have no lock).
