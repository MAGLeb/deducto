# Gameplay and mechanics — the Deduction Grid

> 🧩 **This is one format, not the product.** Deducto publishes one logic puzzle a day and the
> mechanic varies ([01-concept.md](01-concept.md)); everything below is the **Deduction Grid**, the
> format that ships today. The streak, the boards and the result card described elsewhere sit above
> this and know nothing about grids ([12-game-types.md](12-game-types.md)).

## Logic grid

The core entity is a **suspect**. All other categories are matched against suspects. The player solves everything on a single board (rows - suspects, columns - categories: **Coat, Time, Item**; internally `flair` / `time` / `object`), without tabs. The grid is fixed: 4 suspects x 3 categories = 12 cells. We do NOT show the huge classic grid with all sub-tables - too heavy for the Reddit UI.

## Cell states

```
type Cell = 0 | 1 | 2   // 0 = unknown, 1 = crossed out, 2 = confirmed
```

On the board, tap toggles only 0 <-> 1 (normal <-> crossed out); the engine supports state 2, but the UI never sets it - the "confirmed" answer surfaces on its own as the only remaining candidate. The main board view is "single board": rows - suspects, columns - categories, with candidate chips inside each cell (validated on the prototype, it beat tabs).

## Interaction: pure toggle (no confirmation)

The main principle is that **nothing happens by itself** on the board. Every change is made by the player; no cascades, no auto-crossing-out, no auto-confirmations (playtests 2-3: any automation, even local, blurs the understanding of what is happening).

In the "single board", a chip has only two states - normal and crossed out:

- tap on a candidate - cross out / restore (pure toggle: tapped = activated / deactivated);
- there is no separate "confirm". When a single non-crossed-out candidate remains in a cell, it is the answer (it stands out on its own against the dimmed crossed-out ones) - but it stays a regular toggle chip: tapping it simply crosses it back out;
- undo reverts exactly one move (one cell).

Crossing out is the only action. The n/12 counter counts the single remaining (non-crossed-out) candidate in each cell as an answer - **"I crossed everything out" = "I solved it"** (playtests 1 and 4). All options are always visible, nothing collapses: while solving, it is important to see the crossed-out options too (playtest 4).

## Live clue status

Each clue in the list answers to the player's current marks. `clueStatus()` returns three values, and the D3 visual language gives each one a treatment that is not a colour swap:

| `clueStatus` | Meaning | How it reads on screen |
|---|---|---|
| `ok` | satisfied - the board agrees with it | struck through, muted ink, number box filled |
| `bad` | violated - the marks contradict it | the screen's one red: stamp wash, red number box, and the words "Contradicted by the board" |
| `open` | not yet decided | plain |

Deliberately not a traffic light: satisfied is *withdrawn from play*, which strike-through says better than green, and it leaves red meaning exactly one thing on the screen. It survives greyscale and every CVD type.

The status is computed from the player's marks, not from the hidden solution - honest feedback without spoilers. Hovering over / selecting a clue does NOT highlight or outline the board cells (playtest 3: this was confusing) - clues and the board are visually independent.

The panel head carries a tally in words (`N contradicted · N satisfied · N open`), and one line under the board carries the two things that are true whether or not anyone asked: the standing instruction normally, and "1 clue now contradicts the board - it is marked in the list" when something is red. It is a sentence-case caption, not a message - a line that is always on screen should not look like the game speaking to you (dec. 79). The third thing it used to say, "no forced move left", is a verdict on a *technique* rather than a statement about the board, so it now answers a press of **Hint** instead; a player who has stalled without pressing anything gets the stall nudge below.

## Auto-closing the case (no "Check" button, no mistakes)

There is no separate "Check case" button, and there is no concept of a "mistake" either. The case closes on its own as soon as both conditions are met simultaneously:

1. **all 12 cells are deduced** - exactly one non-crossed-out candidate remains in each of the 4x3 cells (effectiveCount == suspects x categories);
2. **no clue is contradicted** - clueStatus for all clues equals `ok`.

As soon as both conditions align, the client itself submits the grid to the server (`/api/check`), the server checks it against the hidden solution (anti-cheat: the solution and the timer live ONLY on the server, the client never receives them) and returns `solved` -> result screen. Since the case has a single solution, "all cells deduced + no clue contradicted" = the correct answer; you cannot lose or "get a mistake". An incomplete or contradictory grid simply does not trigger the close - the player keeps solving.

A logged-out visitor who solves the case gets a screen of its own saying that nothing was recorded - no time, no rank, no streak - rather than an invented one.

