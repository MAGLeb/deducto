# Architecture (Devvit Web)

> 🌐 + 🧩 **One app, two layers.** The transport, the server, the endpoints, the anti-cheat model
> and the Redis isolation below are **shared** by every format. The engine, the bank and the grading
> path are the **Deduction Grid's**, and the code has no notion of a format today — it simply is the
> grid. The seam a second format needs, and where it would be cut, is in
> [12-game-types.md](12-game-types.md).

Deducto is a daily deduction puzzle shipped as Reddit interactive posts. The whole thing is one
Devvit Web app: two webview entrypoints plus an Express server that is the source of truth.
There is no external backend and no database beyond Redis.

## Stack

- `@devvit/web` 0.13.11 (Devvit Web interactive post + `createServer` / `getServerPort`); CLI `devvit` 0.13.11.
- Client: vanilla TypeScript, no framework. Two HTML entrypoints under `src/client/`, bundled with
  Vite 7 into `dist/client`. Each entry's stylesheet is inlined into its HTML at build time
  (`inlineEntryCss` in `src/client/vite.config.ts`) so the feed's first paint costs no extra round-trip.
- Server: Express 5 (`express` 5.1.0) mounted on the Devvit server, built with Vite into
  `dist/server/index.cjs`.
- Storage: Devvit Redis (`redis` from `@devvit/web/server`) and Reddit API (`reddit`), scope `user`.
- Shared TypeScript in `src/shared/` is imported by both client and server (types, live clue
  status, themes, clue rendering).

## Repo / build layout

```
src/client/     splash.html/.ts  index.html/main.ts               -> dist/client
                tokens.css base.css splash.css game.css ledger.css
                tiers.ts (the difficulty badge)  forced.ts (offline WEAK check)
                ledger.ts (the ruled row renderer, shared by both board surfaces, plus
                           the one /api/leaderboard fetch the two in-game surfaces use)
src/server/     index.ts + engine.ts + leaderboard.ts                 -> dist/server (Express app)
src/server/     bank.json                     160 prebuilt cases (imported by the server)
src/server/     engine.test.ts (parity), routes.test.ts + testing/ (route-level regression)
src/shared/     types.ts status.ts themes.ts render.ts   (client + server)
scripts/        build-bank.ts, check-solvability.ts, check-levels.ts, difficulty.ts,
                dump-case.ts, smoke-status.ts
devvit.json     Devvit config (post entrypoints, server dir, permissions, mod menu)
```

`npm run build` runs `build:bank` (regenerates `bank.json` with 160 cases), then `build:client`,
then `build:server`. The server bundle is `dist/server/index.cjs`.

### Post entrypoints (`devvit.json` → `post.entrypoints`)

| Key | File | Height | Used by |
| --- | --- | --- | --- |
| `default` | `splash.html` | `regular` | every daily post - the card the feed renders |
| `game` | `index.html` | `tall` | the board, opened from the splash via `requestExpandedMode(e, "game")` |

Splitting `default` from `game` is what removed the internal scroll inside the inline webview: the
feed gets a fixed-height card, the board gets the whole viewport in expanded mode. Expanding
**reloads the document**, so nothing may live in client memory only - the grid, hint count and
elapsed time all come back from `GET /api/daily`.

## Client

### `splash.ts` - the feed card

Renders `GET /api/preview`: case number, title, tier badge, your state (new / playing / solved),
today's solver count and fastest time. One button, wired before the fetch so it works even if the
request is slow or fails. When a number is missing it is simply not printed - the splash never
invents social proof. No clues, no grid, no solution ever reach this screen.

### `main.ts` - the board

Rendering and input only. It never receives the solution.

- Board: 4 suspects × 3 categories (`flair` = Coat, `time` = Time, `object` = Item) = 12 cells.
  Each cell shows chips for its candidate values.
- Cell interaction is a two-state toggle per chip: unknown (0) ↔ crossed out (1). Ruling a value out
  narrows the cell; when a single candidate survives, that survivor is the deduced answer
  (`effectiveValue` in `shared/status.ts`). `status.ts` also models a third "confirmed" state (2),
  but the shipped board only sets 0/1.
- Live feedback is computed purely from the player's own marks, never from a hidden solution:
  `clueStatus()` grades each clue `ok` / `bad` / `open`; `effectiveValue` fills the answer.
  Visually (D3): `ok` is struck through in muted ink, `bad` carries the one red stamp on the screen
  plus the words "Contradicted by the board", `open` is left plain.
