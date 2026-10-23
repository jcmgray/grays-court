// human style solver, used to grade how hard a puzzle is
//
// each technique makes one deduction and returns the reason for it (the units
// involved etc), false if it found nothing, or CONTRADICTION. the solver
// always uses the easiest technique that works, and the grade comes from the
// hardest one it needed. the same steps give the in-game tips

import { UNKNOWN, EMPTY, STAR } from "./board.js";
import { placeStar, propagate, unitCounts } from "./solver.js";

export const CONTRADICTION = "contradiction";

function starCounts(board, cells) {
  return board.units.map((u) => unitCounts(u, cells)[0]);
}

function emptyAll(cells, todo) {
  for (const i of todo) cells[i] = EMPTY;
  return todo.length > 0;
}

// all ways to put the missing stars of a unit onto its unknown cells, with no
// stars touching and no other unit overfilled
function placements(board, cells, ui, counts, cap = 5000) {
  const k = board.k;
  const m = k - counts[ui];
  const free = board.units[ui].cells.filter((i) => cells[i] === UNKNOWN);
  const extra = new Int8Array(board.units.length);
  const chosen = [];
  const out = [];

  function rec(start) {
    if (chosen.length === m) {
      out.push(chosen.slice());
      return;
    }
    for (let a = start; a <= free.length - (m - chosen.length); a++) {
      if (out.length >= cap) return;
      const i = free[a];
      if (chosen.some((j) => board.isAdjacent(i, j))) continue;
      const us = board.cellUnits[i];
      if (us.some((u) => u !== ui && counts[u] + extra[u] + 1 > k)) continue;
      chosen.push(i);
      for (const u of us) extra[u]++;
      rec(a + 1);
      for (const u of us) extra[u]--;
      chosen.pop();
    }
  }

  rec(0);
  return out;
}

// cells touching a star are empty, only needed when starting from a board in
// play, since placeStar already does this
function neighbours(board, cells) {
  for (let i = 0; i < board.N; i++) {
    if (cells[i] !== STAR) continue;
    if (board.neighbours[i].some((j) => cells[j] === STAR)) return CONTRADICTION;
    const todo = board.neighbours[i].filter((j) => cells[j] === UNKNOWN);
    if (emptyAll(cells, todo)) return { cell: i };
  }
  return false;
}

// a unit with all its stars has its other cells empty
function full(board, cells) {
  const counts = starCounts(board, cells);
  for (let ui = 0; ui < board.units.length; ui++) {
    if (counts[ui] !== board.k) continue;
    const todo = board.units[ui].cells.filter((i) => cells[i] === UNKNOWN);
    if (emptyAll(cells, todo)) return { units: [ui] };
  }
  return false;
}

// a unit with exactly as many unknown cells as missing stars
function forced(board, cells) {
  for (let ui = 0; ui < board.units.length; ui++) {
    const unit = board.units[ui];
    const [stars, unknown] = unitCounts(unit, cells);
    if (unknown === 0 || stars === board.k) continue;
    if (stars + unknown < board.k) return CONTRADICTION;
    if (stars + unknown === board.k) {
      for (const i of unit.cells.filter((j) => cells[j] === UNKNOWN)) {
        if (cells[i] !== UNKNOWN || !placeStar(board, cells, i)) {
          return CONTRADICTION;
        }
      }
      return { units: [ui] };
    }
  }
  return false;
}

// within one unit: cells used by every possible placement are stars, cells
// used by none are empty
function squeeze(board, cells) {
  const counts = starCounts(board, cells);
  for (let ui = 0; ui < board.units.length; ui++) {
    if (counts[ui] >= board.k) continue;
    const ps = placements(board, cells, ui, counts);
    if (ps.length === 0) return CONTRADICTION;
    const used = new Map();
    for (const p of ps) for (const i of p) used.set(i, (used.get(i) || 0) + 1);
    const free = board.units[ui].cells.filter((i) => cells[i] === UNKNOWN);
    const stars = free.filter((i) => used.get(i) === ps.length);
    const empties = free.filter((i) => !used.has(i));
    if (stars.length === 0 && empties.length === 0) continue;
    emptyAll(cells, empties);
    for (const i of stars) {
      if (!placeStar(board, cells, i)) return CONTRADICTION;
    }
    return { units: [ui], stars, empties };
  }
  return false;
}

