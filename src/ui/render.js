// svg renderer for the board, kept apart from the game logic so another
// renderer (eg 3d) can take its place

import { ROAD, CASTLE } from "../core/rules.js";
import { hashString, makeRng } from "../core/rng.js";
import { landColour } from "./colour.js";

const S = 10;
const NS = "http://www.w3.org/2000/svg";

// ms before a new rule break shows in red
const BREAK_DELAY = 600;

// ms between each shape of a cell growing in, and between cells that appear
// together, eg the farms auto filled round a new castle
const GROW_STAGGER = 40;
const CELL_STAGGER = 15;

const centre = (board, i) => [board.colOf(i) * S + S / 2, board.rowOf(i) * S + S / 2];

// a shortest path of cells from a to b that stays inside their region,
// stepping only up, down, left or right. of the shortest paths it takes one
// with the fewest turns, so castles in a line get a straight road
function regionPath(board, a, b) {
  const n = board.n;
  const g = board.regions[a];
  const steps = [-n, n, -1, 1];
  // search over (cell, direction came in), costing 1000 a step and 1 a turn
  const key = (i, d) => i * 4 + d;
  const best = new Map();
  const from = new Map();
  let queue = [];
  for (let d = 0; d < 4; d++) {
    best.set(key(a, d), 0);
    queue.push([0, a, d]);
  }
  let end = null;
  while (queue.length) {
    queue.sort((x, y) => x[0] - y[0]);
    const [cost, i, d] = queue.shift();
    if (cost > best.get(key(i, d))) continue;
    if (i === b) {
      end = key(i, d);
      break;
    }
    for (let e = 0; e < 4; e++) {
      const j = i + steps[e];
      if (j < 0 || j >= board.N || board.regions[j] !== g) continue;
      if (Math.abs(board.colOf(j) - board.colOf(i)) > 1) continue;
      const next = cost + 1000 + (e === d || i === a ? 0 : 1);
      if (next < (best.get(key(j, e)) ?? Infinity)) {
        best.set(key(j, e), next);
        from.set(key(j, e), key(i, d));
        queue.push([next, j, e]);
      }
    }
  }
  const path = [];
  for (let k = end; k !== undefined; k = from.get(k)) path.push(Math.floor(k / 4));
  return path.reverse();
}

