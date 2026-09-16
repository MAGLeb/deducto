# Screens and visual style — the board

> 🧩 **The board screens are one format's.** The design language itself is shared — tokens,
> stamps, the paper — and lives in [10-design-spec.md](10-design-spec.md); the feed card and the
> result sheet are shared frames with grid-shaped contents. What is specific to the Deduction Grid
> here is the board: the matrix, the cell states, the clue list.

## Core principle

The interface is a **case file**: warm paper, ink, hairlines, stamps. One idea generates the rest -

> **Colour belongs to evidence. Chrome is ink on paper.**

The only hues that exist are the four Okabe-Ito coats in the evidence grid and one archive red used
at most once per screen. Progress, time, buttons, headings, the board frame, the histogram and the
leaderboard are all achromatic, which is what makes a colourful 4×3 grid legible instead of noisy.
Paper is produced by the palette, the type pairing and its rules: no textures, no coffee rings,
no torn edges (design system D3 "Manila", dec. 57-70). The one exception, added deliberately in
dec. 71, is `--shadow-1` - two hard offsets and one 8px blur mixed out of `--ink` - on the sheets
that genuinely float over another surface. It is a printed drop, not a photographic one, and it
exists because `--sheet-raised` is capped by white and cannot buy its edge with lightness.

Three documents, three jobs (dec. 43/46 in [09-design-decisions.md](09-design-decisions.md)):

| Entrypoint | File | Where it runs | Height |
|---|---|---|---|
| `default` | `splash.html` | inline, in the feed and on the post page | `regular` (320px) |
| `game` | `index.html` | expanded - fullscreen on mobile, a modal on desktop | `tall` |

The splash opens the game with `requestExpandedMode(event, "game")` from `@devvit/web/client`. Expanding **reloads the document**, so nothing may live in memory only: the grid, the hint count and the elapsed time all come back from `GET /api/daily`.

**Nothing scrolls, anywhere.** `html, body { overflow: hidden }` in [base.css](../src/client/base.css) makes a scrollbar structurally impossible; every screen is laid out to fit 375×667 through 1440×900. Scrolling inside an inline webview is prohibited by the Reddit Featuring Guide, and decision 25 (which used to permit it) is revoked - see dec. 45.

## Style

The token system (colours with verified WCAG contrasts, type scale, spacing, radii) lives in exactly one file, [src/client/tokens.css](../src/client/tokens.css): it is the only place in `src/client` that holds a literal colour. Everything else references it through `var()`, so replacing the visual language is a rewrite of that file, not of the components. The full spec is [10-design-spec.md](10-design-spec.md). In brief:

- **Two themes, both mandatory.** Light is `:root`, dark arrives through `prefers-color-scheme` - Devvit offers no toggle and the webview inherits the client's scheme, so a white rectangle in a dark feed is as foreign as a black one in a light feed. Four surfaces (`--paper → --sheet → --sheet-raised`, plus the recessed `--groove`), and the ladder never inverts between themes;
- **The ladder is spaced, not merely ordered** (dec. 71). `--paper` is the manila folder on the desk and `--sheet` is the sheet laid on it, **2.00:1** apart in light; the result sheet clears the page by 2.16:1. Two pairs cannot be spaced and say so in the audit rather than hiding: `--sheet`/`--groove` is capped at 1.51:1 by `--ink-3` needing AA on a recess, and `--sheet`/`--sheet-raised` is capped at ~1.1:1 by white. Both carry their edge with a `--rule-strong` boundary and, where a sheet floats, `--shadow-1`. **Nothing but `--ink` may be set on `--paper`** - the screenshot harness asserts it on every frame;
- **Structure is `--rule-strong`, decoration is `--rule`** (dec. 72). The board grid, panel heads, the sidebar edge and the facts strip are structure; row dividers inside a list are decoration;
- **Anything the pointer can act on lights up** (dec. 73), and every hover rule lives inside `@media (hover: hover)` guarded against `:disabled` - so a tap on a phone never leaves a button looking pressed;
- **Ink, three reading steps** (`--ink / --ink-2 / --ink-3`) and one inverse. No fourth grey;
- **One accent, `--stamp` (archive red), at most once per screen**: the case number on the splash, the contradicted clue in the game, `CLOSED` on the result, `NOT RECORDED` on the guest screen, the error stamp. There is no orange, green, yellow, blue or purple anywhere in the chrome (dec. 57). The tier stamp and the `SEALED` envelope gave their red back (dec. 77/80) - fewer red marks is always inside the rule, never outside it;
- **Confirmed = a 4px ink frame inside the chip** (`border-color: --ink` + `inset 0 0 0 2px --ink` + `0 0 0 1px --ink`), not a green ring and no longer a 2px outline at offset 2 - on a 27px chip with a 3px gap that ring merged with the neighbouring chip's border (dec. 76). **Satisfied = struck through and muted**, not a green badge. Both are CVD-immune by construction;
- **Difficulty reads in words, and its second channel is weight** (dec. 77, revised by dec. 86): the stamp is `MEDIUM` over `LEVEL 2 OF 3` - a word that is already ordered in English, over the denominator an ordinal never had - outlined in `--ink-3` / `--ink-2` / `--ink` at 1.5 / 2 / 4px double as the ladder climbs. Never a hue: it is the channel that dies first in greyscale and under CVD;
- **Mono caps are for labels, not for prose** (dec. 79/83). Column heads, stamps, section headings and figures are mono caps; anything the reader has to *read* - the board instruction, the note under a standings table, the line explaining how points are counted - is sentence-case sans. 11px caps at `.12em` scans as a label and slows down as a sentence;
- Coats - Okabe-Ito palette (CVD-safe) + **letter R/B/G/P in the chip**: state is never conveyed by colour alone (dec. 16/62). Blue is theme-dependent and the letter ink is per-coat;
- **Three families**: sans for prose, mono (`tabular-nums`) for every figure and caps label, serif in exactly **two** places - the case title and the result hero subtitle. No webfonts: a failed font request in an isolated webview is a layout bug;
- **Two radii, `0` and `2px`.** Sheets, panels, the board: 0. Chips, buttons, stamps, tags: 2px. Paper is cut, not moulded;
- **No emoji in the chrome** - mono caps labels and four inline-SVG line icons (undo / restart / help / close) replace 🧵 ✔ ⏱️ 🔥 💡 🏆 ✉️ 🥇. Item emoji (🍕 ⌨️ 🥄 📜) stay: they are content, and so do the **rank** emoji on the result sheet's ladder (🔎 🕵️ 🎩 🧠 🏛, dec. 89) - that block is *about* the rank, and position is carried by three non-colour channels besides the glyph;
- Text 3 steps, type 8 steps, spacing on a 4pt grid;
- `prefers-reduced-motion` disables every animation and transition.

