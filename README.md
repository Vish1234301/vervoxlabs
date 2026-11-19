# VerVox Cards

A responsive, single-page card storefront with 100 placeholder card slots across the Ractors, Snakow, and Jellsun collections.

## Run it

Open `index.html` in a browser, or publish the repository with GitHub Pages.

## Store behavior

- Individual cards are $0.50; card packs are $1.50.
- Visitors can search/filter cards, add singles or packs to a cart, and enter shipping details.
- **The current static demo prepares an email** to `vishaagpartha@gmail.com` with the customer's order and shipping address using the visitor's default email app. The visitor must review and send it. It does not charge customers, send email automatically, or store orders.
- To send order notifications automatically, connect a secure backend/serverless function and an email provider such as Resend. Store the API key as a server-side environment secret—never in `index.html`—and add a real payment/shipping workflow before accepting live orders.
- Replace the generated artwork in each slot with supplied card images when ready.
