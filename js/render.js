// Builds and updates the HTML on the screen. No fetching and no storage here.
import { convert, formatCompact, formatPercent, formatPrice, trendOf } from "./currency.js";
import { sparklineSvg } from "./chart.js";

// names and symbols come from an external API, so escape them before using innerHTML
export function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char],
  );
}

function changeBadge(value, label, extraClass = "") {
  const trend = trendOf(value);
  return `<span class="change change--${trend} ${extraClass}" data-label="${label}">
    ${formatPercent(value)}
  </span>`;
}

// second price under the main one: BRL when showing USD, USD otherwise
function altPrice(coin, currency, rates) {
  const altCurrency = currency === "USD" ? "BRL" : "USD";
  const value = convert(coin.price, altCurrency, rates);
  return value === null ? "" : formatPrice(value, altCurrency);
}

function coinRowTemplate(coin, index, currency, rates) {
  const name = escapeHtml(coin.name);
  const symbol = escapeHtml(coin.symbol);
  const pending = coin.price === null || coin.price === undefined;
  const price = convert(coin.price, currency, rates);
  const volume = convert(coin.volume, currency, rates);
  const trend7d = trendOf(coin.change7d);
  const image = coin.image
    ? `<img class="coin__logo" src="${escapeHtml(coin.image)}" alt="" width="36" height="36" loading="lazy" />`
    : `<span class="coin__logo coin__logo--placeholder" aria-hidden="true">${symbol.charAt(0)}</span>`;

  return `<li class="coin-row${pending ? " coin-row--pending" : ""}" data-id="${escapeHtml(coin.id)}">
    <span class="coin-row__index">${index + 1}</span>
    <div class="coin-row__coin coin">
      ${image}
      <div class="coin__text">
        <span class="coin__name">${name}</span>
        <span class="coin__meta">
          <span class="coin__symbol">${symbol}</span>
          ${coin.rank ? `<span class="coin__rank">#${coin.rank}</span>` : ""}
        </span>
      </div>
    </div>
    <div class="coin-row__price">
      <span class="price-main">${pending ? "Loading…" : formatPrice(price, currency)}</span>
      <span class="price-alt">${pending ? "" : altPrice(coin, currency, rates)}</span>
    </div>
    ${changeBadge(coin.change24h, "24h", "coin-row__d24")}
    ${changeBadge(coin.change7d, "7d", "coin-row__d7")}
    <div class="coin-row__chart">
      ${pending ? "" : sparklineSvg(coin.sparkline, { trend: trend7d === "flat" ? undefined : trend7d })}
    </div>
    <span class="coin-row__volume" data-label="Vol">${pending ? "—" : formatCompact(volume, currency)}</span>
    <button type="button" class="coin-row__remove" data-id="${escapeHtml(coin.id)}"
      aria-label="Remove ${name} from watchlist" title="Remove">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
    </button>
  </li>`;
}

export function filterCoins(coins, filter) {
  if (filter === "gainers") return coins.filter((coin) => coin.change24h > 0);
  if (filter === "losers") return coins.filter((coin) => coin.change24h < 0);
  return coins;
}

export function renderWatchlist(listElement, emptyElement, coins, { currency, rates, filter }) {
  const visible = filterCoins(coins, filter);
  listElement.innerHTML = visible
    .map((coin, index) => coinRowTemplate(coin, index, currency, rates))
    .join("");

  emptyElement.hidden = coins.length > 0;
  if (coins.length > 0 && visible.length === 0) {
    listElement.innerHTML = `<li class="coin-row coin-row--message">No ${filter} in your watchlist right now.</li>`;
  }
}

export function renderSkeleton(listElement, count = 5) {
  listElement.innerHTML = Array.from(
    { length: count },
    () => `<li class="coin-row coin-row--skeleton" aria-hidden="true">
      <span class="skeleton skeleton--sm"></span>
      <span class="skeleton skeleton--lg"></span>
      <span class="skeleton"></span><span class="skeleton"></span>
      <span class="skeleton"></span><span class="skeleton"></span>
      <span class="skeleton"></span><span class="skeleton skeleton--sm"></span>
    </li>`,
  ).join("");
}

export function renderFilterCounts(container, coins) {
  const counts = {
    all: coins.length,
    gainers: filterCoins(coins, "gainers").length,
    losers: filterCoins(coins, "losers").length,
  };
  container.querySelectorAll("[data-count]").forEach((element) => {
    element.textContent = counts[element.dataset.count];
  });
}

export function renderSummary(elements, coins, { currency, rates }) {
  const loaded = coins.filter((coin) => typeof coin.change24h === "number");
  elements.count.textContent = coins.length;

  if (loaded.length === 0) {
    elements.gainer.textContent = "—";
    elements.gainerChange.textContent = "";
    elements.gainerBadge.hidden = true;
    elements.loser.textContent = "Top loser: —";
    elements.volume.textContent = "—";
  } else {
    const sorted = [...loaded].sort((a, b) => b.change24h - a.change24h);
    const top = sorted[0];
    const bottom = sorted.at(-1);
    elements.gainer.textContent = top.symbol;
    elements.gainerChange.textContent = formatPercent(top.change24h);
    elements.gainerChange.className = `stat-card__change change-text--${trendOf(top.change24h)}`;
    elements.gainerBadge.hidden = false;
    elements.gainerBadge.textContent = formatPercent(top.change24h);
    elements.gainerBadge.className = `change change--${trendOf(top.change24h)}`;
    elements.loser.textContent = `Top loser: ${bottom.symbol} ${formatPercent(bottom.change24h)}`;

    const totalUsd = loaded.reduce((sum, coin) => sum + (coin.volume ?? 0), 0);
    elements.volume.textContent = formatCompact(convert(totalUsd, currency, rates), currency);
  }

  if (rates?.BRL) {
    const rate = formatPrice(rates[currency === "USD" ? "BRL" : currency], currency === "USD" ? "BRL" : currency);
    elements.rate.textContent = `1 USD = ${rate} · rates from ${rates.date ?? "today"}`;
  } else {
    elements.rate.textContent = "Exchange rate unavailable — showing USD";
  }
}

// chips with popular coins that are not in the watchlist yet
export function renderQuickAdd(container, popularCoins, watchlist, max = 4) {
  const options = popularCoins.filter((coin) => !watchlist.has(coin.id)).slice(0, max);
  container.innerHTML = options
    .map(
      (coin) => `<button type="button" class="chip" data-id="${escapeHtml(coin.id)}"
        title="Add ${escapeHtml(coin.name)}">+ ${escapeHtml(coin.symbol)}</button>`,
    )
    .join("");
  container.closest(".quick-add").hidden = options.length === 0;
}

export function renderSuggestions(listElement, suggestions, { activeIndex, watchlist, searching }) {
  if (suggestions.length === 0) {
    listElement.innerHTML = searching
      ? `<li class="suggestions__status">Searching CoinGecko…</li>`
      : `<li class="suggestions__status">No coins found</li>`;
    return;
  }
  listElement.innerHTML = suggestions
    .map((coin, index) => {
      const added = watchlist.has(coin.id);
      return `<li id="suggestion-${index}" class="suggestion${index === activeIndex ? " is-active" : ""}"
        role="option" aria-selected="${index === activeIndex}" data-id="${escapeHtml(coin.id)}"
        data-index="${index}">
        ${coin.image ? `<img src="${escapeHtml(coin.image)}" alt="" width="22" height="22" />` : `<span class="suggestion__dot"></span>`}
        <span class="suggestion__name">${escapeHtml(coin.name)}</span>
        <span class="suggestion__symbol">${escapeHtml(coin.symbol)}</span>
        <span class="suggestion__action">${added ? "Added ✓" : "+ Add"}</span>
      </li>`;
    })
    .join("");
  if (searching) {
    listElement.insertAdjacentHTML("beforeend", `<li class="suggestions__status">Searching more…</li>`);
  }
}

export function renderStatus(element, { state, text }) {
  element.dataset.state = state;
  element.querySelector(".sync-status__text").textContent = text;
}
