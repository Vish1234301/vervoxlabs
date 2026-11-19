# VerVox Cards

A responsive, single-page card storefront with 100 generic card slots.

## Run it

Open `index.html` in a browser, or publish the repository with GitHub Pages.

## Store behavior

- Individual cards are $0.50; card packs are $1.50.
- Visitors can add cards or packs to a cart and enter shipping details.
- The static demo prepares an order email to `vishaagpartha@gmail.com` in the visitor's default email app. The visitor must review and send it. It does not charge customers, send email automatically, or store orders.
- For automatic order notifications or payment, connect a secure backend/serverless function and use server-side environment secrets. Never put API keys in `index.html`.
- Replace the generated artwork in each card slot with supplied card images when ready.
