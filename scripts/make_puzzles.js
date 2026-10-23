// precompute daily puzzles into puzzles/daily.json
//
//   node scripts/make_puzzles.js [start-date] [days] [--replace]
//
// existing dates are kept, so this can be rerun to extend the file. with
// --replace the given dates are made again, eg after changing the grading.
// don't replace days people may have already played, as their saved
// progress is for the old puzzle

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EPOCH, TIERS, addDays, puzzleForDate } from "../src/core/daily.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "puzzles", "daily.json");

const args = process.argv.slice(2).filter((a) => a !== "--replace");
const replace = process.argv.includes("--replace");
const start = args[0] || EPOCH;
const days = Number(args[1] || 365);

const data = fs.existsSync(out)
  ? JSON.parse(fs.readFileSync(out, "utf8"))
  : { puzzles: {} };

const t0 = Date.now();
for (let d = 0; d < days; d++) {
  const key = addDays(start, d);
  if (data.puzzles[key] && !replace) continue;
  const p = puzzleForDate(key);
  data.puzzles[key] = { tier: p.tier, n: p.n, k: p.k, regions: p.regions, score: p.score };
  console.log(`${key}  ${TIERS[p.tier].name.padEnd(6)}  score ${p.score}`);
}

const sorted = Object.fromEntries(Object.entries(data.puzzles).sort());
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ puzzles: sorted }, null, 0) + "\n");
console.log(`${Object.keys(sorted).length} puzzles in ${out} (${Date.now() - t0}ms)`);
