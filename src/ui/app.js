// the game: loading the puzzle, input, undo, timer, saving and sharing

import { makeBoard, decodeRegions, UNKNOWN, EMPTY, STAR } from "../core/board.js";
import { findSolutions } from "../core/solver.js";
import { nextStep, pointingCases, CONTRADICTION } from "../core/logic.js";
import { BLANK, ROAD, CASTLE, impliedRoads, ruleBreaks, mistakes, isSolved } from "../core/rules.js";
import { EPOCH, TIERS, dateKey, dayNumber, tierForDate, puzzleForDate, practicePuzzle } from "../core/daily.js";
import { makeRng, hashString } from "../core/rng.js";
import { biomesFor } from "./biomes.js";
import { THEMES, DEFAULT_THEME } from "./themes.js";
import { createRenderer } from "./render.js";

const $ = (id) => document.getElementById(id);

// local storage that never throws, eg in private windows
const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  },
};

const settings = {
  autoRoads: true,
  castleFirst: false,
  theme: DEFAULT_THEME,
  ...store.get("gc:settings", {}),
};
const saveSettings = () => store.set("gc:settings", settings);
const theme = () => THEMES[settings.theme] ?? THEMES[DEFAULT_THEME];

// fill in the theme's words wherever the page has a data-word span, and the
// tap order in the help, and tag the page with the theme for any colours of
// its own in style.css
function applyTheme() {
  const w = theme().words;
  for (const el of document.querySelectorAll("[data-word]")) el.textContent = w[el.dataset.word];
  const order = settings.castleFirst ? [w.star, w.blockedOne] : [w.blockedOne, w.star];
  $("tap-order").textContent = `${order.join(", ")}, clear`;
  document.documentElement.dataset.look = THEMES[settings.theme] ? settings.theme : DEFAULT_THEME;
}

async function loadPuzzle() {
  const params = new URLSearchParams(location.search);
  const practice = params.get("practice");
  if (practice !== null) {
    const tier = Math.max(0, TIERS.findIndex((t) => t.name === practice));
    const seed = Number(params.get("seed")) || Math.floor(Math.random() * 1e9);
    return { ...practicePuzzle(tier, seed), seed };
  }
  // past days can be played, but not ones still to come
  const asked = params.get("date");
  const key = asked && asked <= dateKey() ? asked : dateKey();
  try {
    const res = await fetch("puzzles/daily.json");
    const p = res.ok && (await res.json()).puzzles[key];
    if (p) return { date: key, ...p };
  } catch {}
  return puzzleForDate(key);
}

// game state
let puzzle;
let board;
let saveKey;
let biomes;
let solution = null;
let play;
let undoStack = [];
let redoStack = [];
let used = { undos: 0, checks: 0, tips: 0, autoRoads: false };
let elapsed = 0;
let started = false;
let solved = false;
let shownMistakes = new Set();
let tip = null;

// mistakes and tips stay shown until the board next changes
function clearHints() {
  shownMistakes = new Set();
  tip = null;
}

const svg = $("board");
const renderer = createRenderer(svg);

function display() {
  if (solved) return play.map((v) => (v === CASTLE ? CASTLE : ROAD));
  if (!settings.autoRoads) return Array.from(play);
  const implied = impliedRoads(board, play);
  return play.map((v, i) => (implied[i] ? ROAD : v));
}

function draw() {
  const disp = display();
  renderer.render({
    board,
    theme: theme(),
    biomes,
    display: disp,
    breaks: solved ? { cells: new Set(), units: new Set() } : ruleBreaks(board, play),
    mistakes: shownMistakes,
    tip,
    solved,
  });
  $("tip-text").textContent = tip ? tip.text : "";
  $("tip-box").hidden = !tip;
  const w = theme().words;
  const stars = play.filter((v) => v === CASTLE).length;
  $("status").textContent = solved
    ? w.done
    : `${stars} of ${board.n * board.k} ${w.stars} ${w.placed}`;
  // once solved, the share screen can be opened again from here
  $("reshare").hidden = !solved;
  $("undo").disabled = solved || undoStack.length === 0;
  $("redo").disabled = solved || redoStack.length === 0;
  $("auto").setAttribute("aria-pressed", String(settings.autoRoads));
}

