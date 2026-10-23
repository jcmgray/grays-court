// geometry of an n x n star battle board: rows, cols, regions and neighbours

export const UNKNOWN = -1;
export const EMPTY = 0;
export const STAR = 1;

const DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz";

export function encodeRegions(regions) {
  return Array.from(regions, (g) => DIGITS[g]).join("");
}

export function decodeRegions(s) {
  return Array.from(s, (ch) => DIGITS.indexOf(ch));
}

export function makeBoard(n, k, regions) {
  const N = n * n;
  const rowOf = (i) => Math.floor(i / n);
  const colOf = (i) => i % n;

  const units = [];
  for (let r = 0; r < n; r++) {
    const cells = [];
    for (let c = 0; c < n; c++) cells.push(r * n + c);
    units.push({ kind: "row", index: r, cells });
  }
  for (let c = 0; c < n; c++) {
    const cells = [];
    for (let r = 0; r < n; r++) cells.push(r * n + c);
    units.push({ kind: "col", index: c, cells });
  }
  const nregions = Math.max(...regions) + 1;
  for (let g = 0; g < nregions; g++) {
    units.push({ kind: "region", index: g, cells: [] });
  }
  regions.forEach((g, i) => units[2 * n + g].cells.push(i));

  // the row, col and region unit index of each cell
  const cellUnits = Array.from({ length: N }, () => []);
  units.forEach((u, ui) => u.cells.forEach((i) => cellUnits[i].push(ui)));

  // 8-way neighbours, stars may not touch these
  const neighbours = Array.from({ length: N }, (_, i) => {
    const out = [];
    const r = rowOf(i);
    const c = colOf(i);
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const rr = r + dr;
        const cc = c + dc;
        if (rr >= 0 && rr < n && cc >= 0 && cc < n) out.push(rr * n + cc);
      }
    }
    return out;
  });

  const isAdjacent = (i, j) =>
    i !== j &&
    Math.abs(rowOf(i) - rowOf(j)) <= 1 &&
    Math.abs(colOf(i) - colOf(j)) <= 1;

  return {
    n,
    k,
    N,
    regions: Array.from(regions),
    nregions,
    units,
    cellUnits,
    neighbours,
    rowOf,
    colOf,
    isAdjacent,
  };
}

// 4-way neighbours, used for region connectivity
export function orthoNeighbours(n, i) {
  const r = Math.floor(i / n);
  const c = i % n;
  const out = [];
  if (r > 0) out.push(i - n);
  if (r < n - 1) out.push(i + n);
  if (c > 0) out.push(i - 1);
  if (c < n - 1) out.push(i + 1);
  return out;
}
