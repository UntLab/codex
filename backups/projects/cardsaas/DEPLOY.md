# CardSaaS deployment guide

## Current deployment status

- The application itself can be deployed now under one production domain, for example `cards.example.com`.
- The standard public flows already build successfully: landing page, login, register, dashboard shell.
- Uploads, email, and lead webhooks depend on external providers and must be configured before those features are considered production-ready.
- Billing can run in `manual` mode while Stripe remains disabled.

## Important limitation

The current codebase does **not** fully implement production-grade per-card custom domains yet.

What exists today:
- saving `customDomain` to the database
- returning DNS instructions from the API

What is still missing:
- domain ownership verification flow
- host-based card lookup and routing by incoming domain
- full DNS verification lifecycle

That means:
- you can publish the whole CardSaaS app on your own domain now
- you should not promise end users that their individual card domains are production-ready yet

## Recommended first production target

Publish the app under a single domain first:

- `cards.yourdomain.com`
- or `app.yourdomain.com`

After that, finish and harden the per-card custom domain feature.

## Required infrastructure

### 1. Vercel project

Recommended for this repository because it is a Next.js application.

Connect:
- GitHub repository: `UntLab/cardsaas`
- production branch: `main`

### 2. PostgreSQL database

Recommended path:
- Supabase PostgreSQL

You need:
- pooled runtime connection for `DATABASE_URL`
- direct connection reserved in `DIRECT_URL`

### 3. Authentication secret

Generate a strong random value for:
- `AUTH_SECRET`

### 4. Production app URL

Set these to the same final app URL:
- `NEXT_PUBLIC_APP_URL`
- `AUTH_URL`
- `NEXTAUTH_URL`

Example:

```env
NEXT_PUBLIC_APP_URL=https://cards.example.com
AUTH_URL=https://cards.example.com
NEXTAUTH_URL=https://cards.example.com
```

## Optional but important integrations

### Stripe

Needed for:
- subscription checkout
- billing portal
- subscription activation and blocking

Required variables:
- `STRIPE_SECRET_KEY`
- `STRIPE_PRICE_ID`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PUBLISHABLE_KEY`

Webhook endpoint:

```text
https://cards.example.com/api/stripe/webhook
```

### Manual billing mode

If you are not using Stripe yet, set:

- `NEXT_PUBLIC_BILLING_MODE=manual`
- `BILLING_MODE=manual`

In this mode:
- new cards start in a `pending` state
- admins can move cards between `pending`, `active`, and `paused`
- checkout and portal endpoints return a manual-activation response
- the dashboard stops showing trial messaging

Add at least one admin email:

- `ADMIN_EMAILS=owner@example.com,admin@example.com`

### Cloudinary

Needed for:
- avatar and image uploads

Use either:
- `CLOUDINARY_URL`

or:
- `CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`

### Resend

Needed for:
- lead notification emails

Required variables:
- `RESEND_API_KEY`
- `FROM_EMAIL`

## Deployment sequence

1. Create and configure the production Supabase project.
2. Set all required environment variables in Vercel.
3. Run production migrations against the target database:

```bash
npx prisma migrate deploy
```

4. Trigger the first production deployment.
5. Attach the app domain in Vercel and point DNS to Vercel.
6. Configure Stripe webhook if billing is enabled.
7. Configure Cloudinary if avatar uploads are enabled.
8. Configure Resend if email notifications are enabled.

## DNS for the main app domain

For a subdomain like `cards.example.com`, Vercel usually uses:
- a CNAME from your subdomain to the target Vercel provides

Do this in the Vercel project domain settings and follow the exact DNS target shown there.

## Minimal smoke test after deploy

Check these in the browser:

1. Home page opens on the production domain.
2. Register page opens.
3. New user registration works.
4. Login works.
5. Dashboard opens after login.
6. Card creation works.
7. Public card page opens by slug.

If billing is enabled, also test:

1. Stripe checkout session creation.
2. Stripe webhook delivery.
3. Billing portal open flow.

If uploads are enabled, also test:

1. Avatar upload from the card editor.

If lead capture is enabled, also test:

1. Lead form submission on a public card.
2. Lead appears in dashboard.
3. Email notification arrives if Resend is configured.
4. Webhook delivery works if `webhookUrl` is set on the card.

## Current technical notes

- Node version for this project is pinned to `22.x`.
- `.env.example` now documents the required runtime variables.
- `dotenv` is declared directly because it is imported by `prisma.config.ts`.

## Recommended next engineering step

Before announcing the product publicly, finish the custom-domain architecture properly:

- domain verification
- host-based routing
- domain activation and failure states
- end-to-end testing for domain onboarding