// how a placement rules out a cell outside its unit ui: by touching it, by
// filling up another unit the cell is in, or not at all
function ruledOutBy(board, counts, ui, p, j) {
  if (p.some((i) => board.isAdjacent(i, j))) return "touch";
  for (const u of board.cellUnits[j]) {
    if (u === ui) continue;
    const added = p.filter((i) => board.cellUnits[i].includes(u)).length;
    if (added && counts[u] + added === board.k) return u;
  }
  return null;
}

// placements of a unit up to this many count as a small case split, which is
// easy to see, bigger ones are graded harder
const SMALL_SPLIT = 6;

// wherever a unit's stars go, some outside cell always gets ruled out, either
// as a neighbour or because another unit gets filled up. only looks at units
// with more than lo and at most hi placements, smallest first, as fewer cases
// are easier to follow
function pointing(lo, hi) {
  return (board, cells) => {
    const counts = starCounts(board, cells);
    const options = [];
    for (let ui = 0; ui < board.units.length; ui++) {
      if (counts[ui] >= board.k) continue;
      const ps = placements(board, cells, ui, counts);
      if (ps.length === 0) return CONTRADICTION;
      if (ps.length > lo && ps.length <= hi) options.push([ui, ps]);
    }
    options.sort((a, b) => a[1].length - b[1].length);
    for (const [ui, ps] of options) {
      const inUnit = new Set(board.units[ui].cells);
      const todo = [];
      for (let j = 0; j < board.N; j++) {
        if (cells[j] !== UNKNOWN || inUnit.has(j)) continue;
        if (ps.every((p) => ruledOutBy(board, counts, ui, p, j) !== null)) todo.push(j);
      }
      if (emptyAll(cells, todo)) return { units: [ui], targets: todo, placements: ps.length };
    }
    return false;
  };
}

// the cases behind a pointing step, for explaining it: whether some
// placements touch the target, and which units others fill up
export function pointingCases(board, cells, ui, target) {
  const counts = starCounts(board, cells);
  const ps = placements(board, cells, ui, counts);
  const reasons = ps.map((p) => ruledOutBy(board, counts, ui, p, target));
  return {
    touch: reasons.includes("touch"),
    fills: [...new Set(reasons.filter((r) => r !== "touch" && r !== null))],
  };
}

function* combinations(arr, j, start = 0, acc = []) {
  if (acc.length === j) {
    yield acc;
    return;
  }
  for (let a = start; a <= arr.length - (j - acc.length); a++) {
    acc.push(arr[a]);
    yield* combinations(arr, j, a + 1, acc);
    acc.pop();
  }
}

const CONFINE_PAIRS = [
  ["region", "row"],
  ["region", "col"],
  ["row", "region"],
  ["col", "region"],
];

// j units of one kind whose unknown cells all lie within units of another kind
// needing the same number of stars, so those units have no stars elsewhere
function confinement(j) {
  return (board, cells) => {
    const k = board.k;
    const counts = starCounts(board, cells);
    const need = counts.map((s) => k - s);
    for (const [kindA, kindB] of CONFINE_PAIRS) {
      const as = [];
      board.units.forEach((u, ui) => {
        if (u.kind === kindA && need[ui] > 0) as.push(ui);
      });
      for (const group of combinations(as, j)) {
        const inGroup = new Set();
        const touched = new Set();
        let needGroup = 0;
        for (const ua of group) {
          needGroup += need[ua];
          for (const i of board.units[ua].cells) {
            if (cells[i] !== UNKNOWN) continue;
            inGroup.add(i);
            for (const ub of board.cellUnits[i]) {
              if (board.units[ub].kind === kindB) touched.add(ub);
            }
          }
        }
        let needTouched = 0;
        for (const ub of touched) needTouched += need[ub];
        if (needTouched < needGroup) return CONTRADICTION;
        if (needTouched > needGroup) continue;
        const todo = [];
        for (const ub of touched) {
          for (const i of board.units[ub].cells) {
            if (cells[i] === UNKNOWN && !inGroup.has(i)) todo.push(i);
          }
        }
        if (emptyAll(cells, todo)) return { units: group.slice(), others: [...touched] };
      }
    }
    return false;
  };
}

