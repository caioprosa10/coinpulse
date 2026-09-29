// Formatting helpers built on Intl.NumberFormat + USD -> other currency conversion.

export const CURRENCIES = ["USD", "BRL", "EUR"];

const LOCALES = {
  USD: "en-US",
  BRL: "pt-BR",
  EUR: "de-DE",
};

// convert a value in USD using the rates object ({ USD: 1, BRL: 5.2, ... })
export function convert(usdValue, currency, rates) {
  if (usdValue === null || usdValue === undefined) return null;
  const rate = rates?.[currency];
  if (!rate) return null;
  return usdValue * rate;
}

// cheap coins (e.g. SHIB, PEPE) need more decimals than BTC
function fractionDigits(value) {
  const abs = Math.abs(value);
  if (abs >= 1) return 2;
  if (abs >= 0.01) return 4;
  if (abs >= 0.0001) return 6;
  return 8;
}

export function formatPrice(value, currency = "USD") {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const digits = fractionDigits(value);
  return new Intl.NumberFormat(LOCALES[currency] ?? "en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: digits,
  }).format(value);
}

// 58_000_000_000 -> "$58B"
export function formatCompact(value, currency = "USD") {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat(LOCALES[currency] ?? "en-US", {
    style: "currency",
    currency,
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

// "up" | "down" | "flat" — used to pick green/red CSS classes
export function trendOf(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "flat";
  if (value > 0) return "up";
  if (value < 0) return "down";
  return "flat";
}
