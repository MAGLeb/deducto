# 12 — Game types: the shared layer and the seam

**What this file is.** Deducto is now a collection of daily logic formats
([01-concept.md](01-concept.md)). That makes one question architectural rather than cosmetic:
**where does a format end and the product begin?**

This document draws that line, says which side of it every existing part of the code is on today,
and states what a daily puzzle has to declare for a second format to arrive without the first one
being rewritten.

> **Status.** Nothing here is implemented. One format ships — the Deduction Grid — and the code has
> no notion of a format at all; it simply *is* the grid. This file is the target, written down
> before the second format is built, because the cost of the seam is paid once and the cost of not
> having one is paid at every format after the second.

---

## 1. The line

**The product is the daily ritual.** A puzzle went out today; you solved it in some number of
seconds; that continued a run; it put you somewhere on a board; there is a thread about it and a
countdown to the next one. Every word of that is true whatever the puzzle was.

**The format is what happens between opening the puzzle and closing it.** Its rules, its board, its
notion of a move, its clue text, its idea of "solved".

The seam is therefore exactly one question: **"is it closed, and how long did it take?"** Everything
above the seam consumes that answer and nothing else about the puzzle.

### The invariant that matters most

A streak counts **puzzles**, not grids. Closing a Kings & Jacks on Tuesday extends a run started on a
grid on Monday.

This is not a convenience — it is the collection's entire premise. A streak that resets when the
format changes would punish the player for the variety the product is built on, and the first thing
a player would learn is to hope the format does not change.

---

## 2. Where the code stands today

| Part | Side of the line | State today |
| --- | --- | --- |
| streak (`src/server/streak.ts`) | shared | already format-blind: it counts post ids against the case registry and never inspects a puzzle |
| leaderboards, points, ranks (`src/server/leaderboard.ts`) | shared | format-blind: it takes a username, a time and a hint count |
| rank flair (`src/server/flair.ts`) | shared | format-blind: reads the streak only |
| the day, the registry, the epilogue comment (`src/server/herald.ts`, `daily.ts`) | shared | format-blind: they act on posts, not puzzles |
| stats surfaces ([11-stats-ia.md](11-stats-ia.md)) | shared | **almost**: the vocabulary is grid-shaped — see §4 |
| the feed card (`src/client/splash.ts`) | mixed | the frame is shared; `CLUES`, the item glyphs and the tier stamp are the grid's |
| the board (`src/client/main.ts`, `game.css`) | format | entirely the grid |
| clue rendering (`src/shared/render.ts`), live status (`status.ts`) | format | entirely the grid |
| the engine and the bank (`src/server/engine.ts`, `bank.json`) | format | entirely the grid |
| the design system ([10-design-spec.md](10-design-spec.md)) | shared | tokens and components are already generic; only the board's own components are grid-specific |

The good news is that most of the shared side is *already* shared, and not by accident: the streak
was rebuilt to count cases against a registry of posts, and the leaderboard has never been handed
anything but a username and a number. The work is not untangling — it is naming the seam and moving
three or four grid-shaped assumptions off the shared side.

---

## 3. What a daily puzzle has to declare

Today a published post carries `postData: { idx, date, n, level, epilogue }` — an index into the one
bank there is. A second format needs the post to say **which** bank, which is one field:

```jsonc
postData: {
  gameType: "grid",      // "grid" | "kings"  — the only new required field
  idx, date, n, level, epilogue
}
```

Three rules make that field enough, and all three are about *not* letting the type leak upward:

1. **The server resolves the type once, at the edge.** One lookup turns `gameType` into the module
   that can load, grade and describe that puzzle. Nothing downstream branches on the string; a
   `switch (gameType)` anywhere in the leaderboard, the streak or the result sheet is the seam
   failing.

2. **A format module answers a fixed set of questions** and nothing else knows how it does so:
   load today's puzzle for this index; take a player's state and say *unsolved / solved / wrong*;
   describe itself for the feed card (a title, a hook, a size — "12 cells", "10 clues", "6
   characters"); and hand the client whatever it needs to render, minus the answer.

3. **Absent means grid.** Every post published before the field existed has no `gameType`, and they
   must keep working: missing reads as `"grid"`. This is the same rule the app already applies to
   every other field it added after the fact, and it is why no migration is needed.

### What a format module must NOT be given

The solution never reaches the client — that is anti-cheat and it is older than this document. Less
obviously: a format module has no business knowing about streaks, points, boards or ranks. If one
needs to *write* something for the player to keep, the seam is in the wrong place.

---

## 4. What has to change on the shared side

Four grid-shaped assumptions currently sit above the line. None is deep; all four are visible to
players, which is why they are listed rather than discovered later.

**Words.** "Case", "suspect", "detective", "clue" are the grid's vocabulary and they run through
every surface. A collection needs a shared noun for *the thing published today*. `case` reads as a
detective story; `puzzle` is honest across formats and is what the concept document now uses. This
is a copy change with a large surface, not a code change, and it should happen once rather than
per-format.

**The feed card's middle band.** `CLUES 10` is a grid figure. It should be whatever the format calls
its own size, supplied by the format module rather than assumed by the card.

**Difficulty.** The tier stamp, the `Harder / Same / Softer` vote and the level ladder are all
defined in terms of the grid's generator. A second format needs its own notion of difficulty, or the
vote needs to be scoped per format — the wrong answer is one global level applied to a format whose
generator has never heard of it.

**Measurement.** The concept document asks for daily players, completion rate, solve time, D1/D7 and
streak distribution **per format**. Every one of those is currently aggregated across the one format
there is, which reads identically to "aggregated across all of them" — and will silently keep
reading that way after the second arrives. The format has to be recorded on the day's record at the
moment it is written, because it cannot be recovered afterwards.

---

## 5. Kings & Jacks, sketched

Not built. Written down because a seam designed against one format is a seam designed against
nothing.

A puzzle is a small cast of characters, each secretly a **King** (always tells the truth) or a
**Jack** (always lies), and a set of statements they make about themselves and each other. The
player marks each character King or Jack; the puzzle closes when every assignment is consistent with
every statement, and — as with the grid — the puzzle is generated so that exactly one assignment is.

What it shares with the grid, for free: one provable answer, therefore no submit button and no way
to lose; a per-statement live status, the same idea as the grid's live clue status; a board of
toggles; the same tokens, stamps and paper.

What it needs of its own: a generator and a uniqueness proof; a statement renderer; a board that is
a list of characters rather than a matrix; and its own difficulty scale.

What it must not touch: the streak, the boards, the points, the ranks, the flair, the result card,
the epilogue comment, the countdown. If building it requires editing any of those, §1 was drawn in
the wrong place and the fix belongs there, not in the format.
