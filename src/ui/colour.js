// colour helpers shared by the renderer and themes

export const PALE = "#f4f6f6";

// mix hex colour `a` part way, t from 0 to 1, towards hex colour `b`
export function mixColour(a, b, t) {
  const rgb = (hex) => [1, 3, 5].map((p) => parseInt(hex.slice(p, p + 2), 16));
  const [x, y] = [rgb(a), rgb(b)];
  const hex = (v) => Math.round(v).toString(16).padStart(2, "0");
  return `#${x.map((v, k) => hex(v + (y[k] - v) * t)).join("")}`;
}

// the soft shade a region's colour is drawn in on the board
export const landColour = (hex) => mixColour(hex, PALE, 0.38);

// a light colour with the hue of `hex`, its saturation scaled by `boost`
// (capped at 1), and the given lightness from 0 to 1
export function tint(hex, lightness, boost) {
  const [r, g, b] = [1, 3, 5].map((p) => parseInt(hex.slice(p, p + 2), 16) / 255);
  const hi = Math.max(r, g, b);
  const lo = Math.min(r, g, b);
  const l = (hi + lo) / 2;
  const d = hi - lo;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d !== 0) {
    if (hi === r) h = ((g - b) / d) % 6;
    else if (hi === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  // back from hue, saturation and lightness to rgb
  const sat = Math.min(1, s * boost);
  const c = (1 - Math.abs(2 * lightness - 1)) * sat;
  const x = c * (1 - Math.abs((((h % 6) + 6) % 6 % 2) - 1));
  const m = lightness - c / 2;
  const sector = Math.floor((((h % 6) + 6) % 6));
  const [r1, g1, b1] = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ][sector];
  const hex2 = (v) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${hex2(r1)}${hex2(g1)}${hex2(b1)}`;
}
