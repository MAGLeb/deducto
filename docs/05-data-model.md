# Data model

> 🌐 + 🧩 **Two halves, and the split matters.** The Redis layout for the day, the streak, the
> boards, the points and the ranks is **shared** — none of it knows what a puzzle is made of. The
> puzzle types, the bank record and the grid state are the **Deduction Grid's**. A second format
> adds its own bank and its own state shape and touches none of the shared keys; what a published
> post would have to declare for that to work is in [12-game-types.md](12-game-types.md) §3.

Deducto is a daily deductive puzzle on Reddit (Devvit Web). This describes the real data format: types from `src/shared/types.ts` and `src/shared/status.ts`, the bank record shape (`src/server/index.ts`), and the Redis layout. The solution and timer live ONLY on the server - the client never receives the solution (anti-cheat).

Grid: 4 suspects x 3 categories. Internal category ids: `flair` (Coat), `time` (Time), `object` (Item).

## Shared types (`src/shared/types.ts`)

Client and server share one module. The clue shape matches the difficulty engine 1:1 (verified for parity against the Python solver).

```ts
type CatId = string;                                   // "flair" | "time" | "object"
type Cats = Record<CatId, string[]>;                   // catId -> values
type Solution = Record<string, Record<CatId, string>>; // suspect -> cat -> value

// Reference in a clue: ["s", suspectName] or [catId, value].
type Ref = [string, string];

// Clue - discriminated union on the k (kind) field.
type Clue =
  | { k: "ne";     s: string; cat: CatId; v: string } // suspect != value
  | { k: "same";   a: Ref; b: Ref }                   // a,b - same owner
  | { k: "nsame";  a: Ref; b: Ref }                   // different owners
  | { k: "before"; a: Ref; b: Ref };                  // time(a) < time(b)

// Canonical clue key (dedup and compare by value, analog of repr()).
function clueKey(c: Clue): string;
```

Exactly four clue kinds: `ne`, `same`, `nsame`, `before`. No `equal` / `after` / `location`.

## Grid state (`src/shared/status.ts`)

The player's marks are computed independently of the hidden solution - honest feedback without spoilers.

```ts
type Cell = 0 | 1 | 2;   // 0 = clear (unknown), 1 = crossed out, 2 = confirmed
type GridState = Record<string, Record<string, Record<string, Cell>>>; // cat -> suspect -> value -> Cell

interface PuzzleCtx {
  suspects: string[];
  catIds: string[];               // category order, ["flair","time","object"]
  cats: Record<string, string[]>; // catId -> values
  timeValues: string[];           // ordered time values (for before)
}
```

The grid is a two-state toggle: a tap switches a cell 0 <-> 1 (cross out value / clear). State 2 (confirmed) is supported by the engine, but the current board UI does not set it: the cell's "effective answer" is derived from the crossouts (the single non-crossed-out candidate). The case closes automatically when all 12 cells are determined and every clue is green. There is no "Check solution" button and no concept of an "error".

## Bank record (`src/server/index.ts`, `bank.json`)

```ts
interface BankEntry {
  themeId: string;
  tier: "tutorial" | "green" | "yellow" | "red"; // in prod tutorial/green/yellow; red - backlog
  suspects: string[];
  objectTokens: string[];           // values of the object category
  clues: Clue[];
  solution: Solution;               // server secret, never sent to the client
  score?: number;                   // offline difficulty score (build-bank.ts); orders the warm-up pool
}
```

Four tiers, three of them built (160 cases: 15 tutorial / 45 green / 100 yellow):

| tier | what it means | where it is served |
|---|---|---|
| `tutorial` | over-clued 🟢 - 14 clues, ≤35% relational, ≥2 time hooks. Every move forced *and* obvious | warm-up lane only (`/api/practice`), never a daily |
| `green` | weak-forced: solvable using only what the 4×3 board can record | **daily default** (`DEFAULT_LEVEL = 0`) |
| `yellow` | grid-forced but not weak-forced: needs coat↔time↔item cross-referencing held in your head | daily, only after the sub votes Harder |
| `red` | not grid-forced - needs a guess. Not generated | backlog |

The daily ramp (`LEVEL_BUCKETS`) is built from `DAILY_TIERS = ["green","yellow","red"]`, so `tutorial` can never be voted into a daily post and `MAX_LEVEL` sizes itself as tiers get added.

