// rules for a board in play: auto roads, rule breaks, mistakes and completion

export const BLANK = 0;
export const ROAD = 1;
export const CASTLE = 2;

// blank cells that the castles placed so far rule out: their neighbours, and
// the rest of any row, col or region that already has k castles
export function impliedRoads(board, play) {
  const out = new Uint8Array(board.N);
  play.forEach((v, i) => {
    if (v === CASTLE) for (const j of board.neighbours[i]) out[j] = 1;
  });
  for (const unit of board.units) {
    const castles = unit.cells.filter((i) => play[i] === CASTLE).length;
    if (castles >= board.k) for (const i of unit.cells) out[i] = 1;
  }
  play.forEach((v, i) => {
    if (v !== BLANK) out[i] = 0;
  });
  return out;
}

// castles touching each other, and units that are overfull or have no room
// left for their castles
export function ruleBreaks(board, play) {
  const implied = impliedRoads(board, play);
  const cells = new Set();
  const units = new Set();
  play.forEach((v, i) => {
    if (v !== CASTLE) return;
    for (const j of board.neighbours[i]) {
      if (play[j] === CASTLE) cells.add(i);
    }
  });
  board.units.forEach((unit, ui) => {
    let castles = 0;
    let room = 0;
    for (const i of unit.cells) {
      if (play[i] === CASTLE) castles++;
      else if (play[i] === BLANK && !implied[i]) room++;
    }
    if (castles > board.k || castles + room < board.k) units.add(ui);
  });
  return { cells, units };
}

// cells that disagree with the solution: wrong castles, and roads on castles
export function mistakes(board, play, solution) {
  const isStar = new Uint8Array(board.N);
  for (const i of solution) isStar[i] = 1;
  const out = [];
  play.forEach((v, i) => {
    if ((v === CASTLE && !isStar[i]) || (v === ROAD && isStar[i])) out.push(i);
  });
  return out;
}

export function isSolved(board, play) {
  const k = board.k;
  for (const unit of board.units) {
    if (unit.cells.filter((i) => play[i] === CASTLE).length !== k) return false;
  }
  return ruleBreaks(board, play).cells.size === 0;
}
