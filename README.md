# CoinPulse — Crypto Watchlist

WDD 330 Final Project · Caio Palladino

CoinPulse is a crypto watchlist that works without an account. You add the coins you care about and see, all on one screen, the live price, the 24h and 7-day change, a 7-day sparkline and the 24h volume. Prices can be shown in **USD, BRL or EUR**.

**Live site:** https://caioprosa10.github.io/coinpulse/
**Trello board:** https://trello.com/b/sE51eqqh/coinpulse-wdd-330-final-project

## Features (Weeks 5–6)

- Live market data from the **CoinGecko** `/coins/markets` endpoint. Each refresh is one request that covers the whole watchlist.
- **Search** with suggestions: a local `coins.json` list is checked first, and the CoinGecko `/search` endpoint is used as a fallback. The input is debounced and supports keyboard navigation (↑ ↓ Enter Esc, and `/` to focus the search box).
- The **watchlist** is saved in `localStorage`. Coins can be added with the search box or the quick-add chips, and removed with the × button.
- **24h / 7d % change** shown in green or red, **top gainer / loser** and total watchlist volume.
- A **7-day sparkline** for each coin, drawn as inline SVG without a chart library.
- **Currency conversion** from USD to BRL or EUR using the **Frankfurter** API. The chosen currency is remembered.
- A **backup data source**: when CoinGecko rate-limits or blocks requests, prices come from the **CoinPaprika** API instead. Id matches are cached in `localStorage`.
- **Auto-refresh** every 60s. It pauses in background tabs and backs off when rate-limited, and there is a manual refresh button.
- **Loading and error states**: skeleton rows while loading, and an error banner that shows the last saved prices when the API fails.
- **Responsive layout**: a table on desktop and cards on mobile.

## Project structure

```
index.html
css/styles.css
data/coins.json       popular coins used for search suggestions + quick add
images/favicon.svg
js/main.js            entry point: state, events, refresh loop
js/coingecko.js       CoinGecko API calls
js/coinpaprika.js     backup market data when CoinGecko is unavailable
js/frankfurter.js     exchange-rate API call
js/watchlist.js       add / remove / order logic
js/storage.js         localStorage read/write
js/render.js          HTML templates and DOM updates
js/chart.js           SVG sparkline
js/currency.js        Intl.NumberFormat helpers + conversion
```

## Run locally

This is plain HTML, CSS and ES modules with no build step. Serve the folder with any static server, for example:

```
npx serve .
# or
python -m http.server
```

## Credits

- Market data: [CoinGecko API](https://www.coingecko.com/en/api)
- Backup market data: [CoinPaprika API](https://api.coinpaprika.com/)
- Exchange rates: [Frankfurter](https://frankfurter.dev/)