Every "text on background" pair is recomputed on the **actual** surface it lands on: AA (4.5:1) for text, 3:1 for any boundary that carries information (SC 1.4.11). The maths is [10-design-spec-wcag.py](10-design-spec-wcag.py); the run against the shipped token file is reproducible and lists where each pair appears on screen.

**And every "surface on surface" pair too.** Checking only text on background is how a palette whose four surfaces all sat inside 1.09-1.46:1 of each other passed a full audit while the result card had no visible edge (dec. 71). The run now carries a second table: each pair of surfaces that meet somewhere in the DOM, the floor it has to clear, what it was, what it is, and - for the two pairs that physically cannot be spaced - what draws the boundary instead. A pair that cannot be spaced is reported, never omitted.

## Screen 0. Splash - the first screen in the feed

Everything a passer-by needs to decide, and nothing else. No grid, no clues, no scroll.

A sheet laid on the folder: wordmark, the case number, the tier stamp, the serif title, one sentence of rules, **the docket**, and two buttons - the case, and the table. **The card is the slot** (dec. 74): it fills the 320px webview from edge to edge minus an 8px manila frame.

Dec. 74 stretched the card and the slot was still mostly empty page. **The docket** (dec. 84) is what fills it, out of figures `GET /api/preview` was already answering and the old layout spent on one 11px line of caps at the bottom edge:

Which figures appear is the player's state, and **the rule is one line** (dec. 95/97/103): *before* you play the docket answers "is this worth three minutes, and is anyone here"; *after* you play it answers "what did I get, how did it compare".

**Every cell belongs to a world, and the arrangement says which** (dec. 103, [docs/11-stats-ia.md](11-stats-ia.md) §1). ① is *this case*, ② is *the series* - the countdown, the vote - and ③ is *you here, all time*. The card used to draw all three in one typeface, one weight and one rhythm, with nothing to tell them apart:

```
YOUR TIME 05:20 · FASTEST 01:54 · NEXT CASE 8h 53m · CURRENT STREAK 4 · DETECTIVES 8
└──────────── this case ───────┘  └── the series ─┘  └──────── you, all time ─────────┘
```

Five cells, three subjects, zero sign of it - which is exactly why a cell that looked glued to the case was read as being about the case. So cells of one world stand together and are never interleaved, and **the boundary between two worlds is drawn one weight heavier than the boundary inside one** (`--rule-strong` against `--rule`): same ink, no colour, no extra word. `‖` marks it below.

| Cell | World | new | playing | solved |
|---|:---:|:---:|:---:|:---:|
| `TODAY'S BOARD` - 12 countable squares, no figure | ① | ● | | |
| `YOUR BOARD` - the same squares + `5/12` | ① | | ● | |
| `YOUR TIME` | ① | | | ● |
| `CLOSED IT` - who has closed **this case** (or "Nobody yet - be the first") | ① | ● | ● | |
| `FASTEST` - this case's best time, then WHO holds it: a `You` tag, or `u/name` | ① | | | ● |
| ‖ `CURRENT STREAK`, or `CASES CLOSED` once the run has ended | ③ | ● | ● | ● |

The cell about you appears only above zero, so a docket is **two or three cells** - never four, never five. Three is what the 320px feed slot draws, so **the strip is now complete on a phone in every state** rather than truncated, and dec. 93's four- and five-band type ladder has been deleted with the counts that reached it.

**`0/12` is not printed** (dec. 95). Before the first move that fraction is the same value for every reader - it cannot differ, so it carries nothing - and it phrases the screen's opening line as a verdict on the reader. The squares stay, keyed to the case rather than to the player: they are countable, which is the only thing the fraction was adding, and they are what makes the feed's first screen show *what the game is* before anyone has pressed anything.

**The room's cell counts this case** (dec. 103, revoking dec. 96's two-form cell). It used to have two subjects and a hidden switch: `SOLVED TODAY` carried the day board from ten solvers up and `DETECTIVES` carried the all-time community below it, and the reader was never told the population had changed under them. The owner met it as *"DETECTIVES 8 считает не тот кейс"* - and he was right twice over, because 8 was everyone who had ever closed anything. The card is one case's cover page, so the count is that case's, in every state, from `zCard(lb:{postId})`. Two consequences: the threshold goes with the swap (`ROOM_MIN` gated a change of *subject*, not a change of precision), and the all-time community leaves this card for the surface that owns world ③ and for the all-time board's own footer, where a titled board makes `detectives` unambiguous. Zero is still a sentence rather than a figure (dec. 37) - and on a fresh case that sentence is the better hook.

**`FASTEST` appears only once you have solved** (dec. 103, completing dec. 97). Adjacency is what makes a second time figure a benchmark rather than a stray clock; with no time of your own on the card it is a stray one. When the best time **is** yours the cell prints the figure with a filled `You` tag beside it - the ledger's own mark for "this row is you" - rather than the word `Yours`, which withheld the very number the cell exists to state. It used to carry `of N`, the size of the field; that was deleted in track 12 (dec. 112): on a 375px phone the band is ~93px and the figure, the tag and `of 7` do not fit on one line, so the field size ran into the next cell and the owner photographed a streak of `4` and a `7` reading as one number. The name replaces it on its own line, clipped with an ellipsis at Reddit's 20-character maximum. It is also the better fact - a headcount says how many you beat, a name says who to beat.

**A streak counts CASES closed on the day they ran** (dec. 123), not calendar days you came back. The archive still counts as cases closed and still scores points; it simply does not build the chain — 160 archive cases made a day-unit streak farmable, which is the hole the owner found. A day the sub published nothing does not break a run: there was nothing to miss. Every surface says "cases", including the rank ladder's rungs, because a figure whose unit changed silently is the same defect as a label over the wrong population.

