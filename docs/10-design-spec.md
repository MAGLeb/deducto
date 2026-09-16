# Deducto design spec — D3 "Manila"

**Status:** this is the design system for the redesign (internal plan 03b, §B "visual direction",
decided 2026-08-07 — the `plans/` tree is gitignored and is not part of the published repo).
It **replaces** the dark-navy system that shipped for the hackathon. The old spec is preserved
verbatim in [10-design-spec-legacy.md](10-design-spec-legacy.md) — read it when you need to know
why an old value was what it was; do not implement from it.

**Reference implementation:** [10-design-spec-proto.html](10-design-spec-proto.html) — one file, no build,
no network, opens straight in a browser. Every rule below is live there. States are addressable:
`#s=<state>&t=<light|dark>&shot=1`.
States: `splash · game-empty · game-mid · game-violated · game-solved · result · board · load · error`.

It is the *reference*, not the *evidence*. Since the design landed, the screenshot matrix (§7) is
shot from the real built client against a fixture server; the prototype is kept for reading a rule
in isolation, and it does not carry the screens the spec never mocked (the standings ledger, the
coach tip, the hint ladder).

**Scope.** This document owns tokens, components and their states. It does **not** own the
entrypoint architecture, expanded mode, or the removal of inline scroll — that is plan 03a,
which lands first on the old tokens; this spec is applied on top as the third step.

---

## 0. The one idea

> **Colour belongs to evidence. Chrome is ink on paper.**

The interface is a case file: warm paper, ink, hairlines, stamps. The only hues that exist
are the four coats (Okabe-Ito) and one archive red. Progress, time, buttons, headings,
the board frame, the histogram, the leaderboard — all achromatic. That single rule is what
makes a colourful 4×3 evidence grid legible instead of noisy, and it is what makes the result
card live in the same world as the board (the old system's white-modal-over-dark-game
dissonance, decision №20, is gone by construction: there are no local token overrides anywhere).

Five consequences, all deliberate:

| | Old (navy) | D3 (Manila) |
|---|---|---|
| Semantic hues in chrome | orange, green, red, yellow, blue, purple | **none** — one archive red, used once per screen |
| "Confirmed" | green ring | circled in ink (`outline`) — CVD-immune |
| "Satisfied clue" | green badge | struck through + muted, number box filled ink-3 |
| Radii | 4 tokens, up to 18px | **2** — `0` and `2px` |
| Emoji in chrome | 🧵 ✔ ⏱️ 🔥 💡 🏆 ✉️ 🥇 | mono caps labels + 4 inline SVG line icons |

Item emoji (🍕 ⌨️ 🥄 📜) stay. They are content, they carry the puzzle's nouns, and they are
duplicated by position in a fixed column order.

**Anti-goals (hard).** No paper textures, no coffee rings, no paperclips, no photographic
shadows, no torn edges, no rotated "taped" cards. Skeuomorphism is rejected outright.
Paper is produced by three things only: the palette, the type pairing, and hairlines.
The single rotation in the system is the 3° tilt on `.stamp`, which is what makes a boxed
mono label read as a stamp rather than a badge.

---

## 1. Tokens

All contrasts below are WCAG 2.x relative-luminance ratios computed on the **actual** background
the token is used on. Method and script: §7. Thresholds: **4.5:1** for text (AA, normal size),
**3:1** for non-text boundaries that carry information (SC 1.4.11).

> **Revised 2026-08-08 — the surface ladder repair (decision 71/72).** §1.1, §1.2, §1.3, §1.4 and
> §1.6 below carry the current values; §1.5 is unchanged. What moved and why:
>
> | Token | Was (light) | Now (light) | Why |
> |---|---|---|---|
> | `--paper` | `#E7DFD1` | `#BEAD8C` | the desk was 1.18:1 under the sheet, so no card on it had an edge; it is now 2.00:1 under it, which is where a lightness step starts reading as a boundary |
> | `--sheet` | `#F6F2E9` | `#F8F4EB` | a hair lighter, to buy back some of the step |
> | `--sheet-raised` | `#FFFCF6` | `#FFFDF8` | same |
> | `--groove` | `#DBD2C1` | `#D9CFBA` | as deep as `--ink-3` at AA allows (the cap, stated below) |
> | `--rule` | `#D2C8B5` | `#BEB299` | 1.48:1 on the sheet is a hairline nobody can see; 1.91:1 is still decorative but the rows it divides read as rows |
> | `--rule-strong` | `#7E725C` | `#655B47` | it has to clear 3:1 on the darkened `--paper` too (3.04:1) |
> | `--stamp-wash` | `#EEE0D7` | `#E4C8BD` | recomputed at 22% `--stamp` over the new `--sheet` |
> | `--coat-*-out` | — | — | recomputed over the new `--sheet` (light) and the new dark `--sheet`; §1.6 |
> | `--shadow-1` | *deleted by dec. 57* | reinstated, one token | `--sheet-raised` is capped by white and cannot buy an edge with lightness; a printed drop can |
>
> Dark is re-cut on the same criteria, and `--ink-2`, `--ink-3` and `--stamp` are lightened there
> to keep AA on the raised sheet once it moves. §2 (contrast), §3 (CVD ΔE), §6 (the token mirror) and
> §7–§8 have since been re-transcribed from the shipped file and now agree with it. The source of
> truth is [tokens.css](../src/client/tokens.css); the reproducible run against it is
> `plans/assets/proto/04-polish/verify-contrast.py`, which also audits surface-to-surface pairs —
> the check whose absence let the original ladder through. Re-run it and re-transcribe §2/§3 on any
> token edit.

### 1.1 Surfaces — higher is lighter, in both themes

In light mode the page is the manila folder and panels are sheets laid on it; in dark mode the
same ladder runs from near-black upward. The direction never inverts, so elevation reasoning is
identical in both themes.

| Token | Light | Dark | Role |
|---|---|---|---|
| `--paper` | `#BEAD8C` | `#0A0907` | page ground (the folder / the desk) |
| `--sheet` | `#F8F4EB` | `#2A2419` | the primary surface: the case file, panels, board |
| `--sheet-raised` | `#FFFDF8` | `#3B3422` | raised: result sheet, hover, hint slip |
| `--groove` | `#D9CFBA` | `#16130E` | recessed strips: meter bar, controls, `th`, empty chip |

Four steps, not five. `--groove` is a *recess*, not a fifth elevation — it is always darker than
`--sheet`, which is why a control bar sitting in it reads as pressed into the page. In light mode
it is now *lighter* than `--paper`: the desk and a recess in a sheet lying on it are different
materials, and the ordering that matters is the one within the app (`groove < sheet < raised`).