// apply the simple techniques until stuck, false on contradiction
function settle(board, cells) {
  while (true) {
    if (!propagate(board, cells)) return false;
    const r = squeeze(board, cells);
    if (r === CONTRADICTION) return false;
    if (!r) return true;
  }
}

// try a star (or empty) in a cell, and rule it out if the simple techniques
// then hit a contradiction
function lookahead(board, cells) {
  for (let i = 0; i < board.N; i++) {
    if (cells[i] !== UNKNOWN) continue;
    const a = cells.slice();
    if (!placeStar(board, a, i) || !settle(board, a)) {
      cells[i] = EMPTY;
      return { cell: i, tried: STAR };
    }
    const b = cells.slice();
    b[i] = EMPTY;
    if (!settle(board, b)) {
      return placeStar(board, cells, i) ? { cell: i, tried: EMPTY } : CONTRADICTION;
    }
  }
  return false;
}

export const TECHNIQUES = [
  { name: "neighbours", level: 0, weight: 0, apply: neighbours },
  { name: "full", level: 0, weight: 0, apply: full },
  { name: "forced", level: 1, weight: 1, apply: forced },
  { name: "squeeze", level: 1, weight: 2, apply: squeeze },
  { name: "confine1", level: 2, weight: 3, apply: confinement(1) },
  { name: "pointing", level: 2, weight: 4, apply: pointing(0, SMALL_SPLIT) },
  { name: "confine2", level: 3, weight: 6, apply: confinement(2) },
  { name: "pointing-big", level: 3, weight: 7, apply: pointing(SMALL_SPLIT, Infinity) },
  { name: "confine3", level: 4, weight: 9, apply: confinement(3) },
  { name: "confine4", level: 4, weight: 12, apply: confinement(4) },
  { name: "lookahead", level: 5, weight: 15, apply: lookahead },
];

// make one deduction in place with the easiest technique that works, giving
// {technique, reason, changed}, CONTRADICTION, or null if stuck
export function nextStep(board, cells, maxLevel = 5) {
  for (const t of TECHNIQUES) {
    if (t.level > maxLevel) break;
    const before = cells.slice();
    const reason = t.apply(board, cells);
    if (reason === CONTRADICTION) return CONTRADICTION;
    if (reason) {
      const changed = [];
      cells.forEach((v, i) => v !== before[i] && changed.push(i));
      return { technique: t, reason, changed };
    }
  }
  return null;
}

// solve step by step with the easiest technique available each time
export function solveLogically(board, { maxLevel = 5, start = null } = {}) {
  const cells = start
    ? Int8Array.from(start)
    : new Int8Array(board.N).fill(UNKNOWN);
  const counts = {};
  const steps = [];
  let score = 0;
  let level = 0;

  while (cells.includes(UNKNOWN)) {
    const step = nextStep(board, cells, maxLevel);
    if (step === null || step === CONTRADICTION) {
      const contradiction = step === CONTRADICTION;
      return { solved: false, contradiction, cells, counts, steps, score, level };
    }
    const t = step.technique;
    steps.push({ technique: t.name, changed: step.changed });
    counts[t.name] = (counts[t.name] || 0) + 1;
    score += t.weight;
    level = Math.max(level, t.level);
  }
  return { solved: true, contradiction: false, cells, counts, steps, score, level };
}
