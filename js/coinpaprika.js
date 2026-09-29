// Backup market data from CoinPaprika (free, no key), used when CoinGecko
// is rate-limiting or blocking requests. Docs: https://api.coinpaprika.com/
import { loadPaprikaIds, savePaprikaIds } from "./storage.js";

const BASE_URL = "https://api.coinpaprika.com/v1";

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`CoinPaprika returned an error (${response.status}).`);
  return response.json();
}

// CoinGecko and CoinPaprika use different ids ("bitcoin" vs "btc-bitcoin"),
// so we look the coin up by name once and remember the match in localStorage.
async function resolveId(coin, idMap) {
  if (idMap[coin.id]) return idMap[coin.id];
  const query = coin.name && coin.name !== coin.id ? coin.name : coin.id.replace(/-/g, " ");
  const data = await getJson(`${BASE_URL}/search?q=${encodeURIComponent(query)}&c=currencies&limit=10`);
  const candidates = (data.currencies ?? []).filter((item) => item.is_active !== false);
  const match =
    candidates.find((item) => item.symbol === coin.symbol && item.name.toLowerCase() === coin.name?.toLowerCase()) ??
    candidates.find((item) => item.symbol === coin.symbol) ??
    candidates[0];
  if (!match) throw new Error(`No CoinPaprika match for ${coin.id}`);
  idMap[coin.id] = match.id;
  return match.id;
}

/**
 * Same result shape as coingecko.getMarkets(), built from CoinPaprika tickers.
 * The 7-day sparkline is not available for free here, so the last one we got
 * from CoinGecko is kept.
 * @param {Array<{id: string, name?: string, symbol?: string}>} coins
 */
export async function getMarketsFromPaprika(coins) {
  const idMap = loadPaprikaIds();
  const results = await Promise.allSettled(
    coins.map(async (coin) => {
      const paprikaId = await resolveId(coin, idMap);
      const ticker = await getJson(`${BASE_URL}/tickers/${paprikaId}`);
      const quote = ticker.quotes.USD;
      return {
        ...coin,
        name: coin.name && coin.name !== coin.id ? coin.name : ticker.name,
        symbol: coin.symbol || ticker.symbol,
        rank: ticker.rank,
        price: quote.price,
        marketCap: quote.market_cap,
        volume: quote.volume_24h,
        change24h: quote.percent_change_24h,
        change7d: quote.percent_change_7d,
        sparkline: coin.sparkline ?? [],
      };
    }),
  );
  savePaprikaIds(idMap);
  const loaded = results.filter((result) => result.status === "fulfilled").map((result) => result.value);
  if (loaded.length === 0) throw new Error("The backup data source (CoinPaprika) is unavailable too.");
  return loaded;
}
