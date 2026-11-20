# VerVox Cards

A static storefront for the VerVox character card collection. Individual cards are $0.50 each. The browser-only demo stores stock locally and prepares an order email; it does not process payments or provide shared/server-side inventory.

## Cloudflare Worker notifications

See [WORKER_SETUP.md](WORKER_SETUP.md) for the Resend-backed Worker, Supabase notification-event tracking, Stripe payment webhook requirements, registration webhook contract, Cloudflare Workers Builds deployment, and testing instructions.

The Worker has no D1 dependency and uses Supabase only for notification tracking. The existing `cards`, `profiles`, `orders`, and `order_items` tables are not modified or connected to this notification-only Worker. Email is not confirmed or active until Worker secrets and sender verification are configured, Stripe and registration sources are connected, deployment succeeds, and end-to-end tests pass.