// the board's regions go in with the save, so a save for a puzzle that has
// since changed isn't laid over the new one
function save() {
  store.set(saveKey, {
    regions: puzzle.regions,
    play: Array.from(play).join(""),
    undoStack,
    redoStack,
    used,
    elapsed,
    solved,
  });
}

// the next state a tap gives, skipping states that would look the same
function nextState(i, disp) {
  const order = settings.castleFirst ? [BLANK, CASTLE, ROAD] : [BLANK, ROAD, CASTLE];
  let s = disp[i];
  for (let step = 0; step < 3; step++) {
    s = order[(order.indexOf(s) + 1) % 3];
    const trial = play.slice();
    trial[i] = s;
    const shown = settings.autoRoads && s === BLANK && impliedRoads(board, trial)[i] ? ROAD : s;
    if (shown !== disp[i]) return s;
  }
  return s;
}

// input: tap to cycle a cell, drag to paint the same change over more cells
let gesture = null;

function setCell(i, value) {
  if (!gesture.changes.has(i)) gesture.changes.set(i, play[i]);
  play[i] = value;
}

svg.addEventListener("pointerdown", (e) => {
  if (!board || solved || e.button > 0) return;
  const i = renderer.cellAt(board, e);
  if (i < 0) return;
  e.preventDefault();
  try {
    svg.setPointerCapture(e.pointerId);
  } catch {}
  const disp = display();
  const to = nextState(i, disp);
  gesture = { from: disp[i], to, changes: new Map(), last: [e.clientX, e.clientY] };
  setCell(i, to);
  startTimer();
  clearHints();
  draw();
});

svg.addEventListener("pointermove", (e) => {
  if (!gesture || gesture.to === CASTLE) return;
  // sample along the path since the last event, so fast drags miss no cells
  const [x0, y0] = gesture.last;
  const steps = Math.max(1, Math.ceil(Math.hypot(e.clientX - x0, e.clientY - y0) / 6));
  gesture.last = [e.clientX, e.clientY];
  let changed = false;
  for (let s = 1; s <= steps; s++) {
    const t = s / steps;
    const i = renderer.cellAt(board, { clientX: x0 + t * (e.clientX - x0), clientY: y0 + t * (e.clientY - y0) });
    if (i < 0 || gesture.changes.has(i) || display()[i] !== gesture.from) continue;
    setCell(i, gesture.to);
    changed = true;
  }
  if (changed) draw();
});

function endGesture() {
  if (!gesture) return;
  const changes = [...gesture.changes].filter(([i, before]) => play[i] !== before);
  gesture = null;
  if (changes.length === 0) return;
  undoStack.push(changes.map(([i, before]) => [i, before, play[i]]));
  redoStack = [];
  if (settings.autoRoads) used.autoRoads = true;
  afterChange();
}

svg.addEventListener("pointerup", endGesture);
svg.addEventListener("pointercancel", endGesture);

// ios safari can still double-tap zoom on the board despite touch-action,
// cancelling the touch events themselves stops it. this relies on touches
// targeting the svg itself, see #board * in style.css
for (const type of ["touchstart", "touchend"]) {
  svg.addEventListener(type, (e) => e.preventDefault(), { passive: false });
}

function afterChange() {
  if (isSolved(board, play)) {
    solved = true;
    stopTimer();
    recordWin();
    setTimeout(showWin, 900);
  }
  save();
  draw();
}

function undo() {
  const entry = undoStack.pop();
  if (!entry || solved) return;
  for (const [i, before] of entry) play[i] = before;
  redoStack.push(entry);
  used.undos++;
  clearHints();
  afterChange();
}

function redo() {
  const entry = redoStack.pop();
  if (!entry || solved) return;
  for (const [i, , after] of entry) play[i] = after;
  undoStack.push(entry);
  clearHints();
  afterChange();
}

