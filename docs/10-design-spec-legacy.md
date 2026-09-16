> **SUPERSEDED (2026-08-07).** This is the dark-navy system that shipped for the hackathon.
> The live design system is [10-design-spec.md](10-design-spec.md) (D3 "Manila").
> Kept only as the record of why the old values were what they were.

# Deducto redesign design spec (implemented in src/client/index.html + main.ts)

Synthesis of 4 studies (daily-games, dark-a11y, Devvit, type/spacing) and 4 audits (color, type-size, hierarchy, mobile). All contrasts recomputed via WCAG relative luminance on real backgrounds.

Core principles (unchanged): the grid dominates; dark navy + soft amber accent #ff8c42 (do NOT switch to #FF4500 - taken by Reddit's system UI); green = confirmed, red = impossible/violated; mobile priority (tap-only, iOS webview); a single self-contained HTML; do not touch JS logic, keep DOM changes minimal (classes/wrappers).

> **Update (2026-07-07):** the community loop (topic vote / submit suspect / deduction card for sharing) and the alternative "Tabs" board view have been removed from the prototype; the only remaining view is the single board. The directives below that relate to them (poll/submit/viewswitch/tab/cell/red-soft) are **historical**, read them as audit context, not as tasks. Separately: the tomorrow block later returned, but now as an honest difficulty vote Harder/Same/Softer (`r-tomorrow`/`renderVote`) - it is live (see item 16), this is NOT a topic poll.

---

## 1. Design tokens

### 1.1 Color (declare in `:root`, replace hardcoded values with var())

**Surfaces - "higher = lighter" elevation ladder (Material principle, no shadows):**

| Token | Hex | Role | Contrast |
|---|---|---|---|
| `--surface-0` | `#0b101e` | page background (formerly --bg); also styles.backgroundColorDark in Devvit | base |
| `--surface-1` | `#131a2e` | panels: board frame, clue-panel, casebar (formerly --panel) | - |
| `--surface-2` | `#1a2340` | cells, cards, inputs, tabs (formerly --panel-2) | - |
| `--surface-3` | `#1f2846` | hover, result modal, elevated elements | muted holds 4.73:1 - ladder limit |
| `--surface-sunken` | `#10162a` | clue container, controls bar (formerly hardcoded) | - |

Do not go lighter than `#1f2846`: on `#222c4e` muted drops to 4.46:1.

**Text - exactly 3 steps (collapse the 4-gray scale, EXCLUDE `#566083` from text roles):**

| Token | Hex | Role | Contrast |
|---|---|---|---|
| `--text` | `#e8ebf5` | primary | 15.93:1 on surface-0, 12.98:1 on surface-2 |
| `--text-2` | `#c6cbdc` | clue text, table values, poll percentages | 9.55:1 on surface-2 |
| `--muted` | `#8b93ab` | captions, counters, hint text, footer, grid-help | 6.20/5.65/5.05/4.73 on L0-L3 - AA everywhere |
| `--on-accent` | `#0b101e` | text on ANY colored fill (orange/green/red/yellow/blue) | 8.20:1 on orange, 8.38 on green, 6.21 on red, 13.16 on yellow |

`#566083` is allowed only as decorative graphics with no meaning. White text on colored fills is forbidden (on red 3.05:1 - fail, on yellow 1.44:1).

**Borders:**

| Token | Hex | Role | Contrast |
|---|---|---|---|
| `--border` | `#26304f` | decorative dividers (1.33:1 - legal only as decor) |
| `--border-strong` | `#39466e` | borders of interactive grid cells (visibility, not state) |
| `--border-active` | `#6b76a0` | border = the sole indicator of state/interactivity | 3.89:1 on surface-1 - passes SC 1.4.11 |
| `--border-hover` | `#5f70ad` | hover borders of cells/chips | ~3:1 |

**Accents:**