**The two ceilings, because they decide the rest.** A surface that carries `--ink-3` as text at AA
cannot go below relative luminance .583, which floors `--groove` and caps `--sheet`/`--groove` at
**1.51:1**. `--sheet-raised` is capped by white, so `--sheet`/`--sheet-raised` can never pass
~**1.1:1**. Both of those pairs are therefore drawn with a `--rule-strong` boundary (and, where a
sheet genuinely floats, `--shadow-1`) rather than by lightness. Dark is tighter still: with
`--ink-3` and `--stamp` both needing AA on the topmost surface, all four dark surfaces live inside
luminance 0–.035 and no dark pair can exceed ~1.6:1. Dark spends its budget on lines instead,
where it has room light does not (`--rule` reaches 1.84:1 and `--rule-strong` 4.58:1 on the sheet).

**One rule follows from the darkened desk and it is not negotiable: nothing but `--ink` may be set
on `--paper`.** `--ink-2` is 4.43:1 there and `--ink-3` is 3.40:1 — fine as a boundary, short of AA
as text. No component does it, and the screenshot harness measures it on every frame it shoots and
prints any offender rather than trusting the rule (§7 — it reports, it does not fail the run, so a
human still has to read the `REPORT` lines).

### 1.1a Elevation — `--shadow-1`

```css
/* light */
--shadow-1: 0 1px 0 color-mix(in srgb, var(--ink) 16%, transparent),
            0 3px 8px color-mix(in srgb, var(--ink) 10%, transparent);
/* dark — same geometry, inverted ingredient */
--shadow-1: 0 1px 0  color-mix(in srgb, var(--paper) 70%, transparent),
            0 3px 10px color-mix(in srgb, var(--paper) 55%, transparent);
```

Reinstates the one thing decision 57 deleted wholesale, and only that: one hard offset and one
soft blur, mixed out of the theme's own darkest token, so the shadow darkens the paper the sheet is
lying on instead of adding a grey. Light mixes out of `--ink` at 16%/10% with an 8px blur; dark mixes
out of `--paper` at 70%/55% with a 10px blur, because on a near-black ground a 10%-of-white wash is
invisible — the drop has to deepen the surface below, not tint it. Same idea, inverted ingredient.

The anti-goal in §0 stands — this is a printed drop, not a photographic one, there
is no spread and no halo past the blur. Used **only** where a sheet floats over another surface: the
result sheet, the standings sheet, the app card and the ledger from 720px, the splash card, the
load/error card, the hint slip, the toast, the first-run card, the coach tip. Never on a
full-bleed phone layout — there is no desk under it to cast onto.

### 1.2 Ink — three reading steps and one inverse

| Token | Light | Dark | Role |
|---|---|---|---|
| `--ink` | `#1B1815` | `#F2ECE0` | primary text, filled CTA, "circled" ring, filled ticks |
| `--ink-2` | `#4A433A` | `#D2C8B5` | clue text, secondary values, ghost-button label |
| `--ink-3` | `#5C5446` | `#A89E87` | caps labels, captions, muted/satisfied text, outlined stamp |
| `--ink-inv` | `#FFFDF8` | `#16130E` | text on any ink fill |
| `--strike` | `#4A433A` | `#D2C8B5` | the pen stroke over a ruled-out candidate |

Light is unchanged. Dark moves up one notch across the board because `--sheet-raised` moved up:
`--ink-3` has to clear 4.5:1 on it (it does, at 4.65), and `--ink-2` follows so the three reading
steps stay three (1.41 and 1.60 between neighbours, against 1.57/1.79 before — tighter, and paid
for by surfaces that are actually distinguishable).

Exactly three reading steps. There is no fourth grey. `--strike` is `--ink-2`'s value but a
separate token because it lands on coat washes, not on paper (§1.6) — keeping it separate is what
lets the dark theme raise it without touching body text.

### 1.3 Lines

| Token | Light | Dark | Role |
|---|---|---|---|
| `--rule` | `#BEB299` | `#554D3D` | decorative hairline: row dividers only. **Carries no meaning.** |
| `--rule-strong` | `#655B47` | `#968B75` | structure + every control boundary: chips, secondary buttons, table head, **board grid**, panel heads, the sidebar edge, the facts strip, every `--groove` edge |

`--rule-strong` clears 3:1 on **all four** surfaces in both themes, so a boundary drawn with it is
always a valid SC 1.4.11 indicator wherever it lands. `--rule` never is — never use it to mark a
state or delimit a control, and never to separate two blocks (decision 72: the board grid drawn in
`--rule` was a 1.48:1 hairline, which is a grid you have to take on faith).

### 1.4 The accent — archive red

| Token | Light | Dark | Role |
|---|---|---|---|
| `--stamp` | `#9E2B1C` | `#E8886F` | the marks made *on* the file |
| `--stamp-ink` | `#FFFDF8` | `#16130E` | text on a solid stamp fill |
| `--stamp-wash` | `#E4C8BD` | `#483427` | background of a contradicted clue row |

The dark red is lighter than it was (`#E27A62` → `#E8886F`) for one measured reason: the `CLOSED`
stamp sits on `--sheet-raised`, and lifting that surface to give the result card an edge would
have taken the stamp to 4.4:1. It is 4.81:1 now. The washes are 22% of `--stamp` over `--sheet`
in light and 16% in dark — the dark alpha came down because the flag line is `--stamp` *on* the
wash, and at 22% that pair fell to 4.05:1.

**Rule of one.** Red appears **at most once per screen**, always meaning one thing on that screen:

| Screen | The one red mark |
|---|---|
| splash | the case stamp block — `CASE 047` + the tier stamp (identity) |
| game | the contradicted clue: left rule, number box, flag line |
| result | the `CLOSED` stamp (by definition no clue is contradicted here) |
| error | the `FILE UNAVAILABLE` stamp |

Consequence: the case number is **red on the splash and ink in the game chrome**. That is not an
inconsistency — `.casestamp` is one component with two variants, `hero` and `inline`. On the splash
the identity is the message; in the game the state is, and red must belong to the clue panel alone.
The only other red is `--stamp` on `:hover` of the destructive "start over" button — transient,
absent on touch.

### 1.5 Evidence — the coats (Okabe-Ito)

| Token | Light | Dark | Letter | Letter contrast |
|---|---|---|---|---|
| `--coat-r` | `#D55E00` | `#D55E00` | **R** `--coat-r-ink` `#100D0A` | 5.01:1 |
| `--coat-b` | `#0072B2` | `#56B4E9` | **B** light `#FFFDF8` / dark `#100D0A` | 5.10 / 8.40:1 |
| `--coat-g` | `#009E73` | `#009E73` | **G** `#100D0A` | 5.66:1 |
| `--coat-p` | `#CC79A7` | `#CC79A7` | **P** `#100D0A` | 6.33:1 |

Two deliberate asymmetries, both forced by the numbers:

- **Blue differs per theme.** Okabe-Ito's `#0072B2` needs a *light* letter (dark letter is 3.37:1 —
  fail) and is invisible as a fill on a dark sheet; the palette's own sky blue `#56B4E9` is right
  in dark but washes out on cream. So: `#0072B2` in light, `#56B4E9` in dark, and the letter ink is
  a per-coat token rather than a global one.