function clearBoard() {
  if (solved) return;
  const changes = [];
  play.forEach((v, i) => v !== BLANK && changes.push([i, v, BLANK]));
  if (changes.length === 0) return;
  play.fill(BLANK);
  undoStack.push(changes);
  redoStack = [];
  clearHints();
  afterChange();
}

function check() {
  if (solved) return;
  solution ??= findSolutions(board, 1)[0];
  const wrong = mistakes(board, play, solution);
  used.checks++;
  clearHints();
  // just says whether anything is wrong, not where
  toast(wrong.length === 0 ? "all looks right!" : "something's wrong...");
  save();
  draw();
}

// tips: the easiest deduction the logic solver can make from the board as it
// stands, with the reason in words
function unitName(ui) {
  const u = board.units[ui];
  if (u.kind === "row") return `row ${u.index + 1}`;
  if (u.kind === "col") return `column ${u.index + 1}`;
  return theme().regionName(biomes[u.index]);
}

// eg "the blue lake and the red volcano", "rows 3 to 5" or "columns 2 and 7"
function listNames(uis) {
  const join = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}` : xs[0]);
  if (uis.length === 1) return unitName(uis[0]);
  const kind = board.units[uis[0]].kind;
  if (kind === "region") return join(uis.map(unitName));
  const word = kind === "row" ? "rows" : "columns";
  const nums = uis.map((ui) => board.units[ui].index + 1).sort((a, b) => a - b);
  if (nums.length > 2 && nums.at(-1) - nums[0] === nums.length - 1) {
    return `${word} ${nums[0]} to ${nums.at(-1)}`;
  }
  return `${word} ${join(nums.map(String))}`;
}

function tipText(step, before) {
  const w = theme().words;
  const count = (m) => (m === 1 ? `1 ${w.star}` : `${m} ${w.stars}`);
  const more = (m) => (m === 1 ? `1 more ${w.star}` : `${m} more ${w.stars}`);
  const them = (m) => (m === 1 ? "it" : "them");
  const { reason, changed } = step;
  const need = (ui) => board.k - board.units[ui].cells.filter((i) => before[i] === STAR).length;
  const space = (ui) => board.units[ui].cells.filter((i) => before[i] === UNKNOWN).length;
  const placed = changed.filter((i) => before[i] === UNKNOWN && step.after[i] === STAR).length;
  const ui = reason.units && reason.units[0];
  const name = reason.units && unitName(ui);
  switch (step.technique.name) {
    case "neighbours":
      return `${w.stars} can't touch, not even at the corners, so every cell around this ${w.star} is ${w.blocked}.`;
    case "full":
      return `${name} already has its ${count(board.k)}, so the rest of it is ${w.blocked}.`;
    case "forced":
      return `${name} still needs ${count(need(ui))} and only has ${space(ui)} free ${space(ui) === 1 ? "cell" : "cells"}, so ${w.place} there.`;
    case "squeeze":
      return placed
        ? `${name} needs ${more(need(ui))}, and ${w.stars} can't touch. every way to fit ${them(need(ui))} uses the marked ${placed > 1 ? `cells, so ${w.place} ${w.stars}` : `cell, so ${w.place} a ${w.star}`} there.`
        : `${name} needs ${more(need(ui))}, and ${w.stars} can't touch. no way of fitting ${them(need(ui))} uses the marked cells, so they're ${w.blocked}.`;
    case "pointing":
    case "pointing-big": {
      // spell out each way the marked cell gets ruled out
      const m = need(ui);
      const it = m === 1 ? "it" : "they";
      const parts = [];
      if (step.cases.touch) parts.push(`${m === 1 ? "it touches" : "one of them touches"} the marked cell`);
      for (const u of step.cases.fills) {
        parts.push(`${it} fill${m === 1 ? "s" : ""} up ${unitName(u)}, which the marked cell is also in`);
      }
      const cases = parts.length > 1 ? `either ${parts.join(", or ")}` : parts[0];
      return `${name} needs ${more(m)}. however ${it} go${m === 1 ? "es" : ""}, ${cases}. so the marked cell is ${w.blocked}.`;
    }
    case "trial":
    case "trial-long": {
      // walk through the chain of moves, or just count them if it's long
      const guess = reason.tried === STAR ? `a ${w.star}` : `a ${w.blockedOne}`;
      const answer = reason.tried === STAR ? w.blocked : `a ${w.star}`;
      const end =
        reason.broken === null
          ? `there's no room left somewhere`
          : `${unitName(reason.broken)} is left with no room for its ${w.stars}`;
      const move = ({ technique, reason: r }) => {
        const n = unitName(r.units[0]);
        if (technique === "forced") return `${n} has to fill its last free cells`;
        return r.stars.length ? `${n} is forced to ${w.place} a ${w.star}` : `${n} rules out some of its cells`;
      };
      let middle;
      if (reason.steps === 0) middle = `straight away ${end}`;
      else if (reason.steps <= 3) middle = `then ${reason.chain.map(move).join(", then ")}, and ${end}`;
      else middle = `${reason.steps} forced moves later, ${end}`;
      return `try ${guess} in the marked cell: ${middle}. so it must be ${answer}.`;
    }
    default: {
      // the confine techniques
      const a = reason.units;
      const b = reason.others;
      const total = a.reduce((s, u) => s + need(u), 0);
      const these = a.length > 1 ? "between them they need" : "it needs";
      return (
        `${listNames(a)} can only have ${w.stars} inside ${listNames(b)}. ${these} ${count(total)}, ` +
        `exactly what ${listNames(b)} still need${b.length > 1 ? "" : "s"}, so the rest of ${listNames(b)} is ${w.blocked}.`
      );
    }
  }
}

