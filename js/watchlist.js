// Core add / remove logic for the user's list of coins.
import { saveWatchlist } from "./storage.js";

export default class Watchlist {
  constructor(ids = []) {
    // a Set removes duplicates but keeps the order the coins were added
    this.ids = [...new Set(ids)];
  }

  get size() {
    return this.ids.length;
  }

  has(id) {
    return this.ids.includes(id);
  }

  /** @returns {boolean} false when the coin was already in the list */
  add(id) {
    if (!id || this.has(id)) return false;
    this.ids.push(id);
    saveWatchlist(this.ids);
    return true;
  }

  /** @returns {boolean} false when the coin was not in the list */
  remove(id) {
    if (!this.has(id)) return false;
    this.ids = this.ids.filter((item) => item !== id);
    saveWatchlist(this.ids);
    return true;
  }

  toArray() {
    return [...this.ids];
  }

  // keep the coins in the same order as the watchlist (API returns them by market cap)
  sortByWatchlist(coins) {
    const position = new Map(this.ids.map((id, index) => [id, index]));
    return [...coins]
      .filter((coin) => position.has(coin.id))
      .sort((a, b) => position.get(a.id) - position.get(b.id));
  }
}