**A streak is two numbers, and cases closed is a third** (dec. 100/102). `streakBest` is the rank-bearing one - the STREAK board, the subreddit flair and the result sheet's ladder all read it - `streakCurrent` is the run in progress, and `casesSolved` counts cases rather than days: the whole archive in one sitting is ten cases and one day. Three questions, three words, never one word over two figures.

The splash carries **one** cell about you, because the phone strip draws three cells in total. It is `CURRENT STREAK` while a run is alive - that is the one at risk tonight - and `CASES CLOSED` once `streakCurrent` has gone to zero, which since agent T's repair is a fact ("the run is over") and not missing data. Without the swap a veteran who missed a day met a card with nothing of theirs on it. Both are drawn only above zero: a zero there is "nothing recorded yet".

**The brief changes world with the player's state** (dec. 104). Before you play, the two lines under the title explain the case in front of you - the rule of the game, then `tierTechnique(tier)`, what *this* case asks of you. Once you have closed it that explanation is spent, and the question that replaces it is the owner's: *"если уже решил, интересно посмотреть кто за что проголосовал, какой следующий кейс будет тяжелее или легче"*. So the same two lines become world ②: the countdown and what the vote is doing to the next case's level, with the raw tally on the wide layout. That is also what buys the docket its clean split - the countdown and the vote are a sentence rather than two more cells, so no world ② figure has to stand inside a world ① strip.

Every branch is gated on what the vote can actually **do**. Below `VOTE_MIN_TOTAL = 5` it moves nothing at all, so the honest line states the tally and how far it is from mattering, never a verdict:

| Vote state | The line reads |
|---|---|
| no votes | `Next case in 3h 07m. Nobody has voted on how hard it should be yet.` |
| below the gate | `Next case in 3h 07m. 2 of 5 votes in on how hard the next one should be.` |
| enough votes, no clear lead | `Next case in 3h 07m. 7 votes in and no clear winner, so the level stays at Easy.` |
| decided, and the level can move | `Next case in 3h 07m. The vote is sending it up to Medium.` |
| decided, but the level cannot move | `Next case in 3h 07m. The vote says harder, but there is no harder case to serve yet.` — and at the bottom, `…and Easy is already the easiest level.` The ladder the **vote** walks is `LEVEL_TIERS`, sized from what is in the bank, and it is **not** the three-point scale the tier stamp prints beside it: with no 🔴 cases in the bank it tops out at Medium, so naming Medium "the end of the ladder" would contradict the `LEVEL 2 OF 3` on the same card |
| an archive case | the countdown alone - its vote steers nothing, and saying otherwise would invent an outcome |

**The docket is a ruled ledger, not a stack of boxes** (dec. 90). The cells split the column equally and centre their own content. The first cut laid them out with `space-between`, which puts every gap *after* a figure - a caps key, a number, then a hole down to the next hairline, three times over. That is what the owner was looking at when he said the screen still had a lot of empty space in it, and it is a layout defect rather than a missing logo: `assets/banner.png` is the pre-D3 navy/orange palette, and its largest element is the word already set as the wordmark 60px above it.

**How big the figures are is a function of how many bands there are** (dec. 93). `renderDocket()` writes the count onto the docket as `data-n`, and splash.css sizes the figure from it - 26px at three bands, 21px at four, 17px at five, one notch down each in a 320px slot and another below 300px. Equal bands only look generous while the column has slack to spend: at five bands in the feed slot each is ~44px and a 26px figure over an 11px key does not fit twice over. A band that does not fit here neither clips nor scrolls, because `html`/`body` are pinned to `overflow: hidden` - the next band's key is simply painted over the figure above it, in silence, which is how this shipped.

**The card stops stretching above 440px of viewport height** (`max-height: 420px`, centred). Nothing in production renders this document taller than the 320px `regular` slot, so dec. 74's "the card is the slot" is untouched where it applies; the cap only stops a cover page from becoming a title, a button and a hole if something ever does.

Under the one-sentence rule sits **what this case asks of you** - `tierTechnique(tier)`, the sentence dec. 86 moved off the stamp. From 560px only: below that the single column is already full and the sentence would push the CTA down.

```
 <560px (the phone feed slot)         >=560px (desktop feed)
┌──────────────────────────────┐     ┌───────────────────────┬────────────┐
│ D E D U C T O    ┌─────────┐ │     │ D E D U C T O         │ ┌────────┐ │
│ CASE #47         │ MEDIUM  │ │     │ CASE #47              │ │ MEDIUM │ │
│ The Cursed Pizza │LEVEL 2/3│ │     │ The Cursed Pizza      │ │LEVEL2/3│ │
│                  └─────────┘ │     │                       │ └────────┘ │
│ Cross out what the clues     │     │ Cross out what the    │TODAY'S BOARD│
│ rule out - the last one left │     │ clues rule out - the  │ □□□□□□□□□□ │
│ in a cell is the answer.     │     │ last one left in a    │────────────│
│┌──────────┬────────┬────────┐│     │ cell is the answer.   │ CURR STREAK│
││TODAY'S   │CURRENT │SOLVED  ││     │                       │ 3          │
││BOARD □□□□│STREAK 3│TODAY 14││     │ Some steps need two   │────────────│
│└──────────┴────────┴────────┘│     │ clues linked through  │ SOLVED     │
│┌─────────────────┬──────────┐│     │ a value they share.   │ TODAY      │
││Open the case fil│ Standings││     │ ┌────────────┬──────┐ │ 142        │
││   ABOUT 3 MIN   │          ││     │ │Open the cas│Standi│ │────────────│
│└─────────────────┴──────────┘│     │ │ ABOUT 3 MIN│      │ │ FASTEST    │
│                              │     │ └────────────┴──────┘ │ 02:41      │
└──────────────────────────────┘     └───────────────────────┴────────────┘
```

**Two buttons, and only two** (dec. 98). The standings used to be reachable only by opening a case and finding an icon in the board's control rail - which the owner met as *"you can't bloody get to it"* - and dec. 84 kept a button off this screen because the standings lived in a separate post, which dec. 85 then deleted. Still exactly **one filled** button: the second is a secondary sized to its own label rather than to half the row, so the weight on the card still says which of the two it is for.

