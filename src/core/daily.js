// daily puzzles: tiers, the weekday ramp and seeding from the date

import { generate } from "./generate.js";
import { makeRng, hashString } from "./rng.js";

export const EPOCH = "2026-10-23";
export const SIZE = 10;
export const STARS = 2;

// first matching tier wins, calibrated from the logic solver's grades
export const TIERS = [
  { name: "easy", test: (p) => p.level <= 2 },
  { name: "medium", test: (p) => p.level <= 3 || (p.level === 4 && (p.counts.trial || 0) <= 2) },
  // a trial of more than 5 steps is too much to hold in your head, and more
  // than 3 trials of 3 or more steps is a slog
  { name: "hard", test: (p) => p.longestTrial <= 5 && (p.counts["trial-long"] || 0) <= 3 },
  { name: "expert", test: () => true },
];

// sunday first, as Date.getUTCDay counts. no expert days for now, that tier
// is only for practice
const WEEKDAY_TIERS = [2, 0, 0, 1, 1, 2, 2];

export function tierOf(p) {
  return TIERS.findIndex((t) => t.test(p));
}

export function dateKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseKey(key) {
  const [y, m, d] = key.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

export function addDays(key, days) {
  const d = new Date(parseKey(key) + days * 86400000);
  return d.toISOString().slice(0, 10);
}

export function dayNumber(key) {
  return Math.round((parseKey(key) - parseKey(EPOCH)) / 86400000) + 1;
}

export function tierForDate(key) {
  return WEEKDAY_TIERS[new Date(parseKey(key)).getUTCDay()];
}

// the same date always gives the same puzzle
export function puzzleForDate(key) {
  const tier = tierForDate(key);
  const rng = makeRng(hashString(`grays-court:${key}`));
  const p = generate(rng, SIZE, STARS, (q) => tierOf(q) === tier);
  return { date: key, tier, n: p.n, k: p.k, regions: p.regions, score: p.score };
}

export function practicePuzzle(tier, seed = Date.now()) {
  const rng = makeRng(seed);
  const p = generate(rng, SIZE, STARS, (q) => tierOf(q) === tier);
  return { date: null, tier, n: p.n, k: p.k, regions: p.regions, score: p.score };
}
