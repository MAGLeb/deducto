# 11 — Statistics: information architecture

> 🌐 **This is the shared meta layer, specified.** Every number here belongs to the product rather
> than to any one puzzle type: the day, the run, the time, the standing, the rank. A second format
> inherits this document unchanged — that is what makes it the meta layer — with the caveat in
> [12-game-types.md](12-game-types.md) §4 about the grid's vocabulary still showing through.

**What this file is.** Every number Deducto shows a human being, on every surface, in every state
the player can be in: *which* number it is, *where* it comes from, *how* it is labelled, *at what
threshold* it appears, and **what question the reader is asking when they look at it**.

It exists because the owner said the thing the decision journal had been circling for four tracks:

> «в целом не проработано у тебя что показывать какие статистика когда где и как правильно»
> — «надо правильно понять, как связать текущий кейс, любой кейс — со всей статистикой игрока
> в целом. что показывать на кейсе, именно по нему, а что именно за всё время участника игры
> в сообществе»

Every figure in this game was decided one at a time, in answer to one complaint at a time. Each
decision was defensible on its own; together they produced a card on which five cells drawn in one
typeface, one weight and one rhythm belonged to three unrelated subjects, and nothing on screen
said so. This document is the whole answer, so that the next figure is placed by a rule instead of
by an argument.

**Order of authority.** The rules in §1 are new and govern. Everything they do not touch is
governed by the standing rules of the project (dec. 37 honest numbers, dec. 63 emoji out of the
chrome, one red per screen, [docs/10-design-spec.md](10-design-spec.md) §1) and by the shape of the
data ([docs/05-data-model.md](05-data-model.md)). Where this file revokes a previous decision it
says so by number and gives the reason.

---

## 1. The rules

### R1 — one word, one number

A label names exactly one figure, everywhere in the product. If two figures answer different
questions they get two words, even when they coincide most days.

The failure this is written against: `DETECTIVES` carried the all-time community below ten solvers
and `SOLVED TODAY` carried the day above it — **one cell, two populations, switched by a threshold
the reader cannot see.** A reader who watched the label change had no way to know the subject had
changed with it.

### R2 — a cell answers a question the reader has *here*

Not "what data do we have" but "what does this person want to know, standing on this screen, in
this state". A cell with no answer in the last column of the tables below **is not drawn**.

### R3 — every number belongs to a world, and the arrangement says which

This is the rule the other two needed and did not have. There are three worlds:

| | World | What it is | Its natural home |
|---|---|---|---|
| ① | **THIS CASE** | your time, the case's best time, who has closed it, where you stand among them, the tier, the clues | the post |
| ② | **THE SERIES** | the countdown to the next case, the vote on tomorrow's difficulty, the day's board | the feed, the day |
| ③ | **YOU HERE** | current and longest streak, cases closed, rank and the next rung, points, place, best time ever, your history | *had none — §5* |

**The arrangement carries the world, not the labels.** Naming the world in every caps key is noise;
naming it nowhere is what produced the complaint. So:

- **cells of one world stand together**, in drawing order, and are never interleaved;
- **the boundary between two worlds is drawn one weight heavier** than the boundary inside one:
  `--rule` divides two cells of the same world, `--rule-strong` divides two worlds. Same ink, no
  colour, no extra glyph, no extra word — and it is the vocabulary the docket's own frame already
  uses;
- **where a strip is truncated, it truncates on a world boundary or inside the last world**, never
  in a way that leaves one orphan cell of a world that has been cut in half.

The acceptance test is a sentence, and it is checkable on a screenshot: *a reader looking at the
screen can say, of every figure, whether it is about the case or about themselves.*

### R4 — the 320px feed slot decides which world fits, and that is a decision, not a leftover

The inline feed slot draws **three cells** (`splash.css`, `.dcell:nth-child(n+4) { display: none }`).
Which three is therefore a choice about *which world the phone reader gets*, and it is made
explicitly per state in §4.1 — not left to whatever the desktop order happens to truncate to.

### R5 — a headcount inherits the scope of the container it sits in; a bare cell carries its own

`5 detectives` under a board titled **Fastest today** is unambiguous — the board says the scope. The
same words in a docket cell with nothing around them are not. This is why the standings' footer may
keep the bare word `detectives` on four boards that count four different populations, and why the
splash may not.

### R6 — an honesty threshold protects a reader who did not ask; it does not apply to one who did

Dec. 37's gates (a percentile and a distribution from N ≥ 50) exist because a stranger meets those
figures without asking for them. The mod-menu funnel is the opposite case: a moderator pressed a
menu item whose entire purpose is the raw number. **The funnel prints raw counts at any N**, and it
names the denominator of every percentage instead of gating it.

---

## 2. The register of numbers

Every figure that exists. `Retro` = would be correct for history predating the counter.
Keys are defined in [src/server/leaderboard.ts](../src/server/leaderboard.ts):200-212 and
[src/server/index.ts](../src/server/index.ts):232-243.