- Auto-close: `maybeFinalize()` fires as soon as all 12 cells have an effective value and every clue
  is `ok`. There is NO "Check solution" button and no "mistakes" counter. On auto-close it POSTs
  `/api/check`; the server confirms and returns the result screen - or, for a logged-out visitor,
  the guest screen that says plainly that nothing was recorded.
- Hint ladder: three rungs (`/api/hint` with `step: 1 | 2 | 3`). Rungs 1-2 are free and only point at
  the board; rung 3 reveals a cell and is the only one that counts. The deduction itself is the
  server's (`adviseOnGrid`); the client phrases the five verdicts (`move` / **`cross`** /
  `contradiction` / `stuck` / `done`) and pages the log of everything revealed so far. `cross` is
  the 🟡 rung - the clues that still bite once the *board* has nothing left to give (see the engine
  section below and `docs/05-data-model.md`); it carries `clues: number[]` and, on step 2 only, the
  chip they kill.
- Status line under the board answers "is anything forced right now?". `forced.ts` runs the WEAK
  model locally on every render; whenever the server has returned a verdict for *this exact board*
  (cached by a grid signature) that verdict wins instead.
- Other UI: undo, board reset (two-tap confirm - `confirm()` is blocked in the sandboxed webview),
  3 coach marks on the first visit, the first-run warm-up ladder, and the warm-up lane itself.
- Persistence: the grid and active seconds are debounced to `/api/state`; the timer only counts
  while the tab is visible and the case is unsolved. The 10-second heartbeat, not the move autosave,
  is what carries the stall nudge - a player who stopped moving stopped autosaving by definition.

### `ledger.ts` - one board renderer, two surfaces

The ruled ledger is written once and used twice, so a board looks and behaves the same wherever
it appears. It owns the row types, the rendering, and the single `GET /api/leaderboard` fetch.

| Surface | Where | Boards | Fetch |
| --- | --- | --- | --- |
| the standings **screen** | inside the game, `#view-standings`, opened from the board's control rail (`#btn-standings`) | Today · Week · Streak · All-time | `/api/leaderboard?scope=…&limit=50`, one per tab, cached per scope, refetched on every entry |
| the standings **block** | on the result sheet, after a solve | the same four | the same cache |

`GET /api/leaderboard` is a **public** route (`/api/*`, not `/internal/*`), which is what makes the
first two work for a player who has not solved anything - the screen is a permanent button on the
game, not a reward. The result-card tabs are no longer placeholders. It is deliberately not open
*during* an unsolved case by accident: it is reached by an explicit press and closes straight back to
the board, per `docs/02-gameplay.md`.

The `season` scope exists on both sides (`ledger.ts`, `leaderboard.ts`) and is served by
`/api/leaderboard`, but **no UI exposes it** - it is not a feature, it is a board the monthly
aggregate already maintains.

If `/api/leaderboard` is down, the **result sheet's** Today tab falls back to the three fastest that
`/api/check` already returned, rather than blanking a board the result screen is holding in its hand.
The full-screen standings view has no such source and says the board is unavailable.

## Server (`src/server/index.ts` + `src/server/leaderboard.ts`, source of truth)

