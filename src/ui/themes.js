// themes: how stars and blocked cells are drawn, and the words used for them
//
// these are all optional: land(biome) is the colour a region is drawn in,
// regionBorder is the colour of the lines between regions, regionWidth their
// width, regionWobble how far in board units they wave away from straight,
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

// the words for themes of castles and farms
const CASTLE_WORDS = {
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
};

// the shire's lands: earthy colours only a little apart, and their names
const SHIRE_LANDS = {
  forest: ["#8a9b63", "the mossy dell"],
  fields: ["#c2ad72", "the barley field"],
  desert: ["#b79f78", "the fallow ground"],
  lake: ["#8fa38a", "the water meadow"],
  mountains: ["#9e9a84", "the stony heath"],
  snow: ["#b3b89a", "the high down"],
  blossom: ["#a6a26a", "the orchard"],
  fungal: ["#93876b", "the bracken moor"],
  volcanic: ["#a98e5f", "the ploughland"],
  tropics: ["#7f9a6a", "the green pasture"],
};

const TREES = ["#3e5a2c", "#4a6833", "#56763a"];
const CROPS = ["#5a4527", "#5c7a33", "#c29a3e", "#6f5a30"];

const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];

const STONES = ["#a49e91", "#9a9a94", "#b2a58c", "#8f8a80"];
const ROOFS = ["#9a5a3c", "#5d6670", "#7a5a3a", "#8c4a3a"];

// a hipped roof seen from above: a ridge along the long side, with hip lines
// down to the corners, and a little shadow cast down and right
function roof(x0, y0, x1, y1, colour) {
  const [w, h] = [x1 - x0, y1 - y0];
  const d = Math.min(w, h) / 2;
  const line = `stroke="#3b2a20" stroke-width="0.25" stroke-opacity="0.8"`;
  // the ridge runs from a to b, and each end of it meets the two corners
  // nearest that end
  const wide = w >= h;
  const [ax, ay, bx, by] = wide ? [x0 + d, y0 + d, x1 - d, y0 + d] : [x0 + d, y0 + d, x0 + d, y1 - d];
  const hips = wide
    ? `M${x0} ${y0} L${ax} ${ay} L${x0} ${y1} M${x1} ${y0} L${bx} ${by} L${x1} ${y1}`
    : `M${x0} ${y0} L${ax} ${ay} L${x1} ${y0} M${x0} ${y1} L${bx} ${by} L${x1} ${y1}`;
  return (
    `<rect x="${x0 + 0.45}" y="${y0 + 0.55}" width="${w}" height="${h}" fill="#000" fill-opacity="0.25"/>` +
    `<rect x="${x0}" y="${y0}" width="${w}" height="${h}" fill="${colour}" ${line}/>` +
    `<path d="${hips} M${ax} ${ay} L${bx} ${by}" fill="none" ${line}/>`
  );
}

// a round tower with a cone roof seen from above
function roundRoof(cx, cy, r, colour) {
  let spokes = "";
  for (let k = 0; k < 6; k++) {
    const a = (Math.PI / 3) * k;
    spokes += `M${cx} ${cy} L${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)} `;
  }
  return (
    `<circle cx="${cx + 0.4}" cy="${cy + 0.5}" r="${r}" fill="#000" fill-opacity="0.25"/>` +
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${colour}" stroke="#3b2a20" stroke-width="0.25"/>` +
    `<path d="${spokes}" stroke="#3b2a20" stroke-width="0.2" stroke-opacity="0.8"/>`
  );
}

