const ADMIN_EMAIL = "vishaagpartha@gmail.com";
const RESEND_URL = "https://api.resend.com/emails";
const STRIPE_API = "https://api.stripe.com/v1";
const SITE_URL = "https://vish1234301.github.io/vervoxlabs/";
const SITE_ORIGIN = "https://vish1234301.github.io";
const SIGNATURE_TOLERANCE_SECONDS = 300;
const encoder = new TextEncoder();
const ZERO_DECIMAL_CURRENCIES = new Set([
  "BIF", "CLP", "DJF", "GNF", "ISK", "JPY", "KMF", "KRW", "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF",
]);
const PRODUCTS = new Map([
  ["ractors", "Ractors"],
  ["snakow", "Snakow"],
  ["jellsun", "Jellsun"],
  ["fatue", "Fatue"],
]);
const CARD_PRICE_CENTS = 50;

function json(data, status = 200) {
  return new Response(status === 204 ? null : JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": SITE_ORIGIN,
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "Content-Type",
      "vary": "Origin",
    },
  });
}

function hexToBytes(hex) {
  if (typeof hex !== "string" || !/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) return null;
  return new Uint8Array(hex.match(/.{2}/g).map((byte) => Number.parseInt(byte, 16)));
}

function constantTimeEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function verifyStripeSignature(rawBody, header, secret) {
  if (!header || !secret) return false;
  const fields = header.split(",").map((part) => part.split("=", 2));
  const timestamp = fields.find(([key]) => key === "t")?.[1];
  const signatures = fields.filter(([key]) => key === "v1").map(([, value]) => value);
  const timestampNumber = Number(timestamp);
  if (!Number.isInteger(timestampNumber) || Math.abs(Date.now() / 1000 - timestampNumber) > SIGNATURE_TOLERANCE_SECONDS) return false;
  const expected = hexToBytes(await hmacHex(secret, `${timestamp}.${rawBody}`));
  return signatures.some((signature) => constantTimeEqual(expected, hexToBytes(signature)));
}

async function verifyRegistrationSignature(rawBody, timestamp, signature, secret) {
  const timestampNumber = Number(timestamp);
  if (!secret || !timestamp || !signature || !Number.isInteger(timestampNumber) ||
      Math.abs(Date.now() / 1000 - timestampNumber) > SIGNATURE_TOLERANCE_SECONDS) return false;
  const supplied = signature.replace(/^sha256=/, "");
  const expected = hexToBytes(await hmacHex(secret, `${timestamp}.${rawBody}`));
  return constantTimeEqual(expected, hexToBytes(supplied));
}

async function stableIdempotencyKey(eventKey) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(eventKey)));
  const hex = [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `vervox-${hex}`;
}

function formatDateTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "Unavailable";
  return `${date.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC")}`;
}

function formatStripeAmount(minorAmount, currency) {
  if (!Number.isFinite(Number(minorAmount)) || typeof currency !== "string") return "Unavailable";
  const normalizedCurrency = currency.toUpperCase();
  let digits = ZERO_DECIMAL_CURRENCIES.has(normalizedCurrency) ? 0 : 2;
  try {
    digits = new Intl.NumberFormat("en-US", { style: "currency", currency: normalizedCurrency }).resolvedOptions().maximumFractionDigits;
    return new Intl.NumberFormat("en-US", { style: "currency", currency: normalizedCurrency }).format(Number(minorAmount) / (10 ** digits));
  } catch {
    return `${(Number(minorAmount) / (10 ** digits)).toFixed(digits)} ${normalizedCurrency}`;
  }
}

async function supabaseRpc(env, functionName, parameters) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Supabase is not configured");
  const base = env.SUPABASE_URL.replace(/\/+$/, "");
  const response = await fetch(`${base}/rest/v1/rpc/${functionName}`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(parameters),
  });
  if (!response.ok) throw new Error(`Supabase request failed (${response.status})`);
  return response.json();
}

async function sendEmail(env, eventKey, subject, text) {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) throw new Error("Email service is not configured");
  const response = await fetch(RESEND_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      "content-type": "application/json",
      "Idempotency-Key": await stableIdempotencyKey(eventKey),
    },
    body: JSON.stringify({ from: env.EMAIL_FROM, to: [ADMIN_EMAIL], subject, text }),
  });
  if (!response.ok) throw new Error(`Resend request failed (${response.status})`);
}