## The hint ladder (3 rungs; two of them free)

Teach the next move instead of answering it. All three run through `POST /api/hint` with `step: 1 | 2 | 3`; the deduction itself is the server's weak model (`adviseOnGrid` in `engine.ts`).

| Rung | What it says | Price |
|---|---|---|
| 1 - "Which clue works" | names the clue that still moves *your* board, and nothing else | free |
| 2 - "What it rules out" | names the cell that clue rules out, and what it leaves standing | free |
| 3 - "Reveal a cell" | reveals the answer for one still-undetermined cell | costs 1 hint |

Only rung 3 counts against the result, and the price is printed on the button - an unlabelled free hint is a hint nobody presses. Repeat presses on the same board never inflate the counter: the server tracks which cells it has already revealed (`hinted`) and only new reveals increment. The full log of revealed cells is server-backed and pageable, so it survives a reload.

The four verdicts rung 1/2 can come back with are `move`, `contradiction`, `stuck` and `done`, and the client phrases each in **one sentence**; `stuck` is honest about the wall ("no single clue moves this board now - link two categories through a value they share") rather than pretending a move exists.

The slip they arrive in **floats over the board and moves nothing** (dec. 78): it is positioned absolutely inside the board area, so the clue list, the epilogue and the panel head are exactly where they were before it opened. It docks at whichever end of the board is *not* the row the hint is naming, which is how it keeps dec. 66's real requirement - a hint must never cover the cell it is about - without taking height from the clue list, which is what the in-flow version did (and on a 14-clue case that cost a clue row at every phone size).

**The stall nudge.** The server owns both active play time and the moment the board last gained a cell, so it decides: more than 3 minutes in, more than 90 seconds without a new cell, and the game offers the two free rungs on its own. Offered once per player per case, and never in the warm-up lane. It is the only message in the game that arrives unasked, so it is the only one shaped like an interruption - a bar on the bottom edge with one line and one action, never the hint slip. What it offers depends on the board: at the weak-model wall it says two clues have to be linked, otherwise it just points at the free rungs.

## The warm-up lane

An opt-in practice case, isolated from the daily: its own saved grid, no leaderboard, no vote, no streak, no hints. It serves the `tutorial` tier - over-clued cases where every move is forced - walking the pool by a per-user counter, so a second warm-up is a different case rather than the same board with yesterday's marks on it.

A brand-new player is offered it before today's case (the "first-run ladder"). The offer closes itself: one finished warm-up, or one *skip*, and it never comes back. Separately, three coach marks run once on the first visit, tracked server-side (`tut:{userId}`) rather than in localStorage, which is unreliable inside the webview.

**Closing a warm-up ends in a choice, not a timer** (dec. 82): a card marked `WARM-UP SOLVED` offers *Open today's case* or *One more warm-up*. The pool holds 15 and rotates, so the second offer is real; and the one moment in the lane worth marking is no longer a grey plaque followed by a 1.3-second jump to somewhere you did not ask to go.

## Discussing the solution in the comments

There is no separate in-game card mechanic. After solving, the player explains their line of reasoning organically in the comments on the daily post - and there they argue and cross-check the chain with other detectives:

> 🧠 Clue 2 + Clue 5 prove: Mira could not have had the green coat.

The comments are a board for deductions and debates about the solution, living natively in the Reddit thread.

## Game states

0. **In the feed** - the case card (`splash.html`): case number, title, difficulty stamp, today's solvers and fastest time, and one button. No clues and no grid here - seeing the post must not start your run. The button opens the board full-screen (`requestExpandedMode`), which is also what removed the internal scroll inside the inline webview.
1. **Not started** - the board, the clue list and the standing instruction right away. No second Start screen behind the card.
2. **In progress** - timer, cell meter, clue tally, hint ladder, controls.
3. **Solved** - both auto-close conditions have aligned, the server confirmed -> transition to the result screen.
4. **Post-solve** - result (time / hints / streak / rank, the day's three fastest, the difficulty vote), the solution table on the sheet's second face, discussion in the comments, countdown to the new case.

Nothing pushes a leaderboard or a long list at a player who is mid-deduction: the board never grows a table on its own, and no result surfaces until the case closes. That rule is about interruption, not about access.

Access is open. A standings screen (today / week / longest streak / all-time) is reachable from the controls at any time, including by someone who has not solved today - it takes an explicit tap and closes straight back to the board. The result sheet carries the top four of each board with the rest behind one button. Gating the boards behind solving hid them from exactly the people deciding whether this game is worth a habit.
