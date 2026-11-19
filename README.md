# VerVox Cards

A static storefront for the VerVox character card collection. Individual cards are $0.50 each. The browser-only demo stores stock locally and prepares an order email; it does not process payments or provide shared/server-side inventory.

## Run the storefront

Open `index.html` in a browser, or publish the repository with GitHub Pages.

## Cloudflare Worker email notifications

See [WORKER_SETUP.md](WORKER_SETUP.md) for the Resend-backed Cloudflare Worker, D1 deduplication, Stripe payment webhook requirements, registration webhook contract, Cloudflare Workers Builds setup, and testing instructions.

Email sending is not active until Cloudflare secrets and D1 are configured, Resend sender verification is complete, the Stripe and registration systems are connected, and end-to-end tests pass. The current storefront does not contain a registration flow or Stripe checkout integration.
