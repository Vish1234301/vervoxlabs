const ADMIN_EMAIL = "vishaagpartha@gmail.com";
const RESEND_URL = "https://api.resend.com/emails";
const SIGNATURE_TOLERANCE_SECONDS = 300;
const encoder = new TextEncoder();

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function hexToBytes(hex) {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) return null;
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
  if (!response.ok) {
    // Do not log or return provider response bodies; they can contain sensitive details.
    throw new Error(`Resend request failed (${response.status})`);
  }
}

async function deliverOnce(env, eventKey, eventType, subject, text) {
  if (!env.DB) return json({ error: "Notification database is not configured" }, 503);
  try {
    await env.DB.prepare(
      "INSERT OR IGNORE INTO notification_events (event_key, event_type, status) VALUES (?, ?, 'pending')",
    ).bind(eventKey, eventType).run();
    const record = await env.DB.prepare(
      "SELECT status FROM notification_events WHERE event_key = ?",
    ).bind(eventKey).first();
    if (record?.status === "sent") return json({ received: true, duplicate: true });

    await sendEmail(env, eventKey, subject, text);
    await env.DB.prepare(
      "UPDATE notification_events SET status = 'sent', sent_at = datetime('now'), last_error = NULL WHERE event_key = ?",
    ).bind(eventKey).run();
    return json({ received: true, sent: true });
  } catch (error) {
    try {
      await env.DB.prepare(
        "UPDATE notification_events SET last_error = ? WHERE event_key = ? AND status = 'pending'",
      ).bind(String(error?.message || "Delivery failed").slice(0, 200), eventKey).run();
    } catch { /* Leave the event retryable; upstream webhook retries are expected. */ }
    return json({ error: "Notification delivery failed; retry the event" }, 503);
  }
}

async function handleStripe(request, env) {
  const rawBody = await request.text();
  if (!(await verifyStripeSignature(rawBody, request.headers.get("Stripe-Signature"), env.STRIPE_WEBHOOK_SECRET))) {
    return json({ error: "Invalid Stripe signature" }, 400);
  }

  let event;
  try { event = JSON.parse(rawBody); } catch { return json({ error: "Invalid JSON" }, 400); }
  if (!event?.id || !event?.type) return json({ error: "Invalid Stripe event" }, 400);
  if (!['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type)) {
    return json({ received: true, ignored: true });
  }

  const session = event.data?.object;
  if (!session?.id || session.payment_status !== "paid") {
    // Checkout may complete before an asynchronous payment succeeds. The success event is handled separately.
    return json({ received: true, ignored: true });
  }

  const customerEmail = session.customer_details?.email || session.customer_email || "Not provided";
  const amount = Number.isInteger(session.amount_total)
    ? `${(session.amount_total / 100).toFixed(2)} ${(session.currency || "usd").toUpperCase()}`
    : "Unavailable";
  const subject = `Paid VerVoxLabs order — ${session.id}`;
  const text = [
    "A Stripe-verified payment was completed.",
    `Checkout session: ${session.id}`,
    `Customer email: ${customerEmail}`,
    `Amount: ${amount}`,
    `Payment status: ${session.payment_status}`,
  ].join("\n");
  // Key by the Checkout Session, not Stripe event ID: different Stripe events for one order cannot duplicate mail.
  return deliverOnce(env, `stripe-order:${session.id}`, "stripe_order_paid", subject, text);
}

async function handleRegistration(request, env) {
  const rawBody = await request.text();
  const timestamp = request.headers.get("X-Registration-Timestamp");
  const signature = request.headers.get("X-Registration-Signature");
  if (!(await verifyRegistrationSignature(rawBody, timestamp, signature, env.REGISTRATION_WEBHOOK_SECRET))) {
    return json({ error: "Invalid registration signature" }, 401);
  }

  let event;
  try { event = JSON.parse(rawBody); } catch { return json({ error: "Invalid JSON" }, 400); }
  if (event?.type !== "user.registered" || typeof event.event_id !== "string" ||
      typeof event.email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(event.email)) {
    return json({ error: "Expected a valid user.registered event" }, 400);
  }

  const name = typeof event.name === "string" ? event.name.slice(0, 200) : "Not provided";
  const subject = "New VerVoxLabs customer registration";
  const text = `A customer registration completed.\nCustomer: ${name}\nEmail: ${event.email}\nEvent: ${event.event_id}`;
  return deliverOnce(env, `registration:${event.event_id}`, "registration", subject, text);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") return json({ status: "ok" });
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
    if (url.pathname === "/webhooks/stripe") return handleStripe(request, env);
    if (url.pathname === "/webhooks/registration") return handleRegistration(request, env);
    return json({ error: "Not found" }, 404);
  },
};