> ⚠️ **A bucket is served in theme-interleaved order, not bank order** (`spreadByTheme()`). `build-bank.ts` lays a tier down in a run while the theme cycles as `i % THEMES.length`, so all 20 pinned 🟢 landed on one theme (`pizza`). Serving the green bucket in bank order therefore put the *same* headline on the first twenty daily posts - a bot-shaped signature, and the thing that got the previous subreddits banned. The greedy interleave (always the theme with the most cases left that isn't the previous one) brings the longest same-theme run down from 20 to 3; the 3 is a tail at day ~43 and is unavoidable while `pizza` is 24 of the 45 greens. `lt:bucketCursor:{level}` indexes into this re-ordered list, not into the bank.

> ⚠️ **Bank indices 0..119 are pinned.** A live post stores its bank index in `postData`, so changing what sits at an index swaps the puzzle under an open post and discards every player's saved board (`gridMatchesCtx` rejects a grid whose shape no longer matches). New cases are appended; `scripts/build-bank.ts` reproduces 0..119 byte-for-byte on every rebuild.

The client receives the public shape (without `solution`):

```ts
{
  idx, caseNumber, themeId, tier, level,
  title, legend,
  suspects, objectTokens, clues,
  day,               // YYYY-MM-DD
}
```

## Hint ladder (`/api/hint`)

Three steps; only step 3 costs a hint. Body `{ grid, step }` (legacy `{ grid, reveal }` still maps to step 3 / log-only). The deduction is `adviseOnGrid()` in [engine.ts](../src/server/engine.ts) - the WEAK model run on the *player's own board*, so the answer is about their position, not the solution.

```ts
type Advice =
  | { kind: "move";  clue: number; cat?; suspect?; value?; pins? }  // step 1: clue number only
  | { kind: "cross"; clues: number[]; via?; viaCat?; cat?; suspect?; value?; pins? } // ← the 🟡 rung
  | { kind: "contradiction"; clue: number | null }                  // their board breaks that clue
  | { kind: "stuck" }                                               // nothing under 4 clues at once
  | { kind: "done" };                                               // everything already determined
```

**`cross` is the rung that makes the ladder work on 🟡.** WEAK *is* the 4×3 board, so a 🟡 case runs
out of board-visible moves long before it is solved - after ~8 crossings-out, with 0-4 of the 12
cells decided. Every rung past that point used to return the same bare `stuck`, so rungs 1 and 2
printed one identical sentence and pressing either button changed nothing on screen. `crossAdvice()`
answers that board with the GRID model (value×value + transitivity - precisely the reasoning the
board cannot record) run over the player's own marks:

- `clues` is the **smallest** set that still kills a chip, searched by size 1 → 2 → 3. Reaching size
  *k* means no smaller subset moves anything, so every clue named is load-bearing.
- `via` / `viaCat` name the value two clues share, when there are exactly two - the chain the player
  has to hold in their head ("clue 3 and clue 6 both mention the Red coat").
- `cat` / `suspect` / `value` / `pins` are the chip it kills, and are sent **only on step 2** - the
  whole difference between the free rungs. Eliminations only: the closure rules out a cell's other
  candidates in the same pass it pins one, so every deduction reaches the player as "cross this out".

Measured over all 100 🟡 bank cases played to that wall (`engine.test.ts`, `bankWallSweep`): one
clue is enough on 96, a pair on 1 more, three clues on 3 more - **99 of 100**. The last case needs
four at once and keeps `stuck`, which is still true of it. Advice is never the true value and never
points at an already-crossed chip; worst case ~40 ms.

## Splash preview (`/api/preview`)

What the feed's first screen renders before the player has opted into anything. Counters only - no clues, no grid, no solution, no case text beyond the theme title.

```ts
{
  // ① THIS CASE
  case:  { number: number,          // caseNumber(): postData.n, else bank index + 1 - never null
           title: string, tier: "tutorial"|"green"|"yellow"|"red",
           closers: number,          // rows on lb:{postId} - who has closed THIS case
           fastestSec: number | null }, // this case's best time; null until somebody closes it
  // ③ YOU, ALL TIME
  you:   { state: "new"|"playing"|"solved",
           deduced: number,          // cells already determined on the saved board (0..cells)
           cells: number,            // 12
           streak: number,           // = streakBest; the rank-bearing number (see "Three numbers")
           streakBest: number,
           streakCurrent: number,    // the LIVE run - 0 once it can no longer be extended
           casesSolved: number,      // cases closed; the archive walker's number, never the streak
           timeSec: number | null }, // your solve time, only when state === "solved"
  // ② THE SERIES
  next:  { number: number,           // bank:cursor + 1 - the number the next publish will take
           opensInMin: number,
           tier: Tier | null,        // the tier the next case WOULD get if published now
           moved: "up" | "down" | null,   // whether the verdict actually shifts the level
           vote: { total: number,
                   tally: { Harder: number, Same: number, Softer: number },
                   verdict: "Harder"|"Same"|"Softer"|null,  // null = the sub has NOT decided
                   yours: string | null,
                   minTotal: number } | null }             // VOTE_MIN_TOTAL
}
```

> ⚠️ **The payload is grouped by world, and there is no `today` group.** ① `case` · ③ `you` ·
> ② `next` ([docs/11-stats-ia.md](11-stats-ia.md) §1). Nothing on a card that is one case's cover
> page is scoped to the day: the day is the standings' unit and is answered there, with names
> attached and a titled board to make the scope unambiguous.
>
> This **reverses the source, not the invariant**, that agent R chose. R found the splash counting
> the post under the word "today" and moved the count to the day board, which was correct for that
> label. The label is gone. The invariant R was protecting - *a figure is never printed under a word
> that describes a different population* - is what now makes the two splashes of a two-case day
> report **different** numbers, each honestly its own case's.
>
> `closers` and `fastestSec` both come off `lb:{postId}`, one row per player who closed that case,
> re-written idempotently on every `/api/check` - so both are correct retroactively for every solve
> whose username resolved.

> ⚠️ **`next.vote` is `null` on an archive case.** `createDailyPost()` reads the vote of
> `lt:lastPostId`, so only the case the sub is currently on steers the next one. An older post
> claiming authorship of tomorrow's difficulty would be an invented outcome (dec. 37). The countdown
> survives either way, because that one is still true.
>
> **A verdict is not a tally.** `verdict` is `null` below `VOTE_MIN_TOTAL = 5` or without a
> ≥10-point lead - the states in which the vote moves the level by exactly nothing. `moved` is
> separate again, because at either end of the ladder a decided "Harder" still changes no level, and
> a screen printing the verdict alone would promise a step the publisher then declines to take. One
> definition (`voteVerdict()`) serves the publisher, the feed card and the result sheet.

> ⚠️ **`nextOpensInMin` is a cadence, not a schedule.** It counts 24 h from the newest entry in
> `lt:posts`, and the case number the card names is `bank:cursor + 1` - the number the *next*
> publish will actually take. The old answer was "minutes to UTC midnight" and "this post's number
> + 1", which stacks two assumptions this app does not hold: that cases appear at midnight (the
> daily-post scheduler is off; a moderator presses a button) and that the next case has not shipped
> yet. On 2026-08-14 both were wrong at once - #14's card printed "#15 opens in 1h 30m" while #15
> had been live for nine minutes.

