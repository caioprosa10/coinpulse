// Entry point: loads saved state, wires up events and keeps prices fresh.
import { getMarkets, searchCoins } from "./coingecko.js";
import { getMarketsFromPaprika } from "./coinpaprika.js";
import { getRates } from "./frankfurter.js";
import Watchlist from "./watchlist.js";
import {
  loadWatchlist,
  loadCurrency,
  saveCurrency,
  loadCachedMarkets,
  saveCachedMarkets,
  loadCachedRates,
  saveCachedRates,
} from "./storage.js";
import {
  renderWatchlist,
  renderSkeleton,
  renderSummary,
  renderFilterCounts,
  renderQuickAdd,
  renderSuggestions,
  renderStatus,
} from "./render.js";

const REFRESH_INTERVAL = 60_000; // 60s keeps us well under CoinGecko's free limit
const MAX_BACKOFF = 5 * 60_000;
const GECKO_COOLDOWN = 5 * 60_000; // after a CoinGecko failure, use the backup for 5 min

const $ = (selector) => document.querySelector(selector);

const dom = {
  list: $("#watchlist"),
  empty: $("#empty-state"),
  status: $("#sync-status"),
  refresh: $("#refresh-btn"),
  banner: $("#error-banner"),
  toast: $("#toast"),
  quickAdd: $("#quick-add"),
  filters: $(".filters"),
  currencyToggle: $(".currency-toggle"),
  priceColumn: $("#price-col-currency"),
  searchForm: $("#search-form"),
  searchInput: $("#coin-search"),
  searchError: $("#search-error"),
  suggestions: $("#search-suggestions"),
  summary: {
    count: $("#stat-count"),
    gainer: $("#stat-gainer"),
    gainerChange: $("#stat-gainer-change"),
    gainerBadge: $("#stat-gainer-badge"),
    loser: $("#stat-loser"),
    volume: $("#stat-volume"),
    rate: $("#stat-rate"),
  },
};

const state = {
  watchlist: new Watchlist(loadWatchlist()),
  currency: loadCurrency(),
  rates: loadCachedRates({ allowStale: true }) ?? { USD: 1 },
  coins: [],
  filter: "all",
  popular: [],
  loading: false,
  updatedAt: null,
  timer: null,
  delay: REFRESH_INTERVAL,
  source: "CoinGecko",
  geckoBlockedUntil: 0,
  search: { query: "", results: [], activeIndex: -1, remoteTimer: null, controller: null, searching: false },
};

// ---------------------------------------------------------------- rendering
function render() {
  // if BRL/EUR was chosen but we have no rate yet, fall back to USD for now
  const currency = state.rates[state.currency] ? state.currency : "USD";
  const options = { currency, rates: state.rates, filter: state.filter };
  renderWatchlist(dom.list, dom.empty, state.coins, options);
  renderSummary(dom.summary, state.coins, options);
  renderFilterCounts(dom.filters, state.coins);
  renderQuickAdd(dom.quickAdd, state.popular, state.watchlist);
  dom.priceColumn.textContent = currency;
}

function timeLabel(timestamp) {
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function showBanner(message, type = "error") {
  dom.banner.textContent = message;
  dom.banner.dataset.type = type;
  dom.banner.hidden = !message;
}

let toastTimer;
function showToast(message, type = "info") {
  dom.toast.textContent = message;
  dom.toast.dataset.type = type;
  dom.toast.hidden = false;
  // restart the CSS transition
  dom.toast.classList.remove("is-visible");
  void dom.toast.offsetWidth;
  dom.toast.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => dom.toast.classList.remove("is-visible"), 3200);
}

