// Draws the 7-day sparkline as an inline SVG — no chart library needed.

let gradientId = 0;

// CoinGecko sends ~168 hourly points; ~50 is plenty for a small chart
export function downsample(values, maxPoints = 56) {
  if (values.length <= maxPoints) return values;
  const step = (values.length - 1) / (maxPoints - 1);
  return Array.from({ length: maxPoints }, (_, i) => values[Math.round(i * step)]);
}

/**
 * @param {number[]} prices  array of prices (oldest -> newest)
 * @param {{width?: number, height?: number, trend?: "up"|"down"|"flat"}} options
 * @returns {string} SVG markup
 */
export function sparklineSvg(prices = [], { width = 140, height = 40, trend } = {}) {
  const points = downsample(prices.filter(Number.isFinite));
  if (points.length < 2) {
    return `<span class="sparkline sparkline--empty">No chart data</span>`;
  }

  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1; // avoid dividing by 0 for stablecoins
  const padding = 3;

  // map each price to an x/y position inside the SVG box
  const coords = points.map((price, i) => {
    const x = (i / (points.length - 1)) * width;
    const y = padding + (1 - (price - min) / range) * (height - padding * 2);
    return [x.toFixed(1), y.toFixed(1)];
  });

  const line = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x} ${y}`).join(" ");
  const area = `${line} L${width} ${height} L0 ${height} Z`;
  const direction = trend ?? (points.at(-1) >= points[0] ? "up" : "down");
  const id = `spark-${++gradientId}`;

  return `<svg class="sparkline sparkline--${direction}" viewBox="0 0 ${width} ${height}"
    preserveAspectRatio="none" role="img" aria-label="7-day trend: ${direction}">
    <defs>
      <linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="currentColor" stop-opacity="0.35" />
        <stop offset="100%" stop-color="currentColor" stop-opacity="0" />
      </linearGradient>
    </defs>
    <path d="${area}" fill="url(#${id})" />
    <path d="${line}" fill="none" stroke="currentColor" stroke-width="1.75"
      stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" />
  </svg>`;
}