async function deliverOnce(env, eventKey, eventType, subject, text) {
  const claimToken = crypto.randomUUID();
  let claim;
  try {
    claim = await supabaseRpc(env, "claim_notification_event", {
      p_event_key: eventKey,
      p_event_type: eventType,
      p_claim_token: claimToken,
    });
  } catch {
    return json({ error: "Notification tracking is unavailable" }, 503);
  }
  if (claim === "sent") return json({ received: true, duplicate: true });
  if (claim !== "claimed") return json({ error: "Notification is already being processed; retry later" }, 503);

  try {
    await sendEmail(env, eventKey, subject, text);
    await supabaseRpc(env, "complete_notification_event", {
      p_event_key: eventKey,
      p_claim_token: claimToken,
    });
    return json({ received: true, sent: true });
  } catch {
    try {
      await supabaseRpc(env, "release_notification_event", {
        p_event_key: eventKey,
        p_claim_token: claimToken,
        p_error: "Delivery failed; safe to retry",
      });
    } catch { /* Leave the claim to expire so a retry can safely claim it. */ }
    return json({ error: "Notification delivery failed; retry the event" }, 503);
  }
}

async function createCheckout(request, env) {
  if (!env.STRIPE_SECRET_KEY) return json({ error: "Checkout is not configured yet." }, 503);
  let order;
  try { order = await request.json(); } catch { return json({ error: "Invalid order." }, 400); }
  if (!order || typeof order !== "object" || !Array.isArray(order.items) || order.items.length < 1 || order.items.length > PRODUCTS.size) {
    return json({ error: "Your cart is empty or invalid." }, 400);
  }
  const email = typeof order.email === "string" ? order.email.trim() : "";
  const name = typeof order.name === "string" ? order.name.trim() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || !name || name.length > 200) {
    return json({ error: "Enter a valid name and email address." }, 400);
  }
  const addressFields = ["address", "city", "region", "postal", "country"];
  const shipping = {};
  for (const field of addressFields) {
    const value = typeof order[field] === "string" ? order[field].trim() : "";
    if (!value || value.length > 200) return json({ error: "Complete all shipping address fields." }, 400);
    shipping[field] = value;
  }
  const quantities = new Map();
  for (const item of order.items) {
    if (!item || !PRODUCTS.has(item.id) || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 20 || quantities.has(item.id)) {
      return json({ error: "One or more cart items are invalid." }, 400);
    }
    quantities.set(item.id, item.quantity);
  }

  const orderNumber = `VV-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const params = new URLSearchParams({
    mode: "payment",
    customer_email: email,
    client_reference_id: orderNumber,
    success_url: `${env.STOREFRONT_URL || SITE_URL}?checkout=success`,
    cancel_url: `${env.STOREFRONT_URL || SITE_URL}?checkout=cancel`,
    "metadata[store]": "vervoxlabs",
    "metadata[order_number]": orderNumber,
    "metadata[customer_name]": name,
    "metadata[shipping_address]": shipping.address,
    "metadata[shipping_city]": shipping.city,
    "metadata[shipping_region]": shipping.region,
    "metadata[shipping_postal]": shipping.postal,
    "metadata[shipping_country]": shipping.country,
  });
  let index = 0;
  for (const [id, quantity] of quantities) {
    params.set(`line_items[${index}][quantity]`, String(quantity));
    params.set(`line_items[${index}][price_data][currency]`, "usd");
    params.set(`line_items[${index}][price_data][unit_amount]`, String(CARD_PRICE_CENTS));
    params.set(`line_items[${index}][price_data][product_data][name]`, `VerVox ${PRODUCTS.get(id)} character card`);
    index++;
  }
  let response;
  try {
    response = await fetch(`${STRIPE_API}/checkout/sessions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        "content-type": "application/x-www-form-urlencoded",
        "Idempotency-Key": `checkout-${orderNumber}`,
      },
      body: params,
    });
  } catch {
    return json({ error: "Could not reach Stripe. Please try again." }, 502);
  }
  const session = await response.json().catch(() => ({}));
  if (!response.ok || typeof session.url !== "string") {
    return json({ error: "Stripe could not start checkout. Please try again." }, 502);
  }
  return json({ url: session.url });
}

async function fetchStripeLineItems(env, sessionId) {
  if (!env.STRIPE_SECRET_KEY) throw new Error("Stripe API is not configured");
  const items = [];
  let startingAfter;
  do {
    const url = new URL(`${STRIPE_API}/checkout/sessions/${encodeURIComponent(sessionId)}/line_items`);
    url.searchParams.set("limit", "100");
    if (startingAfter) url.searchParams.set("starting_after", startingAfter);
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
    });
    if (!response.ok) throw new Error(`Stripe line-item lookup failed (${response.status})`);
    const page = await response.json();
    if (!Array.isArray(page.data)) throw new Error("Stripe returned invalid line items");
    items.push(...page.data);
    if (items.length > 1000) throw new Error("Stripe order has too many line items");
    startingAfter = page.has_more ? page.data.at(-1)?.id : null;
    if (page.has_more && !startingAfter) throw new Error("Stripe pagination failed");
  } while (startingAfter);
  return items;
}