// ---------------------------------------------------------------- data
async function refreshMarkets({ manual = false } = {}) {
  if (state.loading) return;
  const ids = state.watchlist.toArray();
  if (ids.length === 0) {
    state.coins = [];
    render();
    renderStatus(dom.status, { state: "ok", text: "Synced via localStorage · watchlist empty" });
    return;
  }

  state.loading = true;
  dom.refresh.classList.add("is-spinning");
  dom.refresh.disabled = true;
  renderStatus(dom.status, { state: "loading", text: "Updating prices…" });

  try {
    const coins = await fetchMarkets(ids);
    const found = new Set(coins.map((coin) => coin.id));
    if (state.source === "CoinGecko") {
      // ids that CoinGecko doesn't know anymore are removed from the list
      ids.filter((id) => !found.has(id)).forEach((id) => {
        state.watchlist.remove(id);
        showToast(`“${id}” was not found on CoinGecko and was removed.`, "error");
      });
    } else {
      // backup source: keep the old data (or a placeholder row) for any coin it couldn't find
      ids.filter((id) => !found.has(id)).forEach((id) => {
        coins.push(state.coins.find((coin) => coin.id === id) ?? placeholderCoin(id));
      });
    }

    state.coins = state.watchlist.sortByWatchlist(coins);
    state.updatedAt = Date.now();
    state.delay = REFRESH_INTERVAL;
    saveCachedMarkets(state.coins);
    showBanner(
      state.source === "CoinGecko"
        ? ""
        : "CoinGecko is not responding right now, so prices come from the backup source (CoinPaprika). Charts show the last CoinGecko 7-day data, or the last 24h when there is none.",
      "info",
    );
    render();
    renderStatus(dom.status, {
      state: state.source === "CoinGecko" ? "ok" : "backup",
      text: `${state.source} · Updated ${timeLabel(state.updatedAt)} · Auto 60s`,
    });
    if (manual) showToast("Prices updated");
  } catch (error) {
    console.warn(error);
    // back off: wait longer after every failed attempt (rate limits)
    state.delay = Math.min(state.delay * 2, MAX_BACKOFF);
    const cachedNote = state.updatedAt ? ` Showing prices from ${timeLabel(state.updatedAt)}.` : "";
    showBanner(`${error.message}${cachedNote} Retrying in ${Math.round(state.delay / 1000)}s.`);
    renderStatus(dom.status, { state: "error", text: "Offline · showing last saved prices" });
    if (state.coins.length === 0) {
      // nothing saved yet: show the rows with names only, prices come on retry
      state.coins = ids.map(placeholderCoin);
      render();
    }
  } finally {
    state.loading = false;
    dom.refresh.classList.remove("is-spinning");
    dom.refresh.disabled = false;
    scheduleRefresh();
  }
}

// a row with only the name, used until prices arrive
function placeholderCoin(id) {
  const known = state.popular.find((coin) => coin.id === id);
  return { id, name: known?.name ?? id, symbol: known?.symbol ?? id.slice(0, 4).toUpperCase(), price: null };
}

// CoinGecko first; if it fails (rate limit / blocked), use CoinPaprika for a while
async function fetchMarkets(ids) {
  if (Date.now() >= state.geckoBlockedUntil) {
    try {
      const coins = await getMarkets(ids);
      state.source = "CoinGecko";
      return coins;
    } catch (error) {
      console.warn(error);
      state.geckoBlockedUntil = Date.now() + GECKO_COOLDOWN;
    }
  }
  const known = ids.map(
    (id) =>
      state.coins.find((coin) => coin.id === id) ??
      state.popular.find((coin) => coin.id === id) ?? { id, name: id, symbol: "" },
  );
  const coins = await getMarketsFromPaprika(known);
  state.source = "CoinPaprika";
  return coins;
}

function scheduleRefresh() {
  clearTimeout(state.timer);
  if (document.hidden) return; // paused while the tab is in the background
  state.timer = setTimeout(refreshMarkets, state.delay);
}

async function loadRates() {
  const cached = loadCachedRates();
  if (cached) {
    state.rates = cached;
    return;
  }
  try {
    state.rates = await getRates(["BRL", "EUR"]);
    saveCachedRates(state.rates);
  } catch (error) {
    console.warn(error);
    if (state.currency !== "USD" && !state.rates[state.currency]) {
      showToast("Couldn't load exchange rates — showing USD.", "error");
    }
  }
  render();
}

async function loadPopularCoins() {
  try {
    const response = await fetch("data/coins.json");
    if (!response.ok) throw new Error(`coins.json ${response.status}`);
    state.popular = await response.json();
  } catch (error) {
    console.warn(error);
    state.popular = [];
  }
}