| # | Number | World | Source | Retro | Never shown when |
|---|---|---|---|---|---|
| 1 | your time on this case | ① | `att:{postId}:{userId}.timeSec` | — | you have not solved |
| 2 | fastest time on this case | ① | min score of `lb:{postId}` | yes | nobody has closed it |
| 3 | detectives who closed this case | ① | `zCard(lb:{postId})` | yes | 0 → words, never a zero |
| 4 | your position on this case | ① | `zRank(lb:{postId}, name) + 1` | yes | you have no row (no resolvable name) |
| 5 | cells you have deduced | ① | `effectiveCount()` over the saved grid | — | `0/12` is never printed (dec. 95) |
| 6 | cells revealed to you | ① | `att:.hints` | — | 0 |
| 7 | this case's tier | ① | bank entry | — | tier unknown → no mark at all |
| 8 | your finishing order on this case | ① | `solvedCount:{postId}` → `att:.solveOrder` | no | used only when #4 has no row |
| 9 | funnel: opened / moved / solved / rungs / stall buckets | ① | `stats:{postId}`, `stuck:{postId}`, `solvedCount:` | no | mod menu only |
| 10 | countdown to the next case | ② | newest score in `lt:posts` + 24 h | — | ≤ 0 → the word `soon` |
| 11 | the next case's number | ② | `bank:cursor + 1` | — | — |
| 12 | the tier the next case would get | ② | `LEVEL_TIERS[levelFromVote(resolveLevel(), tally)]` | — | this post is not `lt:lastPostId` |
| 13 | the vote | ② | `vote:{postId}` (`Harder`/`Same`/`Softer`) | no | a **verdict** below `VOTE_MIN_TOTAL = 5` or lead < 10 % |
| 14 | your vote | ② | `att:.vote` | — | you have not voted |
| 15 | detectives who closed a case today | ② | `zCard(lb:day:{day})` | yes | — |
| 16 | your rank today | ② | `zRank(lb:day:{day}) + 1` | yes | no row → reported as 0 |
| 17 | your percentile today | ② | `(total − 1 − rank0) / total` | yes | printed only at N ≥ 50 |
| 18 | the shape of today's times | ② | `lb:day:{day}` binned | yes | N < 50 (`HIST_MIN`) |
| 19 | today's three fastest | ② | `lb:day:{day}` zRange 0..2 | yes | — |
| 20 | week / season points | ② | `lb:week:{iso}`, `lb:season:{YYYY-MM}` | yes | — |
| 21 | your current streak, **in cases** | ③ | `streak:cases:{userId}` walked against `lt:posts`, liveness-filtered | partly (seeded from `lb:solves`) | 0 — which is a *fact*, so the cell swaps rather than blanks |
| 22 | your longest streak, **in cases** | ③ | `streak:{userId}.best`, floored by the old day-unit record | yes | 0 |
| 36 | your record predates the unit change | ③ | `best > 0` and no chain recorded | — | it is the reason for a sentence, never a figure |
| 37 | this case's hook | ① | `theme.legend`, first sentence | — | the solved card, which has no use for it |
| 38 | the previous case's winner | ① of the **previous** case | `postData.epilogue`, re-read live from `lb:{prevPostId}` | yes | **on the feed card, always** — a live re-read of another case's board loses the old holder the moment somebody beats them, and nothing anywhere then says they ever held it, so the record is a comment on the post (`src/server/herald.ts`) and the card keeps only live figures about the case it IS |
| 23 | cases you have closed | ③ | `streak:{userId}.cases` | no (seeded once from `user:.solved`) | 0 = "not recorded yet" |
| 24 | your rank and the next rung | ③ | `rankState(best, current)` | yes | `label: null` → `Not ranked yet`, never rung 1 |
| 25 | your points | ③ | `zScore(lb:alltime, name)` | yes | — |
| 26 | your place all-time | ③ | `zCard − zRank(lb:alltime)` | yes | no row |
| 27 | detectives all-time | ③ | `zCard(lb:alltime)` | yes | 0 |
| 28 | your best time ever | ③ | `user:{name}.bestTimeSec` | since the leaderboard shipped | 0 |
| 29 | days you have solved on | ③ | `zCard(lb:days:{name})` | yes | 0 |
| 30 | the day you first appeared | ③ | `user:{name}.firstSeen` | since the leaderboard shipped | absent |
| 31 | your day-by-day history | ③ | `lb:days:{name}` (member = date, score = points) | yes | empty |
| 32 | who holds the best time on this case | ① | member of `zRange(lb:{postId}, 0, 0)` | yes | nobody has closed it |
| 33 | the case's own board | ① | `lb:{postId}`, ranked by time | yes | — |
| 34 | the last seven cases' points | ② | computed at read from `lt:posts` + `lb:solves:{date}` | yes | — |
| 35 | was a solve closed on the case's own day | ①×② | the 5th field of the `lb:solves` record | no (missing = fresh) | it is an input, never printed alone |

Two numbers that are *not* in the register because they are not shown to anyone:
`meta.solversTotal` on `/api/daily` (declared by the client, rendered nowhere — **deleted**, §6) and
`today.solversAllTime`'s old role as a stand-in for the day (**deleted**, §6).

---

## 3. Thresholds, in one place

Scattered across four files, three of them numerically similar and none of them explained beside
each other. They are all here so that the next screen does not invent a fourth.

