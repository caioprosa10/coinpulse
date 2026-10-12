// Backup market data from CoinPaprika (free, no key), used when CoinGecko
// is rate-limiting or blocking requests. Docs: https://api.coinpaprika.com/
import { loadPaprikaIds, savePaprikaIds } from "./storage.js";

const BASE_URL = "https://api.coinpaprika.com/v1";
const TIMEOUT = 12_000;
// the free tier is strict, so requests go out a few at a time instead of all at once
const CONCURRENCY = 3;

async function getJson(url, attempts = 3) {
  for (let attempt = 1; ; attempt += 1) {
    let response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT) });
    } catch {
      // offline, DNS, CORS or timeout: no response at all
      if (attempt >= attempts) throw new Error("Could not reach CoinPaprika (network error).");
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
      continue;
    }
    if (response.status === 429 && attempt < attempts) {
      await new Promise((resolve) => setTimeout(resolve, 900 * attempt));
      continue;
    }
    if (!response.ok) throw new Error(`CoinPaprika returned an error (${response.status}).`);
    return response.json();
  }
}

// run async work over a list a few items at a time (never all at once)
async function mapPooled(items, worker, limit = CONCURRENCY) {
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      try {
        results[index] = { status: "fulfilled", value: await worker(items[index]) };
      } catch (error) {
        results[index] = { status: "rejected", reason: error };
      }
    }
  });
  await Promise.all(runners);
  return results;
}

// CoinGecko and CoinPaprika use different ids ("bitcoin" vs "btc-bitcoin"), and
// CoinGecko disambiguates with numeric suffixes ("avalanche-2") that CoinPaprika
// does not know. So we try a few spellings and remember the match in localStorage.
function searchTerms(coin) {
  const fromId = coin.id.replace(/-\d+$/, "").replace(/-/g, " ");
  const terms = [coin.name && coin.name !== coin.id ? coin.name : null, fromId, coin.symbol || null];
  return [...new Set(terms.filter(Boolean))];
}

function pickMatch(candidates, coin) {
  const active = candidates.filter((item) => item.is_active !== false);
  const symbol = String(coin.symbol ?? "").toUpperCase();
  const name = String(coin.name ?? "").toLowerCase();
  return (
    active.find((item) => item.symbol === symbol && item.name?.toLowerCase() === name) ??
    active.find((item) => item.symbol === symbol) ??
    active.find((item) => item.name?.toLowerCase() === name) ??
    active[0]
  );
}

async function resolveId(coin, idMap) {
  if (idMap[coin.id]) return idMap[coin.id];
  for (const term of searchTerms(coin)) {
    const data = await getJson(`${BASE_URL}/search?q=${encodeURIComponent(term)}&c=currencies&limit=10`);
    const match = pickMatch(data.currencies ?? [], coin);
    if (match) {
      idMap[coin.id] = match.id;
      return match.id;
    }
  }
  throw new Error(`No CoinPaprika match for ${coin.id}`);
}

// Free plan only allows the last 24h of history, so without CoinGecko's
// 7-day data we draw a 24h chart instead. Cached for 30 minutes per coin.
const historyCache = new Map();
const HISTORY_MAX_AGE = 30 * 60 * 1000;

async function getHistory24h(paprikaId) {
  const cached = historyCache.get(paprikaId);
  if (cached && Date.now() - cached.savedAt < HISTORY_MAX_AGE) return cached.prices;
  const start = Math.floor(Date.now() / 1000) - 23 * 60 * 60;
  const data = await getJson(`${BASE_URL}/tickers/${paprikaId}/historical?start=${start}&interval=1h`);
  const prices = Array.isArray(data) ? data.map((point) => point.price) : [];
  historyCache.set(paprikaId, { prices, savedAt: Date.now() });
  return prices;
}

/**
 * Same result shape as coingecko.getMarkets(), built from CoinPaprika tickers.
 * The 7-day sparkline is not available for free here, so the last one we got
 * from CoinGecko is kept (or a 24h chart is drawn when there is none).
 * Coins that fail are simply left out; main.js keeps their last known prices.
 * @param {Array<{id: string, name?: string, symbol?: string}>} coins
 */
export async function getMarketsFromPaprika(coins) {
  if (!coins.length) return [];
  const idMap = loadPaprikaIds();
  const results = await mapPooled(coins, async (coin) => {
    const paprikaId = await resolveId(coin, idMap);
    const ticker = await getJson(`${BASE_URL}/tickers/${paprikaId}`);
    const quote = ticker.quotes?.USD;
    if (!quote) throw new Error(`No USD quote for ${coin.id}`);
    let sparkline = coin.sparkline ?? [];
    let sparklineRange = coin.sparklineRange ?? "7d";
    if (sparkline.length < 2 || sparklineRange === "24h") {
      sparkline = await getHistory24h(paprikaId).catch(() => []);
      sparklineRange = "24h";
    }
    return {
      ...coin,
      name: coin.name && coin.name !== coin.id ? coin.name : ticker.name,
      symbol: coin.symbol || ticker.symbol,
      image: coin.image ?? `https://static.coinpaprika.com/coin/${paprikaId}/logo.png`,
      rank: ticker.rank,
      price: quote.price,
      marketCap: quote.market_cap,
      volume: quote.volume_24h,
      change24h: quote.percent_change_24h,
      change7d: quote.percent_change_7d,
      sparkline,
      sparklineRange,
    };
  });
  savePaprikaIds(idMap);
  const loaded = results.filter((result) => result.status === "fulfilled").map((result) => result.value);
  if (loaded.length === 0) {
    const [first] = results;
    throw new Error(
      first?.reason?.message?.includes("network")
        ? "The backup data source (CoinPaprika) is unreachable too."
        : "The backup data source (CoinPaprika) is unavailable too.",
    );
  }
  return loaded;
}