// ---------------------------------------------------------------- watchlist actions
function addCoin(coin) {
  if (!coin?.id) return;
  if (!state.watchlist.add(coin.id)) {
    showToast(`${coin.name} is already in your watchlist`);
    return;
  }
  // show the row right away, prices arrive with the next fetch
  state.coins.push({ id: coin.id, name: coin.name, symbol: coin.symbol, image: coin.image, rank: coin.rank, price: null });
  if (state.filter !== "all") setFilter("all");
  render();
  const row = dom.list.querySelector(`[data-id="${CSS.escape(coin.id)}"]`);
  row?.classList.add("is-new");
  showToast(`${coin.name} added to your watchlist`, "success");
  refreshMarkets();
}

function removeCoin(id) {
  const row = dom.list.querySelector(`.coin-row[data-id="${CSS.escape(id)}"]`);
  const coin = state.coins.find((item) => item.id === id);
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    state.watchlist.remove(id);
    state.coins = state.coins.filter((item) => item.id !== id);
    saveCachedMarkets(state.coins);
    render();
    showToast(`${coin?.name ?? id} removed`);
  };
  if (!row || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    finish();
    return;
  }
  row.classList.add("is-removing");
  row.addEventListener("transitionend", (event) => {
    if (event.target === row) finish();
  });
  setTimeout(finish, 450); // safety net in case transitionend never fires
}

function setFilter(filter) {
  state.filter = filter;
  dom.filters.querySelectorAll("[data-filter]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.filter === filter));
  });
}

function setCurrency(currency) {
  state.currency = currency;
  saveCurrency(currency);
  dom.currencyToggle.querySelectorAll("[data-currency]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.currency === currency));
  });
  if (!state.rates[currency]) loadRates();
  render();
}

// ---------------------------------------------------------------- search
function localMatches(query) {
  const q = query.toLowerCase();
  return state.popular
    .filter((coin) => coin.symbol.toLowerCase().startsWith(q) || coin.name.toLowerCase().includes(q))
    .sort((a, b) => Number(b.symbol.toLowerCase() === q) - Number(a.symbol.toLowerCase() === q))
    .slice(0, 6);
}

function openSuggestions() {
  dom.suggestions.hidden = false;
  dom.searchInput.setAttribute("aria-expanded", "true");
}

function closeSuggestions() {
  dom.suggestions.hidden = true;
  dom.searchInput.setAttribute("aria-expanded", "false");
  dom.searchInput.removeAttribute("aria-activedescendant");
  state.search.activeIndex = -1;
}

function showSearchError(message) {
  dom.searchError.textContent = message;
  dom.searchError.hidden = !message;
  dom.searchForm.classList.toggle("is-invalid", Boolean(message));
}

function updateSuggestions() {
  const { results, activeIndex, searching } = state.search;
  renderSuggestions(dom.suggestions, results, { activeIndex, watchlist: state.watchlist, searching });
  if (activeIndex >= 0) {
    dom.searchInput.setAttribute("aria-activedescendant", `suggestion-${activeIndex}`);
  }
  openSuggestions();
}

// remote search only runs when the local list doesn't have enough matches
async function remoteSearch(query) {
  state.search.controller?.abort();
  state.search.controller = new AbortController();
  state.search.searching = true;
  updateSuggestions();
  try {
    const remote = await searchCoins(query, state.search.controller.signal);
    if (query !== state.search.query) return; // user kept typing
    const known = new Set(state.search.results.map((coin) => coin.id));
    state.search.results = [...state.search.results, ...remote.filter((coin) => !known.has(coin.id))].slice(0, 8);
  } catch (error) {
    if (error.name === "AbortError") return;
    console.warn(error);
  }
  state.search.searching = false;
  if (query === state.search.query) updateSuggestions();
}

function debounce(fn, wait) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

const handleSearchInput = debounce(() => {
  const query = dom.searchInput.value.trim();
  state.search.query = query;
  state.search.activeIndex = -1;
  state.search.searching = false;
  clearTimeout(state.search.remoteTimer);
  showSearchError("");

  if (query.length === 0) {
    state.search.results = [];
    closeSuggestions();
    return;
  }
  state.search.results = localMatches(query);
  updateSuggestions();
  if (query.length >= 2 && state.search.results.length < 3) {
    state.search.remoteTimer = setTimeout(() => remoteSearch(query), 450);
  }
}, 200);

function chooseSuggestion(index) {
  const coin = state.search.results[index];
  if (!coin) return;
  addCoin(coin);
  dom.searchInput.value = "";
  state.search.query = "";
  state.search.results = [];
  closeSuggestions();
}