> ⚠️ **This endpoint is strictly read-only.** The splash renders whenever the post scrolls past in the feed, so it must not carry a single one of `/api/daily`'s side effects: no `startedAt` stamp, no `att:` row created, no `opened` counter, and above all no consuming `tut:{userId}`. If it did, merely *seeing* the post would burn the one-time tutorial and start a timed run. Guests (no `userId`) get `state: "new"` and never touch `att:`.

A grid whose **shape** no longer matches the case (the post re-pointed at an `idx` with different suspects or items) is rejected by `gridFits()` and reported as `deduced: 0` rather than crashing `effectiveCount`. `gridFits()` checks shape only, so a re-point inside the same theme keeps the shape and the old marks are read as if they belonged to the new case.

## Result payload (`/api/check`)

> ⚠️ **`/api/check` reconciles on every call; it does not return early on a replay.** `att:.solved`
> is necessarily set *before* the boards are written, so anything that interrupts what follows - a
> thrown Redis call, a deploy landing between the two, a solve recorded by a build that predates
> `writeSolve()` - leaves a player marked as a solver with no row on any board. The old code
> returned early whenever `att:.solved === "1"`, which made that hole permanent: the result card
> kept rendering (it reads the per-post `lb:{postId}`) while `lb:day` / `lb:week` / `lb:alltime`
> stayed empty forever, and nothing could ever repair it.
>
> A replay now re-runs the board writes with the **recorded** time, order and hint count. It never
> re-times a solve, never re-issues a finishing position, and never counts a **visit**: the client
> re-submits the finished board every time a solved post is reopened, so crediting a replay would
> hand an unbreakable streak to anyone who opens one archive post a day. What it does do, once per
> case, is read `att:.solvedAt` and tell the streak the calendar day that case was really closed -
> the only repair available for a solve recorded before the streak knew what a day was. Inside
> `writeSolve()` the record is claimed with `hSetNX`, so exactly one call per (day, player) is
> "fresh"; every board write after the claim is idempotent (`zAdd` re-sets the same score,
> `applyPoints` is a delta against `lb:applied:{date}`) and runs unconditionally. The one
> non-idempotent write, the `user:{username}` solve counter, is gated on winning the claim, and the
> target used is the day's rolled median when there is one - otherwise a replayed check would
> quietly undo the nightly rollup.

