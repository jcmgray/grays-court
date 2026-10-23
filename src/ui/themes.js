// themes: how stars and blocked cells are drawn, and the words used for them
//
// these are all optional: regionBorder is the colour of the lines between
// regions, regionWobble how far in board units they wave away from straight,
// with regionWaves half waves along each cell edge, and road(d, biome) draws
// the road along svg path d that joins up a region's stars once it has them
// all, between the edges of their cells
//
// star(x, y, biome, seed) and blocked(x, y, biome, seed) give svg for one
// cell centred on x, y, in board units where a cell is 10 across. seed is
// fixed per cell, so anything random looks the same every time the cell is
// drawn. starTop(x, y, biome, seed), if given, is more svg for a star that
// goes over the region borders

import { makeRng, shuffle } from "../core/rng.js";
import { landColour, mixColour, tint } from "./colour.js";

// a five pointed star as svg polygon points
function starPoints(x, y, outer, inner) {
  const pts = [];
  for (let k = 0; k < 10; k++) {
    const r = k % 2 ? inner : outer;
    const a = (Math.PI / 5) * k - Math.PI / 2;
    pts.push(`${(x + r * Math.cos(a)).toFixed(2)},${(y + r * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(" ");
}

// a box [x0, y0, x1, y1] as a polygon with each corner nudged at random
function wobbly(rng, [x0, y0, x1, y1], wobble, attrs) {
  const nudge = () => (rng() * 2 - 1) * wobble;
  const pts = [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ].map(([a, b]) => `${(a + nudge()).toFixed(2)},${(b + nudge()).toFixed(2)}`);
  return `<polygon points="${pts.join(" ")}" ${attrs}/>`;
}

const GAP = 0.8;

// split a box into field plots: a few parallel strips, one block, or two
// halves that are split again
function fieldPlots(rng, box, depth, out) {
  const [x0, y0, x1, y1] = box;
  const r = rng();
  if (depth === 0 ? r < 0.65 : depth < 2 && r < 0.3) {
    const t = 0.35 + rng() * 0.3;
    if (rng() < 0.5) {
      const xm = x0 + (x1 - x0) * t;
      fieldPlots(rng, [x0, y0, xm - GAP / 2, y1], depth + 1, out);
      fieldPlots(rng, [xm + GAP / 2, y0, x1, y1], depth + 1, out);
    } else {
      const ym = y0 + (y1 - y0) * t;
      fieldPlots(rng, [x0, y0, x1, ym - GAP / 2], depth + 1, out);
      fieldPlots(rng, [x0, ym + GAP / 2, x1, y1], depth + 1, out);
    }
  } else if (r < 0.8) {
    const across = rng() < 0.5;
    const len = across ? y1 - y0 : x1 - x0;
    const most = Math.max(1, Math.floor((len + GAP) / (1.3 + GAP)));
    const n = Math.min(most, 2 + Math.floor(rng() * 3));
    const w = (len - GAP * (n - 1)) / n;
    for (let k = 0; k < n; k++) {
      const a = k * (w + GAP);
      out.push(across ? [x0, y0 + a, x1, y0 + a + w] : [x0 + a, y0, x0 + a + w, y1]);
    }
  } else {
    out.push(box);
  }
  return out;
}

// a cluster of overlapping buildings: either four round a hall in the
// middle, or a keep with small towers about it. gives the hall or keep as
// main, and the rest as others
function buildings(rng) {
  const size = (lo, hi) => lo + rng() * (hi - lo);
  const out = [];
  let main;
  if (rng() < 0.5) {
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const inner = size(0.2, 0.6);
      const outer = size(3.6, 4.2);
      const [a, b] = sx < 0 ? [-outer, -inner] : [inner, outer];
      const [c, d] = sy < 0 ? [-outer, -inner] : [inner, outer];
      out.push([a, c, b, d]);
    }
    const h = size(1.8, 2.6);
    main = [-h, -h, h, h];
  } else {
    const h = size(2.2, 2.9);
    main = [-h, -h, h, h];
    const spots = [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]];
    const count = 4 + Math.floor(rng() * 3);
    for (const [sx, sy] of shuffle(rng, spots).slice(0, count)) {
      const t = size(0.8, 1.3);
      const cx = sx * size(2.8, 3.2);
      const cy = sy * size(2.8, 3.2);
      out.push([cx - t, cy - t, cx + t, cy + t]);
    }
  }
  return { main, others: out };
}

// a wall round a castle, as a band between two squares to fill with the even
// odd rule. it sits just outside the cell, with the inner edge clear of the
// region border so that stays visible, and the outer edge wonky
function wall(rng, x, y, inner, outer, wobble) {
  const square = (half, lo, hi) =>
    [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]
      .map(([sx, sy]) => {
        const a = x + sx * (half + lo + rng() * (hi - lo));
        const b = y + sy * (half + lo + rng() * (hi - lo));
        return `${a.toFixed(2)},${b.toFixed(2)}`;
      })
      .join(" L");
  return `M${square(outer, -wobble, wobble)} Z M${square(inner, 0, 0.1)} Z`;
}

// a grays court castle wall, with its own fixed wobble per castle
function castleWall(x, y, biome, seed, opacity) {
  const rng = makeRng(seed ^ 0x51ed270b);
  const fill = tint(biome.color, 0.86 + 0.14 * 0.6, 1);
  return `<path d="${wall(rng, x, y, 5.45, 6.2, 0.25)}" fill="${fill}" fill-opacity="${opacity}" fill-rule="evenodd"/>`;
}

export const THEMES = {
  grays: {
    label: "grays court",
    icon: "🏰",
    // winding river blue between the lands
    regionBorder: "#1447b3",
    regionWobble: 0.1,
    regionWaves: 3,
    // solid shapes in white mixed with the land colour, so they sit cleanly
    // over borders and grid lines
    star(x, y, biome, seed) {
      const rng = makeRng(seed);
      // bright white with a faint touch of the land's hue
      const white = (t) => tint(biome.color, 0.86 + 0.14 * t, 1);
      const { main, others } = buildings(rng);
      const draw = ([a, b, c, d], fill) => wobbly(rng, [x + a, y + b, x + c, y + d], 0.35, `fill="${fill}"`);
      const houses = others.map((box) => draw(box, white(0.7))).join("") + draw(main, white(0.92));
      return castleWall(x, y, biome, seed, 1) + houses;
    },
    // the wall again at half strength, so rivers it crosses show through
    // faintly, then round turrets on it, at most of its corners and often
    // midway along a side. drawn over the region borders
    starTop(x, y, biome, seed) {
      const rng = makeRng(seed ^ 0x9e3779b9);
      const spots = [];
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        if (rng() < 0.85) spots.push([sx, sy]);
      }
      for (const [sx, sy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
        if (rng() < 0.45) spots.push([sx, sy]);
      }
      const fill = tint(biome.color, 0.86 + 0.14 * 0.7, 1);
      const turrets = spots
        .map(([sx, sy]) => {
          const r = 0.6 + rng() * 0.3;
          return `<circle cx="${(x + sx * 5.85).toFixed(2)}" cy="${(y + sy * 5.85).toFixed(2)}" r="${r.toFixed(2)}" fill="${fill}"/>`;
        })
        .join("");
      return castleWall(x, y, biome, seed, 0.5) + turrets;
    },
    // the same shade as the field plots, with an edge of bare land either
    // side to keep it clear of the plots it runs over
    road(d, biome) {
      const land = landColour(biome.color);
      const colour = mixColour(land, "#000000", 0.5);
      const line = (stroke, width) =>
        `<path d="${d}" pathLength="1" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;
      return line(land, 2.6) + line(colour, 1.3);
    },
    blocked(x, y, biome, seed) {
      const rng = makeRng(seed);
      // redraw until there are at least 3 plots, so no farm is one big block
      let plots = [];
      for (let tries = 0; plots.length < 3 && tries < 50; tries++) {
        plots = fieldPlots(rng, [x - 4.3, y - 4.3, x + 4.3, y + 4.3], 0, []);
      }
      return plots
        .map((box) => wobbly(rng, box, 0.3, 'fill="#000" fill-opacity="0.5"'))
        .join("");
    },
    regionName: (biome) => biome.label,
    words: {
      star: "castle",
      stars: "castles",
      place: "build",
      placed: "built",
      blockedOne: "farm",
      blocked: "farmland",
      region: "land",
      done: "the realm is complete",
      auto: "auto-roads",
      autoBadge: "🛤️ auto-roads",
    },
  },

  classic: {
    label: "classic",
    icon: "⭐",
    star: (x, y) =>
      `<polygon points="${starPoints(x, y + 0.3, 3.5, 1.8)}" fill="#f7c843" stroke="#8a3d08" stroke-width="0.25" stroke-linejoin="round"/>`,
    blocked: (x, y) => {
      const d = 1.25;
      const line = (x1, y1, x2, y2) =>
        `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#464b4d" stroke-width="0.65" stroke-linecap="round"/>`;
      return line(x - d, y - d, x + d, y + d) + line(x - d, y + d, x + d, y - d);
    },
    regionName: (biome) => `the ${biome.colour} region`,
    words: {
      star: "star",
      stars: "stars",
      place: "place",
      placed: "placed",
      blockedOne: "cross",
      blocked: "crossed out",
      region: "region",
      done: "puzzle complete",
      auto: "auto-crosses",
      autoBadge: "🤖 auto-crosses",
    },
  },
};

export const DEFAULT_THEME = "grays";