export function createRenderer(svg) {
  // region borders go near the end so they stay on top, for play, with only
  // the bits of stars meant to sit over them, and the board edge, above
  const layers = ["base", "blocked", "land", "grid", "top", "stars", "regions", "star-tops", "edge"].map((name) => {
    const g = document.createElementNS(NS, "g");
    g.setAttribute("class", name);
    svg.append(g);
    return g;
  });
  const [base, blockedLayer, land, grid, top, starLayer, regionLayer, starTopLayer, edgeLayer] = layers;
  let staticFor = null;
  // a fixed random seed per cell, for themes that draw cells at random
  let seeds = [];
  // star and blocked cell elements by cell, kept between renders so each
  // grows in once, when it first appears. nothing grows on the first render
  // of a board or theme
  let starEls = new Map();
  let starTopEls = new Map();
  let blockedEls = new Map();
  let roadEls = new Map();
  let piecesFor = null;
  let animate = false;

  // give each key in `wanted` an element, drawn by draw(key), and drop the
  // rest. new elements get the css class `anim` on each of their shapes
  function syncCells(layer, els, wanted, cls, draw, anim = "grow") {
    let batch = 0;
    for (const i of wanted) {
      if (els.has(i)) continue;
      const g = document.createElementNS(NS, "g");
      g.setAttribute("class", cls);
      g.innerHTML = draw(i);
      if (animate) {
        const start = batch++ * CELL_STAGGER;
        [...g.children].forEach((c, k) => {
          c.classList.add(anim);
          c.style.animationDelay = `${start + k * GROW_STAGGER}ms`;
        });
      }
      layer.append(g);
      els.set(i, g);
    }
    for (const [i, g] of els) {
      if (!wanted.has(i)) {
        g.remove();
        els.delete(i);
      }
    }
  }
  // when each rule break was first seen, so new ones fade in after a pause
  // and don't flash up while tapping through road to castle
  let breakSeen = new Map();
  // cell edges between regions, and the rest inside regions, each as
  // [x1, y1, x2, y2]
  let regionEdges = [];
  let gridEdges = [];

  function drawStatic(board, biomes) {
    const n = board.n;
    svg.setAttribute("viewBox", `-1 -1 ${n * S + 2} ${n * S + 2}`);
    let b = "";
    for (let i = 0; i < board.N; i++) {
      const x = board.colOf(i) * S;
      const y = board.rowOf(i) * S;
      const fill = landColour(biomes[board.regions[i]].color);
      b += `<rect x="${x}" y="${y}" width="${S}" height="${S}" fill="${fill}"/>`;
    }
    base.innerHTML = b;

    // the cell edges, for drawBorders
    regionEdges = [];
    gridEdges = [];
    const edge = (x1, y1, x2, y2, between) => (between ? regionEdges : gridEdges).push([x1, y1, x2, y2]);
    for (let i = 0; i < board.N; i++) {
      const r = board.rowOf(i);
      const c = board.colOf(i);
      if (c < n - 1) edge((c + 1) * S, r * S, (c + 1) * S, (r + 1) * S, board.regions[i] !== board.regions[i + 1]);
      if (r < n - 1) edge(c * S, (r + 1) * S, (c + 1) * S, (r + 1) * S, board.regions[i] !== board.regions[i + n]);
    }

    // keep stars, eg castle walls, from drawing outside the board
    let clip = svg.querySelector("#board-clip");
    if (!clip) {
      const defs = document.createElementNS(NS, "defs");
      defs.innerHTML = `<clipPath id="board-clip"><rect/></clipPath>`;
      svg.prepend(defs);
      clip = svg.querySelector("#board-clip");
    }
    const rect = clip.querySelector("rect");
    rect.setAttribute("width", n * S);
    rect.setAttribute("height", n * S);
    starLayer.setAttribute("clip-path", "url(#board-clip)");
    starTopLayer.setAttribute("clip-path", "url(#board-clip)");
  }

  // the region borders, grid lines and board edge, straight, or for themes
  // with a regionWobble each cell edge a small wave of regionWaves half
  // waves, up to regionWobble either side. the wave sizes are fixed per
  // board, and every edge still starts and ends on the cell corners, so the
  // lines join up
  function drawBorders(board, theme) {
    const rng = makeRng(hashString(`${board.regions}:borders`));
    const wobble = theme.regionWobble ?? 0;
    const waves = theme.regionWaves ?? 1;
    const steps = 6 * waves;
    // the points along one wavy edge, leaving out its first corner, with
    // the wobble scaled by `scale`
    const wave = ([x1, y1, x2, y2], scale = 1) => {
      const [nx, ny] = [-(y2 - y1) / S, (x2 - x1) / S];
      const size = scale * wobble * (0.6 + 0.4 * rng()) * (rng() < 0.5 ? -1 : 1);
      const pts = [];
      for (let k = 1; k <= steps; k++) {
        const t = k / steps;
        const push = size * Math.sin(Math.PI * waves * t);
        pts.push(`${(x1 + (x2 - x1) * t + nx * push).toFixed(2)} ${(y1 + (y2 - y1) * t + ny * push).toFixed(2)}`);
      }
      return pts;
    };
    const draw = (e) => {
      if (!wobble) return `<line x1="${e[0]}" y1="${e[1]}" x2="${e[2]}" y2="${e[3]}"/>`;
      return `<path d="M${e[0]} ${e[1]} L${wave(e).join(" L")}"/>`;
    };
    grid.innerHTML = gridEdges.map(draw).join("");

    // the board edge, as one wavy loop of cell edges round the outside, a
    // bit calmer than the lines inside
    const size = board.n * S;
    let outline = `<rect class="outline" x="0" y="0" width="${size}" height="${size}" rx="1.2"/>`;
    if (wobble) {
      const pts = [];
      const corners = [[0, 0], [size, 0], [size, size], [0, size], [0, 0]];
      for (let side = 0; side < 4; side++) {
        const [ax, ay] = corners[side];
        const [bx, by] = corners[side + 1];
        for (let k = 0; k < board.n; k++) {
          const [t0, t1] = [k / board.n, (k + 1) / board.n];
          pts.push(...wave([ax + (bx - ax) * t0, ay + (by - ay) * t0, ax + (bx - ax) * t1, ay + (by - ay) * t1], 0.6));
        }
      }
      outline = `<path class="outline" d="M0 0 L${pts.join(" L")} Z"/>`;
    }
    regionLayer.innerHTML = `<g class="region-borders">${regionEdges.map(draw).join("")}</g>`;
    edgeLayer.innerHTML = outline;
  }

  // model: board, theme, biomes (per region), display (per cell), breaks
  // {cells, units}, mistakes (set of cells), tip {units, stars, blocked} or
  // null, solved
  function render(model) {
    const { board, theme, biomes, display, breaks, mistakes, tip, solved } = model;
    if (staticFor !== board) {
      drawStatic(board, biomes);
      staticFor = board;
      seeds = Array.from({ length: board.N }, (_, i) => hashString(`${board.regions}:${i}`));
    }
    svg.style.setProperty("--region-border", theme.regionBorder ?? "");
    if (piecesFor !== `${board.regions}:${theme.label}`) {
      starLayer.innerHTML = "";
      starTopLayer.innerHTML = "";
      blockedLayer.innerHTML = "";
      land.innerHTML = "";
      starEls = new Map();
      starTopEls = new Map();
      blockedEls = new Map();
      roadEls = new Map();
      piecesFor = `${board.regions}:${theme.label}`;
      animate = false;
      drawBorders(board, theme);
    }

    const blocked = new Set();
    display.forEach((v, i) => v === ROAD && blocked.add(i));
    syncCells(blockedLayer, blockedEls, blocked, "blocked-cell", (i) => {
      const [x, y] = centre(board, i);
      return theme.blocked(x, y, biomes[board.regions[i]], seeds[i]);
    });

    // once a region has all its stars, a road joins them up, for themes
    // that draw one. keyed by the cells it runs through
    const roads = new Set();
    if (theme.road) {
      for (const unit of board.units) {
        if (unit.kind !== "region") continue;
        const stars = unit.cells.filter((i) => display[i] === CASTLE);
        if (stars.length !== board.k || stars.length < 2) continue;
        for (let s = 1; s < stars.length; s++) {
          roads.add(regionPath(board, stars[s - 1], stars[s]).join(","));
        }
      }
    }
    // the road runs between the stars' cells, stopping just outside each, 0.63
    // of the way along the first and last steps. that is just under the outer
    // edge of a castle wall, so the road meets the wall without a gap
    syncCells(
      land,
      roadEls,
      roads,
      "road",
      (key) => {
        const cells = key.split(",").map(Number);
        const pts = cells.map((i) => centre(board, i));
        const along = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        const n = pts.length;
        const line = [along(pts[0], pts[1], 0.63), ...pts.slice(1, -1), along(pts[n - 1], pts[n - 2], 0.63)];
        return theme.road(`M${line.map(([x, y]) => `${x} ${y}`).join(" L")}`, biomes[board.regions[cells[0]]]);
      },
      "draw",
    );

    const now = performance.now();
    const seen = new Map();
    const delay = (key) => {
      const first = breakSeen.get(key) ?? now;
      seen.set(key, first);
      return ` style="animation-delay:${Math.round(first + BREAK_DELAY - now)}ms"`;
    };

    let t = "";
    for (const ui of breaks.units) {
      const d = delay(`u${ui}`);
      for (const i of board.units[ui].cells) {
        const [x, y] = centre(board, i);
        t += `<rect class="bad-unit"${d} x="${x - S / 2}" y="${y - S / 2}" width="${S}" height="${S}"/>`;
      }
    }
    if (tip) {
      // dim everything outside the units the tip is about, keeping their
      // colours true to the names in the text
      if (tip.units.length) {
        const lit = new Set(tip.units.flatMap((ui) => board.units[ui].cells));
        for (let i = 0; i < board.N; i++) {
          if (lit.has(i)) continue;
          const [x, y] = centre(board, i);
          t += `<rect class="tip-dim" x="${x - S / 2}" y="${y - S / 2}" width="${S}" height="${S}"/>`;
        }
      }
      for (const i of tip.blocked) {
        const [x, y] = centre(board, i);
        t += `<rect class="tip-blocked" x="${x - S / 2 + 1}" y="${y - S / 2 + 1}" width="${S - 2}" height="${S - 2}" rx="1.6"/>`;
      }
      for (const i of tip.stars) {
        const [x, y] = centre(board, i);
        t += `<rect class="tip-star" x="${x - S / 2 + 1}" y="${y - S / 2 + 1}" width="${S - 2}" height="${S - 2}" rx="1.6"/>`;
        t += `<g class="tip-ghost">${theme.star(x, y, biomes[board.regions[i]], seeds[i])}</g>`;
      }
    }
    for (const i of mistakes) {
      const [x, y] = centre(board, i);
      t += `<rect class="mistake" x="${x - S / 2 + 0.8}" y="${y - S / 2 + 0.8}" width="${S - 1.6}" height="${S - 1.6}" rx="1.5"/>`;
    }
    const stars = new Set();
    display.forEach((v, i) => {
      if (v !== CASTLE) return;
      stars.add(i);
      const [x, y] = centre(board, i);
      if (breaks.cells.has(i)) t += `<circle class="bad-star"${delay(`c${i}`)} cx="${x}" cy="${y}" r="4.4"/>`;
    });
    syncCells(starLayer, starEls, stars, "star", (i) => {
      const [x, y] = centre(board, i);
      return theme.star(x, y, biomes[board.regions[i]], seeds[i]);
    });
    syncCells(starTopLayer, starTopEls, theme.starTop ? stars : new Set(), "star-top", (i) => {
      const [x, y] = centre(board, i);
      return theme.starTop(x, y, biomes[board.regions[i]], seeds[i]);
    });
    let starIndex = 0;
    for (const g of starEls.values()) {
      g.style.animationDelay = solved ? `${(starIndex++ * 0.06).toFixed(2)}s` : "";
    }
    breakSeen = seen;
    top.innerHTML = t;
    svg.classList.toggle("solved", !!solved);
    animate = true;
  }

  // which cell a pointer event is over, or -1
  function cellAt(board, e) {
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.getScreenCTM().inverse());
    const c = Math.floor(pt.x / S);
    const r = Math.floor(pt.y / S);
    if (r < 0 || c < 0 || r >= board.n || c >= board.n) return -1;
    return r * board.n + c;
  }

  return { render, cellAt };
}