> ⚠️ **The hero's three figures are the CASE's; everything else on the card is the DAY's.**
> `caseTotal` / `caseRank` / `caseBetterPct` come from `lb:{postId}` and answer "how did I do against
> the people who solved this same puzzle"; `total` / `rank` / `betterPct` / the histogram / the top
> three come from `lb:day:{date}` and belong to the standings block that is titled with the day. The
> hero line used to switch between a percentile over the day and a finishing order over the case
> depending on `hasHistogram` - one sentence, two subjects, chosen by a threshold no reader can see
> ([docs/11-stats-ia.md](11-stats-ia.md) §4.3). `personalBest` is `true` only on a **fresh** solve by
> a player with more than one case closed whose time is at or under `user:{name}.bestTimeSec` - a
> replay is not news, and a first close has no record to beat.

`betterPct: number | null` - the percentile is `null`, not `50`, when there is nobody to compare against (`total <= 1`) or when the viewer has no row on the board at all. An invented percentile is exactly the fake social proof decision #37 forbids; the client only renders the line at `hasHistogram` (N ≥ 50), and the nullable type is what forces any scoring built on top of it to handle the empty case explicitly. The denominator is the board's **full** size, matching the sentence printed over it - `N-1` made the fastest player of ten "faster than 100% of 10 detectives", i.e. faster than themselves.

> ⚠️ **Every count on the card is the DAY's, not the post's.** `total`, `rank`, `betterPct`, the histogram and the top three all read `lb:day:{date}` - the same key the standings block directly beneath them fetches through `/api/leaderboard?scope=today`. They used to read the legacy per-case `lb:{postId}` while the copy around them said "detectives" and "today", which agrees only on a one-case day. `lb:{postId}` is still written, for the client's offline fallback and the epilogue.

### Three numbers, three words

`streak:{userId}` holds `current`, `best` and `cases`, and they are three different facts. One word for two of them put **3** on the result card's plaque and **4** on the STREAK board beside it, on the same screen, with nothing saying why - and worse, the in-game rank ladder was computed from `current` while the subreddit flair was computed from `best`, so one player held two titles at once.

`rankState(best, current)` in [flair.ts](../src/server/flair.ts) is now the only answer, for both surfaces:

| Number | Comes from | Where it appears |
| --- | --- | --- |
| the rank you **hold** | `best` | the result card's ladder **and** the subreddit flair - literally the same function call, so they cannot disagree |
| days to the **next** rank | `current` | the ladder's goal line: only a live run can produce a new best, so a broken streak is not told it is three days from a rung that is really thirteen away |
| the board "Longest streak" | `best` (`lb:streakbest`) | the standings |
| cases closed | `cases` | its own field (`casesSolved`) - the number an archive walker is counting, and the one thing "streak" must never be asked to mean |

`best` only ever grows, so nobody is ever publicly demoted - the promise the subreddit copy makes ("a rank you have earned stays earned"). Payloads carry `streakBest`, `streakCurrent` and `casesSolved` under their own names; `streak` remains as the rank-bearing number (= `best`).

> ⚠️ **`casesSolved` is 0 until the player's next solve, and that is not a wrong answer - it is "not
> recorded yet".** `cases` is exact from the build that introduced it; for earlier play the postIds
> are gone (`lt:posts` only started being written recently, and Redis cannot list keys), so the floor
> is seeded from `user:{name}.solved` - DAYS with a recorded solve, which is ≤ cases closed - and the
> seed needs a username, which only the solve path resolves. So the field must be rendered **only
> when > 0**, the same convention `streakCurrent` already uses on every surface.

> ⚠️ **`streakCurrent` is the LIVE run, so it is 0 once the run is over.** The stored `current` is the
> raw length of the run ending at `lastDate`; a run that did not include yesterday cannot be
> extended, so it is finished, and printing its length under "current streak" - or handing it to the
> ladder's "N days to Chief Inspector" - states a run the player is not on. The liveness test is
> applied on **read** (`stateOf()` in [streak.ts](../src/server/streak.ts)), so nothing is lost and
> `best` is untouched.

### What a streak is: days you came back, not the dates of the cases

`updateStreak(userId, day)` used to be handed `currentDay()`, i.e. the **case's publication date**,
so the counter that means "days you came back" was fed the dates of the cases. A live player reported
it: *"I completed the first 10 puzzles in order in one sitting … the counter randomly resets to 1."*
Replayed against the sub's real publication dates (`lb:index:days`: nothing on 08-04 / 08-07 / 08-09,
two cases on 08-14), the old rule hands that player **1, 1, 2, 1, 1, 2, 3, 4, 5, 5** - it climbs and
drops back twice, because on the first case after a hole `lastDate !== prevDay(caseDate)`. The second
half was never reported and is worse: closing an **archive** case wrote that case's old date into
`lastDate`, so the next real day read "you did not play yesterday" and reset a live run - a run of
three, one archive case, then tomorrow gives `1, 2, 3, 1, 1`.