function formatOrderItems(items) {
  if (!items.length) throw new Error("Paid Stripe session has no line items");
  return items.map((item) => {
    const quantity = Number(item.quantity);
    if (!Number.isInteger(quantity) || quantity < 1) throw new Error("Invalid Stripe line-item quantity");
    const currency = item.currency || item.price?.currency || "usd";
    const rawUnitAmount = item.price?.unit_amount_decimal ?? item.price?.unit_amount;
    const unitMinor = rawUnitAmount != null ? Number(rawUnitAmount) : Number(item.amount_subtotal) / quantity;
    const description = String(item.description || item.price?.nickname || item.price?.product || "VerVox card").slice(0, 200);
    return `- ${description} | Quantity: ${quantity} | Unit price: ${formatStripeAmount(unitMinor, currency)} | Line subtotal: ${formatStripeAmount(item.amount_subtotal, currency)}`;
  }).join("\n");
}

async function handleStripe(request, env) {
  const rawBody = await request.text();
  if (!(await verifyStripeSignature(rawBody, request.headers.get("Stripe-Signature"), env.STRIPE_WEBHOOK_SECRET))) {
    return json({ error: "Invalid Stripe signature" }, 400);
  }

  let event;
  try { event = JSON.parse(rawBody); } catch { return json({ error: "Invalid JSON" }, 400); }
  if (!event?.id || !event?.type) return json({ error: "Invalid Stripe event" }, 400);
  if (!["checkout.session.completed", "checkout.session.async_payment_succeeded"].includes(event.type)) {
    return json({ received: true, ignored: true });
  }

  const session = event.data?.object;
  if (!session?.id || session.payment_status !== "paid") return json({ received: true, ignored: true });
  if (session.metadata?.store !== "vervoxlabs" && !(session.metadata?.order_number?.startsWith("VV-") && session.metadata?.shipping_address)) return json({ received: true, ignored: true });
  let lineItems;
  try { lineItems = await fetchStripeLineItems(env, session.id); }
  catch { return json({ error: "Could not verify purchased Stripe line items; retry event" }, 503); }

  const customerEmail = session.customer_details?.email || session.customer_email || "Not provided";
  const paidAt = formatDateTime(Number.isInteger(event.created) ? event.created * 1000 : Date.now());
  const orderNumber = String(session.metadata?.order_number || session.client_reference_id || session.id).slice(0, 200);
  const shippingLines = [
    ["Customer", session.metadata?.customer_name],
    ["Shipping address", session.metadata?.shipping_address],
    ["City", session.metadata?.shipping_city],
    ["State / region", session.metadata?.shipping_region],
    ["Postal code", session.metadata?.shipping_postal],
    ["Country", session.metadata?.shipping_country],
  ].filter(([, value]) => value).map(([label, value]) => `${label}: ${value}`);
  const currency = (session.currency || "usd").toUpperCase();
  const subject = `Paid VerVoxLabs order ${orderNumber}`;
  const text = [
    "A Stripe-signature-verified payment was completed.",
    `Order number: ${orderNumber}`,
    `Customer email: ${customerEmail}`,
    ...shippingLines,
    `Date and time (UTC): ${paidAt}`,
    "Purchased cards:",
    formatOrderItems(lineItems),
    `Total paid: ${formatStripeAmount(session.amount_total, currency)}`,
    `Payment status: ${session.payment_status}`,
  ].join("\n");
  return deliverOnce(env, `stripe-order:${session.id}`, "stripe_order_paid", subject, text);
}

async function handleRegistration(request, env) {
  const rawBody = await request.text();
  const timestamp = request.headers.get("X-Registration-Timestamp");
  if (!(await verifyRegistrationSignature(
    rawBody,
    timestamp,
    request.headers.get("X-Registration-Signature"),
    env.REGISTRATION_WEBHOOK_SECRET,
  ))) return json({ error: "Invalid registration signature" }, 401);

  let event;
  try { event = JSON.parse(rawBody); } catch { return json({ error: "Invalid JSON" }, 400); }
  if (event?.type !== "user.registered" || typeof event.event_id !== "string" ||
      typeof event.email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(event.email)) {
    return json({ error: "Expected a valid user.registered event" }, 400);
  }
  const registeredAt = formatDateTime(event.created_at || event.registered_at || Number(timestamp) * 1000);
  const name = typeof event.name === "string" ? event.name.slice(0, 200) : "Not provided";
  const subject = "New VerVoxLabs customer registration";
  const text = [
    "A customer registration completed.",
    `Customer: ${name}`,
    `Customer email: ${event.email}`,
    `Date and time (UTC): ${registeredAt}`,
    `Registration event: ${event.event_id}`,
  ].join("\n");
  return deliverOnce(env, `registration:${event.event_id}`, "registration", subject, text);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return json({}, 204);
    if (request.method === "GET" && url.pathname === "/health") return json({ status: "ok" });
    if (request.method === "POST" && url.pathname === "/checkout") return createCheckout(request, env);
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
    if (url.pathname === "/webhooks/stripe") return handleStripe(request, env);
    if (url.pathname === "/webhooks/registration") return handleRegistration(request, env);
    return json({ error: "Not found" }, 404);
  },
};
