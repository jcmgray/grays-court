// random puzzle generator
//
//   1. place a random valid set of stars, ignoring regions
//   2. grow a territory out from each star, then merge them k at a time
//      into n connected regions, each holding k stars
//   3. while there is a second solution, move one of its stars into a
//      neighbouring region, which breaks it but keeps the first solution
//   4. grade with the logic solver

import { makeBoard, orthoNeighbours, encodeRegions } from "./board.js";
import { findSolutions } from "./solver.js";
import { solveLogically } from "./logic.js";
import { randint, shuffle } from "./rng.js";

// k stars per row and col, none touching, as a sorted list of cells
export function randomStars(rng, n, k) {
  const colCount = new Array(n).fill(0);
  const rows = [];

  function rowOptions(prev) {
    const out = [];
    const rec = (start, acc) => {
      if (acc.length === k) {
        out.push(acc.slice());
        return;
      }
      for (let c = start; c < n; c++) {
        if (acc.length && c - acc[acc.length - 1] < 2) continue;
        if (colCount[c] >= k) continue;
        if (prev.some((p) => Math.abs(p - c) <= 1)) continue;
        acc.push(c);
        rec(c + 1, acc);
        acc.pop();
      }
    };
    rec(0, []);
    return shuffle(rng, out);
  }

  function rec(r) {
    if (r === n) return true;
    for (const opt of rowOptions(r > 0 ? rows[r - 1] : [])) {
      opt.forEach((c) => colCount[c]++);
      // every col must still be able to reach k
      if (colCount.every((x) => k - x <= n - r - 1)) {
        rows.push(opt);
        if (rec(r + 1)) return true;
        rows.pop();
      }
      opt.forEach((c) => colCount[c]--);
    }
    return false;
  }

  rec(0);
  return rows.flatMap((cols, r) => cols.map((c) => r * n + c)).sort((a, b) => a - b);
}

// grow one territory per star at random until the board is covered
function growTerritories(rng, n, stars) {
  const terr = new Array(n * n).fill(-1);
  const frontier = [];
  stars.forEach((s, t) => {
    terr[s] = t;
    for (const j of orthoNeighbours(n, s)) frontier.push([j, t]);
  });
  while (frontier.length) {
    const a = randint(rng, frontier.length);
    const [i, t] = frontier[a];
    frontier[a] = frontier[frontier.length - 1];
    frontier.pop();
    if (terr[i] !== -1) continue;
    terr[i] = t;
    for (const j of orthoNeighbours(n, i)) {
      if (terr[j] === -1) frontier.push([j, t]);
    }
  }
  return terr;
}

// partition territories into connected groups of size k, or null
function groupTerritories(rng, n, terr, T, k) {
  const adj = Array.from({ length: T }, () => new Set());
  terr.forEach((t, i) => {
    for (const j of orthoNeighbours(n, i)) if (terr[j] !== t) adj[t].add(terr[j]);
  });
  const group = new Array(T).fill(-1);
  let budget = 20000;

  function connectedSets(t) {
    const seen = new Set();
    const out = [];
    const rec = (set) => {
      const key = [...set].sort((a, b) => a - b).join(",");
      if (seen.has(key)) return;
      seen.add(key);
      if (set.length === k) {
        out.push(set);
        return;
      }
      for (const x of set) {
        for (const y of adj[x]) {
          if (group[y] === -1 && !set.includes(y)) rec([...set, y]);
        }
      }
    };
    rec([t]);
    return shuffle(rng, out);
  }

  function rec(g) {
    if (--budget < 0) return false;
    // most constrained unassigned territory first
    let t = -1;
    let best = Infinity;
    for (let x = 0; x < T; x++) {
      if (group[x] !== -1) continue;
      let free = 0;
      for (const y of adj[x]) if (group[y] === -1) free++;
      if (free < best) {
        best = free;
        t = x;
      }
    }
    if (t === -1) return true;
    for (const set of connectedSets(t)) {
      set.forEach((x) => (group[x] = g));
      if (rec(g + 1)) return true;
      set.forEach((x) => (group[x] = -1));
    }
    return false;
  }

  return rec(0) ? group : null;
}

function isConnected(n, regions, g, without) {
  const cells = [];
  regions.forEach((x, i) => x === g && i !== without && cells.push(i));
  if (cells.length === 0) return false;
  const seen = new Set([cells[0]]);
  const stack = [cells[0]];
  while (stack.length) {
    const i = stack.pop();
    for (const j of orthoNeighbours(n, i)) {
      if (j !== without && regions[j] === g && !seen.has(j)) {
        seen.add(j);
        stack.push(j);
      }
    }
  }
  return seen.size === cells.length;
}

// tweak region borders until `stars` is the only solution, or null
function makeUnique(rng, n, k, regions, stars, maxIter = 60) {
  const isStar = new Set(stars);
  for (let it = 0; it < maxIter; it++) {
    const board = makeBoard(n, k, regions);
    const sols = findSolutions(board, 2);
    if (sols.length === 1) return regions;
    const other = sols.find((s) => s.some((i) => !isStar.has(i)));
    const candidates = shuffle(rng, other.filter((i) => !isStar.has(i)));
    let moved = false;
    for (const i of candidates) {
      const from = regions[i];
      const targets = shuffle(
        rng,
        [...new Set(orthoNeighbours(n, i).map((j) => regions[j]))].filter(
          (g) => g !== from,
        ),
      );
      if (targets.length === 0 || !isConnected(n, regions, from, i)) continue;
      regions[i] = targets[0];
      moved = true;
      break;
    }
    if (!moved) return null;
  }
  return null;
}

// a puzzle with a unique solution, or null if this attempt failed
export function generateOnce(rng, n, k) {
  const stars = randomStars(rng, n, k);
  const terr = growTerritories(rng, n, stars);
  const group = groupTerritories(rng, n, terr, stars.length, k);
  if (!group) return null;
  const regions = makeUnique(rng, n, k, terr.map((t) => group[t]), stars);
  if (!regions) return null;
  const board = makeBoard(n, k, regions);
  const grade = solveLogically(board);
  return {
    n,
    k,
    regions: encodeRegions(regions),
    solution: stars,
    solvable: grade.solved,
    level: grade.level,
    score: grade.score,
    counts: grade.counts,
  };
}

// keep generating until a logically solvable puzzle passes `accept`
export function generate(rng, n, k, accept = () => true, maxTries = 10000) {
  for (let t = 0; t < maxTries; t++) {
    const p = generateOnce(rng, n, k);
    if (p && p.solvable && accept(p)) return p;
  }
  return null;
}