The promise is "solve daily, keep your streak" (dec. 30) and the board one tap away is titled
*"Longest streak - your longest run of days solved back to back"*. That is a habit, so:

> **A streak is the number of consecutive CALENDAR days on which the player closed at least one
> case**, counted on the wall clock (`visitDay()` in [streak.ts](../src/server/streak.ts) = UTC).

Four consequences, all deliberate:

1. **A hole in the feed cannot break it.** Which dates the sub published on is not something a player
   controls, so it cannot be something a player is punished for. On a day with no new case, closing an
   archive case keeps the run alive: the archive is a streak *saver* now, where it used to be the only
   way to lose one.
2. **The whole archive in one sitting is one day**, so the streak is 1. The player who expected 10 was
   counting cases closed - a different number under a different name, never this one.
3. **A replay is not a visit.** The client re-submits the finished board every time a solved post is
   reopened, so counting that would hand an unbreakable streak to anyone who opens one old post a day.
   Only the *first* close of a case records a visit.
4. **`best` only grows.** It drives the subreddit flair, and no repair to a counter is allowed to
   demote someone publicly.

`streak:days:{userId}` is the reason those hold. Every other public number in this game is derived
from a collection, so a bad write can be re-derived away; the streak was the one **accumulator**, and
an accumulator fed a wrong day cannot be repaired afterwards - which is exactly why the live players'
broken runs cannot simply be recomputed. The visit days are now recorded, `current` / `best` are
re-derived from them on every write (`recordVisit()`), and the audit checks the number against the
days behind it instead of taking it on trust.

That also opens the only repair the platform allows. `att:{postId}:{userId}.solvedAt` is the wall
clock of a close, written since the first commit and never read by anything: the first time a player
reopens an old case, that timestamp tells the visit set the day the case was really closed
(`noteRecordedSolve()`). One case at a time, from evidence. `startedAt` is deliberately **not** a
fallback - it is stamped when a row is first touched, so a legacy row would credit *today*, i.e.
merely opening an old post would build a streak.

## Your file (`GET /api/me`)

Everything about the player, in one payload, from keys that already existed and were read by no screen. Read-only, like `/api/preview`.

```ts
{
  name: string | null,          // null for a guest, or a solve whose username never resolved
  casesClosed: number,          // streak:{userId}.cases  - CASES
  daysSolved: number,           // zCard(lb:days:{name})  - DAYS. Not the same question.
  firstSeen: string | null,     // user:{name}.firstSeen
  streakCurrent: number, streakBest: number,
  bestTimeSec: number,          // user:{name}.bestTimeSec
  points: number,               // zScore(lb:alltime, name)
  place: number,                // zCard - zRank on lb:alltime; 0 = no row (never "first")
  detectives: number,           // zCard(lb:alltime) - printed only as `place`'s denominator
  rank: RankState,              // the same rankState(best, current) the card and the flair read
  days: { date, points }[]      // lb:days:{name}, NEWEST FIRST, last 14
}
```

> ⚠️ **`lb:days:{name}` is scored by that day's POINTS, not by the date.** Reading it in rank order
> and taking the tail hands back a player's *best* days under the heading "recent". The members are
> ISO dates, so the ordering comes from them. (Found by the regression test, not by reading.)

> ⚠️ **`casesClosed` and `daysSolved` are different numbers on purpose.** `user:{name}.solved`
> counts days with a solve; `streak:{userId}.cases` counts cases. They differ on any day that
> published two cases - which is also why the seeded floor for `cases` is a floor and not a value.

## Persistence (Redis)

Progress and stats live in Redis, not in the shared types. Keys:

**Devvit Redis cannot enumerate keys.** Nothing can be aggregated after the fact by scanning `att:*` - every stat has to be an explicit counter written at the moment the event happens, and anything that must be iterated later has to be dropped into an explicit collection up front. That constraint shapes the whole funnel layout below.

