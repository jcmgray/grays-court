// exact solver, used to certify that a puzzle has a unique solution

import { UNKNOWN, EMPTY, STAR } from "./board.js";

// place a star and empty its neighbours, false if it touches another star
export function placeStar(board, cells, i) {
  if (cells[i] === EMPTY) return false;
  for (const j of board.neighbours[i]) {
    if (cells[j] === STAR) return false;
  }
  cells[i] = STAR;
  for (const j of board.neighbours[i]) cells[j] = EMPTY;
  return true;
}

export function unitCounts(unit, cells) {
  let stars = 0;
  let unknown = 0;
  for (const i of unit.cells) {
    if (cells[i] === STAR) stars++;
    else if (cells[i] === UNKNOWN) unknown++;
  }
  return [stars, unknown];
}

// apply the simple forced moves until nothing changes, false on contradiction
//   - a unit with k stars has all its other cells empty
//   - a unit with exactly enough unknown cells left gets them all as stars
export function propagate(board, cells) {
  const k = board.k;
  let changed = true;
  while (changed) {
    changed = false;
    for (const unit of board.units) {
      const [stars, unknown] = unitCounts(unit, cells);
      if (stars > k || stars + unknown < k) return false;
      if (unknown === 0) continue;
      if (stars === k) {
        for (const i of unit.cells) if (cells[i] === UNKNOWN) cells[i] = EMPTY;
        changed = true;
      } else if (stars + unknown === k) {
        const todo = unit.cells.filter((i) => cells[i] === UNKNOWN);
        for (const i of todo) {
          if (cells[i] !== UNKNOWN || !placeStar(board, cells, i)) return false;
        }
        changed = true;
      }
    }
  }
  return true;
}

// find up to `limit` solutions, each returned as a sorted list of star cells
export function findSolutions(board, limit = 2, start = null) {
  const solutions = [];
  const k = board.k;

  function rec(cells) {
    if (!propagate(board, cells)) return;

    // branch on the first unknown cell of the most constrained unit
    let best = null;
    let bestScore = Infinity;
    for (const unit of board.units) {
      const [stars, unknown] = unitCounts(unit, cells);
      if (stars < k && unknown < bestScore) {
        best = unit;
        bestScore = unknown;
      }
    }
    if (best === null) {
      const stars = [];
      cells.forEach((v, i) => v === STAR && stars.push(i));
      solutions.push(stars);
      return;
    }
    const i = best.cells.find((j) => cells[j] === UNKNOWN);

    const a = cells.slice();
    if (placeStar(board, a, i)) rec(a);
    if (solutions.length >= limit) return;

    const b = cells.slice();
    b[i] = EMPTY;
    rec(b);
  }

  rec(start ? Int8Array.from(start) : new Int8Array(board.N).fill(UNKNOWN));
  return solutions.slice(0, limit);
}
