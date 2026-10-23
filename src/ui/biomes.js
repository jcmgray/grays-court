// a colour per region, with names for tips and an emoji for the share text

import { shuffle } from "../core/rng.js";

export const BIOMES = [
  { name: "forest", label: "the green forest", colour: "green", color: "#74c26d", glyph: "🌲" },
  { name: "fields", label: "the yellow meadow", colour: "yellow", color: "#f2cf45", glyph: "🌾" },
  { name: "desert", label: "the orange desert", colour: "orange", color: "#f0a457", glyph: "🌵" },
  { name: "lake", label: "the blue lake", colour: "blue", color: "#66ade8", glyph: "🌊" },
  { name: "mountains", label: "the grey mountain", colour: "grey", color: "#a59a8d", glyph: "🗻" },
  { name: "snow", label: "the white tundra", colour: "white", color: "#b3c2d4", glyph: "🧊" },
  { name: "blossom", label: "the pink grove", colour: "pink", color: "#f292b6", glyph: "🌸" },
  { name: "fungal", label: "the purple mushroom wood", colour: "purple", color: "#b391e6", glyph: "🍄" },
  { name: "volcanic", label: "the red volcano", colour: "red", color: "#e66f59", glyph: "🌋" },
  { name: "tropics", label: "the teal jungle", colour: "teal", color: "#4fc4ae", glyph: "🌴" },
];

// biomes whose colours are easy to mix up
const LOOKALIKES = [
  ["snow", "mountains"],
  ["volcanic", "blossom"],
  ["fields", "desert"],
  ["lake", "tropics"],
  ["forest", "fungal"],
];

// every ordering of an array
function permutations(arr) {
  if (arr.length <= 1) return [arr];
  return arr.flatMap((x, i) => permutations([...arr.slice(0, i), ...arr.slice(i + 1)]).map((p) => [x, ...p]));
}

// a biome for each region, keeping lookalikes far apart. regions are split
// into a top and a bottom half, and each pair gets a region in each. the top
// and bottom regions are matched up so that the fewest matched regions touch
// and they sit furthest apart. which pair goes where, and which way round,
// is random
export function biomesFor(board, rng) {
  const byName = Object.fromEntries(BIOMES.map((b) => [b.name, b]));
  const half = LOOKALIKES.length;
  const regions = Array.from({ length: board.nregions }, (_, g) => g);
  if (board.nregions !== 2 * half) return regions.map((g) => BIOMES[g % BIOMES.length]);

  const cells = (g) => board.units[2 * board.n + g].cells;
  const mean = (g, f) => cells(g).reduce((s, i) => s + f(i), 0) / cells(g).length;
  const centre = regions.map((g) => [mean(g, board.rowOf), mean(g, board.colOf)]);
  const touches = (a, b) => cells(a).some((i) => board.neighbours[i].some((j) => board.regions[j] === b));
  const cost = (a, b) => (touches(a, b) ? 100 : 0) - Math.hypot(centre[a][0] - centre[b][0], centre[a][1] - centre[b][1]);

  const ranked = [...regions].sort((a, b) => centre[a][0] - centre[b][0]);
  const top = ranked.slice(0, half);
  let best = null;
  let bestCost = Infinity;
  for (const bottom of permutations(ranked.slice(half))) {
    const c = top.reduce((sum, a, k) => sum + cost(a, bottom[k]), 0);
    if (c < bestCost) [best, bestCost] = [bottom, c];
  }

  const pairs = shuffle(rng, LOOKALIKES.map((pair) => (rng() < 0.5 ? pair : [...pair].reverse())));
  const out = [];
  top.forEach((a, k) => {
    out[a] = byName[pairs[k][0]];
    out[best[k]] = byName[pairs[k][1]];
  });
  return out;
}