- **The letter ink is per-coat, not global.** Three coats take dark, blue-in-light takes paper.
  Forcing one letter colour on all four would break at least one of them.

### 1.6 Crossed-out washes

A ruled-out candidate keeps its hue at reduced strength so you can see *what* was crossed out —
the P0 the old spec kept failing. 22% coat over `--sheet` in light, 28% in dark.

| Token | Light | Dark |
|---|---|---|
| `--coat-r-out` | `#F0D3B7` | `#5A3412` |
| `--coat-b-out` | `#C1D7DE` | `#364C53` |
| `--coat-g-out` | `#C1E1D1` | `#1E4632` |
| `--coat-p-out` | `#EED9DC` | `#573C41` |

The letter on a wash is `--ink` (11.8–13.1:1 light, 7.7–9.2:1 dark) — see §3 for why the letter,
not the wash, is the identity channel. Recomputed 2026-08-08 over the moved `--sheet`; the
alive-vs-crossed state channel (§3's fourth table) is unchanged in light and holds
ΔE00 19.6–38.0 across every CVD type.

### 1.7 Type — three families, eight steps

```css
--font-sans:  -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
--font-mono:  ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
--font-serif: "Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia,
         "Times New Roman", serif;
```

No webfonts, no CDN — the Devvit webview is isolated and a failed font request is a layout bug.

| Family | Where | Never |
|---|---|---|
| **sans** | everything read as prose: clue text, buttons, suspect names, body | numbers you compare |
| **mono** | case numbers, time, counters, tallies, caps labels, stamps, table figures, column heads. Always with `font-variant-numeric: tabular-nums` | clue text |
| **serif** | **two places only**: the case title and the result hero subtitle | anything else |

The serif is the whole "dossier" signal and it costs nothing. It is deliberately confined to two
strings; a third use turns the file into a brochure. On Android the stack falls through to Noto
Serif and metrics shift ~1px — acceptable, because both uses are single lines with generous
leading, not multi-line copy.

| Token | px | LH | Role |
|---|---|---|---|
| `--fs-2xs` | 11 | 1 | mono caps labels, stamps, tallies, flag line (`letter-spacing: .12em`, weight 700–800) |
| `--fs-xs` | 12 | 1.4 | captions, table figures, meter values |
| `--fs-sm` | 13 | 1.4 | clue text, chip letters, dense UI |
| `--fs-base` | 15 | 1.5 | body, buttons, suspect names (14 at `max-height: 700px`) |
| `--fs-md` | 17 | 1.2 | case title, item emoji, fact values |
| `--fs-lg` | 21 | 1.2 | splash title on a phone |
| `--fs-xl` | 26 | 1.15 | splash title, result hero on short viewports |
| `--fs-2xl` | 34 | 1 | result hero time (mono, tabular) |

`--ls-caps: .12em` on every uppercase mono label. That letter-spacing is doing structural work —
it is what separates "a label" from "shouting", and it is why caps labels can be 11px and still scan.

### 1.8 Spacing — 4pt

`--sp-0: 2px` (micro only) · `--sp-1: 4` · `--sp-2: 8` · `--sp-3: 12` · `--sp-4: 16` ·
`--sp-5: 24` · `--sp-6: 32` · `--sp-7: 48`. No other values.

### 1.9 Radii — two

`--r-0: 0` · `--r-1: 2px`. Sheets, panels, table cells, the board, the envelope: **0**.
Chips, buttons, inputs, stamps, the `You` tag: **2px**. Nothing else. There is no pill, no 8, no 12,
no 16. Paper is cut, not moulded — and the flat corner is what makes the ruled grid read as a form.

### 1.10 Sizing

`--chip` — 44px ≥720px wide · 34px on a short wide viewport · 28px <720px · 26px on a short phone.
`--tap` — 44px, 40px on short viewports; the minimum height of every `.btn`.

---

## 2. Contrast table

**These numbers are read off the tokens that actually ship.** The source of truth is
[tokens.css](../src/client/tokens.css); the table below is transcribed from a machine run of
`plans/assets/proto/04-polish/verify-contrast.py`, which parses that file directly and feeds every
pair through [10-design-spec-wcag.py](10-design-spec-wcag.py). Nothing here is inherited from the
legacy spec, and exactly one row is computed outside the driver's own arrays — `--rule-strong` on the
coat washes (§2.3), with the same module. Full run:
[10-design-spec-contrasts.txt](10-design-spec-contrasts.txt) — tracked next to this file, so every
number in §2 and §3 is checkable from a fresh clone. Regenerated with

```bash
# ⚠ the DRIVER is internal tooling and is not in the public repo — see §7
python3 plans/assets/proto/04-polish/verify-contrast.py > docs/10-design-spec-contrasts.txt
```

after **any** edit to `tokens.css`; then re-transcribe §2 and §3. Current values: the surface-ladder
repair of 2026-08-08 (§1's revision note).

### 2.1 Surfaces — a floor per pair

The check whose absence let the first ladder through: text contrast was audited, surface-to-surface
contrast was not, so four surfaces sitting inside 1.09–1.46:1 of each other passed a full audit while
the result card had no visible edge. Each pair carries its own floor, set by how much work the
boundary has to do.

| Pair | Light | Dark | Floor | What draws the edge |
|---|---|---|---|---|
| `--paper` / `--sheet` | 2.00 | 1.29 ᶜ | 1.80 | 1px `--rule-strong` + `--shadow-1` |
| `--paper` / `--sheet-raised` | 2.16 | 1.61 ᶜ | 1.80 | 1px `--rule-strong` + `--shadow-1` |
| `--sheet` / `--groove` | 1.41 | 1.20 ᶜ | 1.35 | 1px `--rule-strong` on every groove edge |
| `--groove` / `--sheet-raised` | 1.52 | 1.50 | 1.35 | inset 3px `--ink` bar (your row); 1px `--rule-strong` (rail) |
| `--sheet` / `--sheet-raised` | 1.08 | 1.25 | 1.00 | capped by white — 1px `--rule-strong`, a 3px `--ink-3` left rule, `--shadow-1` |
| `--paper` / `--groove` | 1.42 | 1.07 ᶜ | 1.20 | 1px `--rule-strong` |

ᶜ **A cap, not a failure.** Dark cannot buy these steps: with `--ink-3` and `--stamp` both owing AA on
the topmost surface, all four dark surfaces live inside luminance 0–.035 and no dark pair can exceed
~1.6:1. Every capped pair names the line that carries the boundary instead, and the run refuses to
silently drop such a pair from the table.

### 2.2 Text — AA (≥4.5:1)

| Pair | Light | Dark |
|---|---|---|
| `--ink` on `--paper` | 8.03 | 16.92 |
| `--ink` on `--sheet` | 16.10 | 13.08 |
| `--ink` on `--sheet-raised` | 17.39 | 10.50 |
| `--ink` on `--groove` | 11.43 | 15.75 |
| `--ink` on `--stamp-wash` | 11.19 | 9.94 |
| `--ink-2` on `--sheet` | 8.88 | 9.28 |
| `--ink-2` on `--sheet-raised` | 9.59 | 7.45 |
| `--ink-2` on `--groove` | 6.30 | 11.18 |
| `--ink-3` on `--sheet` | 6.80 | 5.79 |
| `--ink-3` on `--sheet-raised` | 7.35 | **4.65** |
| `--ink-3` on `--groove` | **4.83** | 6.97 |
| `--ink-inv` on `--ink` (primary button) | 17.39 | 15.75 |
| `--ink-inv` on `--ink-2` (button hover) | 9.59 | 11.18 |
| `--stamp` on `--sheet` | 6.79 | 6.00 |
| `--stamp` on `--sheet-raised` | 7.34 | **4.81** |
| `--stamp` on `--groove` | **4.82** | 7.22 |
| `--stamp` on `--stamp-wash` | **4.72** | **4.56** |
| `--stamp-ink` on `--stamp` (solid stamp) | 7.34 | 7.22 |
| `--sheet` on `--ink-3` (satisfied clue number) | 6.80 | 5.79 |
| letter on `--coat-r` | 5.01 | 5.01 |
| letter on `--coat-b` | 5.10 | 8.40 |
| letter on `--coat-g` | 5.66 | 5.66 |
| letter on `--coat-p` | 6.33 | 6.33 |
| `--ink` on `--coat-*-out` (letter on a wash) | 11.82 – 13.13 | 7.71 – 9.23 |

**`--ink-2` and `--ink-3` on `--paper` are absent from this table on purpose.** The darkened desk puts
them at 4.43:1 and 3.40:1 in light — fine as a boundary, short of AA as text — which is exactly the
price the ladder repair paid. The rule that follows (*nothing but `--ink` on `--paper`*, §1.1) is not
left to discipline: the screenshot harness measures it on every frame it shoots and prints any
offender (`onPaper` in
`plans/assets/proto/04-polish/fixture-server.ts`).

The bold cells are the binding constraints. In light they are why `--ink-3` is `#5C5446` and not the
`#635B4F` the eye first reaches for — that one lands at 4.33:1 on the new `--groove`, a fail. In dark
they are what stops `--sheet-raised` at `#3B3422`: one step lighter and `--ink-3` drops under AA on it.

### 2.3 Non-text — SC 1.4.11 (≥3:1)

| Pair | Light | Dark |
|---|---|---|
| `--rule-strong` on `--paper` | 3.04 | 5.92 |
| `--rule-strong` on `--sheet` | 6.09 | 4.58 |
| `--rule-strong` on `--sheet-raised` | 6.58 | 3.67 |
| `--rule-strong` on `--groove` | 4.33 | 5.51 |
| `--rule-strong` on the coat washes | 4.47 – 4.97 | 2.70 – 3.23 † |
| `--ink` ring ("circled") on `--sheet` | 16.10 | 13.08 |
| `--ink` fill (histogram bar, vote segment) on `--sheet-raised` | 17.39 | 10.50 |
| `--ink` inset bar on `--groove` | 11.43 | 15.75 |
| `--strike` on the coat washes | 6.52 – 7.24 | 5.47 – 6.55 |
| `--strike` on `--groove` | 6.30 | 11.18 |
| `--stamp` 3px left rule on `--sheet` | 6.79 | 6.00 |

† In dark the chip border is lower-contrast against its own fill than against the surrounding
sheet. That is fine: SC 1.4.11 asks for contrast between the control's boundary and the
**adjacent** background, which is `--sheet` (4.58:1 ✓), not its own fill. This row is the one pair
not in `verify-contrast.py`'s own arrays; it is computed with the same module
(`docs/10-design-spec-wcag.py`, `cr()`) over the same parsed tokens.

### 2.4 Decorative — deliberately below 3:1

`--rule` is the only token allowed under the non-text floor, and it may never be the sole carrier of
information. On `--sheet` it reads 1.91 (light) / 1.84 (dark); on `--sheet-raised`, 2.06 / 1.48. Both
went **up** in the repair — 1.48 and 1.30 were hairlines nobody could see, so the rows they divide now
read as rows without the line ever becoming an indicator.

---

## 3. CVD

Verified two ways: numerically (Viénot/Brettel LMS simulation → CIEDE2000) and by simulating the
actual rendered frames — `plans/assets/shots/03b-design-system/cvd/*.png` in a working checkout
(internal, not in the published repo — §7), four columns per frame
(normal / deutan / protan / tritan). The ΔE tables below are transcribed from the same run as §2
(`plans/assets/proto/04-polish/verify-contrast.py`, raw output in
[10-design-spec-contrasts.txt](10-design-spec-contrasts.txt)) and moved with the surface repair,
because the washes are mixed over `--sheet`.

**Coat fills, worst pair, ΔE00**

| | normal | deutan | protan | tritan |
|---|---|---|---|---|
| light | 37.0 | 15.7 (G/P) | 16.5 (B/P) | 10.7 (B/G) |
| dark | 34.7 | 15.7 (G/P) | 13.6 (B/P) | 10.4 (B/G) |

Comfortably separable everywhere. For comparison, the emoji circles this palette replaced
(decision №16) sat at ΔE 27–54 in *normal* vision and collapsed under deutan.

**Crossed-out washes, worst pair, ΔE00**

| | normal | deutan | protan | tritan |
|---|---|---|---|---|
| light | 11.2 (B/G) | **2.1** (G/P) | 4.9 (G/P) | **1.9** (B/G) |
| dark | 15.9 (B/G) | **3.8** (G/P) | 7.2 (B/P) | **4.2** (B/G) |

**Stated honestly: the four washes are not distinguishable from each other under deutan or tritan.**
Desaturated pastels always collapse; no palette fixes this. The wash is a normal-vision
convenience, nothing more. Identity is carried by two CVD-immune channels that are always present:

1. **the letter R / B / G / P** — `--ink` at 11.8–13.1:1 on every light wash and 7.7–9.2:1 on every
   dark one, so it clears AA on all eight with room to spare;
2. **fixed position** — the four coats are always rendered left-to-right R B G P, in every cell,
   in both the wide and the narrow board.

**The state channel — alive vs crossed, same coat, ΔE00**

| coat | normal | deutan | protan | tritan | luminance ratio |
|---|---|---|---|---|---|
| R | 31.8 | 25.8 | 31.4 | 30.2 | 2.71:1 |
| B | 35.7 | 38.0 | 35.5 | 33.5 | 3.47:1 |
| G | 26.1 | 24.4 | 22.2 | 25.4 | 2.44:1 |
| P | 26.4 | 19.6 | 25.0 | 24.3 | 2.27:1 |

(light theme). Dark's luminance ratios are higher on every row — 2.81–3.93:1 — and its ΔE00 is
higher on every row **but R**, which lands at 28.6 / 31.4 / 24.8 / 28.0 and so dips just under light
on normal, protan and tritan. The weakest cell in either theme is light P under deutan at 19.6, still
an order above the wash-vs-wash collapse it has to beat. This is the channel that actually matters during
play — "is this candidate still in?" — and it survives every CVD type because it is a lightness
jump, reinforced by the strike line. Plus, greyscale-safe by construction.

**Nothing in the interface is signalled by colour alone.** The audit, exhaustively:

| State | Colour | Non-colour duplicate(s) |
|---|---|---|
| candidate ruled out | wash instead of fill | diagonal strike + lightness jump + `aria-pressed` |
| candidate deduced | none — the ring is ink | 2px ink ring, offset 2px |
| clue satisfied | none | struck-through text + filled number box + muted |
| clue contradicted | red rule/box/wash | 3px left rule + inverted number box + the literal line "Contradicted by the board" |
| suspect row solved | none | hollow □ → filled ■ next to the name |
| progress | none | 12 countable squares + `NN/12` |
| your leaderboard row | none | inset ink bar + bold + a `You` tag |
| your histogram bar | none | filled vs hollow + a `YOU` label under the axis |
| difficulty vote shares | none | solid / hatched / empty + printed percentages |

---

## 4. Components

### 4.1 `.stamp`
Mono, 11px, 800, `letter-spacing: .12em`, uppercase, `1.5px solid currentColor`,
`padding: 4px 6px`, `border-radius: 2px`, **`transform: rotate(-3deg)`**. `.lg` = 13px / 2px border.
Default colour `--ink-3`; `.red` = `--stamp`; `.solid` fills with `--stamp` and uses `--stamp-ink`.
Uses: the tier stamp (`MEDIUM` + its `Level 2 of 3` line), `CLOSED`, `NOT RECORDED`, `WARM-UP SOLVED`,
`FILE UNAVAILABLE`. `SEALED` went with the sealed envelope (dec. 79) and no longer exists.
Nothing else may be a stamp — a stamp
that shows up on a routine label stops being a stamp.

### 4.2 `.caps`
Mono 11/700/`.12em`/uppercase/`--ink-3`. This is the replacement for every chrome emoji:
`CLUES`, `TIME`, `SOLVED`, `HINT 1 OF 1 · REVEALED`, `SOLVE TIMES TODAY · 142 DETECTIVES`.

### 4.3 Buttons

| Variant | Fill | Border | Label |
|---|---|---|---|
| `--primary` | `--ink` | `--ink` | `--ink-inv` |
| `--secondary` | none | `--rule-strong` | `--ink` |
| `--ghost` | none | none | `--ink-2`; hover fills `--groove` |
| `--icon` | 44×44, inline SVG 18px, `stroke-width: 1.6`, `currentColor` | | |
| `--danger` | ghost; `:hover` turns border+label `--stamp` | | |

One filled button per screen, maximum. On the game screen the filled button appears only at
12/12 (`See results`); before that the right-hand action is `Reveal a cell`, secondary — so the
"filled = the case is closable" signal is earned, not decorative.

Line icons, inline SVG only (undo / restart / help / close). No icon fonts, no emoji: `⏱`
without VS16 rendered as tofu in the Firefox webview in the legacy build — SVG cannot.

### 4.4 The board

A ruled form, `border-collapse: collapse`, every cell bounded by `--rule`, headers in `--groove`.

- **Column heads** (`COAT / TIME / ITEM`) — `.caps`.
- **Row head** — suspect name, sans 600, preceded by an 8px box: hollow `--rule-strong` while
  open, filled `--ink` when all three of that suspect's cells are deduced.
- **Cell** — a flex row of 4 chips, `gap: 4px` (3px narrow).

**Chip**, `--chip` square, `2px` radius, `1px --rule-strong`, mono 13/800:

| State | Rendering |
|---|---|
| alive, coat | full-saturation coat fill, per-coat letter ink, border = the coat colour |
| alive, time | `--sheet`, mono `09/12/15/18` in `--ink` |
| alive, item | `--sheet`, item emoji at 17px |
| ruled out | `--coat-*-out` wash (coats) or `--groove` (time/item); letter/glyph stays; emoji at `opacity: .55`; **2px `--strike` at −38°**, drawn as `::after` outside any opacity |
| deduced (sole survivor) | `outline: 2px solid --ink; outline-offset: 2px` — "circled in pen" |

Every chip carries `::before { inset: -6px -3px }` (−8/−4 narrow) to lift the touch target toward
44px without growing the visual grid.

**Narrow board (<720px).** The table is replaced by per-suspect blocks: a `--groove` name row,
then the three categories side by side. Same chips, same states, same order — only the frame changes.

### 4.5 Clue rows

`border-left: 3px solid transparent`, a 17px number box, sans 13/1.4 in `--ink-2`.

| Status | Rendering |
|---|---|
| open | hollow number box (`--rule-strong`), text `--ink-2` |
| satisfied | number box filled `--ink-3` with `--sheet` numeral; text `--ink-3`, `line-through` |
| contradicted | left rule `--stamp`, number box filled `--stamp`, row background `--stamp-wash`, text at full `--ink`, plus a mono caps line **"Contradicted by the board"** |

Note the direction: satisfied clues *recede*; the contradicted one is the only clue at full ink
strength. On paper you cross off what is done and circle what is wrong — the hierarchy does the
same work the old green/red badges did, with no hue at all except the single red.

The panel head carries the tally: `4 SATISFIED · 6 OPEN`, or `1 CONTRADICTED · 4 SATISFIED` with the
contradiction count in `--stamp`.

### 4.6 Progress

12 squares, 7×7, 3px gap, hollow `--rule-strong` → filled `--ink`, plus `NN/12` in mono tabular.
Countable at a glance, no hue, and it answers plan 03's C2 ("`✔ 5/12` is just a counter") without
adding a colour.

### 4.7 Hint slip

`--sheet-raised`, `3px solid --ink-3` left rule, caps header `HINT 1 OF 1 · REVEALED`, body in
`--ink`. No hue: the legacy yellow pair is gone. It docks at the bottom of the clue column, so a
revealed hint never displaces the board.

### 4.8 Result sheet

Not a modal from another design system — a raised sheet of the same file, over a 76%-opaque
`--paper` scrim through which the solved board stays visible. `CLOSED` stamp top-right.

> ⚠️ **Superseded in part by [11-stats-ia.md](11-stats-ia.md) (dec. 102+).** The result sheet is now
> ordered by *world* — this case ① → you ③ → the day ② — and its cells changed with it: the `hints`
> fact became `· 1 cell revealed` in the subline (the word was wider than the counter: rungs 1-2 are
> hints too, and free), the facts strip carries `CURRENT STREAK` and `LONGEST STREAK` under separate
> words, a kicker reads `CASE #47 · YOUR 14TH`, and a `Your file` button opens the surface that owns
> world ③. Read the order below as the shape before that pass; `11-stats-ia.md` §4.3 is authoritative.

Order, as it shipped before the stats-IA pass: hero (`Case closed` caps → 34px mono time → serif
percentile line) → three facts in a ruled strip (hints / streak / rank) → **histogram**
(`#r-histblock`) → **the standings block**
(`#r-lbblock`: four tabs Today / Week / Streak / All-time over `ledger.ts`, your pinned row, and a
`See all` button into the full-screen standings) → **`Tomorrow's case`** (`#r-tomorrow`: the countdown
rides the section heading, then the difficulty vote and vote bar) → `Full solution`, a hidden section
the footer toggles open (`#r-solution`) → footer: `Full solution` (ghost) + `Play this case again`
(secondary). No filled button: after a solve the primary act is to leave, and the vote is the thing
worth touching.

Two things this section used to describe are gone. The **sealed envelope** was deleted (dec. 79) — it
was a fourth framed thing on a sheet that already had too many, and its whole payload, the next case
number and its countdown, is one phrase that now rides the `Tomorrow's case` heading; the `SEALED`
stamp went with it. And "today's fastest" is no longer a three-name list but the full four-board
standings block, which is the same component the standings screen uses.

**Histogram** (decision №21 stays: by solve time, one series). Bars `--groove` filled with a
`--rule-strong` boundary; your bin filled `--ink`; a `YOU` caps label under the axis. Achromatic —
which is exactly what the dataviz method asks for when one series has one highlighted member.

### 4.9 Leaderboard

Tabs = mono caps with a 2px `--ink` underline on the selected one. Table `.rows`: mono caps header
over `--rule-strong`, rows divided by `--rule`, figures right-aligned mono tabular. Your row:
`--groove` background + `inset 3px 0 --ink` + bold + a `You` tag. Never a coloured row.

### 4.10 Splash (the feed's first screen)

> ⚠️ **Superseded in part by [11-stats-ia.md](11-stats-ia.md) §4.1 (dec. 102+).** The docket is now
> two or three cells grouped **by world**, with the boundary between worlds drawn a weight heavier —
> never four or five, and never a cell whose subject changes at a threshold. The day-scoped cells
> (`SOLVED TODAY`, `NEXT CASE`) and the all-time `DETECTIVES` left it: a card attached to one case
> was carrying three worlds in identical type, which is exactly what a live player read as wrong.
> The brief paragraph now changes with state — the rules before a solve, the next case and the
> standing vote after one. Two buttons since dec. 98. `11-stats-ia.md` is authoritative.

Wordmark (mono, `.3em` tracking) → `CASE 047` in `--stamp` → serif title → **one** paragraph of rules,
the same sentence the board carries under the grid → the **docket** (`#docket`) → **one** button.
Tier stamp top-right, outside `.top` so it only has to clear the title. No scroll.

The docket replaced the ruled social line. It is a grid of the file's own figures from
`/api/preview`, and its first cell is the twelve-square board itself, so the feed shows what the game
*is* before anyone has pressed anything. A figure with no number is simply not printed (dec. 37) —
the splash never invents social proof.

Two buttons: `#play` (primary, with an optional sub-label) and a `Standings` secondary
(dec. 98). An earlier revision of this section forbade the second one, on the grounds that the
standings lived in a post of their own and the splash had nowhere to send anyone. Both halves of
that reasoning have since gone: dec. 85 deleted the standalone standings post, dec. 75 made the
standings a screen inside the game - and a live player put it plainly, that the board was the only
way in and it was one press too many. The splash hands over through `handoff.ts` rather than a URL,
because `requestExpandedMode()` takes an entry name and nothing else.

### 4.11 Loading / error

Loading: caps `OPENING CASE FILE`, four `--groove` skeleton rules, a mono status line.
Error: `FILE UNAVAILABLE` red stamp, one sentence that says progress is safe, a single `Try again`
(primary), then the technical line in mono caps. No `Standings` button — a screen that failed to
reach the server is the wrong place to offer a second server round-trip.

---

## 5. Global rules

```css
:root { color-scheme: light dark; }
:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
button { touch-action: manipulation; }
body { overflow-x: hidden; }
.num, mono contexts { font-variant-numeric: tabular-nums; }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after {
  animation: none !important; transition: none !important; } }
```

The focus ring is **ink**, not blue — 13.1–16.1:1 on the sheet in both themes, and since it sits at
`outline-offset: 2px` it lands on paper even around a saturated coat chip. Dropping blue from the
system costs nothing and removes a hue that meant "focus" in one place and "info" in another.

**Theme.** Light is `:root`; dark is `@media (prefers-color-scheme: dark)`, guarded
`:root:not([data-theme="light"])`. The prototype adds `[data-theme]` purely so screenshots can be
forced; the app ships with the media query only — Devvit gives no theme toggle, and the webview
inherits the client's scheme. A white rectangle in a dark Reddit feed is as foreign as a black one
in a light feed, so both themes are mandatory, not optional.

**Breakpoints.** `720px` (single ↔ two column, table ↔ narrow board, chip 28 ↔ 44),
`880px` height on phones (tighten clue rows), `700px` height (short-viewport tier: 14px base,
40px targets, compressed result sheet).

---

## 6. The token file

This section has stopped being a handoff: the rewrite it proposed **has shipped**. The contract
[tokens.css](../src/client/tokens.css) states — *"swapping the visual language is a rewrite of this
file, not of the components"* — holds in the code, and token names are kept where the previous system
had them (`--font-sans`, `--font-mono`, `--tap`, `--sp-*`, `--fs-*`), so the swap was mechanical.

Below is a **values-only mirror** of what ships. The file itself is the source of truth and carries
the rationale for each value in comments; when they disagree, the file is right and this section is
the bug. Every colour here is the post-repair value (§1's revision note) and is what §2 was measured
against.

```css
/* src/client/tokens.css — D3 "Manila". Light is the base; dark via prefers-color-scheme. */
:root {
  color-scheme: light dark;

  /* surfaces — higher is lighter, in both themes */
  --paper: #BEAD8C; --sheet: #F8F4EB; --sheet-raised: #FFFDF8; --groove: #D9CFBA;

  /* ink */
  --ink: #1B1815; --ink-2: #4A433A; --ink-3: #5C5446; --ink-inv: #FFFDF8; --strike: #4A433A;

  /* lines */
  --rule: #BEB299; --rule-strong: #655B47;

  /* elevation — a printed drop, both offsets mixed out of --ink */
  --shadow-1:
    0 1px 0 color-mix(in srgb, var(--ink) 16%, transparent),
    0 3px 8px color-mix(in srgb, var(--ink) 10%, transparent);

  /* the one accent */
  --stamp: #9E2B1C; --stamp-ink: #FFFDF8; --stamp-wash: #E4C8BD;
  --scrim: color-mix(in srgb, var(--paper) 76%, transparent);

  /* evidence — Okabe-Ito coats */
  --coat-r: #D55E00; --coat-r-ink: #100D0A; --coat-r-out: #F0D3B7;
  --coat-b: #0072B2; --coat-b-ink: #FFFDF8; --coat-b-out: #C1D7DE;
  --coat-g: #009E73; --coat-g-ink: #100D0A; --coat-g-out: #C1E1D1;
  --coat-p: #CC79A7; --coat-p-ink: #100D0A; --coat-p-out: #EED9DC;

  /* type */
  --font-sans:  -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --font-mono:  ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
  --font-serif: "Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia,
                "Times New Roman", serif;
  --fs-2xs: 11px; --fs-xs: 12px; --fs-sm: 13px; --fs-base: 15px;
  --fs-md: 17px;  --fs-lg: 21px; --fs-xl: 26px; --fs-2xl: 34px;
  --ls-caps: .12em;

  /* spacing, radii, metrics */
  --sp-0: 2px; --sp-1: 4px; --sp-2: 8px; --sp-3: 12px;
  --sp-4: 16px; --sp-5: 24px; --sp-6: 32px; --sp-7: 48px;
  --r-0: 0; --r-1: 2px;
  --chip: 34px; --tap: 44px;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --paper: #0A0907; --sheet: #2A2419; --sheet-raised: #3B3422; --groove: #16130E;
    --ink: #F2ECE0; --ink-2: #D2C8B5; --ink-3: #A89E87; --ink-inv: #16130E; --strike: #D2C8B5;
    --rule: #554D3D; --rule-strong: #968B75;
    --shadow-1:
      0 1px 0 color-mix(in srgb, var(--paper) 70%, transparent),
      0 3px 10px color-mix(in srgb, var(--paper) 55%, transparent);
    --stamp: #E8886F; --stamp-ink: #16130E; --stamp-wash: #483427;
    --coat-b: #56B4E9; --coat-b-ink: #100D0A;
    --coat-r-out: #5A3412; --coat-b-out: #364C53; --coat-g-out: #1E4632; --coat-p-out: #573C41;
  }
}
@media (min-width: 720px) { :root { --chip: 44px; } }
@media (max-width: 719px) { :root { --chip: 28px; } }
@media (max-height: 700px) { :root { --tap: 40px; --fs-base: 14px; } }
@media (max-height: 700px) and (min-width: 720px) { :root { --chip: 34px; } }
@media (max-height: 700px) and (max-width: 719px) { :root { --chip: 26px; } }
```

Dark inverts the shadow's ingredient, not its direction: it mixes out of `--paper` (near-black)
rather than `--ink` (near-white), so a raised sheet still darkens what it lies on.

### 6.1 Mapping from the legacy tokens

Left column = the legacy navy tokens, preserved in
[10-design-spec-legacy.md](10-design-spec-legacy.md). None of them survive in
[tokens.css](../src/client/tokens.css) — this table is how to read old code, not current code.

| Legacy | D3 | Note |
|---|---|---|
| `--surface-0` `#0b101e` | `--paper` | |
| `--surface-1` `#131a2e` | `--sheet` | |
| `--surface-2` `#1a2340` | `--sheet-raised` **or** `--groove` | cards/hover → raised; bars/`th`/empty chip → groove |
| `--surface-3` `#1f2846` | — | **deleted**, four steps are enough |
| `--surface-sunken` `#10162a` | `--groove` | |
| `--surface-raised` `#202a4c` | `--sheet` | a chip at rest sits on the sheet, not above it |
| `--surface-crossed` `#141a2c` | `--groove` | coats use `--coat-*-out` instead |
| `--casebar-top` `#182140` | — | **deleted** — the header is flat, separated by `--rule-strong` |
| `--scrim` | `color-mix(in srgb, var(--paper) 76%, transparent)` | the solved board must stay visible behind the result |
| `--shadow-1/2/3` | `--shadow-1` | three photographic shadows collapse to **one printed drop** (§1.1a). Decision 57 deleted all three; the ladder repair reinstated exactly one, because `--sheet-raised` is capped by white and cannot buy an edge with lightness |
| `--text` | `--ink` · `--text-2` → `--ink-2` · `--muted` → `--ink-3` | |
| `--on-accent` `#0b101e` | `--ink-inv` | now means "on an **ink** fill" — there are no coloured fills left to sit on |
| `--border` | `--rule` | |
| `--border-strong` `#39466e` | `--rule-strong` | now genuinely ≥3:1 (the legacy one was ~2:1 on its own surface) |
| `--border-active`, `--border-hover` | `--rule-strong` | one structural line token, not three |
| `--orange`, `--orange-strong` | `--ink` (CTA, progress) / `--stamp` (case stamp) | the CTA is a filled ink button |
| `--green` | — | "confirmed" is an ink ring; "satisfied" is a strike-through |
| `--red` | `--stamp` | |
| `--blue` | `--ink` | the focus ring |
| `--purple` | — | the tomorrow block is ink and rules |
| `--yellow`, `--hint-bg/border/fill/fill-hover/line` | `--sheet-raised` + a `--ink-3` left rule | the hint slip is achromatic; five tokens collapse to zero |
| `--strike` `#6b7590` (scoped `#99a1b8` on flair chips) | `--strike` | one value; the scoped override is no longer needed |
| `--ok-bg/border`, `--info-bg/border` | — | **deleted**, no success/info colour exists |
| `--err-bg/border` | `--stamp-wash` / `--stamp` | |
| `--flair-r/b/g/p` | `--coat-r/b/g/p` + `--coat-*-ink` | same Okabe-Ito hues; **blue is theme-dependent** (`#0072B2` light / `#56B4E9` dark) and letter ink is per-coat |
| `--flair-*-off` (15% over the board) | `--coat-*-out` (22% light / 28% dark, over the sheet) | recomputed for a light ground |
| `--bar`, `--bar-2`, `--bar-you`, `--bar-you-2` | `--groove` + `--rule-strong` / `--ink` | the histogram is achromatic |
| `--vote-harder/same/softer` | `--ink` / hatched `--rule-strong` / `--groove` | solid · hatched · empty + printed percentages |
| `--font-sans`, `--font-mono` | unchanged | `--font-serif` added |
| `--fs-*` 11/12/13/14/17/20/24/28 | 11/12/13/**15**/17/**21**/**26**/**34** | body up one step (expanded mode has the room); hero up |
| `--r-s` 8 / `--r-m` 12 / `--r-l` 16 / `--r-pill` | `--r-1` 2 / `--r-0` 0 | |
| `--sp-1…5` | unchanged; `--sp-0: 2px` and `--sp-6/7` added | |
| `--chip-min` `clamp(34,12vw,44)`, `--chip-h` `clamp(30,4.2vh,44)` | `--chip` | one square token, stepped by media query — a chip is a square, and two clamped axes let it go non-square |
| `--tap` `44px` | unchanged (40px on short viewports) | |

**Delete outright, do not port:** the `.result` scope override (decision №20 — this is what made the
result card a second application); the `body.modal-open` light toast overrides; the casebar gradient;
every `box-shadow`; `--surface-3`; `--border-active`; `--border-hover`; the whole hint colour group;
the ok/info status surfaces.

### 6.2 Decisions this spec supersedes

Record each reversal as a **new row** in [09-design-decisions.md](09-design-decisions.md); do not
edit the old rows.

| # | What changes |
|---|---|
| 17 | "orange = CTA only, yellow = hint only" → there is no orange and no yellow; the CTA is a filled ink button, the hint slip is achromatic |
| 18 | "result: primary = share" → the result has no filled button at all |
| 20 | **light result card over a dark game** → the result is a raised sheet in the same theme; the local override is deleted |
| 21 | histogram stays by solve time; the series becomes `--groove` / `--ink` instead of `#6b7590` / `#d9631e` |
| 23 | "minimum information on the game screen" holds, but the board carries a one-line instruction (`TAP A CANDIDATE TO RULE IT OUT…`) — Reddit's featuring gate requires self-explanatory design |
| 16 | **unchanged and re-verified.** Okabe-Ito + R/B/G/P letters carry over; blue is now theme-dependent and the letter ink is per-coat |

---

## 7. How the numbers were produced

[10-design-spec-wcag.py](10-design-spec-wcag.py) — WCAG relative luminance and contrast ratio,
sRGB alpha compositing (matching `color-mix(in srgb, …)`), Viénot/Brettel LMS dichromacy
simulation for protan/deutan/tritan, and CIEDE2000. It is the maths only; it has no idea what the
app ships.

> **Where these live.** `docs/10-design-spec-wcag.py` (the maths), `docs/10-design-spec-contrasts.txt`
> (the run), `10-design-spec-legacy.md` and `10-design-spec-proto.html` are all **tracked** and sit
> next to this file, so every number in §2 and §3 is checkable from a fresh clone. That closes a loose
> end this section used to carry: they were untracked, and the promise was true on one disk only.
>
> The *driver* and the screenshot harness are the exception. They live under `plans/`, which
> `.gitignore` excludes on purpose — they are internal tooling, they carry local paths and browser
> profiles, and **every `plans/…` path in this document resolves in a working checkout only.**

The **driver** is `plans/assets/proto/04-polish/verify-contrast.py`. It parses
[tokens.css](../src/client/tokens.css) with a regex, resolves the dark block over the light one, and
runs every pair the application pass actually puts on screen — including the surface-to-surface pairs
the first audit had no concept of. Every ratio in §2 and every ΔE in §3 is transcribed from its
output; the raw run is [10-design-spec-contrasts.txt](10-design-spec-contrasts.txt).

```sh
python3 plans/assets/proto/04-polish/verify-contrast.py            # the whole audit, both themes
python3 docs/10-design-spec-wcag.py '#5C5446' '#D9CFBA'            # → 4.83:1, one pair by hand
python3 docs/10-design-spec-wcag.py cvd '#D55E00' '#0072B2' '#009E73' '#CC79A7'
```

The CVD sheets in `plans/assets/shots/03b-design-system/cvd/` are the same simulation applied
per-pixel to real rendered frames, not to swatches — which is how the crossed-wash collapse was
caught rather than assumed.

Screenshots: `firefox --headless --window-size=W,H --screenshot`, driven by
`plans/assets/proto/04-polish/shoot.sh`. They are shot from the **real built client**
(`dist/client`) served by `plans/assets/proto/04-polish/fixture-server.ts`, not from the prototype —
a spec that only ever verifies its own mock verifies nothing. Firefox has no CLI switch for the
colour scheme, so each theme gets a profile with `ui.systemUsesDarkTheme` pinned. Matrix: 18 states ×
{375×667, 393×852, 360×800, 1440×900} × {light, dark}, plus the 320px-tall feed slot at three widths,
into `plans/assets/shots/04-polish/`. The contact sheets (`_sheet-<size>-<theme>.png`) are a second
pass, written by `sheets.py`, not by `shoot.sh`.

```sh
npm run build:client
npx tsx plans/assets/proto/04-polish/fixture-server.ts 8782 &
plans/assets/proto/04-polish/shoot.sh
python3 plans/assets/proto/04-polish/sheets.py   # the _sheet-<size>-<theme>.png contact sheets
```

`shoot.sh` writes the frames; `sheets.py` is what assembles the contact sheets, and it is a separate
step.

The harness does more than shoot: `fixture-server.ts` runs the §1.1 check (`onPaper` — nothing but
`--ink` may be set on `--paper`) on every frame it renders and POSTs any offending element back,
which the server prints as a `REPORT` line. Note what that is and is not: it **measures and reports**,
it does not fail the run or exit non-zero. The rule is mechanically observed, not mechanically
enforced — somebody has to read the log.

---

## 8. Open questions and known limits

1. **44px tap targets are impossible on a phone with this board.** Twelve chips across a 360–393px
   viewport gives 26–28px. The expanded hit area (`::before`) brings the *touchable* region to
   36×44 at 28px chips and 34×42 at 26px (`.chip-m::before { inset: -8px -4px }` under 720px), but
   the *visual* target stays 26–28px. Plan 03's acceptance criterion "tap targets ≥44px
   everywhere" cannot be met by expanded mode alone — expanded mode adds height, and width is the
   binding constraint. Either the criterion relaxes for the evidence grid, or the narrow board
   stacks the three categories vertically (which costs ~400px of height and does not fit 667).
   Flagging, not deciding — this is 03a's call.
2. **`--ink-3` on `--sheet-raised` in dark is 4.65:1.** It passes, with little margin — and after the
   surface repair it is the *binding* constraint on the dark ladder. If `--sheet-raised` is ever
   lightened past `#3B3422`, `--ink-3` must be relightened with it, and `--stamp` (4.81:1 on the same
   surface) checked in the same breath.
3. **The serif on Android.** Falls through to Noto Serif; cap height and width differ slightly from
   Iowan/Georgia. Confined to two single-line strings on purpose. Check the case title's ellipsis
   behaviour on a real Android device before shipping.
4. **The crossed washes under deutan/tritan collapse (§3).** Accepted and documented. If a future
   change removes the letter from the chip, the entire CVD argument collapses with it — the letter
   is load-bearing, not decorative.
5. **The result sheet scrolls at 375×667 if the vote section grows.** It fits today with ~20px to
   spare. Any new block on the result needs a re-shot at 375×667 before it lands.
