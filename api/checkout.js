import backend from "../worker/index.js";

export const config = { runtime: "edge" };

export default function checkout(request) {
  const url = new URL(request.url);
  url.pathname = "/checkout";
  return backend.fetch(new Request(url, request), {
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    STOREFRONT_URL: request.headers.get("origin") === "https://vish1234301.github.io"
      ? "https://vish1234301.github.io/vervoxlabs/"
      : new URL("/", request.url).href,
  });
}