Express router mounted via `createServer(app)` / `server.listen(getServerPort())`. `index.ts` owns
the case, the clock, hints, the vote tally, streaks and the funnel; `leaderboard.ts` is a separate
router mounted with one `app.use`, so the leaderboard track and the difficulty track do not edit the
same file. The surface between them is small and named: `index.ts` imports exactly five symbols -
`leaderboardRouter` (mounted with one `app.use`), `writeSolve()` (called from `/api/check`),
`readBoard()` (the funnel's board-vs-solve-count audit), and `currentDay()` + `LAST_DAY_KEY`, which
are the shared definition of "the day" and the reason there is only one of it.

- Serves the case for the current post (`postData.idx` selects the bank entry). With no pinned index
  (dev harness, or a post older than `postData`) it rotates by day **inside the default bucket**, so
  the fallback can never serve a warm-up-tier case as the daily.
- Grades submissions server-side (`gradeGrid`): a grid is "solved" only when all 12 cells are
  determined and every cell matches the stored solution. Because every bank case has a unique
  solution, "all cells deduced + no clue contradicted" on the client is equivalent to correct, which
  the server re-verifies.
- Records solve time, finishing order, hints, the per-post leaderboard, the streak, the next-day
  difficulty vote, and every aggregate board.

## HTTP endpoint map

Game webview (`/api/*`):

| Method | Path | Purpose |
| --- | --- | --- |
| GET  | `/api/preview`        | Splash counters: case number/title/tier, your state, today's solvers + fastest, minutes to the next case. **Strictly read-only** - see below. |
| GET  | `/api/daily`          | Case (no solution) + the user's attempt + meta (solvers, streak, epilogue, vote tally, `showTutorial`, `showWarmup`, next-open countdown, next case number). |
| POST | `/api/state`          | Persist grid and active seconds (monotonic; only advances). Runs the funnel counters and returns `{ nudge }`. |
| POST | `/api/hint`           | Hint ladder. `step:1` = which clue still works, `step:2` = what it rules out (both free), `step:3` = reveal a cell (counts). `{reveal:false}` still means "just re-read my log". |
| POST | `/api/vote`           | Record a Harder / Same / Softer vote for tomorrow's difficulty (must have solved; one vote per user). |
| POST | `/api/check`          | Grade the grid; on solve, write time/order/leaderboards/streak and return the results payload. A guest gets `{guest:true, results:null}`. |
| GET  | `/api/practice`       | Serve the warm-up case for this player (isolated lane), plus `warmupsDone` / `first` / `poolSize`. |
| POST | `/api/practice/state` | Persist the practice grid. |
| POST | `/api/practice/check` | Grade the practice grid; on solve, advance the per-user warm-up counter. |
| POST | `/api/practice/skip`  | "Skip the warm-up" - closes the first-run ladder so it stops re-offering itself. |

`/api/preview` must not acquire any of `/api/daily`'s side effects: no `startedAt` stamp, no `att:`
row, no `opened` counter, and above all no consuming `tut:{userId}`. The splash renders whenever the
post scrolls past in the feed, so any of those would mean that merely *seeing* the post starts your
timed run and burns your one-time tutorial.

Leaderboard routes (`leaderboard.ts`). One public route, read by the game webview through
`ledger.ts` - it serves both in-game standings surfaces.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/leaderboard` | One board. `?scope=today\|week\|season\|alltime\|streak`, `?date=YYYY-MM-DD`, `?limit=` (1..100, default 50). Returns rows, your row with a percentile, and `provisional`. **Public** - no solve and no moderator status required. |

Internal endpoints (`/internal/*`, called by the mod menu / scheduler):

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/internal/menu/create-post`      | Mod menu: publish the next daily case (applies the vote ramp, rotates the bucket). Warns in the toast when it is the second case of the same date. |
| POST | `/internal/menu/funnel`           | Mod menu: how this case is doing, as a sentence - opened / played / solved, the **named** solve rate (`solved/firstMove`) alongside `solved/opened`, where boards stopped short of 12, hint use per rung, a per-case board integrity check, the day's distinct solvers, and a 7-case trend. The raw counter table goes to `devvit logs`. |
| POST | `/internal/menu/audit`            | Mod menu: the raw Redis state behind all of the above (`audit.ts`). Summary in the toast, full dump in `devvit logs`. See "Reading the database" below. |
| POST | `/internal/scheduler/daily-post`  | The hourly tick for automatic daily publishing. Registered, and a no-op unless a moderator turns the per-subreddit setting on (`src/server/daily.ts`). |
| POST | `/internal/cron/rollup`           | Nightly re-scoring, **registered** as `scheduler.tasks.lb-rollup`, `cron: "0 3 * * *"`. Accepts `{date}` to force one day; otherwise takes a 20 h lease via `runOnce()` and rolls every pending day. |

**Three mod-menu items**, declared in `devvit.json` - one action on the subreddit menu ("publish a
case") and two reports on a post's menu ("how is this case doing?" and "what is actually in the
database?", both `location: post` + `postFilter: currentApp`).

It used to be five. "Deducto: show leaderboard" was a moderator-only toast of a board that
`GET /api/leaderboard` now serves to every player, so it was a worse copy of a screen anyone can
open. "Deducto: publish weekly standings" went with it, and its whole surface - the `leaderboard`
entrypoint, `board.html`/`board.ts`/`board.css` and `GET /api/board` - was deleted with it: once
every player can open the same four boards inside the game at any moment, a separate weekly post is
a third copy of numbers they already have, paid for by a manual moderator ritual. The funnel was
registered twice - once per location - purely because `postFilter: currentApp`
may not be combined with `location: ["subreddit"]` and an unfiltered subreddit item would attach to
posts this app never created; the post-menu half kept, because `postData.date` is right there, so
the report is unambiguous about which case it means and needs no `lt:lastPostId` indirection.

**One cron is registered, one is not.** The daily post is still manual: Reddit automod kept banning
the auto-posted thread, so cases are created from the mod menu.

The **rollup is registered** (`0 3 * * *`), and the reason it was not is worth keeping, because the
cost of the wait was a lie on screen. The plan had been to hold the last word on cron scheduling for
the auto-posting track and share one `/internal/cron/tick` dispatcher, since Devvit allows 10
recurring tasks per installation. Meanwhile `ledger.ts` printed **"scores settle overnight"** under
every board on every result card, the settling never happened, and so on every day this game has
ever played: `T` in the scoring formula stayed the tier nominal, and `lb:daymeta.medianSec` /
`rolledAt` were never written at all. On a measured live day (5 solvers, median 404 s on a 🟢 case)
that under-scores every player by 100-200 points. A promise printed to players is not something a
track can hold in reserve; the shared primitive (`runOnce()`) was the real requirement and it is
shared either way. This spends 1 of 10 slots and leaves 9.

03:00 UTC is past midnight, so a straggler on yesterday's case is already in, and well before a case
goes out. `rollupPending()` never rolls the day the sub is still playing (`currentDay()`), so a day
settles on the first run after the sub has moved on - if the sub skips a day, the last day stays
open until the next case is published. That is the definition working, not a lag to fix.

`provisional` on a board view means exactly the sentence the client prints for it - "the nightly
recount can still move a row here" - so it is a question about **points**, not about whether a period
is over. The day board is ranked by raw seconds, which nothing re-prices, so it no longer carries
the promise; week / season carry it while the period runs; all-time always carries it, because the
live day's provisional points are always inside it.

### Reading the database (`/internal/menu/audit`, `audit.ts`)

Devvit Redis lives inside the app: no CLI, no console, no export, and **no key enumeration at all**
(`KEYS` / `SCAN` do not exist). Looking at live state is therefore not a query, it is code you ship.
Four collections are the entire map, and a key not reachable from one of them cannot be read back by
anyone, ever:

| Collection | What it makes reachable |
| --- | --- |
| `lt:posts` | every case this app published → all `stats:`/`stuck:`/`lb:{postId}`/`vote:` keys, and how many cases went out on a given date |
| `stuck:{postId}` | every player who ever autosaved a board on that case (userId) → their `att:` row and `streak:` hash |
| `lb:alltime` | every player who ever recorded a solve (username) → `user:`, `lb:days:`, `flair:set:` |
| `lb:index:days` | every day that ever recorded a solve → `lb:day`/`solves`/`points`/`applied`/`daymeta` |

The tool prints all of it, and cross-checks what can only be wrong: `lb:points` against `lb:applied`
per member, `lb:alltime` against `sum(lb:days:{user})` and `user.totalPoints`, `user.solved` against
the number of recorded days, and `lb:streakbest` against the longest **consecutive** run in
`lb:days:{user}` - a streak longer than that is proof the streak board is counting days the points
boards have no record of. It also recomputes the day's median and prints what the rollup *would*
change, so "has it run" is answered with a difference rather than with the presence of a key.

What it cannot reach is printed too, rather than left as a silent hole: `att:` rows for openers who
never autosaved (counted in `stats.opened`, then unreachable), `tut:`/`onb:`/`onbSkip:`/`pract:`
outside the userIds in `stuck:`, and anything about people who never opened the post at all.

## Redis key schema

Per post / per user attempt (`index.ts`):

- `att:{postId}:{userId}` - hash: `startedAt`, `grid`, `activeSec`, `hints`, `hinted`, `solved`,
  `solvedAt`, `timeSec`, `solveOrder`, `vote`, plus funnel bookkeeping `maxCells`, `lastGain` and
  the once-only flags `f_open` / `f_move` / `f_r3` / `f_r6` / `f_r9` / `f_hint` / `f_h1` / `f_h2` /
  `f_nudge`. `startedAt` (the timer baseline, written by whichever endpoint touches the row first)
  and `f_open` (the funnel marker) are deliberately separate: deriving "opened" from the absence of
  `startedAt` is what let a row stamped by an older build report `opened 0 -> moved 1` forever.
- `lb:{postId}` - sorted set (per-post leaderboard), member = username, score = solve time in seconds.
- `vote:{postId}` - hash of Harder / Same / Softer counts.
- `solvedCount:{postId}` - counter used to assign finishing order.
- `streak:{userId}` - hash: `current`, `best`, `lastDate`.
- `tut:{userId}` - marks the first-visit coach marks as seen.
- `stats:{postId}` - hash of funnel counters: `opened`, `firstMove`, `reached3/6/9`, `hintStep1`,
  `hintStep2`, `hintUsers`, `nudged`.
- `stuck:{postId}` - sorted set, member = userId, score = best cell count reached (the stall histogram).

Global daily-series state:

- `lt:level` - current difficulty level (index into the live tier buckets; 0 or 1 today).
- `lt:levelBase` - the `DEFAULT_LEVEL` the value above descends from. Equal → the sub is still on the
  default and follows it when the constant moves; different → the sub voted itself there and keeps it.
- `lt:lastPostId` - previous daily post id (for the epilogue, the vote ramp and the weekly CTA).
- `lt:lastPostDay` - the day of that post (`YYYY-MM-DD`), written from the same value that goes into
  `postData.date`. It is what lets a request running *outside* a post resolve the same day a request
  running inside it would - see `currentDay()` below.
- `lt:bucketCursor:{level}` - rotation cursor within a level's case bucket.
- `bank:cursor` - monotonic case number for post titles.
- `lt:posts` - sorted set of every **daily case** post this app created, newest last, trimmed to 60.
  `registerPost()` runs only inside `createDailyPost()`, so only real cases land here and the
  funnel's 7-post trend cannot average in anything else.

Practice / onboarding lane (isolated from the daily; no leaderboard/vote/streak):

- `onb:{userId}` - number of warm-ups completed (also the warm-up pool cursor).
- `onbSkip:{userId}` - the player dismissed the first-run ladder.
- `pract:{userId}:{k}` - practice attempt for warm-up slot `k`: `startedAt`, `grid`, and `idx`, the
  case that board belongs to. `idx` exists because the slot is numbered by the per-user counter while
  *which case sits in a slot* moved with the warm-up pool (it used to be the constant #78 for every
  `k`), and slot 0 kept the same board shape across that move - so the client's own shape check could
  not tell that the marks belonged to another case. A slot whose `idx` does not match is re-stamped
  and its board dropped.

Leaderboard (`leaderboard.ts`), keyed by **date** rather than postId so a board survives a post being
recreated:

- `lb:day:{date}` - ZSET username → solve time (the day's race).
- `lb:solves:{date}` - HASH username → `"timeSec|hints|tier|postId"` (the raw record the rollup
  recomputes from). The trailing `postId` is what separates a replay of the same case from a second
  case published the same date: a replay reconciles from the record and is never re-timed, while a
  faster close of a *different* case that day replaces the record, because the day keeps the
  player's best close. Without it the day's record simply belonged to whichever case they opened
  first, and their second close was silently worth nothing. Rows written before the field carry
  `""` and are treated as their day's only case.
- `lb:points:{date}` / `lb:days:{username}` - ZSETs of what that day was worth (absolute, not incremental).
- `lb:applied:{date}` - HASH username → points already folded into the aggregates. This is the whole
  reason the rollup is idempotent: every aggregate write is a *delta* against this number.
- `lb:daymeta:{date}` - HASH `solvers` / `medianSec` / `rolledAt`.
- `lb:week:{YYYY-Www}`, `lb:season:{YYYY-MM}`, `lb:alltime`, `lb:streakbest` - ZSETs of points (days, for the streak board).
- `lb:index:days` - ZSET of every date that has solves, trimmed to 400.
- `user:{username}` - HASH `firstSeen` / `solved` / `totalPoints` / `bestTimeSec` / `hintsTotal` /
  `lastDate`. ⚠ `solved` counts **days with a recorded solve**, not cases closed - the two differ
  only on a date that published more than one case, and the day is the unit every key here is built
  on. It must equal `zCard(lb:days:{username})`; the audit checks exactly that.
- `lb:cta:{postId}` - cached permalink of the latest daily post.
- `cron:once:{task}:{window}` - the `runOnce()` lease.

### One definition of "the day"

Two clocks used to answer "what day is it", and they disagreed the moment a post outlived its own
date - which is why the bug survived the whole offline gate and only appeared on the live sub:

| | old | used by |
| --- | --- | --- |
| `todayStr()` in `index.ts` | `postData.date` | the **writers**: `lb:day`, `lb:week`, `streak:{userId}` |
| `todayUtc()` in `leaderboard.ts` | the server's clock | the **readers**: the mod menu and `/api/leaderboard` |

A case published on the 7th and solved at 00:20 UTC on the 8th was written to `lb:day:2026-08-07`
and read back from `lb:day:2026-08-08`. Both sides now go through one function,
`currentDay()` in `leaderboard.ts`:

1. **inside a post** → that post's day (`postData.date`). Definitive: it *is* the case's day.
2. **outside a post** → `lt:lastPostDay`, falling back to the newest score in `lt:posts`.
3. **nothing published yet** → the server's calendar day.

`todayUtc()` survives only for things that genuinely are about the wall calendar: the `runOnce()`
lease window. Everything else - the day a solve is filed under, the streak's "yesterday", which day
the mod menu and `/api/leaderboard` report on, whether a board is still `provisional`, and which days
`rollupPending()` considers finished - reads `currentDay()`.

> Devvit Redis **cannot enumerate keys**, and it is isolated **per subreddit**. Both facts are
> load-bearing here: anything that must ever be walked (`lt:posts`, `lb:index:days`) has to be written
> into an explicit collection up front, and there is no cross-community board without an external
> service over `fetch`, which needs app-review approval.

## Anti-cheat

Server-authoritative by construction:

- The solution never leaves the server. `/api/daily` returns suspects, tokens and clues only;
  `/api/preview` returns counters only.
- "Solved" is derived, not asserted by the client: the client can only reach the solved state by
  actually deducing all 12 cells with no clue contradicted; the server re-grades against the stored
  solution before recording anything.
- The timer is server-bounded **from above**. The client reports active play seconds, but
  `/api/check` clamps the recorded time to `[1, wall-clock since startedAt]`, so nobody can be
  credited with more time than they have actually had the post open. Note what this does *not* do:
  the lower bound is a literal `1`, so the clamp alone cannot stop a tampered client posting
  `seconds: 1` after a slow honest solve. That direction is the plausibility floor's job, below.
- Below `MIN_PLAUSIBLE_SEC = 25` a row is **flagged, never dropped**: it keeps its raw time, carries a
  written `Flagged` tag on the board (not a glyph - the chrome carries no emoji) and is excluded from
  the day's median, but earns no speed points - so a forged
  result cannot take the podium from a real one, while a genuinely fast replay is not deleted.
- A username that cannot be resolved means **nothing is written**. The old fallback to `userId`
  leaked a raw `t2_…` into a public table.

## Difficulty engine + case bank

`src/server/engine.ts` is a deterministic TypeScript port of a Python reference solver
(parity-checked by `engine.test.ts`, which also anchors the hint ladder):

- Seeded RNG (mulberry32) with an `xmur3` string seed, so generation is reproducible.
- Clue shapes (see `src/shared/types.ts`): `ne` (suspect is not a value), `same` / `nsame` (two
  attributes share / do not share an owner), `before` (one time precedes another).
- `classify()` tiers a case using two solver models: green = solvable by the **weak** model
  (per-suspect domains - i.e. deducible directly on the board), yellow = needs the **grid** model
  (pairwise + transitivity, i.e. cross-referencing), red = not even grid-solvable.
- `generate()` builds a case of a requested tier: seeded solution → pool of true clues → minimize to
  a unique-solution set. A `tutorial` case is a green minimized down to a clue floor, so it is
  over-clued on purpose; the engine still classifies it green, and the tier name records the intent.
- `adviseOnGrid()` runs the weak model over a live board and returns `move` / `contradiction` /
  `done` - this is what the hint ladder and the board's status line are built on.
- `crossAdvice()` takes over where that stops. WEAK is the board, so "no forced move" is the end of
  the board, not the end of the case: on 🟡 it arrives after ~8 crossings-out with most cells still
  open, and until now both free rungs answered it with the same bare `stuck`. It runs the **GRID**
  model over the player's own marks - the exact reasoning the board cannot hold - and returns the
  smallest set of clues (1-3, searched in that order, so every clue named is load-bearing) that
  still kills a standing chip, plus the value two of them share when there are two. 99 of the 100
  🟡 bank cases get a move at that wall; the one that needs four clues at once keeps `stuck`.

`scripts/build-bank.ts` runs offline (`npm run build:bank`, default 160 cases) and writes
`src/server/bank.json`. Every entry is verified for its tier and for a unique solution, and carries an
offline difficulty `score` used at runtime to order the warm-up pool easiest-first.

Indices **`0..119` are pinned** (`PINNED = 120`): a live post stores its bank index in `postData`, so
changing what sits at an index would swap the puzzle under an open post and throw away every player's
board. Within the pinned range `tierFor()` is the original layout - every 6th case green, the rest
yellow. Everything after 120 is **appended**: 15 `tutorial`, then green. Result: **160 cases = 15
tutorial / 45 🟢 / 100 🟡**. Yellow stays at 100 because shrinking it would mean deleting pinned
indices. 🔴 is deliberately not generated - brute force on every minimization step, an order of
magnitude more expensive, and it belongs to a separate hardcore build.

`scripts/check-solvability.ts` (`npm run check:solvability`) is the regression gate on that promise:
it runs the weak model over the bank and **fails the build** if any tutorial or green case does not
reach 12/12 cells from board state alone.

## Difficulty ladder + vote ramp

- The daily ramp may serve `DAILY_TIERS = ["green", "yellow", "red"]`, filtered to the tiers that
  actually have cases. With today's bank that is `[green, yellow]`, so `MAX_LEVEL` computes to 1 -
  dropping 🔴 into the bank would make it a real third step with no code change.
- `tutorial` is deliberately **absent** from the ramp. It is the warm-up lane's tier, not a
  difficulty a daily post may land on.
- The daily default level is **L0 = 🟢** (`DEFAULT_LEVEL = 0`). The measurement behind that:
  `check-solvability.ts` shows the 4×3 board forces 12/12 cells on green and 0/12 on 69 of the 100
  yellow cases - 🟡 as a default handed a first-time player a board with no legal move on it.
- `createDailyPost()` shifts the global `lt:level` by the previous post's community vote, then picks
  a case from that level's bucket, rotating with `lt:bucketCursor:{level}`.
- **`DEFAULT_LEVEL` only reaches an install that has never published.** It is the fallback for a
  *missing* `lt:level`, so the move to 🟢 never reached the live sub: its key already held `"1"` from
  the old build, and one player cannot outvote `VOTE_MIN_TOTAL = 5`. `resolveLevel()` therefore
  stores the level together with the default it descends from (`lt:levelBase`) and re-baselines only
  a sub that never voted off the old default - self-triggering, so the next edit of the constant
  needs no migration step to remember. See the warning box in `docs/05-data-model.md` for the two
  neighbouring keys (`lt:bucketCursor:{level}`, `bank:cursor`) and why neither is migrated.
- The publish toast names the tier it just published (`Case #N published · green · level 0 (the
  default)`). "Case published!" read identically for a 🟢 and a 🟡, which is how a series stuck on
  the wrong tier stayed invisible for weeks.
- Vote ramp constants (`src/server/index.ts`): `MIN_LEVEL = 0`, `DEFAULT_LEVEL = 0`, `MAX_LEVEL`
  derived, `VOTE_MIN_TOTAL = 5` (significance gate), `VOTE_MIN_LEAD = 0.10` (the leading choice must
  beat the runner-up by at least 10 points). Below the gate or without a clear leader, the level is
  unchanged.
- Bucket order is not bank order. `spreadByTheme()` interleaves the bucket greedily by theme -
  always the theme with the most cases left that isn't the one just used. Bank order would have put
  20 pizza cases in a row at the top of the green bucket (the pinned layout ties tier to `i % 6` and
  theme to `i % THEMES.length`, so all 20 pinned greens share one theme), which means twenty daily
  posts with near-identical titles: exactly the bot-shaped signature that got the previous
  subreddits banned.
- Post titles are `Case #N · YYYY-MM-DD · <case title>`, with a tier label appended **only** when the
  ramp has moved off the default. The date is what keeps a daily series out of the "identical
  repost" filter; a constant tier tail on every post would add headline similarity, not remove it.

## Leaderboard + scoring

Decided in plan 04 §B; the formula lives in `leaderboard.ts` and is pure and separately testable.

```
POINTS = 500 + SPEED − 60 × hints,   clamped to [300, 1000]
SPEED  = round(500 × clamp((2·T − t) / (1.5·T), 0, 1))
```

`t` = solve time in seconds, `T` = the case's target time: 180 s tutorial, 240 s 🟢, 360 s 🟡
(480 s reserved for 🔴). The curve is anchored on `T`: `t = 0.5·T` → 500, `t = T` → 333, `t = 2·T` → 0.

- The floor of **300** is deliberate: solving *with* hints must always beat not solving, or the
  formula punishes people for trying on the hard days.
- The streak is **not** a multiplier - a multiplier runs away and makes the board unwinnable for a
  newcomer. It gets its own board (`lb:streakbest`), fed from the `best` field `index.ts` already keeps.
- "Today" ranks on raw solve time, ascending. Week / season / all-time rank on points, descending.
  Longest-streak ranks on days.
- The nightly rollup recomputes a finished day from the **original** `t` and `hints` with `T`
  re-targeted on that day's median, clamped to ±50% of the tier's nominal target so one freak day
  cannot move the scale. It is idempotent by construction (`lb:applied:{date}` deltas), so a re-run
  changes nothing - and that "changed: 0" is the test.
- Percentages are gated: no percentile under `SMALL_N = 10` players on a board, and no solve-time
  histogram under `HIST_MIN = 50` solves on a day. Below those, the UI reports the count instead.
  The percentile's denominator is the board's **full** size, matching the copy printed over it
  ("faster than X% of N detectives"); dividing by `N-1` made the fastest player of ten "faster than
  100% of 10", which counts them as faster than themselves.
- **One ladder for the rank.** `rankState()` in `flair.ts` is the single answer to "what rank does
  this player hold", used by both the subreddit flair and the result card. The rung held comes from
  `streak.best` (a title is earned and kept - `best` only grows, so nobody is ever demoted and the
  game and the flair are the same word by construction); the distance to the next rung comes from
  `streak.current`, because only a live run can produce a new best. Before this, the flair read
  `best` and the card read `current`, so one player could hold two titles at once, and one screen
  printed "STREAK 3" on the plaque above a board that said 4. `best` and `current` are now separate,
  separately named fields in every payload (`streakBest` / `streakCurrent`).
- **Every figure on the result card is scoped to the day**, not to the post: `total`, `rank`,
  `betterPct`, the histogram and the top three all read `lb:day:{date}`, which is the same key the
  standings block beneath them fetches. `lb:{postId}` is still written (the client's offline
  fallback and the epilogue read it) but is no longer what the card counts.

## Verification gates

Everything runs offline, with no subreddit and no network. This is a **manual** checklist, in the
order to run it - `npm run deploy` builds and uploads, and runs none of these except `build:bank`
(via `npm run build`):

| Command | What it holds | Layer |
| --- | --- | --- |
| `npm test` | `engine.test.ts`: the TypeScript engine is clue-for-clue identical to the Python reference - tier anchors 🟢/🟡/🔴, all three live generators (tutorial / green / yellow), the hint ladder, and the whole bank played to its WEAK wall (every 🟡 board still gets a move, never the true value) | pure functions |
| `npm run test:routes` | `routes.test.ts`: the real Express routes, end to end | **route level** |
| `npm run build:bank` | 160/160 cases rebuild deterministically, each unique-solution and correctly tiered | data |
| `npm run check:solvability` | every tutorial and 🟢 case reaches 12/12 cells from board state alone | data |
| `npx tsx scripts/smoke-status.ts` | on the stored solution every clue is satisfied, and client and server agree, across the whole bank | data |
| `npm run type-check` | `tsc --noEmit`, clean | types |

`scripts/check-levels.ts` and `scripts/difficulty.ts` are measurement tools, not gates: they print
the ramp's tier/level distribution and the bank's offline difficulty-score spread. Run them with
`npx tsx` when a difficulty decision needs a number.

### Why `test:routes` exists

It was added after v0.0.7, where **two bugs reached production through a fully green offline gate**:
a recorded solve reached no board at all, and the funnel could report `opened` lower than `moved`.
Neither is a wrong function. Both live in the *interaction* between endpoints, Redis state and the
two clocks - exactly the seam a unit test does not span.

So the harness drives the **real** router. `src/server/testing/tsconfig.json` aliases
`@devvit/web/server` to `src/server/testing/devvit-stub.ts`, which is a working in-memory Redis
(hashes, strings, sorted sets), a `context`, an auth surface and a post-submission recorder;
importing `src/server/index.ts` then captures the Express app instead of listening on a port.
`harness.ts` gives it `call(method, path, body)` and grid builders that produce a genuinely solved
board - or a board played to its WEAK wall - from a real `bank.json` entry. Fifteen sections, run as
`npm run test:routes`:

- a solve lands on **every** board (`lb:day`, `lb:week`, `lb:season`, `lb:alltime`, `lb:streakbest`,
  `lb:points`, `lb:days:{user}`, `lb:index:days`) and on the same day the mod menu reads back;
- a post that outlives its own date keeps writer and reader on one day;
- a solve stamped in `att:` but missing from the boards heals on the next `/api/check`, a mid-write
  failure is recoverable, and reconciling never undoes the nightly rollup;
- the guard that must still refuse to write (no resolvable username) still refuses, and no raw
  `t2_…` reaches a public table;
- `opened` can never fall below `moved` in any call order, and a legacy `att:` row repairs itself;
- a board the autosave created before `/api/daily` ever ran is handed back to the player, not
  discarded;
- the funnel readout is a sentence and audits itself (board rows vs solve count);
- a stale `lt:level` written by a build with a different `DEFAULT_LEVEL` does **not** outlive it -
  the tier is read off the case that was actually submitted, and a sub that voted keeps its vote;
- a practice board saved against a case that no longer sits in that slot is dropped, not handed back;
- the two free hint rungs answer differently on a 🟡 board with no forced move left, and neither
  names a chip that is already crossed out or is the true answer;
- the weekly-standings refusal explains what would make the button work;
- the **retired** `/internal/menu/leaderboard` returns 404 - a removal, pinned as a test.
