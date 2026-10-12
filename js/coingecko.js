// All calls to the CoinGecko public API (no key needed).
// Docs: https://docs.coingecko.com/v3.0.1/reference/coins-markets

const BASE_URL = "https://api.coingecko.com/api/v3";
const TIMEOUT = 12_000; // a hung request must not stall the whole refresh
const MAX_IDS_PER_REQUEST = 250; // CoinGecko's per_page cap

export class ApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }

  /** true only when CoinGecko itself refused us (HTTP 429) */
  get isRateLimit() {
    return this.status === 429;
  }

  /**
   * true when the request never got an answer: offline, DNS, CORS, timeout, or a
   * 429 whose response the browser hid. Transient, so it is worth retrying soon
   * instead of falling back to the backup source for minutes.
   */
  get isNetworkError() {
    return this.status === 0;
  }
}

// one extra attempt covers the common one-second network blip
async function fetchWithRetry(url, options, attempts = 2) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fetch(url, options);
    } catch (error) {
      if (error.name === "AbortError" && options.signal?.aborted) throw error; // caller cancelled
      if (attempt >= attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
    }
  }
}

async function getJson(url, options = {}) {
  // combine the caller's signal (search typing) with our own timeout
  const timeout = AbortSignal.timeout(TIMEOUT);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;

  let response;
  try {
    response = await fetchWithRetry(url, { headers: { accept: "application/json" }, ...options, signal });
  } catch (error) {
    if (options.signal?.aborted) throw error; // the caller cancelled: let main.js ignore it
    if (error.name === "TimeoutError" || error.name === "AbortError") {
      throw new ApiError("CoinGecko took too long to answer.", 0);
    }
    throw new ApiError("Could not reach CoinGecko (network error or rate limit).", 0);
  }
  if (response.status === 429) {
    throw new ApiError("CoinGecko rate limit reached. Please wait a minute.", 429);
  }
  if (!response.ok) {
    throw new ApiError(`CoinGecko returned an error (${response.status}).`, response.status);
  }
  return response.json();
}

// turn the raw API object into the shape the app uses
function toCoin(raw) {
  return {
    id: raw.id,
    symbol: String(raw.symbol ?? "").toUpperCase(),
    name: raw.name,
    image: raw.image,
    rank: raw.market_cap_rank,
    price: raw.current_price,
    marketCap: raw.market_cap,
    volume: raw.total_volume,
    high24h: raw.high_24h,
    low24h: raw.low_24h,
    change24h: raw.price_change_percentage_24h_in_currency ?? raw.price_change_percentage_24h,
    change7d: raw.price_change_percentage_7d_in_currency ?? null,
    sparkline: raw.sparkline_in_7d?.price ?? [],
    sparklineRange: "7d",
    lastUpdated: raw.last_updated,
  };
}

async function getMarketsPage(ids) {
  const params = new URLSearchParams({
    vs_currency: "usd",
    ids: ids.join(","),
    order: "market_cap_desc",
    per_page: String(ids.length),
    page: "1",
    sparkline: "true",
    price_change_percentage: "24h,7d",
  });
  const data = await getJson(`${BASE_URL}/coins/markets?${params}`);
  return Array.isArray(data) ? data.map(toCoin) : [];
}

/**
 * Get market data (price, % change, volume, 7-day sparkline) for a list of coin ids.
 * Watchlists longer than the API's 250-per-page cap are split into several
 * requests, so no coin is silently left out of the answer.
 */
export async function getMarkets(ids) {
  if (!ids.length) return [];
  const pages = [];
  for (let i = 0; i < ids.length; i += MAX_IDS_PER_REQUEST) {
    pages.push(ids.slice(i, i + MAX_IDS_PER_REQUEST));
  }
  const results = [];
  for (const page of pages) {
    results.push(...(await getMarketsPage(page)));
  }
  return results;
}

/** Search every coin CoinGecko knows by name or symbol. */
export async function searchCoins(query, signal) {
  const data = await getJson(`${BASE_URL}/search?query=${encodeURIComponent(query)}`, { signal });
  return (data.coins ?? []).slice(0, 8).map((coin) => ({
    id: coin.id,
    name: coin.name,
    symbol: String(coin.symbol ?? "").toUpperCase(),
    rank: coin.market_cap_rank,
    image: coin.thumb,
  }));
}