There is one expanded entrypoint, so `Standings` opens the same `game` document; what tells that document which screen to come up on is a one-shot note in the origin's storage ([handoff.ts](../src/client/handoff.ts)). It has to be storage: `requestExpandedMode(event, entry)` takes an entrypoint *name* and the host builds the destination URL out of `devvit.json`, so the splash cannot put a hash or a query on it, and expanding replaces the document, so memory is not a channel either. Both entries are files under `post.dir` and therefore share an origin. `sessionStorage` carries a same-context document swap; `localStorage` carries a web view that is destroyed and rebuilt - so both are written, both accesses are guarded, and a note that never arrives is not an error: the board opens, with the standings one tap away in its rail.

**Opening the standings does not start your run.** `GET /api/daily` is what stamps `startedAt` and consumes the first-run tutorial flag, so on this path it is not called at all - the table paints from `GET /api/leaderboard` alone, and the daily is fetched by the press that asks for a board. Verified against the built bundles in a real browser rather than argued: `plans/assets/proto/09-splash-hub/handoff.sh`.

The **case number is the splash's one red mark**: on the splash the identity is the message, and in the game the state is, so there the same component renders in ink. The tier stamp beside it is achromatic like every other tier stamp (dec. 77) - it used to be red as part of the same block, and it does not need to be.

The CTA reads **Open the case file · ABOUT 3 MIN** / **Continue** / **See results** depending on your state; the sub-label is spent only on the estimate, because the other two repeated a docket figure 40px under it (dec. 99). Counters come from `GET /api/preview` - a light endpoint that carries no clues, no grid and no solution, and must not have `/api/daily`'s side effects (it may not consume the first-run tutorial flag nor stamp `startedAt`). A fact with no number behind it is simply not printed (dec. 37): if nobody has solved it yet the cell says so instead of showing a zero.

The difficulty mark is the same four-rung ladder the board uses, from [tiers.ts](../src/client/tiers.ts) - the text of a stamp rather than a coloured circle (dec. 63). Since **dec. 86** it carries a word and a fraction, not an ordinal:

| Tier | Stamp | Weight | The sentence it hands to the splash |
|---|---|---|---|
| `tutorial` | `WARM-UP` | `--ink-3`, 1.5px | Over-clued on purpose: every move follows straight from a single clue. |
| `green` | `EASY` · `LEVEL 1 OF 3` | `--ink-3`, 1.5px | Every move follows from one clue and what you have already marked. |
| `yellow` | `MEDIUM` · `LEVEL 2 OF 3` | `--ink-2`, 2px | Some steps need two clues linked through a value they share. |
| `red` | `HARD` · `LEVEL 3 OF 3` | `--ink`, 4px double | The clues may not force every cell - a guess can be needed. |

Two attempts at this mark failed on the same reader, and neither failed because of the *rung*: an ordinal with no denominator is not a scale, and a player meets one case a day, so they never see the neighbouring rungs to infer it from. `TIER II / LINK TWO CLUES` (dec. 77) answered the wrong half and answered it in the imperative, which reads as an instruction for the next tap. What a stranger can use with nothing else on screen is a word that is **already ordered in English** and the fraction that supplies the scale. The technique sentence is not deleted - it is a sentence, so it goes where there is room for one (the splash, above) and stays in the stamp's `title`.

The warm-up is deliberately off the numbered ladder: dec. 43 keeps `tutorial` out of `DAILY_TIERS`, so "level 0 of 3" would name a rung that does not exist. One map, both entrypoints - the splash and the board cannot disagree about what a mark means, and an unknown tier still gets no mark at all rather than a guessed one.

## Screen 1. The board

A ruled form. One DOM for every width: the suspect name stacks above its cells on a phone and sits beside them from 720px, and the chips stay square at every size (`aspect-ratio: 1`, shrinking before they ever overflow).

**The clue list is one column, except between 540px and 899px, where it is two - numbered down each
one** (dec. 87). 1-6 on the left and 7-11 on the right, not 1,2 / 3,4 / 5,6: a clue is a sentence
you read and come back to, so the eye wants a column to finish rather than a row to sweep. Below
540px the panel is one column and from 900px it is a 250-330px sidebar, so the band is written out
rather than left to `auto-fit` - and 540px is exactly where `auto-fit, minmax(260px, 1fr)` used to
break, so no breakpoint moves. The row count is explicit (`--clue-rows` = ceil(clues / 2), set by
`renderClues()`) rather than reached with `column-count`, because a multicol box that runs out of
room grows an **overflow column sideways**, and this list lives inside `overflow: hidden`.

Row height is the elastic dimension: `data-density` steps `normal / dense / tight / tightest` at
10 / 12 / 14 clues. The fourth step exists because the bank holds one **15-clue green** case - a
daily - on which the list ran +10px past its own box at 375×667 and +16px at 360×800 (dec. 92).

```
┌────────────────────────────────────────────────┐
│ CASE #47  The Cursed Pizza      [ EASY  ]      │
│                                 [LEVEL 1/3]    │
│ ■■■□□□□□□□□□ 03/12  TIME 04:31 ‖ STREAK 3     │
│ YESTERDAY u/x in 02:41 · 7 solved it           │
├────────────────────┬───────────────────────────┤
│ CLUES  2 SAT · 8 OPEN │  COAT   TIME   ITEM    │
│ ┌1┐ The pizza was…  │ □ John  RBGP 09.. 🍕..   │
│ ┌2┐ The keyboard w… │ □ Mira  RBGP 09.. 🍕..   │
│ …all clues, always… │ □ Paul  RBGP 09.. 🍕..   │
│ ▌HINT 1 OF 1 · REV… │ □ Omar  RBGP 09.. 🍕..   │
│                     │ TAP A CANDIDATE TO RULE  │
│                     │ IT OUT · THE LAST ONE…   │
├────────────────────────────────────────────────┤
│ ↶ ↺ ?              Warm-up  Hint  [See results]│
└────────────────────────────────────────────────┘
```

