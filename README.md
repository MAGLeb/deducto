![Deducto - daily logic games](https://raw.githubusercontent.com/MAGLeb/deducto/main/assets/banner.png)

# Deducto - daily logic games for Reddit

**One puzzle a day. One provable answer. Three to ten minutes.** Solve today's puzzle, see how your time stands against everybody else's, argue it in the comments, and come back tomorrow to keep your run going.

**▶ Play it:** the newest post in [r/deducto_puzzle](https://www.reddit.com/r/deducto_puzzle/) is always today's puzzle.

Built on the **Reddit Developer Platform** - Devvit Web, `@devvit/web`. Everything happens inside the post; nothing links off Reddit.

## In short

**What it does.** Deducto gives a subreddit one logic puzzle a day: a shared, provable, three-to-ten-minute problem that everybody is looking at on the same day. Around every puzzle sits the same loop - a solve time, the day's leaderboard, a streak, a result card and a comment thread to defend your reasoning in.

The **mechanic varies**. Deducto is a collection of daily logic formats rather than a single game, so the habit stays while the puzzle type changes. One format ships today:

| Format | Status | What it asks |
| --- | --- | --- |
| **Deduction Grid** | **live** | Four suspects, three categories, a handful of clues, exactly one arrangement that fits all of them. Tap candidates to rule them out; the puzzle closes by itself the moment the board is fully deduced and no clue is contradicted. |
| **Kings & Jacks** | in design, **not yet playable** | Truth-tellers and liars: Kings always tell the truth, Jacks always lie. From what each character says, work out which is which. |

Further formats - ordering and constraint puzzles, patterns, sequences - arrive one at a time, each kept only if people come back to it.

**Who it is for.** Communities that like puzzles and arguing about reasoning - the Wordle / Sudoku / logic-grid crowd, and any subreddit that wants one recurring, low-effort daily ritual. Players need no account setup, no tutorial reading, and no prior visit: a first-timer is offered a forced-move warm-up puzzle before the real one.

**Free, and staying that way.** No paywalls, no premium puzzles, no gated formats. An unobtrusive *Support this app* link is planned for people who want to give something back; it is not built yet, and it will never sit between a player and a puzzle.

**Critical operational notes for moderators.**
- **Nothing to configure.** Install it, then publish cases from the subreddit menu (⋯) → **"Deducto: publish a case"**. There are no settings, no API keys, and no setup screen.
- **Automatic publishing ships switched OFF.** A moderator publishes each puzzle from the menu unless they turn the daily schedule on themselves, per subreddit, in *Mod Tools → Community Apps → Installed Apps*. Turning it on brings four guards with it - see *Automatic daily publishing* below. It is off by default because an earlier version of this app was filtered for auto-posting into a subreddit that had no players in it yet.
- **Six moderator-only menu items, listed in full below.** Everything else in the app is open to every player.
- **Nothing leaves Reddit.** No external servers, no third-party services, no LLMs, and no outbound network calls at all - the app requests only the `redis` and `reddit` permissions, never HTTP fetch. All state lives in the app's own Devvit Redis, which is isolated per subreddit.
- **The only personal data ever shown is a Reddit username**, and only on a leaderboard row. Internally the app keys your progress, streak and warm-up counter on the opaque Reddit user id (`t2_…`), which is never displayed and never sent to a client - a raw id reaching a public table is treated as a bug and tested against. A logged-out visitor can play a full case and is told plainly, on the result screen, that nothing was recorded.
- **The day rolls over at UTC midnight**, not local midnight - that is when the Today board resets and the next case becomes due.
- **The publish item has no same-day guard yet.** Press it twice in one day and you get two cases, with the app pointing at the newer one. A lock is on the roadmap; until then, one press per day.
- **The puzzles are pre-generated and machine-verified** - 160 cases shipped in the app bundle, each proven to have exactly one solution. Nothing is generated at runtime, so a case can never be unsolvable.

---

## The daily loop

Every day one post becomes a fresh puzzle. Today that means a **Deduction Grid** case: a 4-suspect × 3-category logic grid (Coat / Time / Item) with a single, provable solution. The loop below is the part that does not change when the format does.

The post opens on a **case card** in the feed - what the case is, how far you got, how many have solved it today, and one button that opens the board full-screen.

On the board you tap a candidate to rule it **out** for a suspect. You never guess - you eliminate. Every clue answers to your marks as you make them: one your board has **settled** is struck off the list, one your board **contradicts** is stamped in red - so you always know which assumption went wrong. None of it is computed from the hidden answer, so the feedback never spoils anything.

Because the solution is unique, "all 12 cells deduced + no clue contradicted" *is* the proof. The case therefore **auto-closes** the moment you get there: no submit button, and no way to lose. A tidy 3-5 minute habit.

## The hook - why detectives come back

- 🗓️ **A new puzzle every day**, published in [r/deducto_puzzle](https://www.reddit.com/r/deducto_puzzle/) - and the run counts puzzles, so a change of format never costs anybody their streak.
- 🔥 **Streaks & ranks** - close published cases in a row, each on the day it ran, to climb 🔎 Detective (1 case) → 🕵️ Inspector (3) → 🎩 Chief Inspector (7) → 🧠 Mastermind (14) → 🏛 Legend of the Yard (30). An archive case is still worth points, but it does not extend a run; a day the subreddit published nothing does not break one, because there was nothing to miss.
- 🏆 **Standings, open to everyone** - a button on the board opens four leaderboards at any time, whether or not you have solved today: **Today** (by time), **Week** and **All-time** (by points), and **Current streak** (by cases). The streak board ranks runs that are still going: miss a case and your run leaves it. Your longest run ever is on your own file, where a record stays earned. The same four appear on your result card after a solve. Points favour a fast solve without hints.
- 🗳️ **Difficulty is voted on** - after solving you vote **Harder / Same / Softer**; a clear majority sets tomorrow's case.
- 💬 **Native discussion** - one shared case a day, so detectives compare and defend deductions in the comments, spoilers tagged.
- 💡 **A hint ladder, not an answer button** - three rungs. *Which clue still works on your board* and *what that clue rules out* are free; only *reveal a cell* costs you a hint, and the price is printed on the button.
- 🤝 **It notices when you stall** - after three minutes of play and a minute and a half without a new deduction, it offers the free rungs itself. Once per case, never again.
- 🌱 **A real first run** - newcomers are offered a warm-up case before today's: over-clued, every move forced, purely to teach the mechanic. It counts towards nothing - not the board, not your streak - and there are 15 of them, so a second warm-up is a new case. The warm-up button stays in the board's footer for as long as today's case is open, so a no-stakes round is always one tap away; closing the case replaces it with **See results**.

## Difficulty - what the board can actually carry

The board stores one kind of fact: *for this suspect, in this category, these values are still possible.* No pairwise sub-tables the way a paper logic grid has - there is no room for them in a post-sized viewport.

That constraint decides the difficulty ladder, and it was measured rather than guessed: running the solver's weak model - exactly what the board can record - across the whole bank shows which tiers give you a forced move at every step, and which ones quietly ask you to hold cross-category relations in your head.

The stamp on the case names the difficulty in a plain word, gives it a denominator, and says what the case will ask of you. An ordinal on its own ("tier II") tells a first-timer that a scale exists and nothing about where they are on it:

| Tier | Stamped on the case | Where it's used | What it means |
|---|---|---|---|
| **Tutorial** | `WARM-UP` - off the numbered ladder on purpose | warm-up lane only | over-clued; every move follows straight from a single clue |
| 🟢 **Green** | `EASY` · *Level 1 of 3* | **the daily default** | every move follows from one clue and the marks you have already made |
| 🟡 **Yellow** | `MEDIUM` · *Level 2 of 3* | only when the community votes *Harder* | some steps need two clues linked through a value they share |
| 🔴 **Red** | `HARD` · *Level 3 of 3* | not in the bank | the clues may not force every cell - a guess can be needed |

The daily case defaults to 🟢 so a first-timer arriving from the feed can finish one. Raising the bar is the community's call: the Harder / Same / Softer vote moves the next day's tier - but only once at least 5 people have voted and the leading choice is ahead by at least 10 percentage points of the total. Otherwise tomorrow stays where today was.

## Add it to your community (moderators)

1. On the [app page](https://developers.reddit.com/apps/deducto-puzzle), click **Add to community** and choose your subreddit.
2. Publish a case: subreddit menu (⋯) → **"Deducto: publish a case"**.
3. That's it - the post is interactive on its own, with nothing to configure.

The mod menu (⋯) is the whole admin surface - six moderator-only items, and nothing to configure:

| Where | Item | What it does |
|---|---|---|
| Subreddit ⋯ | **Deducto: publish a case** | Creates today's post: applies the community vote to the difficulty, picks the next unused case, and titles it `Case #N · YYYY-MM-DD · <case name>` (plus ` · hard mode` once the vote has raised the tier). |
| A Deducto post ⋯ | **Deducto: how is this case doing?** | A plain-sentence readout for the case you opened it from: how many opened it, how many marked something, how many solved it, where the people who gave up stopped, hint use, and a check that the day's leaderboard has as many rows as there were solves. |
| A Deducto post ⋯ | **Deducto: what is actually in the database?** | The raw stored state behind that readout - this case, the day and the whole subreddit. A summary in the toast, the full dump in the app logs - including when players show up, as opens by hour of the UTC day, all time. It exists because a figure that looks wrong on a screen is answered by what is stored, not by another screen. |
| Subreddit ⋯ | **Deducto: daily auto-post status** | Whether automatic publishing is on for this subreddit, what hour it publishes at, and whether the last automatic post is still alive on Reddit. A filtered post is reported first, because it is the one state that means something is wrong rather than merely switched off. |
| Subreddit ⋯ | **Deducto: pause/resume daily auto-post** | Pauses the daily schedule, or lifts a pause. It is **not** the on-switch - that is a per-subreddit setting under *Mod Tools → Community Apps → Installed Apps* - and pressing this while the schedule is off says so instead of inventing a pause over a silence that already exists. |
| A Deducto post ⋯ | **Deducto: close this case now** | Publishes the winner comment for this case now instead of at the 24-hour mark. For a case published before that comment existed, and for a moderator who wants the epilogue early. |

Several items that used to be here are gone on purpose. **"Show leaderboard"** was a moderator-only toast of a board that every player can now open inside the game, so it was a worse copy of a public screen. **The second funnel item** existed only because a subreddit-wide menu item cannot be filtered to this app's own posts; keeping the post-menu one means the report is always about the case a moderator is actually looking at. **"The week's numbers"** and the **seed / remove test players** pair were removed at the owner's request (2026-08-22, dec. 149); the audit still names any leftover `[test]` row it finds.

**Automatic daily publishing exists and ships switched off.** It is a per-subreddit setting (*Publish a case automatically every day*), off by default, because an earlier version of this app was filtered for auto-posting into a subreddit with no players in it. Turning it on brings four guards with it: the day is claimed atomically so a retried scheduler delivery cannot publish twice, a 20-hour floor sits behind that, the publishing hour is a setting rather than a redeploy - and, half an hour after each post, the app reads its own post back. If it was removed or caught by the spam filter, the schedule **stops itself** and the moderators get modmail. Reddit's filters act minutes after submission rather than at submission, so without that last one there is no way to learn anything is wrong until it is too late.

**Each case gets a closing comment.** Twenty-four hours after a case is published the app names the fastest solver in a comment on its own post - which is also how that player is notified, since a username mention is a Reddit notification. The leaderboard stays open afterwards, so a time that beats the record later gets a comment of its own: one per case for the close, and never two record comments within six hours.

The game is fully server-authoritative; see **App permissions** on the app page for exactly what it touches.

## Under the hood

- **Server-authoritative & cheat-resistant.** The solution and the timer live only on the server (Redis); the webview receives the grid **without** the answer. Because every case has a unique solution, "all cells deduced + no clue contradicted" on the client provably equals the correct answer - and the server re-grades it against the stored solution before recording anything. Recorded time is clamped to the wall clock since you opened the case, and a time below the physical floor for crossing out 12 cells earns no speed points - so a forged result cannot take the podium from a real one.
- **Deterministic engine, no AI at runtime.** The difficulty engine is a 1:1 TypeScript port of a Python reference solver, **parity-tested** clue-for-clue. Cases are generated and verified offline into a bank of **160** machine-checked puzzles - 15 tutorial, 45 🟢, 100 🟡 - each confirmed to have exactly one solution.
- **Honest numbers.** A solve-time distribution is only drawn once a case has at least 50 recorded solves (`HIST_MIN`); below that the result screen says which number solver you were today. Leaderboard percentiles need 10 players (`SMALL_N`). A solve recorded by a logged-out visitor is reported as recording nothing, rather than shown an invented streak and rank.
- **Native Devvit Web.** `express` + `createServer`. `/api/*` is what the two webview entrypoints (the feed card and the board) read and write; `/internal/*` is the moderator menu and the scheduled jobs. Six tasks are registered: a nightly
rollup that settles the day's points; a one-off job that writes a player's rank flair; the hourly
daily-post tick and the survival check that reads each published case back; and the two that write a
case's closing comment and its later records. All of them are jobs rather than API calls for the
same reason - flairs, posts and comments are moderator actions, and `/api/*` runs in the player's
own context, so it cannot perform them.

### Server endpoints

Game webview (`splash.html` + `index.html`):

- `GET  /api/preview` - case card for the feed, grouped by **world** (see [docs/11-stats-ia.md](docs/11-stats-ia.md)): `case` is this case (number, title, tier, who has closed it, its best time), `you` is your run across every case, `next` is the countdown and what the vote is doing to the next case's difficulty - and, on an archive post, the case that is **live now**, because there the countdown names a case two behind the one a reader could be playing. Deliberately side-effect free - seeing the post in the feed must not start your timed run or burn your one-time tutorial, and that is pinned by a test.
- `GET  /api/daily` - today's case (no solution) + saved progress + streak, vote tally, yesterday's epilogue, and the first-run flags.
- `POST /api/state` - grid autosave + active play-time. Also carries the funnel counters and returns the stall nudge.
- `POST /api/hint` - the three-rung hint ladder (`step: 1 | 2 | 3`). Rungs 1-2 name the clue and what it rules out; only rung 3 reveals a cell and counts against you. Returns the full log of everything revealed so far.
- `POST /api/vote` - cast the Harder / Same / Softer vote that sets tomorrow's difficulty (must have solved; one vote per player).
- `POST /api/check` - grade the grid; on solve, write time, finishing order, streak and every leaderboard, and return the result payload.
- `GET  /api/practice`, `POST /api/practice/state|check|skip` - the warm-up lane: its own case, its own saved grid, no leaderboard, no streak. Offered on a first run, and open from the board's footer while today's case is still unsolved.

Standings (the in-game standings screen and the result card):

- `GET  /api/me` - your file: cases closed, days solved, both streaks, best time, points, place, rank and the last fortnight. Every figure comes from a key that already existed and was read by no screen. Read-only.
- `GET  /api/leaderboard?scope=today|week|season|alltime|streak` - one board, ranked and paged, with your own row and percentile. A **public** route: any player can read a board, solved or not. `season` is served but no screen offers it.

Moderator menu and scheduled jobs (`/internal/*`):

- `POST /internal/menu/create-post` - publish today's case.
- `POST /internal/menu/funnel` - the drop-off readout for a case, plus the last 7 cases together.
- `POST /internal/cron/daily-post` - daily posting. Present but **not** registered in `devvit.json`.
- `POST /internal/cron/rollup` - nightly re-scoring of a finished day against its own median. Idempotent, and also **not** registered yet.

That is the complete list; there is no other route. `POST /internal/menu/leaderboard` was removed when the standings became a public screen, and `npm run test:routes` pins its absence with a 404 assertion.

### For developers - run, verify, extend

Devvit requires **Node ≥ 22** (`nvm install 22 && nvm use 22`).

```bash
npm install
npm run login            # devvit login
# put a test subreddit in devvit.json → "dev": { "subreddit": "..." }
npm run dev              # build client + server (watch) + devvit playtest
```
In the playtest subreddit: menu (⋯) → **"Deducto: publish a case"** → the game post opens.

**Verified before every deploy** - all of it offline, no subreddit and no network needed. Of the six, only `build:bank` is part of `npm run build`; `npm run deploy` runs the rest for nobody. Note also that `deploy` ends in `install:all`, which installs into the two subreddits hardcoded in `package.json` (`deducto_puzzle_dev`, `deducto_puzzle`) - edit that script before running it anywhere else:
- ✅ `npm test` - engine parity vs the Python reference (clue anchors 🟡/🟢/🔴, all three live generators, and the hint ladder all match 1:1).
- ✅ `npm run test:routes` - the **real** Express routes, driven end to end against an in-memory Redis. See below.
- ✅ `npm run build:bank` - 160/160 cases, each unique and the right tier.
- ✅ `npm run check:solvability` - every tutorial and 🟢 case is solvable from board state alone (12/12 cells).
- ✅ `npx tsx scripts/smoke-status.ts` - on the solution every clue is satisfied and client & server agree, over the whole bank.
- ✅ `npm run type-check` - clean.

**Why `test:routes` is its own gate.** Version 0.0.7 shipped two bugs through a completely green offline suite: a recorded solve reached none of the leaderboards, and the funnel could report more players "moved" than "opened". Neither is a broken function - both live in the interaction between endpoints, stored state and two different definitions of "today", which is precisely what unit tests do not span. So `src/server/routes.test.ts` aliases `@devvit/web/server` to a working in-memory Redis stub (`src/server/testing/`), imports the real server, and calls the real routes: a solve must land on all eight boards, a half-written solve must heal on the next check, `opened` must never fall below `moved` in any call order, and a retired endpoint must stay retired.

**Structure:**
- `src/shared` - `types.ts` (clue shapes), `status.ts` (live clue status + the deduced answer), `themes.ts` (6 case packs, streak ranks), `render.ts` (clue → English).
- `src/server` - `engine.ts` (solver, generator, tier classifier, hint advice), `index.ts` (the daily case, hints, vote, grading, funnel, mod menu), `leaderboard.ts` (scoring, boards, nightly rollup), `bank.json`, plus `engine.test.ts`, `routes.test.ts` and the `testing/` harness.
- `src/client` - two entrypoints: `splash.html`/`splash.ts` (the feed card) and `index.html`/`main.ts` (the board, the standings screen and the result sheet). Three shared modules: `ledger.ts` renders every leaderboard on both surfaces that show one, `tiers.ts` holds the tier badge every screen shares, and `forced.ts` works out on the client which eliminations the board already forces. Styling is `tokens.css` + `base.css`, one stylesheet per entry, and `ledger.css` wherever a board appears.

**New themes / bank:** add a pack to `src/shared/themes.ts` (4 names, 4 items, legend), then `npm run build:bank` (deterministic).

A live post stores its bank **index** in `postData`, so changing what sits at an index swaps the puzzle under an open post and discards every player's board. `scripts/build-bank.ts` therefore pins indices `0..119` and only ever **appends** - keep it that way.

## What's next

The roadmap, in the order it's being worked on:

- **♚ Kings & Jacks** - the second format. Kings always tell the truth, Jacks always lie; from what each character says, work out which is which. Same paper, same stamps, same streak - a run counts puzzles, so changing format never costs anybody their streak.
- **🔀 One seam for every format after it** - a published post declares which game it is, the server resolves that once, and nothing above it - the streak, the boards, the points, the result card - ever learns the answer. Cheap now, expensive at the third format.
- **📊 Measurement per format** - daily players, completion rate, solve time, D1/D7 retention and streak distribution, split by game type. A collection whose formats are measured together cannot tell you which one is working.
- **📈 Difficulty decided by the funnel** - the drop-off counters now exist; the next step is to let a puzzle's measured stall point, not intuition, choose what gets published.
- **🔴 Hardcore difficulty** - the 🔴 grid tier, currently excluded from the bank, for detectives who crack 🟢 in under two minutes.
- **💛 Support this app** - an unobtrusive donation link for people who want to give something back. Never a paywall, never a premium puzzle.
- **✍️ Player-created puzzles** - let members design and submit their own; the engine auto-verifies a single provable solution before one can go live.

## License

See [LICENSE](LICENSE).
