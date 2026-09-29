// Everything that touches localStorage lives here.
import { CURRENCIES } from "./currency.js";

const KEYS = {
  watchlist: "coinpulse:watchlist",
  currency: "coinpulse:currency",
  markets: "coinpulse:markets",
  rates: "coinpulse:rates",
};

export const DEFAULT_WATCHLIST = ["bitcoin", "ethereum", "solana", "ripple", "cardano"];

// localStorage can throw (private mode, storage full, blocked cookies),
// so every read and write is wrapped in try/catch.
function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore: the app still works, it just won't remember this
  }
}

// ---------- watchlist (list of coin ids) ----------
export function loadWatchlist() {
  const ids = read(KEYS.watchlist, null);
  if (!Array.isArray(ids)) return [...DEFAULT_WATCHLIST];
  return ids.filter((id) => typeof id === "string" && id.length > 0);
}

export function saveWatchlist(ids) {
  write(KEYS.watchlist, ids);
}

// ---------- preferred display currency ----------
export function loadCurrency() {
  const currency = read(KEYS.currency, "USD");
  return CURRENCIES.includes(currency) ? currency : "USD";
}

export function saveCurrency(currency) {
  write(KEYS.currency, currency);
}

// ---------- last market snapshot ----------
// Prices are always re-fetched on load; the snapshot is only a fallback so the
// page is not empty while loading or when CoinGecko rate-limits us.
export function loadCachedMarkets() {
  const cached = read(KEYS.markets, null);
  if (!cached || !Array.isArray(cached.coins)) return null;
  return cached;
}

export function saveCachedMarkets(coins) {
  write(KEYS.markets, { coins, savedAt: Date.now() });
}

// ---------- exchange rates (they only change once a day) ----------
const RATES_MAX_AGE = 6 * 60 * 60 * 1000; // 6 hours

export function loadCachedRates({ allowStale = false } = {}) {
  const cached = read(KEYS.rates, null);
  if (!cached || !cached.rates) return null;
  const fresh = Date.now() - cached.savedAt < RATES_MAX_AGE;
  return fresh || allowStale ? cached.rates : null;
}

export function saveCachedRates(rates) {
  write(KEYS.rates, { rates, savedAt: Date.now() });
}