- `att:{postId}:{userId}` - attempt hash: `startedAt`, `grid` (JSON GridState), `activeSec`, `timeSec`, `hints`, `hinted`, `solved`, `solvedAt`, `solveOrder`, `vote`, `maxCells`, `lastGain`, `streakDay` (the calendar day this close was credited to the streak - also the once-per-case marker that stops a reopened post from crediting anything twice), plus the once-only funnel markers `f_open`, `f_move`, `f_r3`, `f_r6`, `f_r9`, `f_h1`, `f_h2`, `f_hint`, `f_nudge` (kept as fields here so counting an event creates no new keys).
- `lb:{postId}` - leaderboard sorted set: member = username, score = solve time (sec).
- `vote:{postId}` - difficulty vote hash: `Harder` / `Same` / `Softer`.
- `solvedCount:{postId}` - counter, sets the finish order (`solveOrder`).
- `streak:{userId}` - the player's own progress hash: `current` (raw length of the run ending at `lastDate`), `best`, `lastDate` (**a calendar day**, not a case's day), `cases`, `casesSeeded`. Owned by [streak.ts](../src/server/streak.ts); read-only everywhere else.
- `streak:days:{userId}` - ZSET member = `YYYY-MM-DD`, score = that day's epoch ms: the visit days `current` / `best` are derived from, trimmed to the last 400. The write model - `/api/preview` never touches it, because the splash renders on a feed scroll and may not write.
- `lb:day:{date}` · `lb:solves:{date}` · `lb:points:{date}` · `lb:applied:{date}` · `lb:daymeta:{date}` · `lb:week:{isoWeek}` · `lb:season:{YYYY-MM}` · `lb:alltime` · `lb:streakbest` · `lb:index:days` · `lb:days:{username}` · `user:{username}` - the boards and the player profile, all defined in one place ([leaderboard.ts](../src/server/leaderboard.ts):200-212) and all exported, because Devvit Redis cannot list keys and a key nobody names there is a key the audit can never look at. `lb:day:{date}` is the most-read key in the app.
- `user:{username}` - the player profile hash: `firstSeen`, `lastDate`, `solved` (**days** with a solve, not cases), `totalPoints`, `hintsTotal`, `bestTimeSec`. Written by `bumpProfile()` on every scored solve since the leaderboard shipped, and **read by nothing at all until `GET /api/me`** ([docs/11-stats-ia.md](11-stats-ia.md) §5).
- `tut:{userId}` - "coach marks shown" flag.
- `lt:level` + `lt:levelBase`, `lt:lastPostId`, `lt:lastPostDay`, `lt:bucketCursor:{level}`, `bank:cursor` - state of the daily difficulty ramp.
- `onb:{userId}` (warm-ups completed - also drives pool rotation and closes the first-run ladder), `onbSkip:{userId}` (ladder dismissed), `pract:{userId}:{k}` - isolated warm-up track (no leaderboard / vote / streak). Fields: `startedAt`, `grid`, `idx` - the case that board belongs to.