// a shire castle seen from above, in one of a few layouts: a square bailey
// with a keep, a long bailey with a keep at one end and a hall, a round shell
// keep, or two walls one inside the other. walls get towers at most corners
// and sometimes along their sides, and often a gatehouse. the stone and roof
// colours vary too
function shireCastle(x, y, seed) {
  const rng = makeRng(seed);
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const stone = pick(STONES);
  const roofColour = pick(ROOFS);
  const edge = `stroke="#5f5a50" stroke-width="0.3"`;
  const tower = (cx, cy, r) => `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${r.toFixed(2)}" fill="${stone}" ${edge}/>`;
  // a rectangular curtain wall, with its towers and maybe a gatehouse
  const curtain = (hx, hy, t) => {
    const outer = `M${x - hx} ${y - hy} H${x + hx} V${y + hy} H${x - hx} Z`;
    const inner = `M${x - hx + t} ${y - hy + t} H${x + hx - t} V${y + hy - t} H${x - hx + t} Z`;
    let w = `<path d="${outer} ${inner}" fill="${stone}" fill-rule="evenodd" ${edge}/>`;
    const r = 0.95 + rng() * 0.3;
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      if (rng() < 0.9) w += tower(x + sx * (hx - t / 2), y + sy * (hy - t / 2), r);
    }
    for (const [sx, sy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      if (rng() < 0.25) w += tower(x + sx * (hx - t / 2), y + sy * (hy - t / 2), r * 0.8);
    }
    if (rng() < 0.6) {
      // a gatehouse: two small towers either side of a gap in one wall
      const [gx, gy] = pick([[0, 1], [0, -1], [1, 0], [-1, 0]]);
      const [px, py] = [x + gx * (hx - t / 2), y + gy * (hy - t / 2)];
      const [ox, oy] = gx ? [0, 0.9] : [0.9, 0];
      w += tower(px + ox, py + oy, 0.75) + tower(px - ox, py - oy, 0.75);
    }
    return w;
  };

  const layout = Math.floor(rng() * 4);
  if (layout === 0) {
    // a square bailey round a keep
    const h = 3.6 + rng() * 0.4;
    const k = 1.7 + rng() * 0.5;
    const [kx, ky] = [x + (rng() - 0.5) * 0.8, y + (rng() - 0.5) * 0.8];
    return curtain(h, h, 0.9) + roof(kx - k, ky - k, kx + k, ky + k, roofColour);
  }
  if (layout === 1) {
    // a long bailey, a keep at one end and a hall along the other
    const wide = rng() < 0.5;
    const [hx, hy] = wide ? [4, 2.9] : [2.9, 4];
    let s = curtain(hx, hy, 0.85);
    const k = 1.5 + rng() * 0.3;
    const end = rng() < 0.5 ? -1 : 1;
    const [kx, ky] = wide ? [x + end * (hx - 2.2), y] : [x, y + end * (hy - 2.2)];
    s += roof(kx - k, ky - k, kx + k, ky + k, roofColour);
    const [cx, cy] = wide ? [x - end * 1.1, y] : [x, y - end * 1.1];
    const [lw, lh] = wide ? [1.9, 0.9] : [0.9, 1.9];
    return s + roof(cx - lw, cy - lh, cx + lw, cy + lh, pick(ROOFS));
  }
  if (layout === 2) {
    // a round shell keep, with a round tower in the middle
    const R = 3.7 + rng() * 0.4;
    let s = `<circle cx="${x}" cy="${y}" r="${R - 0.45}" fill="none" stroke="${stone}" stroke-width="0.9"/>`;
    s += `<circle cx="${x}" cy="${y}" r="${R}" fill="none" stroke="#5f5a50" stroke-width="0.3"/>`;
    s += `<circle cx="${x}" cy="${y}" r="${R - 0.9}" fill="none" stroke="#5f5a50" stroke-width="0.3"/>`;
    const turn = rng() * Math.PI;
    for (let k = 0, n = 4 + Math.floor(rng() * 3); k < n; k++) {
      const a = turn + (2 * Math.PI * k) / n;
      s += tower(x + (R - 0.45) * Math.cos(a), y + (R - 0.45) * Math.sin(a), 0.85);
    }
    return s + roundRoof(x, y, 1.6 + rng() * 0.5, roofColour);
  }
  // two walls, one inside the other, round a small keep
  const h = 3.9 + rng() * 0.2;
  const inner = 2.4 + rng() * 0.2;
  const k = 1 + rng() * 0.3;
  return curtain(h, h, 0.7) + curtain(inner, inner, 0.6) + roof(x - k, y - k, x + k, y + k, roofColour);
}