**Progress is countable, not a bar.** 12 hollow `--rule-strong` squares that fill with `--ink`, plus `NN/12` in mono tabular. The clue count moved to where the clues are: the panel head carries the tally `1 CONTRADICTED · 3 SATISFIED · 6 OPEN`, and the contradiction count is the only part of it in red (dec. 65).

**The HUD's two worlds are divided, not interleaved** (dec. 103). Progress and the clock are this case's; the streak is the run you are protecting across every case you have ever played. It used to sit *between* the two case meters - the same interleaving the docket had, in miniature - and now stands after a `--rule-strong` divider, the same signal the docket uses. A rule rather than a label: the strip shares a 30px bar with the case number, the title and the tier stamp, and a word would cost more than it explains. **The bare word `STREAK` is reserved product-wide for the run in progress**; any surface showing the best ever qualifies it (`LONGEST STREAK`, the board title `Longest streak`).

**The epilogue is read live** (dec. 107). `YESTERDAY u/x in 02:41 · 7 solved it` used to be the previous case *as it stood at the moment the next one was published* - two figures frozen into `postData` and never refreshed, under a sentence in the present tense, so every solve after publication was invisible to it. The epilogue now carries the previous case's `postId` and the two figures are re-read from `lb:{prevPostId}`; posts published before that field existed keep the frozen ones, which are then the only ones there are.

**Clue status is shape before anything else** (mobile and desktop alike):

| Status | Rendering |
|---|---|
| open | hollow number box, text in `--ink-2` |
| satisfied | number box filled `--ink-3` with a `--sheet` numeral; text muted and struck through |
| contradicted | 3px `--stamp` left rule, number box filled `--stamp`, row on `--stamp-wash`, text at full `--ink`, plus the literal line **"Contradicted by the board"** |

Note the direction: satisfied clues *recede*, and the contradicted one is the only clue at full ink strength. On paper you cross off what is done and circle what is wrong.

**The board.** Column heads and row heads are recessed into `--groove`, and every cell is bounded by a `--rule-strong` line - the board is a ruled form, and drawn in the decorative `--rule` it was a 1.48:1 hairline you had to take on faith (dec. 72). A chip that is ruled out keeps its hue at wash strength so you can still see *what* was crossed out, keeps its letter, and takes a 2px `--strike` at −38°.

**The sole survivor in a cell is boxed in a 4px ink frame** (dec. 76) - `border-color: --ink` plus `box-shadow: inset 0 0 0 2px --ink, 0 0 0 1px --ink`. This is the most important thing the board ever says, and the first cut said it with a 2px outline at 2px offset, which cannot work at this size: a phone chip is 26-28px with a **3px** gap to its neighbour, so a ring drawn outside it lands in that gap and merges with the neighbouring chip's own border. There is no room outside the chip, so the mark goes inside it, where the chip owns every pixel - four times the mass of any other line on the board, pure `--ink` on all four coats and on paper alike, for 3px of glyph box. It also leaves `outline` to `:focus-visible`, which is the only thing that should own it.

**A suspect is closed** when the 10px box beside the name goes from hollow to filled `--ink`, the name goes to 700, and the name strip takes an inset `--ink` bar - three non-colour channels, no green frame, no flash, no tick glyph (dec. 69/76).

Each chip is a real `<button>` carrying `aria-pressed` (dec. 73): it takes the keyboard, it shows the ink focus ring, and under a pointer its border goes to `--ink` - the one hover channel that reads on a saturated coat fill as well as it does on paper. A closed case drops the cursor and the hover with it.

**One line under the board**, and it is a **caption** - sentence-case sans in `--ink-3`, not 11px mono caps (dec. 79). It carries the two things that are true whether or not anyone asked:

- *nothing to report* - "Tap a chip to rule it out. The last one left in a cell is the answer.";
- *conflict* - "**1 clue** now contradicts the board - it is marked in the list.", at full ink.

Both are statements about the board. The third line that used to share this slot - "no forced move left, link two categories" - is a verdict on a **technique**, which is an answer to a question, so it moved into the hint slip where a player goes looking for one. Four different things speaking in the same voice, in the same place, at the same size is what made the owner ask "is that a hint too? I don't understand the point of this text" (dec. 79).

Two models answer "is anything forced right now", and they are ranked. [forced.ts](../src/client/forced.ts) is a client-side WEAK model (naked/hidden singles + one pass over each clue - exactly what a 4×3 board can express) and costs no round trip. `adviseOnGrid` in [engine.ts](../src/server/engine.ts) runs the same model exactly and answers through `/api/hint`. **Whenever a server verdict exists for the board on screen it wins**, keyed by a signature of the grid itself, so one move retires it; `forced.ts` is the fallback in between. Since dec. 79 the ranked verdict decides what the **stall nudge offers** rather than what the caption says. Measured over the whole bank on a *fresh* board, the two agree 160/160 - and neither reports "stuck" on a single case, tutorial, green or yellow. That matters for the wording: a 🟡 board is not empty of moves at the start, it runs out of them at the WEAK fixpoint some minutes in, so neither the nudge nor the hint ladder may greet a new player with "there is nothing to do here".

Controls sit on a recessed strip along the bottom edge. All four icon buttons answer the pointer the same way - a `--groove` ground and full ink. **Start over used to answer in red** and was read as a rendering fault twice (dec. 91); the warning it was trying to give is now given at the moment it is real, by `[data-armed]`: for the 2.5 seconds the two-tap confirm is live the button carries full ink, an ink border and a filled ground, which is the heaviest a control in this system ever gets. There is no red anywhere in the chrome, in any state.

Left: four ghost icon buttons - **Undo**, **Start over**, **How to play**, **Standings** - drawn as inline SVG at `stroke-width: 1.6`, never emoji (`⏱` without VS16 rendered as tofu in the legacy Firefox webview; SVG cannot); Standings picks up a visible label from 720px, where the bar has the room for it. Right: **Warm-up** (a named entrance, not a ▷ glyph) and **Hint**, both secondary. The filled **See results** button appears only once the case auto-closes - so "filled = the case is closable" is earned rather than decorative, and it is the only filled button on the screen. On a replayed solve the warm-up lane steps aside for it rather than crowding a 360px row. There is no "Check solution" button: the case closes itself once all 12 cells are deduced and every clue is satisfied. The solution and the timer live only on the server (anti-cheat).

