// The ruled ledger, once. Types + row rendering + the one fetch, shared by the two standings
// surfaces inside the game (main.ts: the full-screen standings view and the block on the
// result sheet).
//
// The server half is src/server/leaderboard.ts. `GET /api/leaderboard` is a PUBLIC route
// (/api/*, not /internal/*), so any player - solved or not, mod or not - can read a board.

export type Unit = "time" | "points" | "streak";
export type Scope = "case" | "today" | "week" | "season" | "alltime" | "streak";

export interface BoardRow {
  rank: number;
  name: string;
  value: number;            // seconds / points / cases, per `unit`
  hints: number | null;     // day boards only - a time board without the hint count is not honest
  flagged: boolean;         // below the plausibility floor; marked, never silently dropped
  isYou: boolean;
}
export interface YouRow extends BoardRow { betterPct: number | null }

export interface BoardView {
  scope: string;
  unit: Unit;
  period: { key: string; label: string };
  rows: BoardRow[];
  you: YouRow | null;
  total: number;
  shown: number;
  provisional: boolean;
  updatedAt?: number;
}

// Below this many players a percentage is noise dressed up as a fact - the copy falls back to a
// raw count. The number is dec. 37's and not this file's: *a percentile and a distribution appear
// together, from 50 solvers up*. It used to be 10 here while the result card gated its own
// percentile line on `hasHistogram`, i.e. on 50 - so two screens one press apart answered the same
// question about the same sample with numbers a factor of five apart, and the softer of the two
// was on the screen where a stranger meets it first (dec. 100). The server nulls `betterPct` under
// its own SMALL_N as well; this is the stricter of the two gates and it is deliberately stricter.
//
// Exported because the result sheet's hero gates its own percentile on the same rule, and the two
// screens are one press apart: a second literal `50` in main.ts is a second answer waiting to drift
// from this one (docs/11-stats-ia.md §3).
export const PCT_MIN = 50;

const pad = (n: number) => String(n).padStart(2, "0");

/* How a case is scored, in one sentence, in ONE place - the two footnotes that carry it had drifted
   into a copy of each other and both were wrong in the same way. `(300-1000)` is the clamp on the
   base score, and FRESH_BONUS is added AFTER the clamp (src/server/leaderboard.ts) - so a player who
   closes the case on its own day can score up to 1250, and the footnote was quietly telling them a
   ceiling they had already gone through. The bonus is also the whole reason to come back on the day
   a case lands, which makes it the last thing this sentence should have been leaving out. */
const POINTS_RULE =
  "500 points a case, more for speed, 60 off per hint (300-1000) - plus 250 for closing it on the day it lands.";
