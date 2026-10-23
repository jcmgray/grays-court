# Grays Court

A daily star battle puzzle. Build 2 castles in every row, column and land, with no two castles touching.

## Running

It is a static site with no build step and no dependencies:

```bash
python3 scripts/serve.py
```

then open http://localhost:8000. Add `?date=2026-11-01` to play another day, or `?practice=hard` for a random puzzle.

## Puzzles

```bash
node scripts/make_puzzles.js 2026-10-21 365
```

This fills `puzzles/daily.json` with one puzzle per day and keeps dates already there. Each date seeds its own puzzle, so the site can also make any day's puzzle itself if the file is missing it. The file has no solutions in it, since the page works them out when needed.

## Layout

- `src/core/` has the game logic, shared by the page and the script
  - `generate.js` random puzzles with a unique solution
  - `solver.js` exact solver, used to prove a puzzle is unique
  - `logic.js` human style solver, used to grade difficulty
  - `daily.js` tiers, the weekday ramp (easy on Mon/Tue up to expert on Sun) and seeding
  - `rules.js` auto roads, rule breaks and mistakes during play
- `src/ui/` has the page: `app.js` for input, undo and sharing, and `render.js` for the svg board, kept apart so another renderer can replace it
  - `themes.js` how stars and blocked cells look and the words used for them, picked in the menu