| Token | Hex | Role | Contrast |
|---|---|---|---|
| `--orange` | `#ff8c42` | ONLY primary CTA (fill), brand echoes (logo, CASE #N), progress | 7.48:1 on surface-1 as text |
| `--orange-dim` | `#b35a20` | non-text only: state borders/fills (3.62:1 - forbidden as text) |
| `--green` | `#35c46f` | confirmed: ✓, st-ok num, yes cells | 7.64:1 on surface-1 |
| `--red` | `#ff5a5f` | ONLY errors: violated clue, err-toast, warn-hover | 5.66:1 on surface-1 |
| `--red-soft` | `#c96b6e` | ~~routine ✕ cross-out in "Tabs" mode~~ - **removed along with "Tabs" mode** |
| `--strike` | `#6b7590` | chip strike-through line in "Single board" | 3.05:1 against chip background #202a4c |
| `--blue` | `#4f9cff` | focus-visible outline, info-toast | 6.20:1 on surface-1 |
| `--purple` | `#a78bfa` | tomorrow block | 6.35:1 |
| `--yellow` | `#ffd166` | EXCLUSIVELY hint semantics (hint-box, hint-target) | 11.99:1 on surface-1 |

**Semantic backgrounds (move hardcoded into tokens):** `--hint-bg #241d10` (yellow pair - hint only), `--ok-bg #123524` + `--ok-border #1f6b40`, `--err-bg #241012` + `--err-border #5e2326`, `--info-bg #10223a`.

**Flairs (Okabe-Ito, CVD-safe):**

| Token | Hex | Role | Contrast |
|---|---|---|---|
| `--flair-r` | `#D55E00` | Red (vermillion) | 4.47:1 on surface-1 |
| `--flair-b` | `#56B4E9` | Blue (sky blue) | 7.49:1 |
| `--flair-g` | `#009E73` | Green (bluish green) | 5.05:1 |
| `--flair-p` | `#CC79A7` | Purple (reddish purple) | 5.65:1 |

The red/green and blue/purple pairs are distinguishable under deutan/protan (unlike the current emoji: dist 54 and 27 against a threshold of ~60). Do NOT use OI blue `#0072B2` and Tol red `#CC3311` - on surface-2 they drop below 3:1.

### 1.2 Type scale - 7 steps, integer px, all via var()

| Token | px | LH | Role (replacements) |
|---|---|---|---|
| `--fs-2xs` | 11 | 1.2 | ONLY uppercase micro-labels with letter-spacing .5-1px, weight 600+: panel headings, hint-tag, badge, .by, .cnt (10/10.5 → 11) |
| `--fs-xs` | 12 | 1.5 on wrap | captions, counters, grid-help, footer, sub (11.5/12 → 12) |
| `--fs-sm` | 13 | 1.45-1.5 | base: CLUES, cells, result table (12.5/13 → 13) |
| `--fs-base` | 14 | 1.2 (flex centering) | buttons, case title, panel names (13.5/14/15 → 14) |
| `--fs-md` | 17 | 1.2 | column icons, large numbers, cell marks (17/21 → 17… the ✕/✓ mark may be 20) |
| `--fs-lg` | 20 | 1.2 | logo, h3 hero of result stats (20/21 → 20) |
| `--fs-xl` | 24 | 1.2 | h2 of the result screen |

Base: `body { font-size: 13px; line-height: 1.45; }`. Special off-scale exception: `@media (pointer: coarse) { .submit-row input { font-size: 16px } }` - otherwise iOS auto-zooms the page on focus. `font-variant-numeric: tabular-nums` - on the timer, counters, poll percentages, result stats.

### 1.3 Spacing - 4pt grid

`--sp-1: 4px; --sp-2: 8px; --sp-3: 12px; --sp-4: 16px; --sp-5: 24px; --sp-6: 32px`. 2px is allowed as a micro-gap. Mapping of current values: 3,5→4; 6,7→8; 9,10,11→8/12; 13,14→12/16; 18→16; 22,26→24; border-spacing 5→4. Panel padding: 16px desktop / 12px mobile.

### 1.4 Radius - 4 tokens + nesting rule

`--r-s: 8px` (chip-m, tab, viewswitch, HUD chips; 9→8), `--r-m: 12px` (cell, bcell, btn, toast, poll-opt, input, card; 10→12), `--r-l: 16px` (board frame, result modal; 18→16), `--r-pill: 999px` (diff, s-chip, clue number instead of 50%). Nesting: inner = outer - padding (cards inside the modal at outer 16px and padding 24px → corners --r-s or 0, not 12px).

### 1.5 Touch/misc

Minimums: buttons min-height 44px; clue rows min-height 44px on touch; expand tap targets <44px with `@media (pointer:coarse) { .x { position:relative } .x::after { content:''; position:absolute; inset:-8px } }`. Give all interactives `touch-action: manipulation`. Globally `:root { color-scheme: dark }` (dark UA scrollbars/checkboxes), `:focus-visible { outline: 2px solid var(--blue); outline-offset: 2px }`, `body { overflow-x: hidden }` (safeguard).

---

## 2. Colorblind flairs: what the chip looks like

Replace the bare emoji 🔴🔵🟢🟣 with a CSS chip (`chipLabel` for flair, index.html:732; grid :770-784):

- Circle (30×30 base / no smaller than 30 on mobile), background - the flair color from Okabe-Ito (`--flair-r/b/g/p`).
- Inside - **the letter R / B / G / P**, weight 700, `--fs-sm`, color `--on-accent #0b101e` (dark letter on all four - all backgrounds are light, contrast ≥4.5:1). The letter is the primary channel: the flair names are already Red/Blue/Green/Purple, it works under any type of CVD and in grayscale.
- In clue text the emoji may stay (there the word "red flair" is nearby - duplication already exists), or replace it with the same 14px inline chip for consistency.
- In the "Investigation summary" table - chip + word, `white-space: nowrap`.

**Struck-out chip state (critical, fixes P0):** opacity `.55` (not .3), **remove `grayscale`** entirely - color+letter must stay recognizable; move the strike-through line out from under opacity: draw it as a pseudo-element on the `.bcell` parent or set a direct color `--strike #6b7590`, 2px, without inheriting transparency (3.05:1 against the chip background). Result: it is visible WHAT is struck out and WHICH flair it is.

---

## 3. Component changes

### P0 - blockers (mobile breaks or an action is unavailable)

1. **Grid, mobile scroll** → `.grid-wrap { justify-content: flex-start }` in the MQ (currently center + overflow clips suspect names UNREACHABLY, scrollLeft max 66 of 132); pin the names: `th.rowh { position: sticky; left: 0; background: var(--surface-1); z-index: 2 }`. On desktop, center via `table { margin: 0 auto }` (auto margins collapse on overflow). Scrollbar: `scrollbar-width: thin; scrollbar-color: var(--border) transparent` + webkit equivalent (height 6px) - removes the white system bar. Clipping affordance: right edge-fade `mask-image: linear-gradient(90deg, #000 calc(100% - 18px), transparent)`, remove via class when scrolled to the end.
2. **Header/HUD mobile** → `.top { flex-wrap: wrap; row-gap: var(--sp-1) }`, `.brand .sub { display: none }` in the MQ, `.hud { width: 100%; justify-content: flex-end; gap: 6px }`, chips `padding: 4px 8px; font-size: var(--fs-xs)` - currently the HUD overflows by 110px past the edge and hides progress and hints.
3. **Confirmation without right-click (iOS tap-only)** → for `pointer: coarse` add long-press (pointerdown + ~450ms → applyMove(...,2), cancel on pointerup/pointermove) and/or a tap cycle `· → ✕ → ✓ → ·` in "Tabs" mode; substitute the grid-help text via `matchMedia('(pointer:coarse)')`: "tap - cross out · tap the pulsing one - ✓" (one line), removing "right-click". This is a minimal JS edit of input handlers, not logic.
4. **Struck-out chips of "Single board"** → see section 2: replace opacity .3+grayscale(.9) (line contrast 1.43:1, chip vs background 1.02:1) with opacity .55 without grayscale + `--strike` line outside opacity + letter in the chip.
5. **CVD flair chips** → see section 2 (letters R/B/G/P on Okabe-Ito backgrounds).

### P1 - hierarchy, readability, touch

6. **Orange = CTA only.** The only orange-filled button on the game screen is "Check case". The "CLUES" heading → `--muted` uppercase `--fs-2xs`; `.tab.active` → background `--surface-2` + orange text + 2px bottom border `--orange` (instead of a fill that duplicates the CTA); accent-color of the assistant checkboxes → `--muted`; active viewswitch → background `--surface-2`, border `--border-active`, text `--text` (currently it shares the warm pair #2a2312+yellow with hint semantics). CASE #N stays orange - a brand echo and the ritual issue number.
7. **CTA state = progress indicator** (Connections pattern): until the board is 12/12 - "Check case" in a muted state (fill `--orange-dim`, text `--on-accent`, cursor default is acceptable - this is not disabled in the WCAG sense, but behave as now); at 12/12 - full `--orange` fill + a light pulse. Only a CSS class driven by the already existing counter.
8. **Controls: button hierarchy.** Primary = "Check case" (filled `--orange`, text `--on-accent`, min-height 44px). "Hint" = secondary (`--surface-2` + 1px `--border-active`). "Restart", "Undo" = ghost (transparent background, text `--muted`); red on "Restart" - only on hover/confirm. Mobile: `.controls { flex-wrap: wrap; position: sticky; bottom: 0; z-index: 5; background: var(--surface-sunken) }`, primary `flex: 1 1 100%; order: 1; padding: 12px` (full width as the bottom row = a large tap zone), the three utility ones - side by side above, `white-space: nowrap`.
9. **Viewswitch + assist: demote to a dev panel.** Wrap both blocks in a single `.devbar` row with a "⚙ playtest" prefix, `opacity: .6`, `font-size: var(--fs-2xs)`, dashed border `--border`; move it BELOW the grid (or collapse it behind a ⚙ icon that expands on click). Wrap the checkboxes in a label with padding ≥6px (tap on the text). The clickable state keeps ≥3:1 - we mute via the group's opacity, not text color. Currently they sit above the grid, louder than the category headings, and on mobile grow into 62px tiles.
10. **Clue panel.** Clue text → `--fs-sm` 13px, line-height 1.45, `--text-2`; row padding 10px 12px (row ≥40px), on touch min-height 44px. Statuses: st-ok - `opacity: .68` (4.9:1 instead of 3.67) + `text-decoration: line-through` in `--muted` color (a non-color duplicate); st-bad - dark text `--on-accent` on a red badge (6.21:1 instead of white 3.05) + a red left strip on the row (mirror of hint-target). Bring back the legend as one `--muted` 12px line: "🟢 satisfied · 🔴 violated · tap - highlight on the board". Tip `#566083` → `--muted`. Mobile: `max-height: min(34vh, 260px)` instead of 150px + bottom fade-hint + thin dark scrollbar; clue tap-highlight - toggle (a second tap removes it) with a visible `.pinned` border; disable the mouseenter logic on a coarse pointer.
11. **The grid dominates.** Cells `.bcell/.cell`: border `--border-strong #39466e` (currently 1.19:1 - the board is indistinguishable from the panel), hover border `--border-hover`; center the grid vertically (`align-items: center`), grid-help - right under the table, not at the bottom edge (removes the ~70-160px dead zone). Confirmed cell: keep the collapse into a large green chip with ✓ (Cross Logic canon), the ✓ and border hold ≥3:1 on the cell background. Do NOT shrink chip-m to 26px on mobile - keep 30×30, gap 6px, hit-area up to ~44 via a pseudo-element; horizontal scroll with sticky names and edge-fade is an honest pattern.
12. **Casebar.** Diff badge "medium-light": free up the yellow for hint - `color: var(--muted); background: transparent; border-color: var(--border)`. Mobile: one line, `padding: 8px 12px`, `.case-title { font-size: var(--fs-sm) }`, hide diff. CASE #N - large, the ritual identity of the issue.
13. **HUD priorities.** Progress - visually senior: value in `--orange` color or a mini chip fill 0→12; errors in red only when >0; timer - last, muted. Do not bring back labels - icons+numbers are enough (genre canon: pictograms, not words).
14. **Hint-box.** Appearance: fade+slide 200ms + a single flash of the `--yellow` border; after clicking "Hint" - `scrollIntoView` to the block (the "button at the bottom → block at the top" route is unsupported by anything). The yellow pair #241d10+#ffd166 is hint-exclusive.
15. **Footer note.** `#566083` (2.8:1) → `--muted`, shorten to "🔒 Voting opens after you solve", one `--fs-xs` line. **[removed]** - the footer note has been removed from the game screen (see Iteration 3); do not bring back the topic-vote teaser.
16. **Result screen - hierarchy flip.** Hero block: "Case closed!" `--fs-xl` → large time + percentile ("faster than 46% of detectives") `--fs-lg` with a green/orange accent (the main share stat). "Close" → ghost; in the result card the only filled/primary button is "↺ Play this case again". Collapse the solution table into `<details>` (the player just saw the solved board) - **implemented** (`.final-wrap` = `<details>` "Full solution"). Countdown "next case in HH:MM" as a reason to return - **implemented** (`r-next`, "Opens in Xh Ym"; when data is missing - a placeholder based on local midnight).
> **[removed]** The community-loop parts of this item are cut: the share CTA "Post to comments" (`.deduction-actions`), the topic poll before the vote (`.pct`, voted/mine border), and the nickname submit input (UGC). The only live post-solve vote is the honest difficulty vote Harder/Same/Softer (`r-tomorrow`/`renderVote`); it is neither a topic poll nor a share.
17. **Intermediate width 761-899px.** `.clue-panel { width: clamp(240px, 32%, 292px) }` - currently the fixed 292px leaves the grid 435-570px when it needs ~540, and horizontal scroll appears even before the mobile breakpoint.
18. **Tabs ("Tabs" mode).** `.tab .cnt` - remove opacity .75 on the inactive one (pure `--muted` = 5.05:1); tab height on mobile ≥40px (padding 10px 14px). Struck-out cell ✕ → `--red-soft` (currently the saturated red screams like an error and by mid-game the board is "all red"; bright `--red` - only st-bad/toast).

### P2 - polish

19. **Toast.** err/ok/info backgrounds via tokens `--err-bg/--ok-bg/--info-bg`; mobile `bottom: 12px; max-width: calc(100vw - 24px)` (do not cover the result buttons).
20. **Overlay.** `overscroll-behavior: contain` + `body { overflow: hidden }` on show (remove in btn-close) - the background does not scroll under the modal.
21. **Focus/keyboard.** Global `:focus-visible` in blue (does not conflict with orange/red semantics); interactive cells eventually → `<button>` (out of current scope, record in docs/09).
22. **Unknown mark "·"** → `#454f75` (an intentionally empty state, but a bit more visible than 1.45:1).
23. **Summary table** → `.final td { white-space: nowrap; font-size: var(--fs-xs) }` in the MQ (the emoji does not wrap away from the word).
24. **Micro-feedback instead of text** (as feasible, CSS-only): shake the cell on a contradiction, a short scale on confirmation - the legend text gradually moves into the "?" modal.
25. **Verification:** after edits, run a deuteranopia emulation (DevTools → Rendering) on three states: empty grid, baseline-mid, result. Apply fixes to index.html AND _shot.html in sync (the MQ is offset: index 289-300 = _shot 310-321; index has no .assist/.hovered/.forced - do not lose them in the merge).

---

## 4. What NOT to do (anti-goals)

- **The "Single board/Tabs" viewswitch and "Tabs" mode are REMOVED** (user decision 2026-07-07): the board beat tabs in playtests, one view remains. The audit items above about demoting the viewswitch/devbar and the assistant toggles are historical; there is nothing left to demote into a dev panel. (The earlier directive "do not remove as a playtest tool" is rescinded.)
- **Do not change the game's JS logic** (generation, checking, scoring). The permitted JS minimum: input handlers for touch (long-press/tap cycle, toggle clue highlight), grid-help text substitution, scrollIntoView, overlay scroll locking.
- **Do not switch to Reddit orange #FF4500/#D93900** - differentiating from the system upvote UI is an advantage.
- **Do not fill large areas with orange** - the accent is pinpoint (CTA, progress, brand echo).
- **Do not use `maximum-scale`/`user-scalable=no`** to fight iOS zoom - only 16px on the input.
- **Do not shrink tap targets for the sake of "fitting without scroll"** - a 30px chip + hit-area + honest horizontal scroll is better than 26px chips.
- **Do not express state by color alone** - each one (✕/✓/flair letter/line-through/"!") is duplicated by a sign or shape.
- **Do not introduce a fifth gray-text step or fractional font-sizes** - 3 text tokens, 7 scale steps, integer px.
- **Do not make routine cross-out red** at the same intensity as an error - saturated `--red` is exclusive to violations.
- **Do not remove the emoji from clue text** - there they are duplicated by a word and work.
- **Rollout order:** first declare tokens in `:root`, then a mechanical value replacement (a logged decision for docs/09-design-decisions.md), then component changes P0→P1→P2; after each block - a screenshot comparison against baseline.

## Palette (final tokens)

| Token | Hex | Role | Contrast |
|---|---|---|---|
| `--surface-0` | `#0b101e` | Page background (formerly --bg); backgroundColorDark for Devvit | base of the elevation ladder |
| `--surface-1` | `#131a2e` | Panels: board frame, clue-panel, casebar | muted 5.65:1, text 14.9:1 |
| `--surface-2` | `#1a2340` | Cells, cards, inputs, tabs | muted 5.05:1, text 12.98:1 |
| `--surface-3` | `#1f2846` | Hover, result modal, elevated elements | muted 4.73:1 - the limit, do not go lighter |
| `--surface-sunken` | `#10162a` | Clue container, controls bar | muted 5.9:1 |
| `--text` | `#e8ebf5` | Primary text | 15.93:1 on surface-0 |
| `--text-2` | `#c6cbdc` | Clue text, tables, poll percentages | 9.55:1 on surface-2 |
| `--muted` | `#8b93ab` | Captions, counters, grid-help, footer (replacing the illegal #566083) | 4.73-6.20:1 on L0-L3, AA everywhere |
| `--on-accent` | `#0b101e` | Text on any colored fill (orange/green/red/yellow) | 8.20:1 on orange, 6.21:1 on red, 13.16:1 on yellow |
| `--border` | `#26304f` | Decorative dividers | 1.33:1 - decor only, not an indicator |
| `--border-strong` | `#39466e` | Grid cell borders (board visibility) | ~2:1, duplicated by the surface-2 fill |
| `--border-active` | `#6b76a0` | Border indicator of state/interactivity | 3.89:1 on surface-1 - passes SC 1.4.11 |
| `--border-hover` | `#5f70ad` | Hover borders of cells and chips | ~3:1 on surface-1 |
| `--orange` | `#ff8c42` | Only primary CTA, progress, brand echo (CASE #N, logo) | 7.48:1 on surface-1 as text; not Reddit #FF4500 |
| `--orange-dim` | `#b35a20` | Non-text only: muted CTA fill before 12/12, borders | 3.62:1 - forbidden as text |
| `--green` | `#35c46f` | Confirmed: ✓, yes cells, st-ok | 7.64:1 on surface-1 |
| `--red` | `#ff5a5f` | Only errors: violated clue, err-toast, warn-hover | 5.66:1 on surface-1; text on it - dark only |
| `--red-soft` | `#c96b6e` | ~~Routine ✕ cross-out in "Tabs" mode~~ **removed along with "Tabs" mode** | - |
| `--strike` | `#6b7590` | Chip strike-through line in "Single board" (outside opacity) | 3.05:1 against chip background #202a4c |
| `--blue` | `#4f9cff` | Focus-visible outline, info-toast | 6.20:1 on surface-1 |
| `--purple` | `#a78bfa` | Tomorrow block | 6.35:1 on surface-1 |
| `--yellow` | `#ffd166` | Exclusively hint semantics (hint-box, hint-target) | 11.99:1 on surface-1; take it away from the diff badge and viewswitch |
| `--flair-r` | `#D55E00` | Flair Red (Okabe-Ito vermillion), chip with letter R | 4.47:1 on surface-1; CVD-safe pair with --flair-g |
| `--flair-b` | `#56B4E9` | Flair Blue (sky blue), chip with letter B | 7.49:1 on surface-1 |
| `--flair-g` | `#009E73` | Flair Green (bluish green), chip with letter G | 5.05:1 on surface-1 |
| `--flair-p` | `#CC79A7` | Flair Purple (reddish purple), chip with letter P | 5.65:1 on surface-1; distinguishable from --flair-b under protan/deutan |
| `--hint-bg` | `#241d10` | Background of hint-box/hint-target (warm pair with --yellow) | yellow on it 11.6:1 |
| `--ok-bg` | `#123524` | Background of ok-toast and yes states | green text ≥5:1 |
| `--err-bg` | `#241012` | Background of err-toast | red text ~5.7:1 |
| `--info-bg` | `#10223a` | Background of info-toast | blue text ≥5:1 |

---

## Deviations during rollout (after verification, 4 agents in round 2)

- **The CTA is always filled** `--orange` (not "outline until 12/12 → fill"): the "--orange-dim fill + dark text" variant does not pass 4.5:1 for 14px text, and the outline variant read as secondary. The 12/12 state is conveyed only by the `readypulse` pulsation; behind the modal the animation is disabled (`body.modal-open`).
- **The flair chip strike-through line** - scoped `#99a1b8` (instead of the global `--strike #6b7590`): on 30% flair mixes `--strike` gave 2.07-2.65:1; `#99a1b8` gives ≥3.69:1 on all four.
- **Added the token `--fs-2xl: 28px`** for the result hero stat (the 28px hardcode legalized into the scale).
- **The glyph ⏱ (U+23F1)** without VS16 renders as tofu in Firefox/webview - in the HUD it is replaced with `⏱️` (with VS16), and the icon is removed from the hero stat.
- **Struck-out glyph**: opacity .6 (not .55 from the spec) - so that struck-out time digits hold ~4.45:1.
- **The "clue → board" tap-highlight is deliberately NOT implemented**, though the spec required it: the board-highlight mechanic was removed by playtest (decision log, dec. 10) as confusing. Recorded as an open question in [09-design-decisions.md](09-design-decisions.md).
- **The unknown mark `#454f75`** (1.93:1) is left deliberately quiet - a designed "no data" state.

---

## Iteration 2 (2026-07-07, per user decisions)

**Inline mode (game in the feed, Devvit tall 512px).** `@media (max-height: 720px)`: header+casebar+controls are fixed, `.main` scrolls inside (thin dark scrollbar); clues fill their panel in the two-column layout, in stacked - a 26vh window; devbar and footer are hidden; the 720px threshold closes the 620-720 zone where the CTA went below the fold.

**Light result card** (reference - r/ColorPuzzleGame): local token overrides in the `.result` scope (`#fff` background, text `#1c2437/#3c4660/#5f6b84`, green `#147a43` ≥4.5:1, blue focus `#2563eb`, light toasts on `modal-open`, hover darkening instead of lightening). The card fits a 900px viewport without scrolling: stats in one line + PB/world (mock), a histogram, a collapsed summary, closing via ✕/Esc/click on the background, re-entering a solved case reopens the card. **[removed]** from the list above, the deduction card, 2×2 poll, submit input, and a set of retention CTAs (community-loop/share) are cut; of the live post-solve, only the difficulty vote remains.

**Solve-time histogram** (designed per the dataviz method): one series, bars ≤22px with a 4px gap and a rounded top; neutral `#6b7590`, player bar `#d9631e` (validator: contrast ≥3:1 on white, CVD ΔE 67.6); labels selectively - "you" and the peak (when they coincide - both); label text in ink tokens, not the series color; tooltips on the bins. Data - mock `TIME_BINS`, in prod - from the server.

**Touch addition:** long-press on a board chip shows the candidate's name (replacing the desktop tooltip). Confetti on solve - one-time, disabled by `prefers-reduced-motion`.

---

## Iteration 3 (2026-07-07, "game only")

**Screen = post.** `.app` 700px, `.board` - height `min(512px, 100vh−16)` on desktop: by default the prototype looks like a Devvit post in the feed (reference - r/ColorPuzzleGame). The brand line, footer note, and status legend are removed from the game screen; the HUD is compressed to "✔ progress · ✖ errors (appears after the first) · ⏱ time" in the case line; the logo is 🧵 before CASE #N. Control instructions + legend - a toast behind the "?" button. Controls: ↺ ↩ ? - ghost icons, 💡 Hint - secondary (on mobile - an icon), CTA - the only filled one.

**Desktop 700×512 - no scrolling:** clue panel `clamp(210px,31%,240px)`, clue rows 12px/1.35 (all 10 visible), chips 24px (bcell 44px) - the grid fits into the remaining ~458px without horizontal scroll.

**Phone - no scrolling:** a new compact board render `renderBoardGridNarrow()` (switched via `matchMedia(max-width:760px)`, display-only): the suspect name above a row of three cells, total width ≤390px; columns are labeled once at the top. All clues + grid + controls fit entirely in 390×844. In the 390×512 feed preview the middle scrolls inside the post (26vh of clues) - the full view opens by expanding the post.

**Trade-off:** 24px chips are below the recommended 44px tap targets - compensated by an expanded invisible tap zone (::before) and the long-press name; revisit after a phone playtest.

---

## Iteration 4 (2026-07-07, auto-check)

**No "Check" and no errors.** `maybeSolve()` after every move: 12/12 filled in and matches the solution → `btn-hint` hides, "🏆 Results" appears, after 900ms - the result card (appearance slowed: overlay fade .5s + rise .55s). An incorrect full layout is not penalized in any way - the violated clues turn red on their own. The error counter is removed from the HUD, the mention of errors from the result stats and deduction card, and the error penalty from the percentile formula. The board shake animation is removed along with checking.

**Solved suspect row:** `.bcell.solved` - a permanent green border on all three cells of the row; `.just-solved` - a one-time `rowglow` flash (0.9s) at the moment of solving (tracked via the `rowsDone` set, reset on undo/restart); the ✓ by the name - a pop animation.

---

## Iteration 5 (2026-07-08, hackathon layer)

Full English + de-Reddit reskin (Coat/Item/Omar; "rank", not "flair"). New blocks: an epilogue line under the casebar; an onboarding coach (spotlight `box-shadow 0 0 0 100vmax` + tooltip, 3 steps); the result card: hero (percentile at N≥50 / ordinal at N<50, a single number with a histogram from the same buckets), a difficulty vote + a `CASE #N+1 [SEALED]` envelope with a ticker and countdown, a single ghost button "Play this case again". **[removed]** "Your trail" (the copyable path string / share-to-thread) is cut; the ①-④ suspect numbering remains only in the grid. There are no stub buttons or confirm(); server strings are assembled via textContent (`setRich`) - an XSS pattern for the port. The "day 2 / at scale" data playtest toggle - in the devbar below the post, hidden at inline height. Launch texts (pinned comment, templates, rank ladder) - docs/12-launch-content.md.