| Constant | Value | Where | Governs | Why that number |
|---|---|---|---|---|
| `HIST_MIN` | 50 | `src/server/index.ts` | the distribution of times, and the percentile computed from it | a distribution is a claim about a shape; five points have no shape (dec. 37) |
| `PCT_MIN` | 50 | `src/client/ledger.ts` | printing `ahead of N%` on the pinned row | the same claim, so the same gate — dec. 100 moved it off 10 for exactly this reason |
| `SMALL_N` | 10 | `src/server/leaderboard.ts` | **nulling** `betterPct` server-side | a *field* gate, not a display gate: a non-null `betterPct` at N = 10…49 is still not printed |
| `VOTE_MIN_TOTAL` | 5 | `src/server/index.ts` | the vote's **verdict** — never its tally | below it the vote moves nothing, so a verdict would be a claim about an outcome that cannot happen |
| `VOTE_MIN_LEAD` | 0.10 | `src/server/index.ts` | the same | a plurality of one on five votes is noise |
| `FRESH_BONUS` | 250 | `src/server/leaderboard.ts` | added to a case closed on its own day, **outside** the [300, 1000] clamp | inside the clamp the cap swallows it for exactly the fast players it is meant to reward, so the rule would only bite slow solves. Daily 550-1250, archive 300-1000 |
| `ROLLING_CASES` | 7 | `src/server/leaderboard.ts` | the week board's window, in CASES | a calendar week empties on Mondays and varies in how much play it contains; a rolling window is always full and always comparable |
| `MIN_PLAUSIBLE_SEC` | 25 | `src/server/leaderboard.ts` | flags a row, never drops it | a fast replay from memory is legitimate and must keep its place |
| ~~`ROOM_MIN`~~ | ~~10~~ | ~~`src/client/splash.ts`~~ | **deleted** — §6 | it switched the *subject* of a cell rather than its precision, which is the R1 failure itself |

A rank needs no gate. `2nd of 3` is exactly true at N = 3; `faster than 67%` is not the same claim
and needs the sample a percentage requires. This is why §4.3's hero prints a **position** below
N = 50 rather than saying nothing.

---

## 4. The surfaces

