// All calls to the CoinGecko public API (no key needed).
// Docs: https://docs.coingecko.com/v3.0.1/reference/coins-markets

const BASE_URL = "https://api.coingecko.com/api/v3";

export class ApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }

  get isRateLimit() {
    // CoinGecko answers 429 when rate limited; the browser sometimes blocks
    // that response (no CORS header), which shows up as a network error (0)
    return this.status === 429 || this.status === 0;
  }
}

async function getJson(url, options = {}) {
  let response;
  try {
    response = await fetch(url, { headers: { accept: "application/json" }, ...options });
  } catch (error) {
    if (error.name === "AbortError") throw error;
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
    lastUpdated: raw.last_updated,
  };
}

/**
 * Get market data (price, % change, volume, 7-day sparkline) for a list of coin ids.
 * One request for the whole watchlist keeps us under the free-tier rate limit.
 */
export async function getMarkets(ids) {
  if (!ids.length) return [];
  const params = new URLSearchParams({
    vs_currency: "usd",
    ids: ids.join(","),
    order: "market_cap_desc",
    per_page: String(Math.min(ids.length, 250)),
    page: "1",
    sparkline: "true",
    price_change_percentage: "24h,7d",
  });
  const data = await getJson(`${BASE_URL}/coins/markets?${params}`);
  return data.map(toCoin);
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
