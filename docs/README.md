# Deducto — docs

Design and engineering notes for **Deducto**, a daily logic game on Reddit built on Devvit Web.
Start with the code (`../src`) and `../README.md`; these docs add the "why" and the deeper specs.

## Read this first

Deducto is **a collection of daily logic formats**, not one game. One puzzle goes out a day; the
*mechanic* varies. One format ships today — the **Deduction Grid** — and a second, **Kings &
Jacks**, is designed but not built.

That split runs through every document below, so each one is marked:

- 🧩 **format** — describes the Deduction Grid specifically. True today, and true of one format
  among several later.
- 🌐 **shared** — describes the layer every format sits on: the day, the streak, the boards, the
  stats, the design system.

| Doc | Scope | What it is |
| --- | --- | --- |
| [01-concept.md](01-concept.md) | 🌐 | What Deducto is, the daily ritual, the formats, what they share. **The positioning document — start here.** |
| [12-game-types.md](12-game-types.md) | 🌐 | Where a format ends and the product begins; what a daily puzzle must declare for a second format to arrive. Design target, not shipped. |
| [11-stats-ia.md](11-stats-ia.md) | 🌐 | Every number shown to a player: which, where from, how labelled, at what threshold. The meta layer, specified. |
| [10-design-spec.md](10-design-spec.md) | 🌐 | The design-token system (colour, type, spacing, radii). Design source of truth. |
| [09-design-decisions.md](09-design-decisions.md) | 🌐 | The decision / playtest journal — the source of truth for how things should work and why. |
| [06-architecture.md](06-architecture.md) | 🌐 + 🧩 | System architecture — Devvit Web, Express server, endpoints, anti-cheat, engine + bank. |
| [05-data-model.md](05-data-model.md) | 🌐 + 🧩 | Type shapes and the Redis data model. |
| [02-gameplay.md](02-gameplay.md) | 🧩 | How a grid puzzle is solved — toggle-elimination, live clue status, auto-close. |
| [03-screens.md](03-screens.md) | 🧩 | Screen / UI spec (board, clues, result screen). |
| [04-puzzle-engine.md](04-puzzle-engine.md) | 🧩 | The grid's deterministic difficulty engine and tier model. |

### Companion files

Four files sit beside [10-design-spec.md](10-design-spec.md) and are referenced from it:

| File | What it is |
| --- | --- |
| [10-design-spec-contrasts.txt](10-design-spec-contrasts.txt) | The machine run behind every contrast ratio in §2/§3 of the spec — so the numbers are checkable from a fresh clone. |
| [10-design-spec-wcag.py](10-design-spec-wcag.py) | The contrast + colour-blindness maths, as a helper you can call with colour pairs. Not the audit driver — that is internal tooling. |
| [10-design-spec-proto.html](10-design-spec-proto.html) | The design system's reference implementation: one file, no build. |
| [10-design-spec-legacy.md](10-design-spec-legacy.md) | The superseded dark-navy system that shipped for the hackathon. Kept as the record of why the old values were what they were. |

**`plans/` is not in this repository.** Internal execution plans, prototypes and the screenshot
harness live there and `.gitignore` excludes them on purpose — they carry local paths and browser
profiles. Where a document cites a `plans/…` path it is naming a source, not offering a link.

The gaps in the numbering (07, 08) are removed hackathon-era planning docs (community loop, MVP
plan, hackathon brief/strategy, launch copy, the Devpost draft) — they described features that were
cut or were one-off submission material, so they were deleted after the hackathon was submitted.

## Caveats when reading these docs

1. **Positioning.** Documents written before 2026-09-16 assume Deducto *is* the Deduction Grid,
   because it was. Where an older note says "the game", read "this format". The concept and the
   game-types documents are the current statement; nothing else has been rewritten wholesale.
2. **Vocabulary.** The grid's words — *case*, *suspect*, *detective*, *clue* — are still in the
   product and in most of these docs. They are the grid's, not the collection's; replacing them with
   format-neutral words is a known, unstarted job (12-game-types.md §4).
3. **Brand.** The game was originally called *Logic Thread*; it is now **Deducto** (Devvit app slug
   `deducto-puzzle`). Any lingering "Logic Thread" in older notes is historical.
4. **Cut features.** Two things described in the earliest notes were removed and are NOT in the
   shipped game: the copy-to-thread **"trail"** share, and the 3-block **community loop** (post-solve
   vote / deduction / UGC screens). A lightweight per-day **difficulty vote** and leaderboards did
   ship.
5. **Publishing.** Daily publishing works from the moderator menu and also from a scheduler that
   ships **switched off** per subreddit; a published puzzle is read back half an hour later and the
   schedule stops itself if it was filtered.