function giveTip() {
  if (solved || !board) return;
  // a second press closes the tip rather than counting another
  if (tip) {
    clearHints();
    draw();
    return;
  }
  solution ??= findSolutions(board, 1)[0];
  used.tips++;
  clearHints();
  const wrong = mistakes(board, play, solution);
  if (wrong.length) {
    shownMistakes = new Set(wrong);
    const which = wrong.length > 1 ? `${wrong.length} marked cells` : "marked cell";
    tip = { text: `something has gone astray, fix the ${which} first.`, units: [], stars: [], blocked: [] };
    save();
    draw();
    return;
  }

  // the board as the solver sees it, with auto roads counted as blocked
  const implied = settings.autoRoads ? impliedRoads(board, play) : null;
  const before = Int8Array.from(play, (v, i) =>
    v === CASTLE ? STAR : v === ROAD || (implied && implied[i]) ? EMPTY : UNKNOWN,
  );
  const after = before.slice();
  const step = nextStep(board, after);
  if (!step || step === CONTRADICTION) {
    tip = { text: "no tip found, sorry!", units: [], stars: [], blocked: [] };
  } else {
    step.after = after;
    const name = step.technique.name;
    // a trial is about one cell, not the moves that follow from it, lighting
    // up the units its chain runs through, and a pointing step is explained
    // for one of its cells at a time
    let cells = step.changed;
    let others = step.reason.others || [];
    if (name === "trial" || name === "trial-long") {
      cells = [step.reason.cell];
      others = step.reason.chain.map((m) => m.reason.units[0]);
      if (step.reason.broken !== null) others.push(step.reason.broken);
    }
    if (name === "pointing" || name === "pointing-big") {
      const target = step.reason.targets[0];
      step.cases = pointingCases(board, before, step.reason.units[0], target);
      cells = [target];
      others = step.cases.fills;
    }
    tip = {
      text: tipText(step, before),
      units: [...(step.reason.units || []), ...others],
      stars: cells.filter((i) => after[i] === STAR),
      blocked: cells.filter((i) => after[i] === EMPTY),
    };
  }
  save();
  draw();
}

// timer, which only runs while the page is visible
let timerStart = null;
let timerId = null;

function startTimer() {
  if (solved) return;
  started = true;
  if (timerStart === null && !document.hidden) timerStart = performance.now();
  timerId ??= setInterval(showTime, 500);
}

function pauseTimer() {
  if (timerStart !== null) elapsed += performance.now() - timerStart;
  timerStart = null;
}

function stopTimer() {
  pauseTimer();
  clearInterval(timerId);
  timerId = null;
  showTime();
}

