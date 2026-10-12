// Exchange rates from the Frankfurter API (free, no key).
// Docs: https://frankfurter.dev/

const BASE_URL = "https://api.frankfurter.dev/v1";

/**
 * Returns rates relative to 1 USD, e.g. { USD: 1, BRL: 5.21, EUR: 0.88, date: "2026-09-29" }
 */
export async function getRates(symbols = ["BRL", "EUR"]) {
  const params = new URLSearchParams({ base: "USD", symbols: symbols.join(",") });
  let response;
  try {
    response = await fetch(`${BASE_URL}/latest?${params}`, { signal: AbortSignal.timeout(10_000) });
  } catch {
    // offline, DNS or timeout: the caller keeps the last cached rates
    throw new Error("Could not reach Frankfurter (network error).");
  }
  if (!response.ok) {
    throw new Error(`Frankfurter returned an error (${response.status}).`);
  }
  const data = await response.json();
  return { USD: 1, ...data.rates, date: data.date };
}