// a shire farm: a patchwork of at least 3 fields, each a shade off the land
// around it with rows of crops one way or the other, and now and then a few
// trees standing over them
function shireFarm(x, y, biome, seed) {
  const rng = makeRng(seed);
  const land = SHIRE_LANDS[biome.name][0];
  let plots = [];
  for (let tries = 0; plots.length < 3 && tries < 50; tries++) {
    plots = fieldPlots(rng, [x - 4.4, y - 4.4, x + 4.4, y + 4.4], 0, []);
  }
  let s = "";
  for (const [x0, y0, x1, y1] of plots) {
    // dark soil, green crops or ripe gold, strong enough to stand out from
    // the pale unfarmed land
    const tone = mixColour(land, pick(rng, CROPS), 0.35 + rng() * 0.25);
    const rows = mixColour(tone, "#2e2616", 0.45);
    s += wobbly(rng, [x0, y0, x1, y1], 0.2, `fill="${tone}"`);
    const across = x1 - x0 > y1 - y0 ? rng() < 0.7 : rng() < 0.3;
    const [lo, hi] = across ? [y0, y1] : [x0, x1];
    for (let d = lo + 0.55; d < hi - 0.3; d += 0.75) {
      s += across
        ? `<line x1="${x0 + 0.3}" y1="${d.toFixed(2)}" x2="${x1 - 0.3}" y2="${d.toFixed(2)}" stroke="${rows}" stroke-width="0.25" stroke-opacity="0.85"/>`
        : `<line x1="${d.toFixed(2)}" y1="${y0 + 0.3}" x2="${d.toFixed(2)}" y2="${y1 - 0.3}" stroke="${rows}" stroke-width="0.25" stroke-opacity="0.85"/>`;
    }
  }
  if (rng() < 0.35) {
    // a few trees together, somewhere in the cell
    const [cx, cy] = [x + (rng() - 0.5) * 4, y + (rng() - 0.5) * 4];
    const trees = [];
    for (let k = 0, n = 2 + Math.floor(rng() * 4); k < n; k++) {
      trees.push([cx + (rng() - 0.5) * 3.5, cy + (rng() - 0.5) * 3.5, 0.9 + rng() * 0.7, TREES[Math.floor(rng() * TREES.length)]]);
    }
    for (const [tx, ty, r] of trees) {
      s += `<circle cx="${(tx + 0.35).toFixed(2)}" cy="${(ty + 0.45).toFixed(2)}" r="${r.toFixed(2)}" fill="#000" fill-opacity="0.2"/>`;
    }
    for (const [tx, ty, r, c] of trees) {
      s += `<circle cx="${tx.toFixed(2)}" cy="${ty.toFixed(2)}" r="${r.toFixed(2)}" fill="${c}"/>`;
    }
  }
  return s;
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
    words: CASTLE_WORDS,
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

  shire: {
    label: "shire",
    icon: "🌳",
    // unfarmed land is pale, so the farms stand out on it
    land: (biome) => mixColour(SHIRE_LANDS[biome.name][0], "#eef0e4", 0.3),
    regionName: (biome) => SHIRE_LANDS[biome.name][1],
    // hedgerows between the lands
    regionBorder: "#3f5a2c",
    regionWidth: 1.3,
    regionWobble: 0.22,
    regionWaves: 6,
    star: (x, y, biome, seed) => shireCastle(x, y, seed),
    blocked: shireFarm,
    // a dirt track
    road: (d) =>
      `<path d="${d}" pathLength="1" fill="none" stroke="#9b8257" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/>`,
    words: CASTLE_WORDS,
  },
};

export const DEFAULT_THEME = "grays";