export const fmtTime = (s: number) => `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;

function el(tag: string, cls?: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function fmtValue(unit: Unit, v: number): { n: string; u: string } {
  if (unit === "time") return { n: fmtTime(v), u: "" };
  // Cases, not days, since the unit changed (dec. 123). A figure whose unit moved silently is the
  // same defect as a label over the wrong population - docs/11 R1 applies to units as much as words.
  if (unit === "streak") return { n: String(v), u: v === 1 ? "case" : "cases" };
  return { n: v.toLocaleString("en-US"), u: "pts" };
}

/** What the head of a board says about itself, per scope. */
export function boardTitle(view: BoardView): string {
  switch (view.scope) {
    case "case": return `Fastest on ${view.period.label.toLowerCase()}`;
    case "today": return "Fastest today";   // served for the mod funnel; no screen offers it
    case "streak": return "Current streak";
    case "alltime": return "All-time points";
    case "week": return "Last 7 cases - points";
    default: return `${view.period.label} - points`;
  }
}

/**
 * One line under the head: what this board ranks by, so a figure never needs a legend.
 *
 * "POINTS = SPEED MINUS HINTS" was the formula written as a slogan, and on a phone it was the
 * half of the line that got ellipsed away - the explanation went missing exactly where it was
 * needed (dec. 83). It states the arithmetic now, in the order a player would ask it: what you
 * start with, what speed does, what a hint costs, and the range it can land in.
 */
export function boardMeta(view: BoardView): string {
  switch (view.scope) {
    // The case's own race. It is the one board scoped to the thing the reader just solved, which is
    // why it replaced TODAY: the day and the case differ only when two cases went out on one date,
    // and that is a publishing accident rather than a question anybody asks.
    case "case": return "This case only - ranked by time, with the hints each solve used.";
    case "today": return `${view.period.label} - ranked by time, with the hints each solve used.`;
    // Seven CASES, not a calendar week: a rolling window is always full and always the same size,
    // where a Monday empties the calendar one. Freshness is in the arithmetic, so the sentence says
    // so - a player reading a board they are not on is owed the reason.
    case "week": return "The last seven cases. 500 points a case, more for speed, 60 off per hint, "
      + "and 250 more for closing a case on the day it ran.";
    // The second sentence is behaviour a player cannot guess: a day the sub published nothing is
    // not a day they failed, because there was no case to close (src/server/streak.ts). What DID
    // change with the unit is that an archive case no longer advances a run - it is still a case
    // closed, and it is still worth points, but the chain is made of dailies.
    // The board ranks the run that is STILL GOING, not the record - a table of records nobody can
    // affect today is a monument. So the footnote has to say the thing that makes it a race: your
    // row survives tonight only if you close the next case on its own day.
    case "streak": return "Runs still going - cases closed in a row, each on the day it ran. "
      + "Miss a case and your run leaves this board. A day the sub published nothing does not "
      + "break a run: there was nothing to miss.";
    case "alltime": return `Every case since day one. ${POINTS_RULE}`;
    default: return `${view.period.label}. ${POINTS_RULE}`;
  }
}

export function rowNode(r: BoardRow, unit: Unit, cls = "b-row"): HTMLElement {
  // A time below the plausibility floor keeps its honest position but never takes the podium:
  // marked, not dropped (a hard drop would break a fast player replaying a case from memory).
  const podium = r.rank <= 3 && !r.flagged;
  const line = el("div", cls + (r.isYou ? " you" : "") + (podium ? " top" : ""));
  const { n, u } = fmtValue(unit, r.value);

  // Plain ranks, no medal emoji: the standings are a ruled ledger, and the podium is carried by
  // position plus the weight the first three rows get in CSS.
  line.appendChild(el("span", "b-rank", String(r.rank)));
  // Names come from Reddit - always via textContent, never interpolated into markup.
  const name = el("span", "b-name");
  name.appendChild(el("span", "nm", `u/${r.name}`));
  // filled tag = this row is you; outlined tag = a qualifier on the figure beside it
  if (r.isYou) name.appendChild(el("span", "tag you", "You"));
  line.appendChild(name);

  // Hints are shown on every time board on purpose: a race ranked by raw seconds where six
  // revealed cells look identical to none is not an honest race. Written, not an emoji - the
  // chrome carries no glyphs (dec. 63), and "2 HINTS" says it in any font stack.
  if (r.hints) line.appendChild(el("span", "b-tag", `${r.hints} hint${r.hints === 1 ? "" : "s"}`));
  if (r.flagged) line.appendChild(el("span", "tag hollow b-flag", "Flagged"));

  const val = el("span", "b-val", n);
  if (u) val.appendChild(el("span", "u", u));
  line.appendChild(val);
  return line;
}

/** The pinned "you" line under a list. Renders its own empty state - never nothing. */
export function renderYou(box: HTMLElement, you: YouRow | null, unit: Unit, total = 0, empty?: string): void {
  box.innerHTML = "";
  if (!you) {
    box.className = "b-you b-you-empty";
    box.appendChild(el("span", "", empty ?? "Solve today's case to enter the standings."));
    box.removeAttribute("hidden");
    return;
  }
  box.className = "b-you";
  box.appendChild(rowNode({ ...you, isYou: true }, unit, "b-row you"));
  // Percentiles only once the sample can carry one; below that, a plain position.
  if (you.betterPct !== null && total >= PCT_MIN) {
    box.appendChild(el("span", "b-tag", `ahead of ${you.betterPct}%`));
  }
  box.removeAttribute("hidden");
}

/**
 * "Top 12 of 340 · scores settle overnight" - what is on screen versus what exists, and whether
 * it is final. `provisional` means the period has not closed and the nightly recount can still
 * move a row; "still running" was the flag's name, not its meaning, and told a player nothing
 * (dec. 83).
 */
export function boardNote(view: BoardView, drawn: number): string {
  const parts: string[] = [];
  const more = view.total - drawn;
  parts.push(more > 0 ? `Top ${drawn} of ${view.total}`
                      : `${view.total} detective${view.total === 1 ? "" : "s"}`);
  if (view.provisional) parts.push("scores settle overnight");
  return parts.join(" · ");
}

export function emptyNode(text: string): HTMLElement {
  return el("div", "b-empty", text);
}

/**
 * The whole no-scroll strategy for the standalone post: draw everything, then remove what
 * doesn't fit. Beats computing a row count up front - it needs no assumption about row height,
 * font metrics, or how much room the header took after its title wrapped.
 *
 * Measured against the container's real content edge rather than scrollHeight: scrollHeight
 * leaves out bottom padding, which is exactly enough to leave a hairline of the next row showing.
 */
export function trimToFit(list: HTMLElement): void {
  const bottom = list.getBoundingClientRect().bottom - parseFloat(getComputedStyle(list).paddingBottom);
  while (list.lastElementChild && list.lastElementChild.getBoundingClientRect().bottom > bottom + 0.5) {
    list.removeChild(list.lastElementChild);
  }
}

/** One board, straight from the public endpoint. Throws on anything but a 2xx. */
export async function fetchBoard(scope: Scope, limit = 50): Promise<BoardView> {
  const res = await fetch(`/api/leaderboard?scope=${encodeURIComponent(scope)}&limit=${limit}`);
  if (!res.ok) throw new Error(`/api/leaderboard → ${res.status}`);
  return (await res.json()) as BoardView;
}
