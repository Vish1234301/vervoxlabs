# VerVoxLabs Cloudflare Worker + Supabase + Resend

The Worker uses the existing Supabase project for notification-event tracking and Resend for administrator email notifications. It has no Cloudflare D1 binding or database dependency. This update does not modify the existing `cards`, `profiles`, `orders`, or `order_items` tables. The Worker service-role key and provider credentials must be configured as Cloudflare Worker secrets; none belong in this repository or frontend.

Email is **not confirmed working** until deployment secrets, a verified sender, Stripe configuration, the registration backend, and end-to-end tests are complete.

## Worker endpoints

- `POST /webhooks/stripe`: verifies Stripe's webhook signature, checks the Checkout Session is paid, retrieves purchased line items from Stripe using the server-side `STRIPE_SECRET_KEY`, then emails the order number, customer email, UTC date/time, card descriptions, quantities, unit prices, and total.
- `POST /webhooks/registration`: verifies a timestamped HMAC-signed event from the trusted signup backend and sends the customer email and signup date/time.
- Both routes use Supabase RPCs `claim_notification_event`, `complete_notification_event`, and `release_notification_event`. Stripe notifications are keyed by Checkout Session ID; Resend receives a stable idempotency key. This limits duplicate notifications on retries, although no distributed system can promise absolute exactly-once delivery if provider outcomes are ambiguous.

The current static storefront does not implement Stripe Checkout or customer signup. Configure the actual payment and signup services to call these webhook paths. The Worker does not currently use the existing store tables for inventory/accounts/orders; it is connected to Supabase only for notification tracking. The Stripe Checkout integration must provide order number in `metadata.order_number` or `client_reference_id`; otherwise the Checkout Session ID is used as the order number.

## Deployment — follow in order

1. **Verify Supabase setup.** The `notification_events` table and the three RPC functions must exist in the existing project. No D1 database is needed. The Worker sends RPC requests with the service-role key.
2. **Connect Workers Builds.** In Cloudflare, connect `Vish1234301/vervoxlabs` under Workers & Pages → Create → Connect to Git. Choose branch `main`, root directory `/`, and deploy command `npx wrangler@4 deploy`.
3. **Set the Supabase project URL.** In the Worker's production variables, set `SUPABASE_URL` to your project URL, such as `https://<project-ref>.supabase.co`.
4. **Add the Supabase service-role key as a secret.** Name it `SUPABASE_SERVICE_ROLE_KEY`. Never add it to GitHub, `wrangler.toml`, website HTML, browser JavaScript, or public build variables.
5. **Add email and webhook secrets.** Add `RESEND_API_KEY`, `STRIPE_WEBHOOK_SECRET`, and `REGISTRATION_WEBHOOK_SECRET` as Worker secrets. Set `EMAIL_FROM` as a Worker variable to an address on a domain verified with Resend.
6. **Add the Stripe API secret.** Set `STRIPE_SECRET_KEY` as a Worker secret. It is used only server-side to retrieve the verified paid Checkout Session's line items from Stripe.
7. **Configure Stripe webhooks.** Point Stripe at `https://<worker-domain>/webhooks/stripe`; subscribe to `checkout.session.completed` and `checkout.session.async_payment_succeeded`. Store that endpoint's signing secret in `STRIPE_WEBHOOK_SECRET`. Make the Checkout Session server-side, set its real price, and include `metadata.order_number` or `client_reference_id`.
8. **Connect successful registrations.** Have the trusted auth/signup backend POST `type`, unique `event_id`, `email`, optional `name`, and `created_at` (ISO timestamp) to `/webhooks/registration` only after account creation succeeds. Sign the exact raw JSON body with HMAC-SHA256 using `REGISTRATION_WEBHOOK_SECRET`; pass `X-Registration-Timestamp` (Unix seconds) and `X-Registration-Signature: sha256=<hex of HMAC(timestamp + '.' + raw body)>`. Do not sign or send this from frontend code.
9. **Deploy and test.** Check `/health`, then use Stripe test mode and a test signup to verify mail, content, retry behavior, and duplicate suppression. Repeat webhook deliveries and simulate a Resend failure. A successful health response alone does not verify email.

## Secret entry

Use Cloudflare Dashboard → Worker → Settings → Variables and Secrets, or run `npx wrangler secret put SECRET_NAME` for each secret. Enter secret values interactively, never as command-line literals, source code, or repository files. Store all production values in the production Worker environment; configure preview secrets separately if preview deployments need them.
