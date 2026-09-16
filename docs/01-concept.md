# Concept

## What it is

**Deducto is a daily logic game on Reddit.** One subreddit, one new puzzle a day, three to ten
minutes of thinking, and a reason to come back tomorrow.

The important word is **daily**, not *deduction*. What the product sells is a ritual: today's puzzle,
your time against everybody else's, your run of days. The *mechanic* underneath that ritual is
allowed to change — and changing it is how the ritual stays alive past the point where one puzzle
type becomes a routine.

So Deducto is a **collection of daily logic formats**, not a single game. Today one format ships;
others arrive one at a time, each judged on whether people keep coming back to it.

## What the player does

A player opens the newest post in the subreddit and finds **today's puzzle**. They solve it, see
their time and where it puts them, argue about it in the comments, and come back tomorrow.

They are never handed a catalogue. There is no menu of eighty puzzles, no difficulty picker, no
"choose a game" screen. The archive exists and is reachable, but the product is the post that is
live right now — the same one everybody else in the subreddit is looking at today.

That is the whole design constraint the rest of this document serves: **one puzzle, shared, today.**

## The formats

| Format | Status | What it asks of the player |
| --- | --- | --- |
| **Deduction Grid** | **shipped** | Match people to attributes — who wore which coat, at what time, carrying what — by ruling out what the clues forbid. |
| **Kings & Jacks** | **planned, not built** | Classic truth-teller / liar puzzles. Kings always tell the truth, Jacks always lie; from what each character says, work out which is which. |
| ordering & constraint puzzles, pattern and sequence puzzles, small inference problems | later, one at a time | — |

Nothing beyond the grid is implemented. Where these docs describe a second format they are
describing **intent**, and they say so; the shipped behaviour is always the grid.

The reason for going slowly is not caution about the code. It is that a new mechanic is a bet on
attention, and the only way to settle the bet is to watch whether the people who solved it once come
back — which takes weeks per format, not days.

### Why these two first

The grid and Kings & Jacks are deliberately *different kinds of thinking* while sharing the same
promise. The grid is elimination across a structure you can see; Kings & Jacks is reasoning about
statements that may be lies, where the structure is in your head. A player who bounces off one has a
real chance of liking the other, which is the entire point of a collection. Two formats that differ
only in theme would be one format with two skins.

## What every format shares

The formats vary. The meta layer around them does not, and it is where most of the product lives:

- **the streak** — consecutive published puzzles closed on the day each ran;
- **solve time**, and the day's leaderboard built from it;
- **personal stats** — puzzles closed, best time, points, rank;
- **the result card** after a solve, shareable by construction because it is a Reddit post;
- **the comment thread** — one shared puzzle a day is what makes discussion possible at all;
- **the archive** of previous puzzles;
- **the countdown** to tomorrow's puzzle.

A player's streak must survive a change of format. Someone who closed a grid on Monday and a
Kings & Jacks on Tuesday has a run of two — anything else would make the collection a punishment for
variety, and variety is the reason the collection exists.

This is why the meta layer is specified in its own document
([11-stats-ia.md](11-stats-ia.md)) and, in the code, is deliberately kept clear of anything that
knows what a suspect or a grid cell is.

## Why Reddit

Reddit is not a container for the game; it is the arena the loop runs in.

- The daily post is a **shared** arena — everybody is on the same puzzle at the same time.
- The comments are where people defend their reasoning, which is a second game on top of the first.
- Streaks, times and standings are social by default because every row is a real username.
- A result is shareable without building anything: it is already a post in a public thread.

None of that survives a catalogue. It only works while there is one puzzle a day.

## Audience

People who already have a daily puzzle habit — Wordle, Sudoku, nonograms, logic grids — and Reddit
users who enjoy arguing about how an answer was reached. Casual by design: three to ten minutes,
no account setup, no tutorial to read, no prior visit assumed.

The subreddit's positioning follows from that: **the place you drop into once a day to exercise your
logic.** Content, art direction and promotion are built around the daily habit, not around any one
mechanic.

## Money

There are no paywalls, no premium puzzles, and no gated formats. Every puzzle is free, for everyone,
every day.

The only thing planned is an unobtrusive **Support this app** link for people who choose to give
something back. It is not built yet, and when it is it will not sit between a player and a puzzle.

## What we measure

Per format, separately — a collection whose formats are measured together cannot tell you which one
is working:

- daily players;
- completion rate;
- solve time;
- D1 and D7 retention;
- streak distribution.

## Core promise

> One logic puzzle a day.
> Solve it, argue it in the thread, keep your run going.
