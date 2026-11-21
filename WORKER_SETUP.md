# VerVoxLabs Cloudflare Worker + Supabase + Resend + Stripe Checkout

The Cloudflare Worker provides Stripe Checkout creation and paid-order email notifications. Resend sends order notifications to `vishaagpartha@gmail.com`. Supabase is used only for idempotent notification tracking. The Stripe secret, Resend key, webhook signing secret, and Supabase service-role key must be Cloudflare Worker secrets; never put them in website HTML or GitHub.

Email is **not active until the Worker is deployed and all provider configuration and test steps below are complete**. The GitHub Pages storefront and Worker are separate services.

## Routes

- `POST /checkout`: validates the cart against the server-side VerVox catalog and creates a Stripe Checkout Session. Prices are fixed server-side at **$0.50 per card**; browser-submitted prices are never trusted. Customer shipping data and order number are attached to Checkout Session metadata.
- `POST /webhooks/stripe`: verifies Stripe's webhook signature, checks the session is paid, retrieves line items from Stripe, and emails the order number, customer, shipping address, purchased cards, quantities, prices, total, and UTC payment time.
- `GET /health`: deployment health check.
- `POST /webhooks/registration`: existing signed registration notification endpoint.

Paid-order notifications use Supabase RPCs `claim_notification_event`, `complete_notification_event`, and `release_notification_event`, keyed by Checkout Session ID, to suppress duplicate emails on webhook retries.

## Deployment — complete these steps

1. **Verify Supabase setup.** The existing Supabase project must have the `notification_events` table and the RPC functions `claim_notification_event`, `complete_notification_event`, and `release_notification_event`. The Worker uses the service-role key only server-side.
2. **Deploy the Worker.** In Cloudflare Workers & Pages, connect `Vish1234301/vervoxlabs`, branch `main`, root directory `/`, and deploy with `npx wrangler deploy` (or use the Cloudflare dashboard's Workers Builds configuration). The Worker name in `wrangler.toml` is `vervoxlabs`.
3. **Configure Worker secrets/variables.** Add `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY` as Worker secrets. Set `SUPABASE_URL` to the Supabase project URL. Set `EMAIL_FROM` to a sender address on a domain verified with Resend; replace the example in `wrangler.toml` if deploying that variable from the file. Never commit secret values.
4. **Set the checkout API URL in the storefront.** In `index.html`, replace `YOUR_CLOUDFLARE_SUBDOMAIN` in `CHECKOUT_API` with the actual Cloudflare `workers.dev` subdomain or custom Worker domain. For example, `https://vervoxlabs.example.workers.dev/checkout`. Commit and let GitHub Pages deploy the updated site. The Worker allows browser requests from `https://vish1234301.github.io`.
5. **Configure Stripe webhook.** In Stripe's Developers → Webhooks, add `https://<your-worker-domain>/webhooks/stripe` and subscribe to `checkout.session.completed` and `checkout.session.async_payment_succeeded`. Copy that endpoint's signing secret to the Worker secret `STRIPE_WEBHOOK_SECRET`. Use `STRIPE_SECRET_KEY` from the same Stripe mode (test or live).
6. **Enable Resend delivery.** Verify the sender domain in Resend, set `EMAIL_FROM` to its verified sender, and configure `RESEND_API_KEY`. Notifications currently go to `vishaagpartha@gmail.com`; change `ADMIN_EMAIL` in `worker/index.js` if notifications should go elsewhere, then redeploy.
7. **Test before going live.** Visit `https://<your-worker-domain>/health`, use Stripe test-mode keys and a test payment, and confirm the email includes order and shipping details. Confirm the Stripe webhook succeeds and repeat delivery to verify duplicate suppression. Switch both Stripe secret and webhook endpoint to live mode only after testing.

## Important limitations

- The storefront's displayed stock is only browser-local demo data. It is not shared inventory and does not reserve stock. Do not rely on it to prevent overselling.
- Checkout charges $0.50 per card and currently adds no shipping fee or tax. Configure Stripe tax and shipping charges if needed before live sales.
- Customer address is collected by this storefront and stored in Stripe Checkout Session metadata so it can be included in the paid-order email. Restrict access to Stripe and email data appropriately.
- No provider credentials are included in this repository. A successful code commit does not itself deploy services or prove email delivery.