Each table is one surface in one player state. Columns: **cell · world · number (by register #) ·
label · when it is drawn · the question it answers.** A row with no question is a bug in this
document.

### 4.1 The feed card (`splash.html`, `GET /api/preview`) — the case's cover page

The whole surface is world ①, plus exactly one cell of ③ and, once you have solved, one **sentence**
of ②. The docket is now **two or three cells** — never four, never five.

`‖` marks the world boundary drawn in `--rule-strong`. Cells left of it are ①, right of it ③.

#### State: has not started

| Cell | World | # | Label | Drawn when | Reader's question |
|---|---|---|---|---|---|
| clues | ① | — | `CLUES` + how many the case hands you | always | *how big is this file?* |
| closers | ① | 3 | `CLOSED IT` + count, or the sentence *"Nobody yet - be the first"* | always | *is this case live — has anyone actually done it?* |
| ‖ your climb | ③ | 21 / 24 | `CURRENT STREAK` + `n cases`, then the rank it has earned and how many more cases reach the next one | only while a run is alive | *what have I got riding on this, and what do I get next?* |

The twelve squares are gone (dec. 125): zero of twelve is the same picture for every reader who has
not started, so it could not differ and therefore carried nothing. `CASES CLOSED` is gone with them
(dec. 139) — beside `CLOSED IT` it read as one fact printed twice, and the cell now carries the only
figure on this card a reader can change tonight.

On a phone these are **not** three columns (dec. 141). The two ① cells share a row; the ③ cell takes
the full width beneath them and centres its lines, so the world boundary is a horizontal rule across
the whole block instead of a hairline between two cramped bands.

Phone (3 cells): all three. A stranger has no record cell and gets **two cells, one world**.

#### State: playing

Identical, except the board cell is keyed to you and carries the fraction:

| Cell | World | # | Label | Drawn when | Reader's question |
|---|---|---|---|---|---|
| board | ① | 5 | `YOUR BOARD` + squares + `5/12` | always | *how far did I get before I put it down?* |
| closers | ① | 3 | `CLOSED IT` | always | *am I behind — did people finish this?* |
| ‖ your record | ③ | 21 / 23 | as above | above zero | *what have I got riding on this?* |

#### State: solved

| Cell | World | # | Label | Drawn when | Reader's question |
|---|---|---|---|---|---|
| your time | ① | 1 | `YOUR TIME` | always | *what did I get?* |
| fastest | ① | 2, 3, **32** | `FASTEST` + the time, then WHO: a filled `You` tag when it is yours, otherwise `u/name` on its own line, clipped with an ellipsis | somebody has closed it (always true here) | *was that good — and who do I have to beat?* |
| ‖ your record | ③ | 21 | `CURRENT STREAK` | always (you just closed a case, so the run is alive) | *is my run safe?* |

Phone (3 cells): all three. **The countdown and the vote are no longer docket cells** — they are the
sentence below, so world ② never sits inside a world ① strip. See §6.

#### The brief paragraph — the sentence the docket cannot carry

`.rules` (every width above 300px of viewport height) and `.tierline` (from 560px):

| State | `.rules` | `.tierline` | World | Question |
|---|---|---|---|---|
| not started / playing | the case's **hook** (#37) — the first sentence of `theme.legend` | the rule of the game | ① | *what is this one about?* |
| solved, and this post is the live one | the next case: countdown (#10) and what the vote is doing to its level (#12, #13) | the raw tally and your own vote (#13, #14) | ② | *when is the next one, and how hard?* |
| solved, and this post is an **archive** case | **the case that is live now** — its number, its level, and the row itself navigates to it | **when this case's own day ended** — `CLOSE_AFTER_MS` from publication, or, inside that window, when it will | ② / ① | *this one is over — so where do I play?* |

The hook replaced the rule of the game before you solve (dec. 125). The rule was identical on all
160 cases and duplicated the sentence under the board, where it is actually applied; the hook is the
only line on the card that changes from case to case, which is the whole of what six themes were for.
Only its **first** sentence: on five of the six themes the second describes the board's shape, and the board is already on the card. (`The Cursed Pizza` is the exception — its first sentence carries
the shape too, so it wraps to two lines; measured 35-98 characters across the six, against the rule's 78.) With no previous case the solved line carries the next case alone — nothing
is invented to fill the gap, and nothing is moved in to cover it.

Copy, gated exactly on #13's thresholds — the tally is always a fact, the **verdict** is not:

| Vote state | `.rules` reads |
|---|---|
| no votes | `Next case in 3h 07m. Nobody has voted on how hard it should be yet.` |
| below `VOTE_MIN_TOTAL` | `Next case in 3h 07m. 2 of 5 votes in on how hard the next one should be.` |
| enough votes, no clear lead | `Next case in 3h 07m. 7 votes in and no clear winner, so the level stays at Easy.` |
| decided, and the level can move | `Next case in 3h 07m. The vote is sending it up to Medium.` |
| decided, but the level cannot move | `Next case in 3h 07m. The vote says harder, but there is no harder case to serve yet.` (and at the bottom: *"…and Easy is already the easiest level."*) — the ladder the **vote** walks is `LEVEL_TIERS`, sized from the bank, and it is **not** the three-point difficulty scale the tier stamp prints beside it: with no 🔴 in the bank it tops out at Medium, so calling Medium "the end of the ladder" would contradict the `LEVEL 2 OF 3` stamp on the same card |
| countdown expired | the same sentences with `Next case opens soon.` |
| this post is not the live one | **neither the countdown nor the vote.** The vote row stays gone — an archive case's vote steers nothing and saying otherwise is the invented claim dec. 37 forbids — but the countdown went with it, because it was not merely thin: it names #cursor+1 while #cursor is already published, so it told a reader who had just finished to wait seven hours for a case that was out. In its place: `TODAY'S CASE  #7 · Medium · live now →` (`.rules`, so the phone gets the row that can be acted on) and `CASE CLOSED  4 days ago` (`.tierline`). Neither restates the record or the headcount — the docket beside them already prints `FASTEST` and `YOUR PLACE n of m` |

`.tierline`, solved: `Harder 5 · Same 1 · Softer 1. You voted Harder.` — **counts, never percentages**:
a percentage is a claim about a distribution and this one is five votes wide.

#### The CTA (unchanged, dec. 99)

`Open the case file` + `about 3 min` / `Continue` / `See results`. The sub-label is spent only on the
estimate, never on repeating a docket figure.

### 4.2 The board HUD (`index.html` `.hud`) — while you are solving

| Cell | World | # | Label | Drawn when | Reader's question |
|---|---|---|---|---|---|
| progress | ① | 5 | 12 squares + `05/12` | always | *how far am I?* |
| time | ① | — | `TIME` + `mm:ss` (client clock, active play only) | always | *how long have I been at this?* |
| ‖ streak | ③ | 21 | `STREAK` + `streakCurrent` | above zero | *what do I lose if I put this down?* |

**Reordered** so the two ① meters are adjacent and the ③ meter stands after the boundary; the
boundary is `--rule-strong` (R3). Previously the order was progress · streak · time, which put a
world ③ figure *between* two world ① figures — the same interleaving as the docket, in miniature.

**The bare word `STREAK` is reserved, product-wide, for the run in progress.** No surface may print
`STREAK` over `best`; a surface showing `best` must qualify it (`LONGEST STREAK`, the board title
`Longest streak`). This is R1 satisfied by reservation rather than by a fourth word, and the reason
is width: the HUD strip shares a 30px casebar with the case number, the title and the tier stamp.

### 4.3 The result sheet (`GET /api/check` → `buildResults`) — state: solved, by definition

Read top to bottom, the sheet is now **① → ③ → ②**, each block homogeneous.

| Cell | World | # | Label / copy | Drawn when | Reader's question |
|---|---|---|---|---|---|
| kicker | ①×③ | 23 | `CASE #47 · YOUR 9TH` (falls back to `· SOLVED` when #23 is 0) | always | *which case was that, and where does it sit in my own run of them?* |
| hero time | ① | 1 | `04:57` at 34px mono | always | *what did I get?* |
| personal-best tag | ①×③ | 28 | a filled `Your best` tag beside the time | this fresh solve is ≤ your best ever | *is this the best I have ever done?* |
| hero sub | ① | 4, 3, 6 | `2nd fastest of 7 on this case` (+ ` · 1 cell revealed` when #6 > 0), or `Faster than 68% of 142 on this case` at N ≥ 50 | you have a row; otherwise the #8 fallback below | *was that good, against the people who did this same puzzle?* |
| hero sub, fallback | ① | 8 | `You're the 3rd detective to close this case` | you have no row on the case board | same question, answered by the only fact left |
| ‖ facts strip | ③ | 21, 22 | `CURRENT STREAK` · `LONGEST STREAK` | always | *what is my run, and what is my record?* |
| rank ladder | ③ | 24 | five rungs, the held one framed; head = `RANK Inspector` · `4 days to 🎩 Chief Inspector` / `Not ranked yet` / `Top rank reached` | always | *what am I, and what is next?* |
| your file | ③ | — | a `Your file` button | always | *where is everything else about me?* (§5) |
| ‖ solve times today | ② | 18 | eight bins, your bin filled, `YOU` under the axis | `hasHistogram` (N ≥ 50) **and** ≥ 860px wide | *where do I sit in today's field?* |
| standings | ② | 15-20 | four boards behind one rail; whole rows only (`trimToFit`, dec. 114); your row pinned when off-screen; `ahead of N%` at `PCT_MIN`. The day tab and title read `TODAY` on the live case and the **date** on an archive one (dec. 116) | always | *who is ahead of me?* |
| tomorrow | ② | 10-14 | `Tomorrow's case` + `#48 opens in 3h 07m`; then the vote — three buttons, then the bar with its shares drawn **inside** the segments. On an **archive** case the countdown stands alone: that post's vote steers nothing, so there is no control and no bar (dec. 113/115) | always | *when, and how hard?* |
| vote gate line | ② | 13 | `5 votes decide the level - 2 so far.` / `The vote is sending it up to Medium.` | after you vote, live case only | *did my vote do anything?* |
| full solution | ① | — | the second face of the sheet | on request | *what was the answer?* |

The hero's comparison is **case-scoped**, and that is the change. It used to switch between a
percentile over the **day** and a finishing order over the **case** depending on `hasHistogram` —
one line, two subjects, chosen by a threshold the reader cannot see: R1's failure, one press away
from the same failure on the splash. Both branches now measure the same thing (your position among
the people who closed *this* case), and the threshold now chooses only how precisely to state it.
The **day** keeps its own titled block underneath, where R5 makes `today` unambiguous.

### 4.4 Your file (`GET /api/me`) — new, §5

All of it is world ③. The one number in it that is not about you is the denominator of your place,
and it is printed as a denominator.

| Cell | World | # | Label | Drawn when | Reader's question |
|---|---|---|---|---|---|
| name | ③ | — | `u/ma9leb` | always | *whose file is this?* |
| cases | ③ | 23 | `CASES CLOSED` | above zero | *how much have I done here?* |
| days | ③ | 29 | `DAYS SOLVED` | above zero | *how often do I turn up?* |
| since | ③ | 30 | `SINCE` + a date | recorded | *how long have I been here?* |
| current streak | ③ | 21 | `CURRENT STREAK` | always (0 is meaningful here — this is the surface that owns it) | *am I on a run?* |
| longest streak | ③ | 22 | `LONGEST STREAK` | above zero | *what is my record?* |
| best time | ③ | 28 | `BEST TIME` | above zero | *how fast have I ever been?* |
| points | ③ | 25 | `POINTS` | above zero | *what have I scored?* |
| place | ③ | 26, 27 | `PLACE` + `3` + `of 8` | you have a row | *where am I among everyone?* |
| ladder | ③ | 24 | the same five rungs as the sheet, from the same `rankState()` | always | *what rank do I hold?* |
| history | ③ | 31 | the last 14 days: date · points | there is any | *have I been keeping it up?* |
| empty state | — | — | *"Nothing recorded yet - close a case and this file starts."* | nothing recorded | *is this broken, or am I new?* |

### 4.5 The standings screen (`GET /api/leaderboard`)

Unchanged; audited and correct. It is world ② for `TODAY`/`WEEK` and world ③ for `ALL-TIME`/`STREAK`,
and R5 covers it: each board is titled, so its footer may say `detectives` without qualification.

| Cell | World | # | Label | Drawn when | Reader's question |
|---|---|---|---|---|---|
| title | — | — | `Fastest on case #47` / `Last 7 cases - points` / `All-time points` / `Longest streak` | always | *what am I looking at?* |
| meta | — | — | the arithmetic, in sentence-case sans | always | *how is this figure arrived at?* |
| row | ②/③ | 15-20, 22, 25 | rank · `u/name` · hint tag · value | always | *who is ahead of me?* |
| your row | ③ | — | `You` tag, inset ink bar, bold | you have a row | *which one is me?* |
| pinned you | ③ | 16, 17 | your row again, + `ahead of N%` | your row is off-screen; the percentile at `PCT_MIN` | *where am I, without scrolling?* |
| note | — | 15 | `Top 12 of 340 · scores settle overnight` / `8 detectives` | always | *how much of this am I seeing, and is it final?* |
| empty | — | — | one honest sentence per scope | the board is empty | *is it broken or am I first?* |

### 4.6 The mod-menu funnel (`POST /internal/menu/funnel`)

World ① (this case) with one world ② sentence. Audited and rebuilt by agent R; **unchanged here**,
and R6 is the rule that says it may stay raw: every figure is named with its denominator instead of
being gated, because the reader pressed a button that asks for exactly these numbers.

| Cell | World | # | Question |
|---|---|---|---|
| `N opened it, M marked something (X% of openers), K solved it` | ① | 9 | *where do people fall off?* |
| `Solve rate K/M … ; X% of everyone who opened` | ① | 9 | *is the board solvable?* (the tracked fraction, named, first) |
| `N opened and never touched the board` | ① | 9 | *is the first screen convincing?* |
| stall buckets | ① | 9 | *where exactly do boards stop?* |
| help rungs, reported separately + `hintAny` | ① | 9 | *how many people needed help — without counting anyone twice?* |
| `This case: N board rows for K solves` | ① | 3, 9 | *did every solve reach the board?* |
| `Day board {day}: N distinct solvers` | ② | 15 | *how big was the day, across however many cases went out?* |
| last-7 trend | ① | 9 | *is it getting better?* |

### 4.7 The board epilogue (`postData.epilogue`)

| Cell | World | # | Label | Drawn when | Reader's question |
|---|---|---|---|---|---|
| epilogue | ① of the **previous** case | 2, 3 | `Yesterday u/quillfox in 02:41 · 7 solved it` | the previous case had a solver | *what did the last one look like?* |

The headcount is now read live from `lb:{prevPostId}` when the post carries the id, instead of the
figure frozen into `postData` at publication. A frozen count under a present-tense sentence is a
small lie that grows all day: every solve after publication used to be invisible to it.

---

## 5. World ③ gets a home — and why that is the root of the complaint

The owner's diagnosis, restated as a fact about the product: **the case is a post, the day is the
feed, and "you here" lives nowhere.** It was smeared across other people's screens — a streak in the
corner of a case card, points in someone else's table, a rank in a subreddit flair — which is
precisely why it kept colonising the case's cover page. A figure with no home takes the nearest one.

Two options were on the table and the answer is not close:

**(a) Spread world ③ further and rely on R3 alone.** R3 can *mark* the boundary but cannot fix the
budget: the feed slot draws three cells, so on a phone every world ③ figure competes directly with
the case's own. It also leaves `user:{username}` — `solved`, `totalPoints`, `bestTimeSec`,
`firstSeen`, written on every solve since the leaderboard shipped
([leaderboard.ts:391-403](../src/server/leaderboard.ts#L391-L403)) — read by nothing, forever.

**(b) Build the surface.** It was already planned — `plans/04-leaderboard.md` (internal, not in the public repo)
§D.4, *"профиль игрока — по тапу на имя в таблице… Дёшево (данные уже есть)"* — and never built. Every
number in §4.4 comes from a key that already exists and is already written. It costs one read-only
endpoint and one view.

**(b).** With world ③ housed, the case card can be about the case, which is the whole of the owner's
complaint about `DETECTIVES 8`.

**Entry points.** Your own row in either standings list, and the pinned row under it — plan 04's own
idea, and the one place a player is already looking at their own name. Plus a `Your file` button in
the result sheet's world ③ block. **Not** on the splash: the docket has three cells and a fourth
button on a card that fought for two would cost more than it returns.

**Other people's files: no.** Not for privacy theatre — the boards already publish name, time,
points and streak — but because it is a product decision with a different shape (what is public
about a person who never opted into a profile), and because it doubles the endpoint's surface for a
question nobody has asked yet. The extension is one parameter (`?name=`) when someone does.

---

## 6. What was deleted, and why

| Deleted | Where it was | Why |
|---|---|---|
| `SOLVED TODAY` — the day's headcount | splash docket | World ② on a world ① cover page, and the second half of the R1 collision. The day is the standings' unit and is answered there with names attached, one tap away. The card is a case's cover page; the case's own headcount replaces it. |
| `DETECTIVES` — the all-time headcount | splash docket | The cell the owner read as belonging to this case. It is the one figure on that card that belongs neither to the case nor to the reader; it now lives in world ③'s own surface (§4.4 `PLACE 3 of 8`) and on the all-time board's footer, where R5 makes it unambiguous. |
| `ROOM_MIN = 10` | `splash.ts` | It switched a cell's **subject** on a threshold — the R1 failure itself, not a precision gate. Deleting the swap deletes the constant. |
| `NEXT CASE` as a docket cell | splash docket, solved | A lone world ② figure inside a world ① strip. It keeps its place on the phone — as the first clause of the sentence that also answers "harder or easier", which is the other half of the same question. |
| `FASTEST` on the not-started / playing card | splash docket | Dec. 97's own reason, applied consistently: *adjacency* is what makes a second time figure a benchmark rather than a stray one. With no time of your own on screen it is a stray one. It also freed the phone's third cell for the record cell, which dec. 102 requires to be there. |
| `HINTS` as a fact cell | result sheet | The word is wider than the counter — steps 1 and 2 are hints too, and free (agent R, §5 group 2). It becomes ` · 1 cell revealed` on the hero sub, which is both narrower and exactly true. |
| `CASES CLOSED` as a fact cell | result sheet | Not the number — the **cell**. It is world ③ standing inside a world ① strip. The figure survives twice over: as the kicker's cross-world link (`CASE #47 · YOUR 9TH`, §7) and as a cell of its own in the file that owns world ③. Dec. 102's requirement — *the number the bug report was counting must be on screen* — is met in both places. |
| `meta.solversTotal` | `/api/daily` payload | Declared by the client, rendered by nothing, computed on every board load — and it carried the word the splash reserves for a different population. |
| `today.solversAllTime`, `today.solvers`, `today.day`, `today.fastestSec` | `/api/preview` payload | The whole `today` group goes: nothing on the splash is scoped to the day any more. Replaced by `case.closers` / `case.fastestSec` (①) and `next.*` (②). |
| `.docket[data-n="4"]`, `[data-n="5"]` | `splash.css` | The docket can no longer be four or five cells, so the two lower rungs of dec. 93's type ladder are unreachable code. Every band now gets the top size. |

**No cell survived only because it was already there.** The ones kept are listed with their question
in §4; the ones above had none, or had one that another surface answers better.

---

## 7. Where two worlds meet on purpose

R3 separates. Separation alone would leave the product with three sealed rooms, and the strongest
lines in it are the ones that need two worlds at once. Three, and only three — a link that is
everywhere is decoration:

| Link | Where | Worlds | The question neither world answers alone |
|---|---|---|---|
| `CASE #47 · YOUR 9TH` | result kicker | ① × ③ | *what does this case mean to me?* — it turns a case number into a position in my own run |
| `Your best` tag beside the hero time | result hero | ① × ③ | *is this the best I have ever done?* — the only moment `bestTimeSec` can be delivered as news rather than as a statistic |
| `FASTEST 02:41 · of 7` with a `You` tag when it is yours | splash, solved | ① × ① | the benchmark and the size of the field it is the best of; the tag is what stops a reader taking their own figure for someone else's |

Deliberately **not** linked: the streak is not annotated on the case card beyond its own cell
("today's solve extended your run to 4" is the same figure with a sentence around it), and the
result sheet does not restate the day's headcount beside the case's — two headcounts 40px apart
read as an error however honestly each is labelled.

---

## 7a. Which board answers which question

Four tabs, one per world, and the rail is full at four — a fifth does not fit 360px.

| Tab | World | Key | The question |
|---|---|---|---|
| **This case** | ① | `lb:{postId}`, by time | *who else solved the puzzle I just solved, and how fast?* |
| **7 cases** | ② | computed from `lt:posts` + `lb:solves` | *who is playing well right now?* |
| **Streak** | ③ | `lb:streakbest`, by `best` | *who keeps turning up for the daily?* |
| **All-time** | ③ | `lb:alltime`, by points | *who has been here longest and done most?* |

**TODAY is gone as a tab** (dec. 118). It was the only time board on screen and it was scoped to the
DAY, which equals the case on every day except one that published twice — so it served the
consequence of a missing double-press guard rather than a question. The day board is still served,
because the mod funnel reads it.

**The week is seven CASES, not seven days** (dec. 119), and it is computed on every read rather than
accumulated. That is what makes it impossible for it to drift from the days it is made of.

**A streak is CASES closed on their own day, not days you came back** (dec. 123). The archive still
counts as cases closed and still scores points — it simply does not build the chain, because 160
archive cases made a day-unit streak farmable. A day the sub published nothing does not break a run:
there was no case to miss. The word moved with the unit, so every surface says "cases".

**All-time is a long-service record, and that is now a choice rather than a side effect** (dec. 120).
With the freshness bonus, a newcomer cannot catch a veteran by clearing the archive — the veteran
has more days, not more skill. For a daily game that is arguably right; it is written down here so
that nobody has to rediscover it from a complaint.

## 8. Contract with the endpoints

`GET /api/preview` — **strictly read-only** and pinned by a test in
[routes.test.ts](../src/server/routes.test.ts): zero redis writes, no `att:` row created, no
`startedAt`, no consumption of `tut:{userId}`. It renders whenever the post scrolls past in a feed;
if it wrote, merely *seeing* the post would start a timed run and burn a one-time tutorial. Every
number added by this document (`case.closers`, `case.fastestSec`, `next.tier`, `next.vote`) is a
read.

```
GET /api/preview
  case: { number, title, tier, closers, fastestSec }        // ①
  you:  { state, deduced, cells, timeSec,                   // ①
          streakCurrent, streakBest, streak, casesSolved }  // ③
  next: { number, opensInMin, tier, moved,                  // ②
          vote: { total, tally, leader, decided, yours } | null }
```

`next.vote` is `null` when this post is not `lt:lastPostId` — an archive case's vote steers nothing,
and the client draws the countdown alone.

```
GET /api/me                                                 // ③, read-only
  { name, casesClosed, daysSolved, firstSeen, streakCurrent, streakBest,
    bestTimeSec, points, place, detectives, rank: RankState, days: [{date, points}] }
```

`buildResults` gains `caseTotal` / `caseRank` (①, from `lb:{postId}`) and `personalBest` /
`bestTimeSec` (③), and loses nothing: `total`, `rank`, `betterPct`, the histogram and the top three
stay day-scoped for the block that is titled with the day.

---

## 8a. How a claim about layout is allowed to be made

This section exists because the previous version of this document was accompanied by 472
screenshots and the statement that they were clean, and both were worthless. The machine that takes
them has **none** of the fonts in `--font-sans` or `--font-serif` — no Iowan Old Style, Palatino,
Georgia, SF Mono, Menlo, Consolas, Segoe UI, Roboto or Arial — so the stacks fell through to a
default nobody chose, while the device serves SF Pro, SF Mono and Iowan Old Style. Every pixel
budget in `game.css` was fitted to that accident.

Three rules follow, and they bind this document as much as the ones in §1.

**L1 — a frame that cannot name its font is not evidence.** The harness forces the three tokens to
concrete families and every frame reports the measured width of a probe string; `check-frames.py`
identifies the family from the advance widths in the font FILE (fontTools) and fails the run if the
frame did not render in the font it claims.

**L2 — a layout is proven by a BRACKET, not by one rendering.** The matrix is shot under `narrow`
(Liberation Sans / Liberation Mono / P052) and `wide` (the DejaVu family) and must pass both. The
bracket is wider than the device's plausible range: 14% on a sentence, 26% on the long title, 20%
on `normal` line-height. Monospace needs no bracket — every monospace face, SF Mono included,
advances exactly 0.600em per character, which is why the docket's figures were never the problem.

**L3 — the check is a command that fails, not a log.** The DOM probe has existed since track 06 and
nobody had ever read its output; track 11's own log held 18 clipped boxes and 8 overflows while its
report said the matrix was clean. `shoot.sh` now runs `check-frames.py` per profile and exits
non-zero on any clipped box, spill, container overflow or text-over-text — and on *no reports at
all*, which is what a dead fixture server looks like from the outside.

What this **cannot** do, stated so nobody claims otherwise: it cannot render SF Pro, SF Mono or
Iowan Old Style, because they are Apple's and no free metric-compatible clone exists. It proves a
layout survives a range that contains the device; it does not prove the device. The only way to
make the harness and the phone render the same glyphs is to stop asking the platform and **ship the
fonts with the app** — a self-hosted WOFF2 would remove this entire class of bug permanently, at
the cost of bundle size and of losing the native feel of SF Pro on iOS. That is a design decision
with a real trade in it and it belongs to the owner, so it is recorded here and not taken.

## 9. What this document does not do

- **It does not lower any honesty gate.** The histogram and the percentile still need 50 and will
  not render on this subreddit for a long time. That is correct (dec. 37) and is not a bug to fix
  with a smaller number.
- **It does not add a counter for anything unrecorded.** Feed impressions, CTR and retention among
  people who only ever *opened* remain impossible: Devvit Redis cannot enumerate keys, so nothing is
  recoverable that was not written at the moment it happened
  (`plans/assets/09-stats-audit.md` (internal, not in the public repo) §6). `/api/preview` stays read-only, which
  is a deliberate trade of one metric for a correct product.
- **It does not touch the points formula, the rollup, or the boards.** Those were agent R's and
  agent T's, they are audited, and nothing here disagrees with them.
- **It does not build other players' files** (§5), and it does not put an entry to your own file on
  the splash (§5).

## 10. Using the register: what we can answer, and what we cannot

The register in §2 is the only complete list of what this game can measure. Two questions in front
of the project need it, and both deserve a straight answer rather than a proxy.

### 10.1 The featuring application

| It asks for | Today, honestly | What it would cost | Retroactive? |
|---|---|---|---|
| **Day-1 / day-3 retention** | **Yes — and it already exists.** `lb:day:{date}` is an explicit collection of that day's solvers and `lb:index:days` enumerates the days, so the intersection of two day boards is a real cohort. Agent R built it into the audit tool (`auditRetention`) | nothing | **yes, for every day the boards have existed** |
| **Time in game** | **Partly.** `att:.activeSec` is client-reported active play time, written on every autosave, and reachable for anyone in `stuck:{postId}` | nothing | for reachable rows only |
| **CTR (opened ÷ seen)** | **No.** The numerator exists (`stats:{postId}.opened`, #9). The denominator does not: impressions are not written anywhere | one `hSetNX(seen:{postId}, userId)` + one counter in `/api/preview` | **no** — starts at deploy |

Three caveats that have to travel with those numbers, or they become the invented proof §1 forbids:

1. **The retention cohort is SOLVERS, not players.** Retention among people who merely opened a case
   cannot be computed at all: `opened` is a counter, and the openers' user ids are stored nowhere
   (`stuck:{postId}` holds only those who autosaved). Reporting the solver cohort under the plain
   word "retention" would overstate it, because solving is a much stronger act than opening.
2. **`activeSec` is a lower bound on attention, not a measurement of it** — the client reports it,
   and it stops at the tab going away. It is honest as "at least this long", not as "this long".
3. **Nothing is recoverable before its counter existed.** Devvit Redis cannot enumerate keys, so
   there is no way to reconstruct a number nobody wrote down at the time.

The `seen:` counter is the one worth adding, and not only for CTR — see §10.2. It does **not** break
`/api/preview`'s read-only contract in substance: that contract exists so that scrolling past the
post cannot start a timed run or burn the one-time tutorial, and a `seen:` hash touches neither
`att:` nor `tut:`. It does change the letter of the test, which currently asserts *zero* writes, and
that test would have to become "no write to `att:` or `tut:`" — a weakening that must be made
deliberately and in one commit with the counter, never quietly.

### 10.2 "The game is monotonous" — would the data have said so first?

A player left after about ten cases saying *"the same task again and again"*. The question is
whether that was visible before he wrote it, and it is answerable, because the two explanations
leave **opposite** signatures in numbers we already keep.

`lb:solves:{date}` is a hash of `username → t|hints|tier|postId`, and `lb:days:{username}` lists a
player's days. Together they reconstruct, for any player, the series **(day, time, hints, tier)** —
today, and retroactively.

| Reading | Novelty exhausted | Difficulty wall |
|---|---|---|
| solve time over their last cases | flat or falling | rising |
| hints (#6) | at or near zero | rising |
| solve rate | high to the end | falling |
| how it ends | stops **opening** | opens, struggles, leaves |

**The discriminator is effort against success in the last few cases before the stop**, and only the
last row of that table is missing: we cannot tell "stopped opening" from "opened and gave up",
because — again — the openers are not enumerable. The same `seen:` counter closes it. That is why
it is the one counter worth adding: it is the denominator of the featuring number *and* the
discriminator for the variety question.

One thing the register genuinely does not hold, and it is the one this question is about:
**nothing records which THEME a player has seen.** `lb:solves` keeps the tier and the post id, not
`themeId`, so "this player has had pizza six times running" is not reconstructible. Adding the
theme to that record is a one-field change and would make repetition measurable going forward —
but it is measurable only *forward*, and `plans/07-variety.md` (internal, not in the public repo) is deferred
by the owner, so this document records the option and does not spend it.

**The honest summary for a decision about variety:** we can already tell an exhausted player from a
blocked one for everybody who solved, retroactively, from keys that exist. We cannot yet see
someone who stopped opening, and we cannot see theme repetition at all. Neither gap needs a
research project; both are one counter and one field.