function currentElapsed() {
  return elapsed + (timerStart !== null ? performance.now() - timerStart : 0);
}

function formatTime(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

function showTime() {
  $("timer").textContent = formatTime(currentElapsed());
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    pauseTimer();
    if (board) save();
  } else if (started && !solved) {
    timerStart = performance.now();
  }
});

// winning and sharing
function recordWin() {
  if (!puzzle.date) return;
  const stats = store.get("gc:stats", { solved: {} });
  stats.solved[puzzle.date] ??= { time: Math.round(elapsed), tier: puzzle.tier, used };
  store.set("gc:stats", stats);
}

function streak() {
  const stats = store.get("gc:stats", { solved: {} });
  let count = 0;
  const d = new Date(`${puzzle.date}T12:00:00`);
  while (stats.solved[dateKey(d)]) {
    count++;
    d.setDate(d.getDate() - 1);
  }
  return count;
}

function shareText() {
  const title = puzzle.date ? `#${dayNumber(puzzle.date)}` : "practice";
  const badges = [`⏱️ ${formatTime(elapsed)}`];
  if (!used.autoRoads && !used.checks && !used.tips && !used.undos) badges.push("✨ unassisted");
  if (used.autoRoads) badges.push(theme().words.autoBadge);
  if (used.tips) badges.push(`💡×${used.tips}`);
  if (used.checks) badges.push(`🔍×${used.checks}`);
  if (used.undos) badges.push(`↩️×${used.undos}`);
  const rows = [];
  for (let r = 0; r < board.n; r++) {
    let row = "";
    for (let c = 0; c < board.n; c++) row += biomes[board.regions[r * board.n + c]].glyph;
    rows.push(row);
  }
  return [
    `${theme().icon} Grays Court ${title} · ${TIERS[puzzle.tier].name}`,
    badges.join(" · "),
    ...rows,
  ].join("\n");
}

function showWin() {
  $("win-time").textContent = formatTime(elapsed);
  $("win-streak").textContent = puzzle.date ? `🔥 streak ${streak()}` : "";
  $("share-preview").textContent = shareText();
  $("win").showModal();
}

async function share() {
  const text = shareText();
  if (navigator.share && matchMedia("(pointer: coarse)").matches) {
    try {
      await navigator.share({ text });
      return;
    } catch {}
  }
  try {
    await navigator.clipboard.writeText(text);
    toast("copied to clipboard");
  } catch {
    toast("could not copy, select the text instead");
  }
}

let toastId = null;
function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastId);
  toastId = setTimeout(() => el.classList.remove("show"), 2200);
}

// calendar of daily puzzles, from the first day up to today. solved days
// are filled in, started ones dashed, and tapping a day plays it
let calendarMonth = null;

function drawCalendar() {
  const today = dateKey();
  const [y, m] = calendarMonth;
  const first = new Date(y, m, 1);
  const days = new Date(y, m + 1, 0).getDate();
  $("calendar-title").textContent = first.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  const solvedDays = store.get("gc:stats", { solved: {} }).solved;
  let html = ["M", "T", "W", "T", "F", "S", "S"].map((d) => `<span class="weekday">${d}</span>`).join("");
  // monday first
  for (let k = 0; k < (first.getDay() + 6) % 7; k++) html += "<span></span>";
  for (let d = 1; d <= days; d++) {
    const key = dateKey(new Date(y, m, d));
    const playable = key >= EPOCH && key <= today;
    const saved = store.get(`gc:play:${key}`, null);
    const cls = [
      solvedDays[key] ? "solved" : saved && saved.regions && /[12]/.test(saved.play) ? "started" : "",
      key === today ? "today" : "",
      puzzle && key === puzzle.date ? "current" : "",
    ].join(" ");
    const tier = playable ? `<small>${TIERS[tierForDate(key)].name}</small>` : "";
    html += `<button class="${cls}" data-date="${key}"${playable ? "" : " disabled"}>${d}${tier}</button>`;
  }
  $("calendar-grid").innerHTML = html;

  const month = (key) => key.slice(0, 7);
  const shown = `${y}-${String(m + 1).padStart(2, "0")}`;
  $("calendar-prev").disabled = shown <= month(EPOCH);
  $("calendar-next").disabled = shown >= month(today);
}

