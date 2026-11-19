# VerVoxLabs Cloudflare Worker email integration

The existing storefront is a static GitHub Pages site. This Worker adds server-side notification endpoints, but sending is **not active until the deployment, D1 database, provider secrets, verified sender domain, Stripe webhook, and registration-source integration are configured and tested**. No Resend key is included in this repository.

## What the Worker does

- `POST /webhooks/stripe` accepts Stripe-signed webhook events and sends an order email only for a verified `checkout.session.completed` or `checkout.session.async_payment_succeeded` event whose Checkout Session has `payment_status: paid`.
- `POST /webhooks/registration` accepts a timestamped HMAC-signed `user.registered` event from a trusted registration system. The current static site has no registration/account flow, so you must connect your actual registration provider/backend to this endpoint after signup succeeds.
- Sends notifications to `vishaagpartha@gmail.com` using Resend from the Worker only.
- Uses a D1 unique event key (Stripe Checkout Session ID for orders) and Resend's idempotency header to suppress duplicate emails and make retries safe.
- Returns a retryable 503 when delivery fails. Stripe and the registration sender should retry non-2xx webhook responses.

This repository currently does not create Stripe Checkout Sessions, verify/charge payment on the storefront, or implement user accounts. The Worker can notify about successful Stripe payments only after a Stripe integration creates a Checkout Session and is configured to send its webhook. Do not treat the current browser-only cart as a completed/paid order.

## One-time setup

1. **Create the Cloudflare D1 database** in the same account that will host the Worker, or use Wrangler:
   ```sh
   npx wrangler@4 d1 create vervoxlabs-notifications
   ```
   Copy the returned database ID into `wrangler.toml`, replacing `REPLACE_WITH_D1_DATABASE_ID`. Confirm the database name matches `vervoxlabs-notifications`.

2. **Apply the schema** after setting the database ID:
   ```sh
   npx wrangler@4 d1 execute vervoxlabs-notifications --remote --file=worker/schema.sql
   ```

3. **Configure secrets** (never add values to Git):
   ```sh
   npx wrangler@4 secret put RESEND_API_KEY
   npx wrangler@4 secret put STRIPE_WEBHOOK_SECRET
   npx wrangler@4 secret put REGISTRATION_WEBHOOK_SECRET
   ```
   Use Resend's API key, Stripe's webhook signing secret for the production endpoint, and a long random secret shared only with your trusted registration backend. Cloudflare dashboard equivalents are Worker → Settings → Variables and Secrets → Add secret. `EMAIL_FROM` in `wrangler.toml` must be a sender address on a domain verified with Resend; replace the example domain before deployment.

4. **Connect this existing GitHub repository with Cloudflare Workers Builds**:
   - In Cloudflare, open **Workers & Pages → Create → Connect to Git** and select `Vish1234301/vervoxlabs`.
   - Set the production branch to `main` and root directory to `/` (repository root, where `wrangler.toml` lives).
   - Set the deploy/build command to `npx wrangler@4 deploy`. No static output directory is needed for the Worker.
   - Add the three secrets and `EMAIL_FROM` to the Worker’s production environment in Cloudflare. Add variables/secrets for preview environments separately if desired.
   - Ensure the D1 binding named `DB` exists and points to the database ID in `wrangler.toml`. The checked-in `wrangler.toml` declares this binding.

5. **Configure Stripe**: In Stripe Workbench/Webhooks, add `https://<your-worker-domain>/webhooks/stripe`, subscribe to `checkout.session.completed` and `checkout.session.async_payment_succeeded`, and put that endpoint's signing secret in `STRIPE_WEBHOOK_SECRET`. Verify your Stripe Checkout integration sets the real amount and payment mode on the server; never trust a price or “paid” flag from browser JavaScript.

6. **Connect registrations**: Configure the actual auth/signup backend to POST JSON only after it has successfully created the account:
   ```json
   {"event_id":"unique-registration-event-id","type":"user.registered","email":"customer@example.com","name":"Customer Name"}
   ```
   Include `X-Registration-Timestamp` (current Unix seconds) and `X-Registration-Signature` with value `sha256=<hex HMAC-SHA256>`, where the HMAC key is `REGISTRATION_WEBHOOK_SECRET` and the signed message is `<timestamp>.<exact raw request body>`. Generate signatures server-side; never expose the shared secret in the website. Use a stable unique event ID for retries.

## Test before relying on notifications

- Deploy, then `GET https://<your-worker-domain>/health` should return `{"status":"ok"}`. This does **not** test email sending.
- Send a Stripe test-mode Checkout Session through Stripe's signed webhook test flow and verify a single notification arrives at `vishaagpartha@gmail.com`; resend the same event and confirm it is not duplicated.
- Send a correctly signed test registration event from the trusted backend and verify a single email; repeat the same event ID and confirm it is not duplicated.
- Force a temporary Resend failure and verify the source retries the event, then verify delivery succeeds once.

**Email sending is not confirmed or active just because these files are committed.** It becomes operational only after secrets, database, sender verification, source integrations, deployment, and the end-to-end tests above are complete.