## Screen 1a. The hint ladder

**Hint** opens a slip and immediately takes the free first rung - three buttons, each with its price written on it, because an unlabelled free hint is a hint nobody presses:

| Rung | Button | Cost | What the server returns |
|---|---|---|---|
| 1 | Which clue works | free | the clue number, nothing else |
| 2 | What it rules out | free | clue + cell + the value to cross, and what it leaves behind |
| 3 | Reveal a cell | costs 1 | an answer, counted on the result screen |

The server (`adviseOnGrid`) answers one of five verdicts and the client phrases all five: **move** (a clue still bites on its own), **cross** (a set of clues that bites only read together - the 🟡 rung, and when two of them share a value the message names it), **contradiction** (your marks argue with clue N, or with each other), **stuck** (nothing is forced anywhere), **done** (every cell is down to one candidate). Revealed cells stay in a reviewable log behind the panel's pager; reviewing costs nothing.

**A press always changes the screen** (dec. 88). The rule is stated as an invariant because the alternative - "make sure this particular pair of messages differs" - leaves the next identical pair to be found by the next player:

> **No enabled rung can be pressed without something changing.**

Three mechanisms hold it up, all keyed to the board itself, so one chip retires all of them:

- the rung whose sentence is in the slip is marked `ON SCREEN` and disabled - pressing it again could only reprint what you are reading;
- a free rung that came back `stuck` is marked `NOTHING HERE` and disabled, drawn with a dashed border: it has nothing left *on this board*, which is a fact worth printing rather than a silence to sit in;
- the rung being asked shows `ASKING…` and the ladder locks while the request is in flight - on a real connection that gap is where "I pressed it and nothing happened" starts.

`adviceText()` takes the rung as an argument, so the two free rungs cannot print the same sentence: step 1 names the clues, step 2 names the consequence, and where there is no consequence to name, step 2 says what is left instead of repeating step 1. This came out of the owner pressing both free rungs on a 🟡 board, where the WEAK model forces nothing (dec. 42: 69 of 100 yellow cases force 0 of 12 cells), and getting two identical repaints.

**Where the slip lives** (dec. 78, reversing dec. 66). It is **absolutely positioned inside the board area** and floats over it: opening a hint moves nothing - not a clue row, not the epilogue, not the panel head. `data-anchor` docks it at the top or the bottom of the board, whichever end is *not* the suspect the hint is naming, so it can never cover the cell it is about. With four rows and a slip at most half the board's height, the opposite end is always clear.

Dec. 66 had put it in flow for that same reason - "a hint that says *clue 4 rules out 09:00 for Mira* is useless while covering the board it is talking about" - and in flow it came out of the **clue list's** height budget instead. Measured on the over-clued 14-clue case, `#clue-list` overflowed its own box by **+80px at 375×667, +31px at 360×800 and +5px at 393×852**, and with `overflow: hidden` that is a clue you cannot see and are never told about. Both placements had the same class of bug; only one of them also moved the clues under the reader.

It is still a margin annotation - `--sheet-raised`, a 3px `--ink-3` left rule, `--shadow-1`, no hue at all. **And it is a small document**, so it has a head rail and a body (dec. 73): the rail is `--groove` with the caps label on the left (`HINT`, `HINT 2 OF 3 · REVEALED`), the panel's own tool next to it (the pager, or the "N revealed" button, or "first two are free"), and the dismiss `✕` on the same baseline at the right.

**The slip is the hint ladder's and nothing else's** (dec. 79). It used to be the outlet for every message the game had - "Board cleared", the help paragraph, the warm-up blurb, the stall nudge - which is exactly how four unrelated things came to look like one. Acknowledgements are a floating toast now; the nudge is its own bar.

**The nudge.** After 3 minutes of play with 90 seconds and no new cell, the server sets `nudge` on its reply to the autosave. Every input to that decision - active time, when the board last gained a cell, whether the offer was already made - lives on the server; the client only shows the offer. It shows it as **a bar on the bottom edge**: one short line, a `Show me` button and a `✕`. It is the only thing on this screen that arrives without being asked for, so it is the only thing that looks like an interruption.

## Screen 1b. The first-run ladder

A brand-new player gets a card over the board before anything else: **Start the warm-up** / **Skip to today's case**. The warm-up is a `tutorial`-tier case where every move is forced, labelled `WARM-UP 1/15`, isolated from the daily (its own saved grid, no leaderboard, no streak, no hints).

**Solving one ends in a second card, not a timer** (dec. 82): a `WARM-UP SOLVED` stamp, the headline "That is the whole mechanic", and two buttons - **Open today's case** / **One more warm-up**. The pool holds 15 and rotates, so the second offer is a different case. Before this, the screen printed a grey plaque and jumped to today's case 1.3 seconds later, which is roughly how long it takes to notice the plaque exists.

The offer is server-flagged (`meta.showWarmup`) and self-closing: finishing one warm-up or pressing skip (`POST /api/practice/skip`) retires it for good. A guest cannot be tracked, so the server always offers it and the client remembers the answer for the session - which is also why leaving the warm-up re-fetches `/api/daily` instead of reloading the document.

## Screen 2. Result

A screen of its own (`body[data-view="result"]`), painted as a **raised sheet of the same file** - one step up the elevation ladder, same paper, same ink - not a light card floating over a dark board and not a scrolling modal (dec. 48/59). A `CLOSED` stamp sits top-right and is the screen's one red mark; nothing else on it carries a hue.

**Four groups, not nine** (dec. 80). The owner counted the blocks on the shipped version - hero, three facts, tabs, list, your row, vote, vote bar, envelope, two buttons - and that is the shape of "lots of text, lots of small details" more than contrast ever was. What is here now, top to bottom:

- hero, **world ①** (dec. 105): the kicker is `CASE #47 · YOUR 9TH` - a cross-world link that turns a case number into a position in your own run of them, and the reason `CASES CLOSED` no longer needs a cell of its own; then your time at 34px mono, carrying a filled `Your best` tag when this solve beat your own record; then the serif line, **scoped to this case**: `2nd fastest of 7 on this case`, or `Faster than 68% of 142 on this case` once the field can carry a percentage (`PCT_MIN = 50`), or - with no row on the case board - `You're the 3rd detective to close this case`, which is a different measure and so a different sentence. What the solve cost rides the same line, where the ledger already puts it: ` · 1 cell revealed`, and only when there is one. That line used to switch between a percentile over the **day** and a finishing order over the **case** depending on `hasHistogram` - one sentence, two subjects, chosen by a threshold no reader can see, which is the same defect as the splash's old room cell one press away. Both branches now measure one thing and the threshold chooses only how precisely to state it; the day keeps every figure inside the block that is titled with the day. This is one of the system's exactly two serif uses;
- two facts in a ruled strip - **CURRENT STREAK** and **LONGEST STREAK**, caps key over a mono figure - and under it **the rank ladder** (dec. 89). The strip is **world ③ and nothing else** (dec. 105): it used to run `HINTS · CASES CLOSED · CURRENT STREAK · LONGEST STREAK`, two worlds in one ruled row drawn identically, with nothing to say the subject changed halfway along. The two world ① figures moved into the hero above, which leaves exactly the pair the ladder needs - `N DAYS TO CHIEF INSPECTOR` is counted from the CURRENT run, and without that number beside a longest run of 12 the distance reads as an error (dec. 100). A `Your file` button closes the block, because everything else about you is one press away (Screen 2c): all five rungs on a rail, 🔎 1 · 🕵️ 3 · 🎩 7 · 🧠 14 · 🏛 30, with your rung framed in `--ink`, the rail behind you drawn in ink and ahead of you in `--rule-strong`, and a head reading `RANK Inspector` · `4 DAYS TO 🎩 CHIEF INSPECTOR`. `RANK Detective · 2 DAYS TO INSPECTOR` named a rung and a destination and drew neither the ladder nor your place on it. The emoji are content, not chrome - the block is *about* the rank - and they are never the only channel: the frame, the filled rail and the ink day-figure carry position with the glyphs missing entirely. Hero and facts sit 8px apart because they are one group ("what you scored"); every other gap on the sheet is 20-24px, and that 6× ratio is what does the grouping the hairlines could not;
- **Standings** - four real boards behind a `Today / Week / Streak / All-time` rail, each straight from `GET /api/leaderboard` (dec. 75): TODAY ranks by solve time and prints each row's hint count, WEEK and ALL-TIME by points, STREAK by the longest run of daily solves. The rail is the heading; "Standings" written above a tab reading "Today" above a table was three labels for one block. The list scrolls **inside its own box** - four rows is what the sheet can spare - and your row is pinned under it **only when it is not already on screen** (dec. 81). `See all 142` carries the size of the board so the note beside it does not repeat it;
- **Tomorrow's case** - the countdown rides the heading (`#48 opens in 7h 12m`) instead of a dashed envelope of its own, then the Harder / Same / Softer vote. The vote bar (**solid · hatched · empty** with printed percentages) appears only **after** you vote: before that it is the answer to the question the three buttons are asking. The bar's percentages sit **inside its segments** since dec. 113 - a segment under 18% keeps the shape and drops the label - and the separate text legend is gone: a picture and a caption saying the same three numbers competed, and `SOFTER 0%` spent a third of a row on nothing. On an **archive** case the distribution is drawn all the same, with the reason on screen: this case is closed, so its vote sets no level and the live case's does. How this case's solvers voted is a real answer even where it decides nothing; what must not be claimed is the consequence.

Under it, **what the vote has actually done** (dec. 104): a three-segment bar with printed percentages reads as a result, and below `VOTE_MIN_TOTAL = 5` the vote moves the difficulty by exactly nothing - on this subreddit it collects two. So the line says `5 votes decide the level - 2 so far.`, or names the level the vote is sending the next case to, from the server's single definition of "decided" - the same one the publisher acts on and the feed card prints, so no two screens can promise different tomorrows;
- footer: **Full solution** (ghost) + **Play this case again** (secondary). No filled button - after a solve the primary act is to leave, and the vote is the thing worth touching.

**The clue list scrolls when the density ladder runs out** (dec. 111). `.clue-panel` clips and `.clue-list` is a bounded scroller. Before track 12 it was neither: a flex item squeezed below its content height, on a page pinned to `overflow: hidden`, paints straight through whatever is under it - which is how clue 12 of a 12-clue case ended up under the board's COAT/TIME/ITEM header on the owner's iPhone. The ladder still makes the scroll rare; it is simply no longer the only thing between a long case and an unreadable screen.

**The histogram is drawn from 860px only.** It is a picture of the hero's own sentence, it costs a heading, a chart and an eight-label axis, and it was already hidden below 700px of height for exactly that reason. From 860px the sheet is two columns and the left one has room it would otherwise waste, so that is where it lives: hollow `--groove` bars, your bin filled `--ink`, a `YOU` label under the axis, shown only when the server reports `hasHistogram` (N ≥ 50).

**Full solution is the sheet's second face**, not a section stacked under the others (dec. 68): pressing it swaps histogram + standings + vote for the final table, and back. Inline it cost ~150px, which is exactly what pushed the result past the bottom of a 393×852 and a 360×800 phone - and with `overflow:hidden` it was cut off silently.

There are no synthetic numbers on this screen: the sample histogram and demo leaderboard were deleted (dec. 50). Discussion of the reasoning happens in the native comment feed under the post.

## Screen 2a. Result - guest

A guest solve records nothing, so `/api/check` answers `{status:"solved", guest:true, results:null}` and gets its own screen (`body[data-view="guest"]`) rather than an empty result card: **Case closed**, the time from your own clock, one paragraph saying plainly that there is no time on the board, no rank and no streak, and what logging in changes. The primary button calls `showLoginPrompt()` from `@devvit/web/client`; the secondary goes back to the board. No invented streak, rank or percentile (dec. 37/44).

The screen's **one red mark is a `NOT RECORDED` stamp** where the result screen carries `CLOSED` (dec. 67) - red is the mark made *on* the file, and on this screen the single true statement is that nothing was written down. The three things logging in would count are listed against the same hollow box the board uses for an unsolved suspect: they are boxes waiting to be ticked.

## Screen 2b. Standings, inside the game