async function handleSearchSubmit(event) {
  event.preventDefault();
  const query = dom.searchInput.value.trim();
  if (!query) {
    showSearchError("Type a coin name or symbol, e.g. “BTC” or “Solana”.");
    dom.searchInput.focus();
    return;
  }
  if (state.search.query !== query) {
    state.search.query = query;
    state.search.results = localMatches(query);
  }
  // nothing in the local list: ask CoinGecko right away instead of waiting for the debounce
  if (state.search.results.length === 0 && query.length >= 2) {
    clearTimeout(state.search.remoteTimer);
    await remoteSearch(query);
  }
  if (state.search.results.length === 0) {
    showSearchError(`No coin found for “${query}”.`);
    return;
  }
  chooseSuggestion(Math.max(state.search.activeIndex, 0));
}

function handleSearchKeys(event) {
  const { results } = state.search;
  if (event.key === "Escape") {
    closeSuggestions();
    return;
  }
  if (!results.length || (event.key !== "ArrowDown" && event.key !== "ArrowUp")) return;
  event.preventDefault();
  const step = event.key === "ArrowDown" ? 1 : -1;
  state.search.activeIndex = (state.search.activeIndex + step + results.length) % results.length;
  updateSuggestions();
}

// ---------------------------------------------------------------- events
function bindEvents() {
  // search
  dom.searchInput.addEventListener("input", handleSearchInput);
  dom.searchInput.addEventListener("keydown", handleSearchKeys);
  dom.searchInput.addEventListener("focus", () => {
    if (state.search.results.length) updateSuggestions();
  });
  dom.searchInput.addEventListener("blur", () => setTimeout(closeSuggestions, 150));
  dom.searchForm.addEventListener("submit", handleSearchSubmit);
  // mousedown fires before the input's blur, so the click is not lost
  dom.suggestions.addEventListener("mousedown", (event) => {
    const option = event.target.closest(".suggestion");
    if (!option) return;
    event.preventDefault();
    chooseSuggestion(Number(option.dataset.index));
  });

  // "/" focuses the search box from anywhere
  document.addEventListener("keydown", (event) => {
    if (event.key === "/" && document.activeElement !== dom.searchInput) {
      event.preventDefault();
      dom.searchInput.focus();
    }
  });

  // one listener handles every remove button (event delegation)
  dom.list.addEventListener("click", (event) => {
    const button = event.target.closest(".coin-row__remove");
    if (button) removeCoin(button.dataset.id);
  });

  dom.quickAdd.addEventListener("click", (event) => {
    const chip = event.target.closest(".chip");
    if (!chip) return;
    addCoin(state.popular.find((coin) => coin.id === chip.dataset.id));
  });

  dom.filters.addEventListener("click", (event) => {
    const button = event.target.closest("[data-filter]");
    if (!button) return;
    setFilter(button.dataset.filter);
    render();
  });

  dom.currencyToggle.addEventListener("click", (event) => {
    const button = event.target.closest("[data-currency]");
    if (button) setCurrency(button.dataset.currency);
  });

  dom.refresh.addEventListener("click", () => {
    state.delay = REFRESH_INTERVAL;
    state.geckoBlockedUntil = 0; // a manual refresh always tries CoinGecko again
    refreshMarkets({ manual: true });
  });

  // pause auto-refresh in background tabs, catch up when the user comes back
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      clearTimeout(state.timer);
    } else if (!state.updatedAt || Date.now() - state.updatedAt > REFRESH_INTERVAL) {
      refreshMarkets();
    } else {
      scheduleRefresh();
    }
  });
}

// ---------------------------------------------------------------- start
async function init() {
  setCurrency(state.currency);
  bindEvents();

  // show the last snapshot immediately (or a skeleton) while fresh data loads
  const cached = loadCachedMarkets();
  if (cached) {
    state.coins = state.watchlist.sortByWatchlist(cached.coins);
    state.updatedAt = cached.savedAt;
  }
  if (state.coins.length) render();
  else if (state.watchlist.size) renderSkeleton(dom.list, state.watchlist.size);

  await loadPopularCoins();
  if (state.coins.length) render();
  else renderQuickAdd(dom.quickAdd, state.popular, state.watchlist);
  await Promise.all([loadRates(), refreshMarkets()]);
}

init();