> ⚠️ **A constant only reaches an install that has never run.** `DEFAULT_LEVEL` is the fallback for a
> *missing* `lt:level`, so when the daily default moved 🟡→🟢 (decision #42) every sub that had
> already published one case kept publishing 🟡 - the key held `"1"`, written by the old build, and
> the vote ramp cannot bring it down on its own (`VOTE_MIN_TOTAL = 5`, and the dev sub has one
> player). Deleting the key by hand would fix one install once and leave the next change of the
> constant to walk into the same wall, so the level is now stored **with the default it descends
> from** (`lt:levelBase`): still sitting on the old default → adopt the new one; voted somewhere else
> → the vote stands, and the re-stamp means the question is never asked twice. Nothing has to be
> remembered when `DEFAULT_LEVEL` next changes, which is the difference from a schema-version ledger:
> a ledger only fires for whoever remembers to add an entry, and that is exactly the step missed here.
>
> Two other keys are numbered against a table that has since moved, and are worth knowing about:
> **`lt:bucketCursor:{level}`** counts positions in `LEVEL_BUCKETS[level]`, whose order changed with
> `spreadByTheme()` and whose contents changed when the bank grew 120 → 160. A cursor carried across
> that change can re-serve a case the sub has already seen (measured: the green bucket would repeat
> at every second pick; the yellow bucket, the only one this install has actually walked, repeats
> nowhere in its first 12). It is deliberately **not** migrated - a reset would restart the rotation
> at position 0, i.e. guarantee the repeats it was meant to avoid. The structural fix is to record
> *which* indices were served (a zset) instead of *how many*, which is a change to daily case
> selection and belongs to its own task. **`bank:cursor`** must never be touched at all: it is the
> monotonic case number in every post title, and re-baselining it would renumber the series.

> ⚠️ **`startedAt` is the timer, `f_open` is the counter - never one from the other.** `opened` used
> to be inferred from the absence of `startedAt` in `/api/daily`, and `startedAt` is also written for
> reasons that have nothing to do with the funnel. A row carrying a `startedAt` stamped by a build
> without the counter therefore reported `opened 0 -> moved 1` - an impossible funnel - permanently,
> with no code path able to repair it. Every entry point (`/api/daily`, `/api/state`, `/api/hint`)
> now goes through one `openAttempt()` that stamps the baseline and counts the open through the same
> `countOnce()` path as every other event, so `opened >= firstMove` holds by construction and a
> legacy row heals the next time that player touches the post.

### The day a solve is filed under

One function, `currentDay()` in [leaderboard.ts](../src/server/leaderboard.ts), answers "what day is
it" for **both** the writers and the readers. Everything keyed by date below - `lb:day`, `lb:week`,
`lb:season`, `lb:solves`, `lb:points`, `lb:applied`, `lb:daymeta` - is keyed by *that* value:

1. inside a post → `postData.date` (the case's own day - a case IS a day);
2. outside a post → `lt:lastPostDay`, else the newest score in `lt:posts`;
3. nothing published yet → the server's UTC date.

`todayUtc()` is otherwise reached only for the `runOnce()` lease window, the streak's `visitDay()`
below, and as `currentDay()`'s own last-resort branch (3 above) - all genuinely calendar questions.
Before this, `index.ts` wrote with `postData.date` while `leaderboard.ts` read with the server clock;
a case published on the 7th and solved after midnight UTC went into `lb:day:2026-08-07` and was read
back out of `lb:day:2026-08-08`, so the board looked empty while the result card (which reads the
per-post `lb:{postId}`) showed the solver.

### The day a VISIT is filed under - a different question, and it must stay different

> ⚠️ **`currentDay()` answers "which day's board does this result belong to?"; the streak asks "did
> the player come back today?".** One function answering both is the streak bug above:
> `streak:{userId}.lastDate` used to be keyed by `currentDay()`, so it held the *case's* publication
> date. It is now keyed by `visitDay()` in [streak.ts](../src/server/streak.ts) - the wall calendar,
> and nothing else. Two questions, two functions, named apart on purpose. The boards keep the case's
> day (a case IS a day, and that is what makes `lb:day` a race); only the streak is a habit.

### Funnel (mod menu → `/internal/menu/funnel`)

**One** menu item, on a post's menu, `postFilter: "currentApp"`. It cannot be one item covering both locations - the Devvit config validator rejects `postFilter: "currentApp"` together with `location: ["subreddit"]`, and without the filter a subreddit-level item would attach to every post in the sub, including ones this app never created. It used to be registered twice, once per location, to work around exactly that; the post half is the one kept, because inside a post `postData.date` is right there, so the report is never ambiguous about which case it means and does not depend on `lt:lastPostId` pointing at anything useful.

- `stats:{postId}` - hash of per-post counters: `opened` (first touch of the attempt row, via `f_open`), `firstMove` (first board with a mark), `reached3` / `reached6` / `reached9` (cells deduced), `hintStep1` / `hintStep2` / `hintUsers` (hint ladder rungs, unique players), `hintAny` (players who used *either* free rung - `hintStep1 + hintStep2` counts anyone who pressed both twice, so it is not a number of people), `nudged`. `solved` is read from `solvedCount:{postId}`.

> ⚠️ **The percentage on this screen is the solve rate, and it says which denominator it used.** The toast used to print `solved / opened` under a bare `%`, while the target everyone tracks (`plans/01-distribution.md` (internal, not in the public repo), "> 55%") is `solved / firstMove` - a different fraction, and far enough apart that the launch calendar had to warn its own reader to divide by hand on every reading (34% on screen vs a real 61%). Both are printed now, the tracked one first and by name, each with its denominator spelled out. `hintAny` starts counting from the deploy, so on older posts it reads 0 while the per-rung counters do not - the readout only shows it when it has data. Nothing about the past can be recovered: Redis cannot enumerate keys, so a counter that did not exist at the moment of the event has no history to reconstruct.

The readout is a sentence, not a counter dump. The old toast ended in `best cells 0:0 1-2:0 3-5:0 6-8:0 9-11:0 12:1` - a stall histogram that cannot be decoded without this file open beside it. The same numbers now read as *"1 opened it, 1 marked something (100%), 1 solved it… 3 started and gave up, most of them at 6-8 of 12 deduced"*, and the histogram is reported as the single bucket that actually loses people. The full table still goes to `devvit logs`.

The last clause is a self-audit: the toast compares `solvedCount:{postId}` against the number of rows on that day's `lb:day:{date}` board and says `Leaderboard: N rows, matches` or `⚠ … N solve(s) never reached the board`. That one line is what would have caught the empty-leaderboard bug on the day it shipped instead of in live play.
- `stuck:{postId}` - sorted set, member = userId, score = the best `effectiveCount` that player ever reached. Answers "do people stall at 0 cells or at 9?" directly. Score `0` means *no cell determined*, which is not the same as "never marked anything": crossing out chips that force nothing leaves a board at 0. It is also the **only index of players on a post**, so it is the one door to their `att:` rows - a player who opened the case and never autosaved is counted in `stats.opened` and is then unreachable forever.

### Reading it back: `/internal/menu/audit`

The second post-menu item. Because Redis cannot be queried from outside the app and cannot list keys, "look at the database" is code that has to be shipped; [audit.ts](../src/server/audit.ts) is it. It walks the four collections that make anything reachable at all (`lt:posts`, `stuck:{postId}`, `lb:alltime`, `lb:index:days`), prints every key behind them to `devvit logs`, and puts the sizes plus any alert in the toast.

The checks it runs are the ones that can only be wrong, never merely surprising:

| Check | What a failure means |
| --- | --- |
| `lb:points:{d}` = `lb:applied:{d}` per member | an aggregate has drifted from the day it was folded in from |
| `lb:alltime[u]` = `sum(lb:days:{u})` = `user:{u}.totalPoints` | the running total no longer equals the history it sums |
| `user:{u}.solved` = `zCard(lb:days:{u})` | the profile counter and the day history disagree |
| `streak:{uid}.best` ≥ longest run in `streak:days:{uid}`, and `.current` = the run those days end in | the streak has parted company with the days it is derived from |
| `zCard(lb:{postId})` = `solvedCount:{postId}` | a recorded solve never reached that case's board |
| `opened ≥ firstMove ≥ solved` | the funnel is not a ladder; a rung was climbed that was never entered |
| `lb:daymeta:{d}.rolledAt` on every finished day | the nightly recount is not running |

For an unrolled day it also recomputes the median and prints what the rollup *would* change per player, so "has it run" is answered with a difference rather than with the presence of a key.

> ⚠️ **The check `lb:streakbest[u]` ≤ longest consecutive run in `lb:days:{u}` has been withdrawn,
> because it would now fire on correct behaviour.** The two are keyed by different days on purpose:
> `lb:days` by each case's publication date, the streak by the calendar day the player came back. A
> run kept alive on a day the sub published nothing means closing an **archive** case, which files its
> points under that case's old date. The run is still printed - it is the one number that shows the
> two date spaces apart - and the real check moved to the per-case section, where a `userId` from
> `stuck:{postId}` reaches `streak:days:{userId}`. `lb:streakbest` is keyed by username and nothing
> maps a username back to a userId, so the board itself cannot be cross-checked at all.
- `lt:posts` - sorted set of every **daily case** post this app created (member = postId, score = created ms), trimmed to the last 60. `registerPost()` runs only inside `createDailyPost()`, so only real cases land here and the funnel's 7-post trend cannot average in anything else. It exists purely because Redis can't list keys: without it there is no way to find yesterday's post to report on.

## Automatic daily publication (`src/server/daily.ts`)

Nothing here exists until a moderator turns the schedule on for their own subreddit; the settings
are `dailyAutoPost` (boolean, **default off**) and `dailyPostHourUtc` (number, default 13), both
per-subreddit in `devvit.json`.

| Key | Type | Written by | What it is |
|---|---|---|---|
| `daily:posted` | hash `YYYY-MM-DD` → postId | the hourly tick | The idempotency lock. Claimed with `hSetNX`, so exactly one delivery of a retried scheduler event can pass it; the field holds `pending` between claiming and publishing, then the post id. |
| `daily:lastAt` | ms | the hourly tick | The 20-hour floor - the second belt, which survives a lock written under a different date when the hour setting moves across UTC midnight. |
| `daily:lastPostId` | postId | the hourly tick | The post the survival check reads back, and the one the status menu reports on. |
| `daily:paused` | `"1"` | the survival check, or a moderator | A full stop. Nothing lifts it automatically - everything that sets it is something a person has to look at. |
| `daily:pausedReason` | text | with `daily:paused` | Why, so a stopped schedule is never a mystery. |
| `daily:nextAt` | ms | the hourly tick | The real next publication time. Read by `/api/preview` so the feed card's countdown names the schedule instead of guessing "24 h after the last post"; **deleted** whenever the schedule is off or paused, and its absence means "fall back to the cadence estimate". |

The survival check is a one-off `runJob` queued 30 minutes after each publication. It reads the post
back and, if it was removed or caught by the spam filter, pauses the schedule and opens a mod
discussion. That loop is the reason this track was allowed to ship at all: the previous version had
no way of learning that its posts were being filtered, and nobody found out until two subreddits
were banned.
