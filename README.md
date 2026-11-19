# VerVox Cards

A responsive single-page storefront showing the Snakow collection as one listing with 33 cards available.

## Run it

Open `index.html` in a browser, or publish the repository with GitHub Pages.

## Store behavior

- Snakow single cards are $0.50 each; card packs are $1.50.
- Visitors can add singles or packs to a cart and enter shipping details.
- The static demo prepares an order email to `vishaagpartha@gmail.com` in the visitor's default email app. The visitor must review and send it. It does not charge customers, send email automatically, or store orders.
- For automatic order notifications or payment, connect a secure backend/serverless function and use server-side environment secrets. Never put API keys in `index.html`.
- The displayed 33-card inventory is based on the previous 100-slot collection split (33 Snakow slots). Update the inventory value and displayed count if the real stock differs.