`body[data-view="standings"]`, reached from the **Standings** button in the control bar - so a
player who has not solved anything, and is not a moderator, can still study the table (dec. 75).
Head rail with a back arrow and the board's own title, a recessed line saying what the board ranks
by, the four tabs, the list, your pinned row when it is not already visible, and a footer with
`Top 20 of 142 · scores settle overnight` and a way back.

**Both of those lines are new wording, and both were failures of the same kind** (dec. 83). The
recessed line used to be 11px mono caps on one line with `text-overflow: ellipsis`, so at 360px
`EVERY CASE SINCE DAY ONE · POINTS = SPEED MINUS…` ended mid-formula - the explanation went
missing exactly where it was needed. It states the arithmetic now, in sentence-case sans, wrapping
to two lines: *"Every case since day one. 500 points a case, more for speed, 60 off per hint
(300-1000)."* And `provisional` used to render as **"still running"**, which is the name of the
field rather than what it means to a player; it says **"scores settle overnight"** instead.

It is a **screen**, never an overlay: [02-gameplay.md](02-gameplay.md) forbids a leaderboard over a
case you are still solving, so it opens only on an explicit press and closes straight back to
wherever it was opened from - the board, or the result sheet if you arrived through `SEE ALL`.
Escape closes it too. The board is untouched underneath; nothing is saved or lost by looking.

The list is the only scrolling element in the whole client, and it scrolls **inside its own box**
with `overscroll-behavior: contain`, so the page itself still cannot move - which is the actual
Featuring requirement.

**A row is full-bleed and its text is inset, never the other way round** (dec. 94). Your row is
marked with three non-colour channels - a `--groove` ground, a 3px inset `--ink` bar and a printed
`YOU` tag - and the ground has to run to the panel's own edges, because every band above it on the
screen does: the recessed meta line and the tab rail's rule are both full width. The 12px gutter
used to sit on the *list*, which pushed the rows in, and the fill then stopped exactly on the last
glyph of the figure it was highlighting - `1 u/ma9leb YOU … 830 pts` with the ground ending at the
`s`. The gutter is now `--row-pad` inside the row (12px on this screen, 4px in the block on the
result sheet), so the fill, the hairline under it and the ink bar all reach the edge while the
text keeps its inset. The one gap that remains is a desktop scrollbar's own 12px, which a phone's
overlay scrollbar does not take.


## Screen 2c. Your file

`body[data-view="me"]`, from `GET /api/me`. **The whole of world ③ - you in this community, all time - in one place** (dec. 106, [docs/11-stats-ia.md](11-stats-ia.md) §5).

It exists because that world had no home. The case is a post and the day is the feed, but "you here" was smeared across screens belonging to a case and to a day - a streak in the corner of a case card, points in someone else's table, a rank in a subreddit flair - and **a figure with no home takes the nearest one**. `DETECTIVES 8` sitting on a case's cover page was exactly that. It was also already planned and never built (`plans/04-leaderboard.md` (internal) §D.4, *"профиль игрока - по тапу на имя в таблице… Дёшево (данные уже есть)"*).

Nothing here is a new measurement. `user:{username}` has carried `solved`, `totalPoints`, `bestTimeSec` and `firstSeen` since the leaderboard shipped, and `lb:days:{username}` the day-by-day history - **read by no screen until now**.

It reuses the standings' frame on purpose (`.stsheet` / `.st-head` / `.st-foot`): the two screens are the same act of looking something up in the same archive, and a second chrome would say they were different files. What differs is the body - ruled fact strips and the rank ladder rather than a ranked list, because a file is not a race.

| Strip | Cells | The question |
|---|---|---|
| what you have done | `CASES CLOSED` · `DAYS SOLVED` · `SINCE` | *how much have I done here, and how long have I been?* |
| how you are doing | `CURRENT STREAK` · `LONGEST STREAK` · `BEST TIME` | *am I on a run, what is my record, how fast have I been?* |
| where you stand | `POINTS` · `PLACE 3 of 8` | *where am I among everyone?* |
| the ladder | the same five rungs as the result sheet, from the same `rankState()` | *what rank do I hold, and what is next?* |
| recent days | the last 14: date · points | *have I been keeping it up?* |

`CASES CLOSED` and `DAYS SOLVED` are deliberately separate figures: `user:{name}.solved` counts **days with a solve** while `streak:{userId}.cases` counts **cases**, and a two-case day makes them differ. `PLACE` prints its denominator, which is the only figure on the screen that is not about the reader - and printing it as a denominator is what keeps it from becoming another `DETECTIVES 8`.

**`CURRENT STREAK` is drawn at zero here and nowhere else.** This is the surface that owns the run, so "it is over" is one of the things it exists to say; on every other surface a zero would be "nothing recorded yet" and the cell swaps or hides instead.

**Nothing recorded is a state, not a row of zeros**: every counter here is seeded going forward, so an empty file says *"Nothing recorded yet - close a case and this file starts."* A solve with no resolvable username gets the honest version of the same sentence, and no invented figures (dec. 37/44).

**Two ways in**, both places a reader is already looking at themselves: **your own row in any standings list** (or the pinned row under it) - plan 04's own entry point - and the **Your file** button under the result sheet's rank ladder. Somebody else's row is deliberately inert: what is public about a player who never opted into a profile is a product decision of a different shape, and nobody has asked for it. The extension is one parameter when somebody does.

Deliberately **not** an entry point: the splash. The docket draws three cells and the CTA row already fights for two buttons; a third would cost more than it returns, and the Standings button reaches the file in two taps.

## Onboarding

Two rungs, both server-flagged and both self-closing:

1. **The warm-up card** (`meta.showWarmup`) - see screen 1b. If they take it, the coach marks run on the warm-up board, where every move is forced; if they skip, on today's case.
2. **3 coach marks** (`meta.showTutorial`) over whichever board they landed on (clue list → a chip → the progress ticks), skippable in one tap, with the timer paused until they end. The ring is `--ink` at 2px, not a coloured highlight, and the cut-out is the same `--scrim` the first-run card uses.

"Seen" is tracked server-side per logged-in user - no localStorage, it is unreliable in the webview. `?tut=1` forces the whole ladder (judges/testing) and `?tut=0` suppresses it.