$("calendar-open").addEventListener("click", () => {
  const d = new Date(`${puzzle?.date ?? dateKey()}T12:00:00`);
  calendarMonth = [d.getFullYear(), d.getMonth()];
  drawCalendar();
  $("calendar").showModal();
});
for (const [id, step] of [["calendar-prev", -1], ["calendar-next", 1]]) {
  $(id).addEventListener("click", () => {
    const d = new Date(calendarMonth[0], calendarMonth[1] + step, 1);
    calendarMonth = [d.getFullYear(), d.getMonth()];
    drawCalendar();
  });
}
$("calendar-grid").addEventListener("click", (e) => {
  const key = e.target.closest("button")?.dataset.date;
  if (!key) return;
  location.href = key === dateKey() ? "./" : `./?date=${key}`;
});

// buttons and keys
$("undo").addEventListener("click", undo);
$("redo").addEventListener("click", redo);
$("check").addEventListener("click", check);
$("tip").addEventListener("click", giveTip);
$("tip-close").addEventListener("click", () => {
  clearHints();
  draw();
});
$("clear").addEventListener("click", clearBoard);
$("auto").addEventListener("click", () => {
  settings.autoRoads = !settings.autoRoads;
  saveSettings();
  toast(`${theme().words.auto} ${settings.autoRoads ? "on" : "off"}`);
  draw();
});
$("menu").addEventListener("click", () => $("help").showModal());
$("share").addEventListener("click", share);
$("reshare").addEventListener("click", showWin);
$("theme").innerHTML = Object.entries(THEMES)
  .map(([key, t]) => `<option value="${key}">${t.label}</option>`)
  .join("");
$("theme").value = THEMES[settings.theme] ? settings.theme : DEFAULT_THEME;
$("theme").addEventListener("change", (e) => {
  settings.theme = e.target.value;
  saveSettings();
  applyTheme();
  // a shown tip's text is in the old theme's words
  clearHints();
  if (board) draw();
});
applyTheme();
$("castle-first").checked = settings.castleFirst;
$("castle-first").addEventListener("change", (e) => {
  settings.castleFirst = e.target.checked;
  saveSettings();
  applyTheme();
});
for (const dialog of document.querySelectorAll("dialog")) {
  dialog.addEventListener("click", (e) => e.target === dialog && dialog.close());
}
for (const btn of document.querySelectorAll("[data-practice]")) {
  btn.addEventListener("click", () => {
    const seed = Math.floor(Math.random() * 1e9);
    location.search = `?practice=${btn.dataset.practice}&seed=${seed}`;
  });
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && tip) {
    clearHints();
    draw();
    return;
  }
  if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "z" && e.key !== "y") return;
  e.preventDefault();
  if (e.key === "y" || e.shiftKey) redo();
  else undo();
});

// start up, after a frame so the loading message shows while generating
async function main() {
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
  puzzle = await loadPuzzle();
  board = makeBoard(puzzle.n, puzzle.k, decodeRegions(puzzle.regions));
  saveKey = puzzle.date ? `gc:play:${puzzle.date}` : `gc:play:practice:${puzzle.tier}:${puzzle.seed}`;

  biomes = biomesFor(board, makeRng(hashString(puzzle.regions)));

  const saved = store.get(saveKey, null);
  play = new Uint8Array(board.N);
  if (saved && saved.regions === puzzle.regions) {
    Array.from(saved.play).forEach((ch, i) => (play[i] = Number(ch)));
    ({ undoStack, redoStack, elapsed, solved } = saved);
    used = { ...used, ...saved.used };
    started = elapsed > 0;
  }

  const name = puzzle.date
    ? `#${dayNumber(puzzle.date)} · ${new Date(`${puzzle.date}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" })}`
    : "practice";
  $("subtitle").textContent = `${name} · ${TIERS[puzzle.tier].name}`;
  $("loading").hidden = true;
  showTime();
  if (started && !solved) startTimer();
  draw();
}

main();
