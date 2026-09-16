// Deducto - the board, opened fullscreen through the "game" entrypoint (see splash.ts).
// Rendering only; all data & verification come from the server. No solution on the client:
// "solved" = all 12 cells deduced and every clue green (unique solution ⇒ that equals the correct
// answer); the server confirms and records the result.
//
// Expanding the post reloads this document, so nothing may live in memory only: the grid, the
// hint count and the elapsed time all come back from GET /api/daily.

import { showLoginPrompt } from "@devvit/web/client";
import type { Clue } from "../shared/types.js";
import { FLAIR_TOKENS, TIME_TOKENS, THEME_BY_ID, RANKS, type Theme } from "../shared/themes.js";
import { renderClue, valueLabel } from "../shared/render.js";
import {
  freshGrid, effectiveValue, effectiveCount, clueStatus,
  type GridState, type PuzzleCtx, type Cell,
} from "../shared/status.js";
import { forcedMoves } from "./forced.js";
import { take as takeHandoff } from "./handoff.js";
import { paintTier, tierWord } from "./tiers.js";
import {
  boardMeta, boardNote, boardTitle, emptyNode, fetchBoard, fmtTime, renderYou,
  rowNode, PCT_MIN, trimToFit, type BoardView, type Scope,
} from "./ledger.js";

// ───────────────────────── helpers ─────────────────────────
const $ = (id: string) => document.getElementById(id)!;
const pad = (n: number) => String(n).padStart(2, "0");
const IS_COARSE = matchMedia("(pointer: coarse)").matches;
const ordinal = (n: number) => {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return n + "st";
  if (m10 === 2 && m100 !== 12) return n + "nd";
  if (m10 === 3 && m100 !== 13) return n + "rd";
  return n + "th";
};

// The slip's head rail: a label on the left, whatever tool the panel needs, and the dismiss ✕ -
// all on one baseline (dec. 73). Every entry point into the slip goes through here, so the ✕ is
// never the only thing in the corner of an otherwise empty rail.
function noticeHead(tag: string) {
  const t = $("notice-tag");
  t.textContent = tag;
  t.style.display = tag ? "" : "none";
  $("notice-tools").innerHTML = "";
}

// The slip belongs to the hint ladder and to nothing else (dec. 79). It used to be the outlet
// for every kind of message the game had - "Board cleared", the help paragraph, the warm-up
// blurb, the stall nudge - which is precisely why the owner read four unrelated things as "some
// text" he could not tell apart. One channel, one meaning: this box only ever opens because the
// player pressed Hint.
function hideNotice() {
  $("notice").classList.remove("show");
  hintOpen = false;
}

// Floating toast: acknowledgements the player asked for and can ignore ("Board cleared",
// "Nothing to undo", the help text). Transient, over the bottom edge, on every screen - the
// same look everywhere, because D3 keeps every hue for the evidence grid and err/info/ok are
// told apart by their words.
let floatTimer: number | null = null;
function toast(msg: string, _kind: "err" | "info" | "ok" = "err", ms = 2400) {
  const t = $("toast");
  t.textContent = msg;
  t.className = "toast show";
  if (floatTimer) clearTimeout(floatTimer);
  floatTimer = window.setTimeout(() => t.classList.remove("show"), ms);
}

// text+bold composer without innerHTML interpolation (XSS-safe: names come from Reddit)
function setRich(el: HTMLElement, parts: (string | [string])[]) {
  el.textContent = "";
  for (const p of parts) {
    if (Array.isArray(p)) { const b = document.createElement("b"); b.textContent = p[0]; el.appendChild(b); }
    else el.appendChild(document.createTextNode(p));
  }
}

function el(tag: string, cls?: string, text?: string): HTMLElement {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

// ───────────────────────── types & state ─────────────────────────
interface Epilogue { who: string; timeSec: number; solvers: number; tier: string; pct: number }
interface VoteTally { Harder: number; Same: number; Softer: number }
// The rung a player holds, decided on the SERVER (src/server/flair.ts `rankState`) so the game,
// the STREAK board and the subreddit flair cannot disagree about it. `label` is null for a player
// who holds no rung yet - never "Detective by default" - and `nextIn` counts from the run in
// progress, which is the arithmetic the client used to get wrong whenever current < best.
interface RankState {
  label: string | null; cssClass: string | null; min: number;
  best: number; current: number;
  nextLabel: string | null; nextMin: number; nextIn: number;
}
// What the vote is doing to the NEXT case - the server's one answer, shared with the feed card so
// the two screens cannot disagree about tomorrow. `null` on an archive case, whose vote steers
// nothing. `verdict: null` means the sub has not decided; `moved` is whether the decision actually
// shifts the level, which it does not at either end of the ladder.
interface NextState {
  tier: string; moved: "up" | "down" | null; verdict: "Harder" | "Same" | "Softer" | null;
}
interface Results {
  timeSec: number; hints: number; solveOrder: number; total: number; betterPct: number;
  hasHistogram: boolean; histogram: { counts: number[]; youIdx: number } | null;
  // ── ① the hero's comparison, scoped to THIS CASE ──
  // `total` / `rank` / `betterPct` / the histogram are the DAY's and belong to the block that is
  // titled with the day. The hero asks a different question - how did I do against the people who
  // solved this same puzzle - and it now has its own three figures instead of borrowing one of
  // each (docs/11-stats-ia.md §4.3).
  caseTotal: number; caseRank: number; caseBetterPct: number | null;
  personalBest: boolean;
  // `streak` is the legacy alias of `streakBest`; the two runs are separate fields and separate
  // words everywhere they are printed (dec. 100).
  streak: number; streakBest: number; streakCurrent: number; rankState: RankState;
  streakLegacy: boolean;
  // Cases closed - a different question from the streak and never its word: the archive read in
  // one sitting is ten cases and one day (src/server/streak.ts). 0 means "nothing recorded yet",
  // which is why every surface draws it only above zero.
  casesSolved: number;
  rank: number; voteTally: VoteTally; next: NextState | null; voteMinTotal: number;
  you: string; leaderboard: { name: string; timeSec: number }[];
}
/** Your file: the whole of world ③ in one payload (GET /api/me, docs/11-stats-ia.md §4.4). */
interface MeResp {
  name: string | null;
  casesClosed: number; daysSolved: number; firstSeen: string | null;
  streakCurrent: number; streakBest: number; streakLegacy: boolean; bestTimeSec: number;
  points: number; place: number; detectives: number;
  rank: RankState; days: { date: string; points: number }[];
}
interface DailyResp {
  puzzle: {
    idx: number; caseNumber: number; themeId: string; tier: string; title: string; legend: string;
    suspects: string[]; objectTokens: string[]; clues: Clue[]; day: string;
  };
  attempt: { grid: GridState | null; hints: number; solved: boolean; elapsedSec: number; vote: string | null };
  meta: {
    // `streak` is the payload's legacy alias of `streakBest`; the HUD reads the run in progress.
    // `casesSolved` rides along on this payload too; the surface that prints it is the result
    // sheet, which gets its own copy from /api/check.
    streak: number; streakBest: number; streakCurrent: number;
    casesSolved: number; epilogue: Epilogue | null;
    vote: { choice: string | null; tally: VoteTally; leader: { tier: string; pct: number; total: number } };
    showTutorial: boolean; showWarmup: boolean; nextOpensInMin: number; nextCaseNumber: number;
  };
}

// The server's WEAK verdict on a live board (engine.ts `adviseOnGrid`, served by /api/hint).
// Mirrors the server type structurally - the client cannot import server code.
type Advice =
  | { kind: "move"; clue: number; cat?: string; suspect?: string; value?: string; pins?: string | null }
  // The 🟡 rung: a set of clues that still bites, but only read together. `via` is the value two
  // of them share - the chain the player has to hold in their head, and the whole point of the
  // message. Step 1 arrives redacted (clues + via only); step 2 carries the cell as well.
  | { kind: "cross"; clues: number[]; via?: string; viaCat?: string;
      cat?: string; suspect?: string; value?: string; pins?: string | null }
  | { kind: "contradiction"; clue: number | null }
  | { kind: "stuck" }
  | { kind: "done" };

interface PracticeResp {
  puzzle: DailyResp["puzzle"]; grid: GridState | null;
  warmupsDone: number; first: boolean; poolSize: number;
}

const CAT_IDS = ["flair", "time", "object"];
const CAT_LABEL: Record<string, string> = { flair: "Coat", time: "Time", object: "Item" };

let PZ: DailyResp["puzzle"];
let META: DailyResp["meta"];
let theme: Theme;
let ctx: PuzzleCtx;
let clues: Clue[] = [];
let grid: GridState;
let history: { cat: string; s: string; v: string; from: Cell; to: Cell }[][] = [];
let hints = 0;
let seconds = 0;
let solved = false;
let finalizing = false;
let lastResults: Results | null = null;
// The board as it stood when the case closed. The result sheet's second face IS that board - the
// client never receives the solution, it only ever holds the grid it solved with - while `grid`
// is live: "Play this case again" clears it and deliberately leaves the Results button on screen
// "to reopen the recorded result". Rebuilding the table off a cleared board hit an undetermined
// cell, threw before the view could switch, and left a button that did nothing at all. Found by
// the screenshot harness, on a fixture whose saved grid was not a solution.
let solvedGrid: GridState | null = null;
let diffVote: string | null = null;
let practiceMode = false;            // opt-in warm-up lane; isolated from the daily
let guestSolved = false;             // solved with no account: nothing recorded (dec. 44)
let ladderDone = false;              // first-run ladder answered in this session (guests can't be tracked)
const rowsDone = new Set<string>();
interface HintFact { cat: string; suspect: string; value: string }
let revealedHints: HintFact[] = []; // every cell revealed so far (server-backed) - reviewable log
let hintIdx = 0;                    // which hint the pager currently shows
let hintOpen = false;               // the hint panel owns the notice right now
let lastAdvice: Advice | null = null;
let hintPane: "advice" | "log" = "advice";

// The exact WEAK verdict for one specific board, cached by its signature. See boardStuck().
let serverVerdict: { sig: string; stuck: boolean } | null = null;

// solve-time histogram bins (labels match server thresholds)
const BIN_LABELS = ["<2", "2-3", "3-4", "4-5", "5-7", "7-10", "10-15", "15+"];

// ───────────────────────── API ─────────────────────────
async function api(path: string, body?: unknown): Promise<any> {
  const res = await fetch(path, body === undefined
    ? {}
    : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json();
}
let saveTimer: number | null = null;
// The autosave is also the nudge channel: the server owns active time and the moment the board last
// moved, so it - not the client - decides when a stalled player gets offered help (plan 02/D).
function pushState(): void {
  const p = practiceMode ? api("/api/practice/state", { grid }) : api("/api/state", { grid, seconds });
  p.then((r) => { if (r?.nudge) showNudge(); }).catch(() => {});
}
function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = window.setTimeout(pushState, 600);
}

// ───────────────────────── moves ─────────────────────────
function applyMove(cat: string, s: string, v: string, target: Cell) {
  const from = grid[cat][s][v];
  if (from === target) return;
  history.push([{ cat, s, v, from, to: target }]);
  grid[cat][s][v] = target;
  renderAll();
  scheduleSave();
  maybeFinalize();
}

function undo() {
  if (solved) return;
  const move = history.pop();
  if (!move) { toast("Nothing to undo", "info"); return; }
  for (let i = move.length - 1; i >= 0; i--) grid[move[i].cat][move[i].s][move[i].v] = move[i].from;
  renderAll();
  scheduleSave();
}

function allCluesOk(): boolean { return clues.every((c) => clueStatus(ctx, grid, c) === "ok"); }

async function maybeFinalize() {
  if (solved || finalizing) return;
  if (effectiveCount(ctx, grid) !== ctx.suspects.length * CAT_IDS.length) return;
  if (!allCluesOk()) return;
  finalizing = true;
  try {
    if (practiceMode) {
      const r = await api("/api/practice/check", { grid });
      if (r.status === "solved") { solved = true; if (timerInt) clearInterval(timerInt); onPracticeSolved(r.nextIsDaily === true); }
    } else {
      const r = await api("/api/check", { grid, seconds });
      if (r.status === "solved") {
        solved = true;
        if (timerInt) clearInterval(timerInt);
        $("btn-hint").setAttribute("hidden", "");
        $("btn-results").removeAttribute("hidden");
        syncLane();
        // A guest solve records nothing - no time, no rank, no streak - and the server says so
        // instead of inventing them (dec. 44). That gets its own screen, not an empty result card.
        if (r.guest || !r.results) { guestSolved = true; setTimeout(showGuest, 700); return; }
        lastResults = r.results;
        solvedGrid = JSON.parse(JSON.stringify(grid)) as GridState;
        diffVote = null; // fresh solve - allow a vote
        setTimeout(() => showResult(), 700);
      }
    }
  } catch { /* network - let them keep playing */ }
  finally { finalizing = false; }
}

function updateHintBtn() {
  const t = $("btn-hint").querySelector(".btxt");
  if (t) t.textContent = hints > 0 ? `Hints (${hints})` : "Hint";
}

// ───────────────────────── the hint ladder (plan 02/D) ─────────────────────────
// Two free rungs that teach and one paid rung that answers. Rung 1 names the clue that still works
// on YOUR board, rung 2 names what it rules out, rung 3 reveals a cell - and only rung 3 counts
// against you, which is why the price is written on the buttons: an unlabelled free hint is a hint
// nobody presses. The deduction itself is the server's (engine.ts `adviseOnGrid`); the client only
// phrases the four verdicts it can come back with.
const HINT_RUNGS: [1 | 2 | 3, string, string, boolean][] = [
  [1, "Which clue works", "free", false],
  [2, "What it rules out", "free", false],
  [3, "Reveal a cell", "costs 1", true],
];

function cellPhrase(cat: string, value: string): string {
  const vl = valueLabel(cat, value, theme);
  return cat === "flair" ? `the ${vl.label} coat` : `${vl.emoji} ${vl.label}`;
}

function clueNums(ns: number[]): string {
  if (ns.length === 1) return `Clue ${ns[0]}`;
  if (ns.length === 2) return `Clues ${ns[0]} and ${ns[1]}`;
  return `Clues ${ns.slice(0, -1).join(", ")} and ${ns[ns.length - 1]}`;
}

// What two clues have in common, when the engine found a link worth naming. `viaCat` is a category
// id for a value they share and the literal "suspect" for a person, which reads differently.
function viaPhrase(a: Extract<Advice, { kind: "cross" }>): string {
  if (!a.via) return "";
  if (a.viaCat === "suspect") return a.via;
  return a.viaCat ? cellPhrase(a.viaCat, a.via) : a.via;
}

// Every kind of Advice, in the player's language - one sentence each (dec. 79).
//
// The rung MATTERS here, and it did not before (dec. 88). The two free rungs are different
// questions - "which clue works" and "what does it rule out" - and on a board where the answer to
// both is "nothing", they were printing the identical sentence, so pressing the second one changed
// nothing on screen. Each kind is therefore phrased per rung: step 1 names the clues, step 2 names
// the consequence, and when there is no consequence to name step 2 says what is left instead of
// repeating step 1.
//
// "stuck" is still deliberately not phrased as "there are no moves on this tier": on a fresh board
// there always are - the wall is the fixpoint, which a case hits some minutes in.
function adviceText(a: Advice, step: 1 | 2 | 3): string {
  switch (a.kind) {
    case "move":
      if (a.cat && a.suspect && a.value) {
        const head = `Clue ${a.clue}: cross out ${cellPhrase(a.cat, a.value)} for ${a.suspect}.`;
        return a.pins ? `${head} That leaves ${cellPhrase(a.cat, a.pins)} alone.` : head;
      }
      return `Clue ${a.clue} still rules one more chip out - read it against your marks.`;
    case "cross": {
      const via = viaPhrase(a);
      const link = via ? `, both about ${via},` : "";
      if (a.cat && a.suspect && a.value) {
        const head = `${clueNums(a.clues)}${link} together: cross out ${cellPhrase(a.cat, a.value)} for ${a.suspect}.`;
        return a.pins ? `${head} That leaves ${cellPhrase(a.cat, a.pins)} alone.` : head;
      }
      return via
        ? `${clueNums(a.clues)} both mention ${via} - read them as one and a chip falls.`
        : `${clueNums(a.clues)} only bite together - neither of them does anything alone.`;
    }
    case "contradiction":
      return a.clue === null
        ? "Some cell has no candidate left - undo back to a board that worked."
        : `Clue ${a.clue} argues with your marks - undo until it stops.`;
    case "stuck":
      return step === 1
        ? "No single clue moves this board any further."
        : "Nothing at all is forced here any more - from this board on, only a reveal moves it.";
    case "done":
      return "Every cell is down to one candidate, so a clue below must be marked wrong.";
  }
}

// Where the slip lands. It floats over the board, so the one thing it must never cover is the
// cell it is naming: it docks at the far end of the board from that suspect's row. With four
// rows and a slip that is at most half the board, the opposite end is always clear.
function slipAnchor(suspect?: string): "top" | "bottom" {
  if (!suspect || !ctx) return "bottom";
  const i = ctx.suspects.indexOf(suspect);
  return i >= 0 && i >= ctx.suspects.length / 2 ? "top" : "bottom";
}

// ── what each rung has already said about THIS board (dec. 88) ──────────────────────────────
// The owner's report was "nothing happens when I press the two free buttons", and it was true:
// on a board where the model has nothing forced, both free rungs answered `stuck`, the panel
// printed one sentence for both, and the second press left the screen byte-identical. A press
// with no visible consequence is a broken button, whatever the server meant by it.
//
// So the ladder keeps a memory, keyed by the board itself: which rung produced the line that is
// on screen, and which rungs have already come back empty. One move on the board retires all of
// it. Together with the per-rung phrasing above, that makes an invariant the screen can be read
// against: NO ENABLED RUNG CAN BE PRESSED WITHOUT SOMETHING CHANGING - the rung whose answer you
// are already looking at is marked ON SCREEN and disabled, and a rung with nothing left to say is
// marked NOTHING HERE and disabled.
let rungSig = "";                                   // the board those answers belong to
const rungKind: Record<number, Advice["kind"] | null> = { 1: null, 2: null, 3: null };
let shownRung: 1 | 2 | 3 | null = null;             // whose answer the body is showing
let busyRung: 1 | 2 | 3 | null = null;              // a request is in flight for this rung

function syncRungs() {
  const sig = gridSig();
  if (sig === rungSig) return;
  rungSig = sig;
  rungKind[1] = rungKind[2] = rungKind[3] = null;
  shownRung = null;
}

function renderHintPanel() {
  const box = $("notice-text");
  hideNudge();
  $("notice").className = "notice show";
  hintOpen = true;
  box.innerHTML = "";
  syncRungs();

  const n = revealedHints.length;
  hintIdx = Math.max(0, Math.min(hintIdx, Math.max(0, n - 1)));
  const inLog = hintPane === "log" && n > 0;
  $("notice").dataset.anchor = slipAnchor(
    inLog ? revealedHints[hintIdx]?.suspect
          : shownRung && lastAdvice && "suspect" in lastAdvice ? lastAdvice.suspect : undefined);

  // The rail carries the label and the panel's tool; the body carries only what the hint says.
  // Naming the rung on the rail is the third of the three things that change when a rung is
  // pressed (the sentence, the rung's own mark, and this).
  noticeHead(inLog ? `Hint ${hintIdx + 1} of ${n} · revealed`
    : shownRung ? `Hint · step ${shownRung} of 3` : "Hint");
  const tools = $("notice-tools");
  if (inLog && n > 1) {
    const pager = el("span", "hint-pager");
    const prev = el("button", undefined, "‹") as HTMLButtonElement;
    prev.disabled = hintIdx === 0; prev.title = "Previous revealed cell";
    prev.addEventListener("click", () => { hintIdx--; renderHintPanel(); });
    const next = el("button", undefined, "›") as HTMLButtonElement;
    next.disabled = hintIdx === n - 1; next.title = "Next revealed cell";
    next.addEventListener("click", () => { hintIdx++; renderHintPanel(); });
    pager.append(prev, next);
    tools.appendChild(pager);
  } else if (!inLog && n > 0) {
    const log = el("button", "hint-reveal", `${n} revealed`) as HTMLButtonElement;
    log.title = "Review the cells you have already revealed";
    log.addEventListener("click", () => { hintPane = "log"; hintIdx = n - 1; renderHintPanel(); });
    tools.appendChild(log);
  } else {
    tools.appendChild(el("span", "hint-free", "first two are free"));
  }

  const body = el("div", "hint-body");
  const line = el("span", "hint-line");
  if (inLog) {
    const h = revealedHints[hintIdx];
    const vl = valueLabel(h.cat, h.value, theme);
    line.textContent = `${h.suspect} · ${CAT_LABEL[h.cat]} ${vl.emoji} ${vl.label}`;
  } else if (lastAdvice && shownRung) {
    line.textContent = adviceText(lastAdvice, shownRung);
  } else {
    line.style.opacity = ".8";
    line.textContent = "Ask for the next move rather than the answer.";
  }
  body.appendChild(line);
  box.appendChild(body);

  const ladder = el("div", "hint-ladder");
  const allRevealed = n >= ctx.suspects.length * CAT_IDS.length;
  for (const [step, label, cost, pay] of HINT_RUNGS) {
    const b = el("button", "hint-step") as HTMLButtonElement;
    // A free rung that came back `stuck` on this board has said everything it has; a rung whose
    // answer is the sentence above cannot say anything new either. Both are stated on the button
    // instead of being left for the player to discover by pressing it a second time.
    const spent = !pay && rungKind[step] === "stuck";
    const onScreen = !pay && !inLog && shownRung === step;
    const busy = busyRung === step;
    const mark = busy ? "asking…" : spent ? "nothing here" : onScreen ? "on screen" : cost;
    const state = busy ? "busy" : spent ? "spent" : onScreen ? "on" : "";
    if (state) b.dataset.state = state;
    b.append(el("span", undefined, label), el("span", "cost" + (pay ? " pay" : ""), mark));
    b.title = busy ? "Asking the archive…"
      : spent ? "This step has nothing left until the board changes"
      : onScreen ? "This is the line above"
      : pay ? "Reveals one cell's answer and counts as a hint on your result"
      : "Free - it points at the board, it never fills it in";
    if (pay && allRevealed) {
      b.dataset.state = "spent";
      b.lastElementChild!.textContent = "all revealed";
      b.title = "Every cell has been revealed";
    }
    b.disabled = busyRung !== null || spent || onScreen || (pay && allRevealed);
    b.addEventListener("click", () => { void askHint(step); });
    ladder.appendChild(b);
  }
  box.appendChild(ladder);
}

async function askHint(step: 1 | 2 | 3) {
  if (solved || busyRung !== null) return;
  // The press is acknowledged before the round trip, not after it: on a real connection the
  // archive takes long enough that "I pressed it and nothing happened" is a fair description of
  // the gap, and the gap is where the owner's complaint actually starts.
  busyRung = step;
  renderHintPanel();
  try {
    const r = await api("/api/hint", { grid, step });
    hints = r.hints ?? hints;
    if (Array.isArray(r.revealed)) revealedHints = r.revealed as HintFact[];
    updateHintBtn();
    syncRungs();
    if (r.advice) {
      lastAdvice = r.advice as Advice;
      // What this flag actually answers is "is a single clue still enough on this board?", which
      // is the one distinction that changes what the nudge should offer. `cross` is the engine's
      // way of saying no - it exists precisely because no clue bites alone any more - so it
      // counts, and the nudge hands over the technique instead of pointing at the free rungs.
      serverVerdict = { sig: gridSig(), stuck: lastAdvice.kind === "stuck" || lastAdvice.kind === "cross" };
      if (step !== 3) rungKind[step] = lastAdvice.kind;
      renderMeters(); // the status line answers to the server verdict from here on
    }
    if (step === 3) {
      if (!r.hint && !revealedHints.length) { toast("Nothing left to reveal - every cell is filled in.", "info"); return; }
      hintIdx = revealedHints.length - 1;
      hintPane = "log";
      shownRung = null;                      // the body shows the log, not a rung's sentence
    } else {
      hintPane = "advice";
      shownRung = step;
    }
  } catch { toast("Hints unavailable", "info"); }
  finally { busyRung = null; renderHintPanel(); }
}

// Hint button - open the panel and take the free first rung straight away; nothing is spent.
async function openHints() {
  if (solved) return;
  hintPane = "advice";
  renderHintPanel();
  await askHint(1);
}

// The proactive nudge - the ONE message in the game that arrives without being asked for, so it
// is the one message shaped like an interruption: a bar on the bottom edge, one line, one action
// (dec. 79). It used to open the hint slip with a two-sentence paragraph, which made it
// indistinguishable from the hint it was offering. Every input to the decision (active time, when
// the board last gained a cell, "offered already") lives on the server; the client shows it once.
// What it offers depends on whether the board is genuinely at the WEAK fixpoint or the player is
// merely slow - which is the one distinction that changes what would help, and the reason the two
// "is anything forced right now" models of dec. 55 are still ranked and still both here.
function showNudge() {
  if (solved || practiceMode || hintOpen) return;
  $("nudge-text").textContent = boardStuck()
    ? "One clue is no longer enough here - two have to be linked."
    : "Stuck? The first two hints are free.";
  $("nudge").removeAttribute("hidden");
}
function hideNudge() { $("nudge").setAttribute("hidden", ""); }

// ───────────────────────── rendering ─────────────────────────
// progress ticks: one countable square per cell - progress you can see, not a counter (C2).
// Achromatic by construction; the D3 system keeps every hue for the evidence grid.
function segments(host: HTMLElement, n: number): HTMLElement[] {
  if (host.childElementCount !== n) {
    host.innerHTML = "";
    for (let i = 0; i < n; i++) host.appendChild(el("i"));
  }
  return [...host.children] as HTMLElement[];
}

function renderMeters() {
  $("hud-time").textContent = fmtTime(seconds);

  const total = ctx.suspects.length * CAT_IDS.length;
  const done = effectiveCount(ctx, grid);
  segments($("cell-seg"), total).forEach((s, i) => { s.className = i < done ? "on" : ""; });
  $("cell-n").textContent = `${pad(done)}/${total}`;

  const stats = clues.map((c) => clueStatus(ctx, grid, c));
  const ok = stats.filter((s) => s === "ok").length;
  const bad = stats.filter((s) => s === "bad").length;
  renderTally(ok, bad);

  renderStatusLine(bad, done, total);
}

// The clue panel head carries the count, so the game screen needs no second meter: the tally
// names the states in words and only the contradiction count is red - the same one red as the
// clue row it points at.
function renderTally(ok: number, bad: number) {
  const box = $("clue-tally");
  box.textContent = "";
  const open = clues.length - ok - bad;
  if (bad > 0) box.append(el("b", undefined, `${bad} contradicted`), document.createTextNode(" · "));
  if (ok > 0) box.append(document.createTextNode(`${ok} satisfied${open > 0 ? " · " : ""}`));
  if (open > 0 || (!ok && !bad)) box.append(document.createTextNode(`${open} open`));
}

// "Is anything forced right now?" - two models answer that. forced.ts runs the WEAK model offline
// and is deliberately conservative; the server's `adviseOnGrid` runs the same model exactly, but
// only replies when the player asks for a hint. So: whenever a server verdict exists for THIS
// exact board it wins, and forced.ts answers in between (closes the TODO in forced.ts). The
// signature is the board itself - one move invalidates the cached verdict. Since dec. 79 this
// decides what the stall nudge offers rather than what the standing instruction says.
function gridSig(): string {
  let s = "";
  for (const c of ctx.catIds) for (const su of ctx.suspects) for (const v of ctx.cats[c]) s += grid[c][su][v];
  return s;
}
function boardStuck(): boolean {
  if (serverVerdict && serverVerdict.sig === gridSig()) return serverVerdict.stuck;
  return forcedMoves(ctx, grid, clues) === 0;
}

// One line under the board. It carries two things and no longer three (dec. 79): the
// self-explanatory instruction the Featuring gate asks for (dec. 23, revised), and - when the
// board contradicts itself - the fact that it does. Both are statements about the board that are
// true whether or not anyone asked; the third thing that used to live here, "no forced move left",
// is a verdict on a technique and now answers a press of Hint instead, which is where a player
// looks for it. Achromatic: the screen's one red already belongs to the contradicted clue row.
function renderStatusLine(bad: number, done: number, total: number) {
  const line = $("statusline");
  line.classList.toggle("alert", bad > 0);
  if (solved || done === total) { line.textContent = ""; return; }
  if (bad > 0) {
    setRich(line, bad === 1
      ? [["1 clue"], " now contradicts the board - it is marked in the list."]
      : [[`${bad} clues`], " now contradict the board - they are marked in the list."]);
    return;
  }
  line.textContent = `${IS_COARSE ? "Tap" : "Click"} a chip to rule it out. The last one left in a cell is the answer.`;
}

function setStreakHud(n: number) {
  const box = $("hud-streak");
  if (n > 0) { $("hud-streak-n").textContent = String(n); box.removeAttribute("hidden"); }
  else box.setAttribute("hidden", "");
}

function renderEpilogue() {
  const box = $("epilogue");
  box.textContent = "";
  const y = META?.epilogue;
  if (!y) return;
  // Short enough to finish on a 360px phone. It used to run to "· voted Harder (62%)", which is
  // a fact about a case nobody on this screen is playing, and it was the half that got ellipsed.
  const txt = el("span", "etxt");
  setRich(txt, [[y.who], " in ", [fmtTime(y.timeSec)], ` · ${y.solvers} solved it`]);
  // "Last case", not "Yesterday": the epilogue is the case BEFORE this one, and the sub does not
  // publish every day - on 2026-08-04, 08-07 and 08-09 it published nothing, so "yesterday" was
  // simply false on the next card each time. The feed card says the same words for the same fact.
  box.append(el("span", "caps", "Last case"), txt);
}

function renderClues() {
  const list = $("clue-list");
  list.innerHTML = "";
  // In the 540-899px band the list is two columns numbered DOWN each one (dec. 87), which the
  // grid can only do if it knows how many rows a column holds. Half the clues, rounded up.
  list.style.setProperty("--clue-rows", String(Math.max(1, Math.ceil(clues.length / 2))));
  clues.forEach((c, i) => {
    const stat = clueStatus(ctx, grid, c);
    const item = el("div", "clue-item" + (stat === "ok" ? " st-ok" : stat === "bad" ? " st-bad" : ""));
    // the number box always carries the number: the status is shape (filled / struck / ruled),
    // never a glyph swapped in for a tick or a bang
    const txt = el("span", "txt", renderClue(c, theme));
    txt.appendChild(el("span", "flag", "Contradicted by the board"));
    item.append(el("span", "num", String(i + 1)), txt);
    list.appendChild(item);
  });
}

function chipLabel(cat: string, v: string): string {
  if (cat === "flair") return v[0];
  if (cat === "time") return v.slice(0, 2);
  return valueLabel(cat, v, theme).emoji;
}
// A real <button>, not a <span> with a listener (dec. 73): that is what gives it a pointer
// cursor, a :hover, a focus ring and Enter/Space for free - and it makes `aria-pressed` legal,
// which the spec has been claiming as the non-colour duplicate of "ruled out" all along.
function buildChip(c: string, s: string, v: string, isAnswer: boolean): HTMLElement {
  const st = grid[c][s][v];
  const chip = el("button", `chip-m k-${c}`
    + (c === "flair" ? ` fl fl-${v}` : "")
    + (st === 1 ? " crossed" : "")
    + ((st === 2 || isAnswer) ? " confirmed" : "")) as HTMLButtonElement;
  chip.type = "button";
  chip.setAttribute("aria-pressed", String(st === 1));
  chip.appendChild(el("span", "g", chipLabel(c, v)));
  const vl = valueLabel(c, v, theme);
  const name = c === "flair" ? `${vl.label} coat` : vl.label;
  const verb = IS_COARSE ? "tap" : "click";
  chip.title = st === 1 ? `${name} - crossed out (${verb} to restore)` : `${name} (${verb} to cross out)`;
  chip.setAttribute("aria-label", `${s} · ${CAT_LABEL[c]} ${name}`);
  chip.addEventListener("click", () => { if (!solved) applyMove(c, s, v, st === 0 ? 1 : 0); });
  chip.addEventListener("contextmenu", (e) => e.preventDefault());
  return chip;
}

// One board for every width: the suspect name stacks above its cells when the row is narrow and
// sits beside them when it isn't - CSS decides, not a second renderer.
function renderBoard() {
  const board = $("board");
  board.innerHTML = "";
  // a closed case is not clickable, so it must not offer a pointer cursor or a hover either
  board.toggleAttribute("data-locked", solved);

  const head = el("div", "bhead");
  head.appendChild(el("span", "corner"));
  for (const c of CAT_IDS) head.appendChild(el("span", undefined, CAT_LABEL[c]));
  board.appendChild(head);

  for (const s of ctx.suspects) {
    const rowDone = CAT_IDS.every((c) => effectiveValue(ctx, grid, c, s));
    if (rowDone) rowsDone.add(s); else rowsDone.delete(s);

    // "this suspect is closed" is a hollow box turning into a filled one - no colour, no tick
    // glyph, no green flash. It reads in greyscale and under every CVD type.
    const row = el("div", "brow" + (rowDone ? " done" : ""));
    const name = el("div", "bname");
    name.append(el("span", "done-mark"), el("span", "nm", s));
    row.appendChild(name);

    for (const c of CAT_IDS) {
      const cell = el("div", "bcell");
      const ans = effectiveValue(ctx, grid, c, s); // sole survivor = the deduced answer
      for (const v of ctx.cats[c]) cell.appendChild(buildChip(c, s, v, v === ans));
      row.appendChild(cell);
    }
    board.appendChild(row);
  }
}

// The slip is repainted with everything else when it is open, and that is load-bearing rather
// than tidy: the rung marks of dec. 88 are filed under the board they were answered on, so a move
// has to bring the rungs back to life immediately. Without this, a rung that came back empty would
// still be sitting there disabled after the move that gave it something to say.
function renderAll() {
  renderMeters(); renderClues(); renderBoard(); renderEpilogue();
  if (hintOpen) renderHintPanel();
}

// ───────────────────────── the standings, in two places ─────────────────────────
// GET /api/leaderboard is public (/api/*, not /internal/*), so both surfaces below work for a
// player who has not solved anything: the block on the result sheet, and the standings SCREEN
// reachable from the board's control bar. One renderer (ledger.ts), one cache, four boards -
// TODAY by time, WEEK and ALL-TIME by points, STREAK by the run STILL GOING - not the record. A
// board of records is a monument: nobody can move it today, so nobody reads it twice.
type LbScope = "case" | "week" | "streak" | "alltime";
const SCOPE_EMPTY: Record<LbScope, string> = {
  case: "Nobody has closed this case yet - be the first name on it.",
  week: "No points on this week's board yet.",
  streak: "No runs going yet - close two cases in a row, each on the day it ran, to start one.",
  alltime: "The all-time board opens with the first recorded solve.",
};

let lbScope: LbScope = "case";
let stScope: LbScope = "case";
const boardCache = new Map<LbScope, BoardView | null>();

async function loadBoard(scope: LbScope): Promise<BoardView | null> {
  if (boardCache.has(scope)) return boardCache.get(scope) ?? null;
  let view: BoardView | null = null;
  try { view = await fetchBoard(scope as Scope, 50); } catch { view = null; }
  boardCache.set(scope, view);
  return view;
}

// The endpoint being down must not blank the one board the result screen already holds:
// /api/check came back with the day's three fastest, so today's tab falls back to those.
function caseFromResults(r: Results): BoardView | null {
  if (!r.leaderboard?.length) return null;
  const bare = (n: string) => n.replace(/^u\//, "");
  return {
    scope: "case", unit: "time", period: { key: "case", label: "This case" },
    rows: r.leaderboard.map((row, i) => ({
      rank: i + 1, name: bare(row.name), value: row.timeSec,
      hints: null, flagged: false, isYou: row.name === r.you,
    })),
    you: {
      rank: r.caseRank, name: bare(r.you || "you"), value: r.timeSec, hints: r.hints,
      flagged: false, isYou: true, betterPct: r.caseTotal >= PCT_MIN ? r.caseBetterPct : null,
    },
    // `false`, matching what the server answers for this scope. `provisional` prints exactly one
    // sentence - "scores settle overnight" - and the day board is ranked by raw seconds, which the
    // nightly rollup cannot re-price (leaderboard.ts `isProvisional`). Hardcoding `true` here made
    // the OFFLINE copy of the day board promise a change the live one correctly refuses to.
    total: r.total, shown: r.leaderboard.length, provisional: false,
  };
}

interface LedgerTargets {
  list: string; you: string; note: string; title?: string; meta?: string; all?: string;
  /** The result sheet's preview block: it shows whole rows and sends you to the screen for the
      rest. The standings screen scrolls for real and must not be trimmed. */
  trim?: boolean;
}

// The pinned "you" line exists so a player at rank 340 can still see their own row. When that row
// is already on screen it is not a reminder, it is the same name printed twice in a row - which
// is exactly what the owner hit, and worst of all on a board where he was the only entry (dec. 81).
// Measured, not guessed at from an index: the lists differ (four rows on the result sheet, a full
// screen in the standings) and both scroll, so the question is whether the row is inside its box.
function youOnScreen(list: HTMLElement): boolean {
  const row = list.querySelector(".b-row.you") as HTMLElement | null;
  if (!row) return false;
  const box = list.getBoundingClientRect();
  if (box.height === 0) return false;             // not laid out yet - keep the pinned row
  const r = row.getBoundingClientRect();
  return r.top >= box.top - 0.5 && r.bottom <= box.bottom + 0.5;
}

function paintLedger(t: LedgerTargets, scope: LbScope, view: BoardView | null) {
  const list = $(t.list);
  list.innerHTML = "";
  if (t.title) $(t.title).textContent = view ? boardTitle(view) : "Standings";
  if (t.meta) $(t.meta).textContent = view ? boardMeta(view) : "Standings are unavailable right now.";
  if (!view) {
    list.appendChild(emptyNode("Standings are unavailable right now - your solve is still recorded."));
    $(t.you).setAttribute("hidden", "");
    $(t.note).textContent = "";
    return;
  }
  if (!view.rows.length) list.appendChild(emptyNode(SCOPE_EMPTY[scope]));
  else for (const row of view.rows) list.appendChild(rowNode(row, view.unit));
  // ── whole rows, or none (dec. 114) ──────────────────────────────────────────────────────────
  // The block on the result sheet shows the rows it can fit and sends you to the full screen for
  // the rest - its own CSS comment says "a press, not a scroll the page is not allowed to have".
  // The CSS said `overflow-y: auto` anyway, and a box clamped to four NOTIONAL row heights is not
  // a whole number of REAL ones, so the list opened on the bottom half of row one: a stub of a name
  // above the first full row, which is what the owner photographed.
  //
  // `trimToFit` is the guarantee that used to do this. It has been exported and called by nothing
  // since board.ts was deleted (dec. 85) - the function survived the file, the call did not. This
  // is that call. It is measured, not computed from a row height, which is what makes it survive a
  // font change: it removes whatever does not actually fit.
  //
  // Only where the list is a preview. The standings SCREEN is a real scroller and must keep every
  // row it was sent.
  if (t.trim && view.rows.length) trimToFit(list);
  const drawn = list.querySelectorAll(".b-row").length;
  if (youOnScreen(list)) $(t.you).setAttribute("hidden", "");
  else {
    renderYou($(t.you), view.you, view.unit, view.total,
      scope === "streak" ? "Close two cases in a row, each on its own day, to start a streak."
                         : "Close this case to enter the standings.");
  }
  // Counted after the trim: the note says how much of the board is on screen, so it has to count
  // what is on screen rather than what was sent.
  $(t.note).textContent = drawn ? boardNote(view, drawn) : "";
  // the button carries the size of the board, so the note beside it does not have to repeat it
  if (t.all) $(t.all).textContent = view.total > 0 ? `See all ${view.total}` : "See all";
}

const R_LEDGER: LedgerTargets = { list: "r-lb", you: "r-lbyou", note: "r-lbnote", all: "btn-lb-all", trim: true };
const ST_LEDGER: LedgerTargets = { list: "st-list", you: "st-you", note: "st-note", title: "st-title", meta: "st-meta" };

async function paintResultBoard() {
  const scope = lbScope;
  let view = await loadBoard(scope);
  if (!view && scope === "case" && lastResults) view = caseFromResults(lastResults);
  if (scope !== lbScope) return;                 // a tab was pressed while this was in flight
  paintLedger(R_LEDGER, scope, view);
}

async function paintStandings() {
  const scope = stScope;
  const view = await loadBoard(scope);
  if (scope !== stScope) return;
  paintLedger(ST_LEDGER, scope, view);
}

// Every entry into a standings surface refetches: a board that is one request old is worth more
// than one cached since the screen was last opened, and it is one request. The screen remembers
// where it was opened from, so "See all" on the result sheet does not drop you onto the board.
let stReturn = "game";
// Has /api/daily been applied? False for exactly one path: the standings opened straight off the
// splash (dec. 98), where the daily is deliberately not fetched yet - it stamps `startedAt` and
// consumes the first-run tutorial flag, and someone who pressed "Standings" has not started a run.
let booted = false;
function openStandings() {
  boardCache.clear();
  stReturn = document.body.dataset.view === "result" ? "result" : "game";
  stScope = stReturn === "result" ? lbScope : "case";
  for (const s of $("st-scope").children) {
    const on = (s as HTMLElement).dataset.scope === stScope;
    s.classList.toggle("on", on);
    s.setAttribute("aria-selected", String(on));
  }
  const back = stReturn === "result" ? "Back to the result" : "Back to the board";
  $("btn-st-close").textContent = back;
  $("btn-st-back").title = back;
  $("btn-st-back").setAttribute("aria-label", back);
  document.body.dataset.view = "standings";
  void paintStandings();
}
function closeStandings() {
  if (stReturn === "result") document.body.dataset.view = "result";
  // "Back to the board" arriving from the splash has no board behind it yet - this is where the
  // run actually starts, on the press that asks for it, and not on the one that asked for a table.
  else if (!booted) { document.body.dataset.view = "load"; void load(); }
  else showGame();
}

// ───────────────────────── your file: world ③ ─────────────────────────
//
// One surface for everything about the player, so that the surfaces about a CASE and about a DAY
// can stop carrying it (docs/11-stats-ia.md §5). Nothing here is a new measurement: `user:{name}`
// has been accumulating `solved` / `totalPoints` / `bestTimeSec` / `firstSeen` on every solve since
// the leaderboard shipped, and `lb:days:{name}` the day-by-day history - all of it read by no
// screen until now. The one figure that is not about the reader is printed as the denominator it
// is: `PLACE 3 of 8`.
let meReturn = "standings";

function meCell(key: string, value: string): HTMLElement {
  const f = el("div", "fact");
  f.append(el("div", "k", key), el("div", "v", value));
  return f;
}

/** A ruled strip of facts, drawn only if it has any - an empty strip is a box saying nothing. */
function meStrip(cells: (HTMLElement | null)[]): HTMLElement | null {
  const live = cells.filter(Boolean) as HTMLElement[];
  if (!live.length) return null;
  const box = el("div", "facts");
  for (const c of live) box.appendChild(c);
  return box;
}

function renderMe(m: MeResp) {
  $("me-name").textContent = m.name ? `u/${m.name}` : "Your file";
  const body = $("me-body");
  body.innerHTML = "";

  // Nothing recorded is a state, not an error, and it must not be dressed as a row of zeros: every
  // counter here is seeded going forward, so 0 means "not recorded yet" (dec. 37, dec. 102).
  if (!m.name || (m.casesClosed === 0 && m.daysSolved === 0 && m.streakBest === 0)) {
    $("me-meta").textContent = m.name
      ? "Nothing recorded yet - close a case and this file starts."
      : "Deducto could not put a name to you, so there is no file to open. Logging in starts one.";
    $("me-note").textContent = "";
    return;
  }
  $("me-meta").textContent =
    "Everything Deducto has recorded about you, across every case you have ever opened here.";

  // What you have done · how good you are · where you stand. Three strips, because three questions.
  const strips = [
    meStrip([
      m.casesClosed > 0 ? meCell("Cases closed", String(m.casesClosed)) : null,
      m.daysSolved > 0 ? meCell("Days solved", String(m.daysSolved)) : null,
      m.firstSeen ? meCell("Since", m.firstSeen) : null,
    ]),
    meStrip([
      // 0 is meaningful HERE and nowhere else: this is the surface that owns the run, so "your run
      // has ended" is one of the things it exists to say rather than a cell to hide.
      meCell("Current streak", String(m.streakCurrent)),
      m.streakBest > 0 ? meCell("Longest streak", String(m.streakBest)) : null,
      m.bestTimeSec > 0 ? meCell("Best time", fmtTime(m.bestTimeSec)) : null,
    ]),
    meStrip([
      m.points > 0 ? meCell("Points", m.points.toLocaleString("en-US")) : null,
      m.place > 0 ? meCell("Place", `${m.place} of ${m.detectives}`) : null,
    ]),
  ];
  for (const s of strips) if (s) body.appendChild(s);

  // The same ladder as the result sheet, from the same `rankState()` - one rung, one answer.
  const ranks = el("div", "ranks");
  body.appendChild(ranks);
  renderRanks(m.rank, ranks);
  // World ③ owns the streak, so this is the surface that most owes the explanation (dec. 123).
  if (m.streakLegacy) {
    body.appendChild(el("p", "streak-note",
      "Your longest run was earned when a streak counted days you came back. It stays yours. "
      + "A streak now counts cases closed on the day they run - so a new one starts with the next "
      + "daily case, and the archive no longer adds to it."));
  }

  // Have I been keeping it up? A fortnight is what reads as a habit; older days are on the boards.
  if (m.days.length) {
    const sec = el("div", "me-days");
    sec.appendChild(el("div", "h3", "Recent days"));
    const list = el("div", "lb");
    for (const d of m.days) {
      const row = el("div", "b-row");
      row.append(el("span", "b-name", d.date), el("span", "b-val", d.points.toLocaleString("en-US")));
      list.appendChild(row);
    }
    sec.appendChild(list);
    body.appendChild(sec);
  }
  // The footer note stays empty on purpose. On the standings it says how much of a list you are
  // seeing; there is no list here, and the community's size is already on screen as the thing it
  // actually is - the denominator of your place. Printing `8` twice on one screen is the
  // duplication dec. 80 struck off the result sheet.
  $("me-note").textContent = "";
}

async function openMe() {
  meReturn = document.body.dataset.view ?? "standings";
  $("btn-me-close").textContent = meReturn === "result" ? "Back to the result" : "Back";
  document.body.dataset.view = "me";
  $("me-meta").textContent = "Loading…";
  $("me-body").innerHTML = "";
  try {
    renderMe((await api("/api/me")) as MeResp);
  } catch {
    // The file failing to open must not strand the reader on a blank screen; the way back is the
    // same button either way.
    $("me-meta").textContent = "Your file is unavailable right now - nothing has been lost.";
  }
}
function closeMe() { document.body.dataset.view = meReturn; }

// One handler shape for both tab rails.
function wireScope(railId: string, set: (s: LbScope) => void, paint: () => void) {
  $(railId).addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest("button") as HTMLElement | null;
    if (!b || !b.dataset.scope) return;
    set(b.dataset.scope as LbScope);
    for (const s of $(railId).children) {
      const on = s === b;
      s.classList.toggle("on", on);
      s.setAttribute("aria-selected", String(on));
    }
    paint();
  });
}

// One series, achromatic: hollow bars in groove, your bin filled ink, and a YOU label under the
// axis so the highlight survives greyscale (spec 4.8, dec. 21). The per-bar count moves into the
// tooltip - at eight bins on a phone it was noise stacked on top of the shape it describes.
function renderHistogram(counts: number[], youIdx: number) {
  const hist = $("r-hist"), histx = $("r-histx");
  hist.innerHTML = ""; histx.innerHTML = "";
  const maxC = Math.max(...counts, 1);
  counts.forEach((c, i) => {
    const bin = el("div", "bin" + (i === youIdx ? " you" : ""));
    bin.title = `${BIN_LABELS[i]} min · ${c.toLocaleString("en-US")} detectives`;
    const bar = el("span", "bar");
    bar.style.height = Math.max(3, Math.round((c / maxC) * 100)) + "%";
    bin.appendChild(bar);
    hist.appendChild(bin);
    const lbl = el("span", i === youIdx ? "you" : undefined, BIN_LABELS[i]);
    if (i === youIdx) lbl.appendChild(el("em", undefined, "You"));
    histx.appendChild(lbl);
  });
}

// Solid · hatched · empty, plus the percentages printed underneath - three fills that are told
// apart by texture, not hue, and a legend that carries the numbers in words either way.
// ── the distribution, drawn rather than spelled out (track 12) ────────────────────────────────
// The owner: «выглядит ужасно, может распределение вместо текста, хочется видеть визуально».
// It was a bar with a separate line of prose under it - `HARDER 67% SAME 33% SOFTER 0%` - so the
// picture and the words competed to say one thing, and the words won on weight. The labels move
// INTO the bar: each segment carries its own name and share, so the shape and the figure are the
// same object. A segment too narrow to hold its label drops it rather than overflowing, and its
// `title` still carries the count - the bar stays readable at 0%, which is where the old legend
// printed `SOFTER 0%` and made a fourth of the row about nothing.
//
// Colour is not a channel here and never was (spec §0): the three fills are solid / hatched /
// hollow, so the distribution survives greyscale and CVD. That is unchanged - only the text moved.
function renderVoteBar(tally: VoteTally, total: number, leaderKey: keyof VoteTally) {
  const segs: [keyof VoteTally, string][] = [["Harder", "harder"], ["Same", "same"], ["Softer", "softer"]];
  const track = el("div", "vb-track");
  for (const [k, cls] of segs) {
    const pct = total ? (tally[k] / total) * 100 : 100 / 3;
    const seg = el("span", `vb-seg ${cls}${total ? "" : " empty"}${k === leaderKey && total ? " win" : ""}`);
    seg.style.width = pct + "%";
    seg.title = `${k}: ${tally[k]} of ${total}`;
    // Below this share a label cannot be read inside its own segment at 11px, so the segment
    // carries the shape alone. Measured against the narrowest place this runs, a 360px phone.
    if (total && pct >= 18) {
      seg.append(el("i", "vb-k", k), el("b", "vb-n", `${Math.round(pct)}%`));
    }
    track.appendChild(seg);
  }
  const box = $("r-votebar");
  box.innerHTML = "";
  box.append(track);
  if (!total) box.appendChild(el("div", "vote-note", "Nobody has voted yet - yours would be the first."));
}
function clearVoteBar() { $("r-votebar").innerHTML = ""; }

/**
 * One sentence about the level, gated exactly on what the vote can do.
 *
 * It counts the SERVER's tally, never the optimistic one the bar draws. The two are different
 * objects at one moment - between your press and the endpoint answering - and the verdict beside
 * them came from the server. Mixing them meant a player whose vote was the decisive fifth read
 * "5 votes in and no clear winner", because the total had moved and the verdict had not. The
 * handler refreshes both together and repaints (docs/11-stats-ia.md §3).
 *
 * `next === null` is an archive case, whose vote steers nothing at all - so the screen says nothing
 * about tomorrow's difficulty rather than implying this post decides it.
 */
function voteVerdictLine(): string {
  const r = lastResults;
  const n = r?.next ?? null;
  if (!r || !n) return "This case is closed - the vote on the live case sets the next level.";
  const t = r.voteTally;
  const total = t.Harder + t.Same + t.Softer;
  const word = tierWord(n.tier);
  const need = r.voteMinTotal;
  if (n.verdict === null) {
    return total < need
      ? `${need} votes decide the level - ${total} so far.`
      : `${total} votes in and no clear winner, so the next case stays at ${word}.`;
  }
  if (n.moved === "up") return `The vote is sending the next case up to ${word}.`;
  if (n.moved === "down") return `The vote is bringing the next case down to ${word}.`;
  if (n.verdict === "Same") return `The vote says keep it at ${word}.`;
  // A decided vote that moves nothing, at either wall of the ladder the VOTE walks. That ladder is
  // `LEVEL_TIERS`, sized from the bank, and it is not the same thing as the three-point difficulty
  // scale the tier stamp prints - with no 🔴 cases in the bank it currently tops out at Medium. So
  // the copy says what is true (there is nothing harder to serve) rather than "Medium is the end of
  // the ladder", which would contradict the `LEVEL 2 OF 3` stamp on the same card.
  return n.verdict === "Harder"
    ? `The vote says harder, but there is no harder case to serve yet.`
    : `The vote says easier, and ${word} is already the easiest level.`;
}

function renderVote() {
  const box = $("r-vote");
  box.innerHTML = "";
  // ONE source for the tally on this screen. `META.vote.tally` is /api/daily's copy, read when the
  // board loaded; `lastResults.voteTally` is /api/check's, read when you solved - and the verdict
  // sentence underneath is computed from that one. Other people vote in between, so the bar could
  // print "101 votes so far" over a verdict reasoned from a different number. The sheet takes the
  // later reading and the vote handler refreshes both together (docs/11-stats-ia.md §1/R1).
  const tally: VoteTally = { ...(lastResults?.voteTally ?? META.vote.tally) };
  if (diffVote && !META.vote.choice) tally[diffVote as keyof VoteTally]++;
  const total = tally.Harder + tally.Same + tally.Softer;
  const leader = (Object.entries(tally) as [keyof VoteTally, number][]).sort((a, b) => b[1] - a[1])[0];

  // ── an ARCHIVE case: this post's vote steers nothing ────────────────────────────────────────
  // `next === null` is the server saying so (createDailyPost reads the CURRENT post's vote). The
  // old screen answered that by offering three buttons whose press changes no difficulty, and by
  // showing no verdict - which the owner read, correctly, as the data being missing on some cases
  // for no stated reason. It is not missing; it does not exist. So the block says which, and still
  // draws the distribution, because "what did people think of this case" is a real answer even
  // when it decides nothing.
  // ── an ARCHIVE case has no vote at all (dec. 115) ───────────────────────────────────────────
  // `next === null` is the server saying this post's vote steers nothing: createDailyPost reads the
  // CURRENT post's tally. Three versions of this block have now been wrong. It offered three
  // buttons that changed no difficulty; then it offered the distribution with a sentence explaining
  // why the buttons were gone. The owner's read of the second - «нужно ли голосование на старых
  // кейсах? кажется что нет» - is the rule this document already states: a cell answers a question
  // the reader has HERE (docs/11 §1/R2), and nobody reading a case out of the archive is asking how
  // its solvers voted on a level that has long since been set. An explanation of why a control does
  // nothing is still the control taking up the room.
  //
  // What survives is the countdown below, which is true on any case: the next one does open.
  const archive = !!lastResults && lastResults.next === null;

  const myVote = diffVote ?? META.vote.choice;
  if (archive) {
    clearVoteBar();
  } else if (!myVote) {
    for (const [key, label] of [["Harder", "Harder"], ["Same", "Same"], ["Softer", "Softer"]] as [string, string][]) {
      const b = el("button", "btn secondary", label);
      b.title = "Solvers set tomorrow's difficulty";
      b.addEventListener("click", async () => {
        diffVote = key;
        renderVote();
        try {
          const r = await api("/api/vote", { choice: key });
          // `choice` is what "you have already voted" means, and leaving it null is what let the
          // optimistic +1 be applied a SECOND time on top of a server tally that already carried
          // the vote - every later repaint of this sheet (play again → see results) counted the
          // player twice.
          if (r.tally) { META.vote.tally = r.tally; META.vote.choice = key; }
          // The verdict and the tally have to move together: this press can be the one that
          // decides, and the sheet was built before it. `next` is only overwritten when the answer
          // actually carries one - `?? null` would blank a live verdict on any response that
          // omitted the field, which is a worse failure than a stale one.
          if (lastResults && r.tally) lastResults.voteTally = r.tally;
          if (lastResults && r.next !== undefined) lastResults.next = r.next;
          renderVote();
          toast("Vote counted - tomorrow's case comes from that tier", "ok");
        } catch {
          // The optimistic paint already said "You voted Harder" and drew a bar. Nothing was
          // recorded, so the screen has to take it back rather than leave a vote on display that
          // the server never received - the toast alone is a second message contradicting the
          // first (dec. 37: nothing on screen that did not happen).
          diffVote = null;
          renderVote();
          toast("Couldn't record vote", "info");
        }
      });
      box.appendChild(b);
    }
    // Before you vote, the bar and its legend are the answer to the question the three buttons
    // are asking - two blocks saying one thing, on the sheet that had nine of them (dec. 80).
    clearVoteBar();
  } else {
    const line = el("div", "vote-done");
    setRich(line, ["You voted ", [myVote], ` · ${total} ${total === 1 ? "vote" : "votes"} so far`]);
    box.appendChild(line);
    renderVoteBar(tally, total, leader[0]);
    // ── what the vote has actually DONE, which the bar cannot say ────────────────────────────────
    // A three-segment bar with printed percentages reads as a result. Below VOTE_MIN_TOTAL the vote
    // moves the difficulty by exactly nothing, and on this subreddit it collects two votes - so the
    // screen was showing a decisive-looking picture of a decision that had not been taken. The
    // verdict comes from the server's single definition of "decided" (voteVerdict), the same one
    // the publisher acts on and the feed card prints, so no two screens can promise different
    // tomorrows.
    // Into the BAR's box, not the button row's: `#r-vote` is `.vote-row`, a flex row, so a note
    // appended there becomes a second column beside "You voted Harder" rather than the verdict
    // underneath the bar it is about.
    $("r-votebar").appendChild(el("div", "vote-note", voteVerdictLine()));
  }

  // A countdown that has run out is not a countdown. `nextOpensInMin` floors at 0, so a case whose
  // slot has already come round printed `opens in 0h 00m` - a clock counting down to a moment in
  // the past, on the line whose whole job is to say when to come back.
  const m = META.nextOpensInMin;
  $("r-next").textContent = m <= 0
    ? `#${META.nextCaseNumber} opens soon`
    : `#${META.nextCaseNumber} opens in ${Math.floor(m / 60)}h ${pad(m % 60)}m`;
}

// ── the rank ladder (dec. 89) ────────────────────────────────────────────────────────────────
// All five rungs, in order, with the one you hold framed in ink and the next one named. The
// emoji are back and they are load-bearing here rather than decorative: a rank IS content - the
// thing the screen is about - in exactly the sense dec. 63 used to keep the item emoji (🍕 ⌨️)
// while taking the traffic light out of the chrome. They are still not the only channel: the
// rung you hold is framed, the rungs behind you are joined by a filled ink rail, and the ones
// ahead are not - so the ladder reads in greyscale and with the glyphs missing entirely.
//
// RANKS is stored top-first; the ladder is drawn bottom-first, which is the direction it is
// climbed. src/shared/themes.ts belongs to another track - this reads it, unchanged - and it is
// read for the RUNGS only. Which rung is held, and how far the next one is, are the server's
// answer now (`results.rankState`, src/server/flair.ts), for two reasons that are the same reason:
// the game, the STREAK board and the subreddit flair must not disagree about a player's rank, and
// the distance is arithmetic on TWO streaks. The client computed `next.min - streak` off one
// number, so a player whose best is 12 and whose current run is 1 was told the next rung was two
// days away when it is thirteen. `rankFor` is likewise not used: it answers "Detective" for a
// streak of 0, and an unranked player must not be told they hold the first rung.
const RANK_LADDER = [...RANKS].reverse();
const rankParts = (label: string): [string, string] => {
  const m = /^(\S+)\s+(.*)$/u.exec(label);
  return m ? [m[1], m[2]] : ["", label];
};

// `box` is a parameter because the ladder is drawn on two surfaces now - the result sheet and your
// file - and both must read the SAME `rankState()` answer rather than each deriving one.
/** One sentence, drawn only for a player whose record predates the unit change. */
function renderStreakNote(legacy: boolean, afterId: string): void {
  const host = $(afterId);
  const old = host.parentElement?.querySelector(".streak-note");
  if (old) old.remove();
  if (!legacy) return;
  const note = el("p", "streak-note",
    "Your longest run was earned when a streak counted days you came back. It stays yours. "
    + "A streak now counts cases closed on the day they run - so a new one starts with the next "
    + "daily case, and the archive no longer adds to it.");
  host.parentElement?.insertBefore(note, host.nextSibling);
}

function renderRanks(rs: RankState, box: HTMLElement = $("r-ranks")) {
  box.textContent = "";
  // The rung held, found by its own threshold rather than recomputed from a streak. `label: null`
  // is "no rung yet" and is the one state the ladder must not guess at.
  const now = rs.label === null ? -1 : RANK_LADDER.findIndex((r) => r.min === rs.min);

  const top = el("div", "rk-top");
  top.appendChild(el("span", "caps", "Rank"));
  top.appendChild(el("span", "rk-now",
    rs.label === null ? "Not ranked yet" : rankParts(rs.label)[1]));
  if (rs.nextLabel) {
    const [emoji, name] = rankParts(rs.nextLabel);
    // The count is days the CURRENT run still needs, which is why the strip above prints that run
    // as a figure of its own: without it, "13 days" beside a longest run of 12 reads as a bug.
    top.appendChild(el("span", "rk-goal", rs.nextIn > 0
      ? `${rs.nextIn} ${rs.nextIn === 1 ? "case" : "cases"} to ${emoji} ${name}`
      : `${emoji} ${name} next`));
  } else {
    top.appendChild(el("span", "rk-goal", "Top rank reached"));
  }
  box.appendChild(top);

  const rail = el("ol", "rk-rail");
  RANK_LADDER.forEach((r, i) => {
    const [emoji, name] = rankParts(r.label);
    const li = el("li", "rk");
    li.dataset.state = i < now ? "past" : i === now ? "now" : "future";
    li.title = `${name} - ${r.min} ${r.min === 1 ? "case" : "cases"} in a row, each on its own day`;
    li.append(el("span", "rk-e", emoji), el("span", "rk-d", String(r.min)));
    rail.appendChild(li);
  });
  box.appendChild(rail);
}

function showResult() {
  const r = lastResults;
  if (!r) return;
  // The HUD reads the run you are ON, not the best you ever held. Its label stays the bare word,
  // because the board screen prints no other streak figure - what was wrong was the number under
  // it, which used to be `best` while the meter beside it counted today.
  setStreakHud(r.streakCurrent);

  // ── ① × ③: what this case is, and where it sits in your own run of them ──────────────────────
  // "Case #47 · solved" spent the line restating the stamp in the corner and the hero time under
  // it. `casesSolved` is the number the bug report was counting, and here it turns a case number
  // into a position in the reader's own history - the question neither world answers alone
  // (docs/11-stats-ia.md §7). It is why the figure no longer needs a fact cell of its own.
  $("r-kicker").textContent = r.casesSolved > 0
    ? `Case #${PZ.caseNumber} · your ${ordinal(r.casesSolved)}`
    : `Case #${PZ.caseNumber} · solved`;
  const time = $("r-time");
  time.textContent = fmtTime(r.timeSec);
  // The one moment `bestTimeSec` can be delivered as news instead of as a statistic. Gated on the
  // server (a replay is not news, and a first close has no record to beat) so this is a pure draw.
  if (r.personalBest) time.appendChild(el("span", "tag pb", "Your best"));

  // ── ① the comparison: among the people who closed THIS case ───────────────────────────────────
  // This line used to switch between a percentile over the DAY and a finishing order over the CASE
  // depending on whether the day board had 50 rows - one sentence, two subjects, switched by a
  // threshold no reader can see, which is the same defect as the splash's old room cell. Both
  // branches now measure one thing; the threshold chooses only how precisely to state it, because a
  // rank is exactly true at any N while a percentage is a claim about a distribution (dec. 37).
  //
  // `caseRank` is 0 when you have no row on the case board (no resolvable username), and then the
  // only honest fact left is the order you finished in - which is `solveOrder`, a different measure
  // and so a different sentence.
  const field = r.caseTotal.toLocaleString("en-US");
  let sub = r.caseRank > 0
    ? (r.caseBetterPct !== null && r.caseTotal >= PCT_MIN
        ? `Faster than ${r.caseBetterPct}% of ${field} on this case`
        : `${ordinal(r.caseRank)} fastest of ${field} on this case`)
    : `You're the ${ordinal(r.solveOrder)} detective to close this case`;
  // What the solve cost, where the ledger already puts it - beside the figure it qualifies, and
  // only when there is one. It used to be a fact cell labelled `HINTS`, a word wider than its
  // counter: rungs 1 and 2 are hints too, and free, and are not in this number (docs/11 §6).
  if (r.hints > 0) sub += ` · ${r.hints} cell${r.hints === 1 ? "" : "s"} revealed`;
  $("r-sub").textContent = sub;

  // ── ③ you, all time: the strip is now homogeneous, and it sits against the ladder it explains ──
  // The strip used to run HINTS · CASES CLOSED · CURRENT STREAK · LONGEST STREAK - two worlds in
  // one ruled row, drawn identically, with nothing to say the subject changed halfway along. The
  // two world ① figures moved into the hero above (the kicker and the sub line), which leaves the
  // pair the rank ladder actually needs: `N DAYS TO CHIEF INSPECTOR` is counted from the CURRENT
  // run, and without that number printed beside a longest run of 12 the distance reads as an error
  // (dec. 100). Two runs, two words, one world.
  const stats = $("r-stats");
  stats.innerHTML = "";
  const fact = (key: string, value: string, small = false) => {
    const f = el("div", "fact");
    f.append(el("div", "k", key), el("div", "v" + (small ? " sm" : ""), value));
    return f;
  };
  stats.append(fact("Current streak", String(r.streakCurrent)),
               fact("Longest streak", String(r.streakBest)));
  renderRanks(r.rankState);
  // ── the zero that needs explaining (dec. 123) ────────────────────────────────────────────────
  // A streak used to count days you came back; it now counts cases closed on the day they ran. Every
  // live player's current run therefore reads 0 the first time they open this after the change,
  // while their record still reads whatever they earned. Silence here is the worst of the three
  // options: the number looks broken, and the player who most deserves an explanation is the one
  // who had the longest run.
  renderStreakNote(r.streakLegacy, "r-ranks");

  // `dataset.off` is "this section has nothing to show", as opposed to "the solution face is up"
  const histblock = $("r-histblock");
  if (r.hasHistogram && r.histogram) {
    delete histblock.dataset.off;
    renderHistogram(r.histogram.counts, r.histogram.youIdx);
  } else histblock.dataset.off = "1";

  boardCache.clear();
  void paintResultBoard();

  const tbl = $("r-table") as HTMLTableElement;
  tbl.innerHTML = "";
  const hr = document.createElement("tr");
  for (const h of ["Suspect", "Coat", "Time", "Item"]) hr.appendChild(el("th", undefined, h));
  tbl.appendChild(hr);
  // From the snapshot, never from the live board. The `continue` is the belt to that brace: an
  // undetermined cell has no answer to print, and it must not be able to stop the sheet opening.
  const sol = solvedGrid ?? grid;
  for (const s of ctx.suspects) {
    const f = effectiveValue(ctx, sol, "flair", s), t = effectiveValue(ctx, sol, "time", s), o = effectiveValue(ctx, sol, "object", s);
    if (!f || !t || !o) continue;
    const ol = valueLabel("object", o, theme);
    const tr = document.createElement("tr");
    tr.appendChild(el("td", undefined, s));
    const coat = document.createElement("td");
    coat.append(el("span", `fl-mini fl-${f}`, f[0]), document.createTextNode(" " + valueLabel("flair", f, theme).label));
    tr.appendChild(coat);
    tr.appendChild(el("td", undefined, t));
    tr.appendChild(el("td", undefined, `${ol.emoji} ${ol.label}`));
    tbl.appendChild(tr);
  }

  renderVote();
  setSolution(false);

  document.body.dataset.view = "result";
}

// A guest solved the case and the server recorded nothing - no time on the board, no rank, no
// streak (dec. 44). The screen says exactly that and offers the one thing that changes it.
function showGuest() {
  guestSolved = true;
  $("btn-results").removeAttribute("hidden");
  syncLane();
  $("g-time").textContent = fmtTime(seconds);
  document.body.dataset.view = "guest";
}

function showGame() { document.body.dataset.view = "game"; setSolution(false); }

// The solution is the sheet's second face, not a section stacked under the histogram: inline it
// costs ~150px, and that is precisely what pushed the result past the bottom of an 852px phone.
// The spec's own result order puts "Full solution" in the footer next to "Play this case again".
const R_SECS = ["r-histblock", "r-lbblock", "r-tomorrow"];
let solutionOpen = false;
function setSolution(open: boolean) {
  solutionOpen = open;
  $("r-solution").toggleAttribute("hidden", !open);
  for (const id of R_SECS) $(id).toggleAttribute("hidden", open || !!$(id).dataset.off);
  $("btn-solution").textContent = open ? "Back to the result" : "Full solution";
}
function showSolution() { setSolution(!solutionOpen); }

// Once the Results button is up, three labelled buttons fight over a 360px control bar. The
// warm-up lane is the one that yields: a case you have already closed has nothing to warm up
// for, and the lane is back the moment you leave the result.
function syncLane() {
  $("btn-warmup").toggleAttribute("hidden", !practiceMode && !$("btn-results").hasAttribute("hidden"));
}

// ───────────────────────── onboarding: 3 coach marks ─────────────────────────
const TUT_STEPS = [
  { sel: ".clue-panel", text: "Every clue is true. Your job: cross out whatever they rule out." },
  { sel: ".bcell", text: `${IS_COARSE ? "Tap" : "Click"} a chip to cross it out - same again to bring it back.` },
  { sel: "#meter-cells", text: "One chip left in a cell - that's the answer. Deduce all 12 and the case closes itself." },
];
let tutStep = -1;
function coachShow(i: number) {
  const step = TUT_STEPS[i];
  const target = document.querySelector(step.sel) as HTMLElement | null;
  if (!target) { coachEnd(); return; }
  tutStep = i;
  const rect = target.getBoundingClientRect();
  const ring = $("coach-ring");
  ring.style.left = (rect.left - 6) + "px"; ring.style.top = (rect.top - 6) + "px";
  ring.style.width = (rect.width + 12) + "px"; ring.style.height = (rect.height + 12) + "px";
  $("coach-step").textContent = `${i + 1} / ${TUT_STEPS.length}`;
  $("coach-text").textContent = step.text;
  $("coach-next").textContent = i === TUT_STEPS.length - 1 ? "Got it" : "Next";
  const tip = $("coach-tip"); tip.style.visibility = "hidden";
  $("coach").classList.add("show");
  requestAnimationFrame(() => {
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    const x = Math.min(Math.max(8, rect.left), window.innerWidth - tw - 8);
    let y = rect.bottom + 14;
    if (y + th > window.innerHeight - 8) y = Math.max(8, rect.top - th - 14);
    tip.style.left = x + "px"; tip.style.top = y + "px"; tip.style.visibility = "visible";
  });
}
function coachEnd() {
  $("coach").classList.remove("show"); tutStep = -1;
  startTimer(); // "seen" is tracked server-side (tut:{userId}, set on first /api/daily) - no localStorage
}
function startTutorial() { seconds = 0; if (timerInt) clearInterval(timerInt); coachShow(0); }

// ───────────────────────── timer / init ─────────────────────────
let timerInt: number | null = null;
// persist active time (not practice). This heartbeat, not the move autosave, is what carries the
// stall nudge: a player who has stopped moving stops autosaving by definition.
function saveSeconds() {
  if (!practiceMode) api("/api/state", { seconds }).then((r) => { if (r?.nudge) showNudge(); }).catch(() => {});
}
function startTimer() {
  if (timerInt) clearInterval(timerInt);
  timerInt = window.setInterval(() => {
    if (solved || document.visibilityState !== "visible") return; // active time only: pause on solve / hidden tab
    seconds++;
    $("hud-time").textContent = fmtTime(seconds);
    if (seconds % 10 === 0) saveSeconds();
  }, 1000);
}

function helpText(): string {
  const verb = IS_COARSE ? "Tap" : "Click";
  // the case's four items, each glyph with its word (dec. 150) - the board's chips can't fit the words
  const items = Object.values(theme.objects).map((o) => `${o.emoji} ${o.label}`).join(" · ");
  return `${verb} a chip to cross it out, again to bring it back. One chip left in a cell is the answer; deduce all 12 and the case closes itself. Items in this case: ${items}.`;
}

// reset uses two-tap confirm (confirm() is blocked inside the sandboxed webview)
//
// Dec. 91: the warning used to be a red outline that appeared on HOVER, i.e. on an idle button
// nobody had pressed - which is both the wrong moment and, on a rail where every other button
// only deepens, a colour the owner read as a rendering fault twice. The danger is announced at
// the one moment it is real: between the arming press and the clearing one. `data-armed` is that
// moment, drawn in ink.
let resetArm = false, resetTimer: number | null = null;
function setArmed(on: boolean) {
  const b = $("btn-restart");
  if (on) b.dataset.armed = "1"; else delete b.dataset.armed;
  b.title = on ? "Press again to clear the board" : "Start over";
}
function restart() {
  if (solved) return;
  if (!resetArm) {
    resetArm = true;
    setArmed(true);
    toast(`${IS_COARSE ? "Tap" : "Click"} start over again to clear the board`, "info");
    if (resetTimer) clearTimeout(resetTimer);
    resetTimer = window.setTimeout(() => { resetArm = false; setArmed(false); }, 2500);
    return;
  }
  resetArm = false; if (resetTimer) clearTimeout(resetTimer);
  setArmed(false);
  clearBoard();
  toast("Board cleared", "ok");
}

// "Play this case again" from the result screen - unconditional replay (the solve is already recorded server-side)
function playAgain() {
  solved = false; seconds = 0;
  clearBoard();
  $("btn-hint").removeAttribute("hidden"); // results button stays to reopen the recorded result
  showGame();
  startTimer();
}

function clearBoard() {
  grid = freshGrid(ctx); history = []; rowsDone.clear();
  lastAdvice = null; serverVerdict = null;
  hideNotice(); hideNudge();
  renderAll(); scheduleSave();
}

function wire() {
  $("btn-restart").addEventListener("click", restart);
  $("btn-undo").addEventListener("click", undo);
  $("notice-x").addEventListener("click", hideNotice);
  $("nudge-x").addEventListener("click", hideNudge);
  $("nudge-go").addEventListener("click", () => { hideNudge(); void openHints(); });
  $("wdone-go").addEventListener("click", () => { closeWarmupDone(); void exitPractice(); });
  $("wdone-more").addEventListener("click", () => { closeWarmupDone(); void anotherWarmup(); });
  $("btn-help").addEventListener("click", () => toast(helpText(), "info", 9000));
  $("btn-warmup").addEventListener("click", () => { if (practiceMode) void exitPractice(); else void enterPractice(); });
  document.addEventListener("visibilitychange", () => { if (document.hidden) saveSeconds(); }); // flush active time when hidden
  $("btn-hint").addEventListener("click", () => { void openHints(); });
  $("btn-results").addEventListener("click", () => { if (guestSolved) showGuest(); else if (lastResults) showResult(); });
  $("btn-again").addEventListener("click", playAgain);
  $("btn-solution").addEventListener("click", showSolution);
  $("btn-retry").addEventListener("click", () => { document.body.dataset.view = "load"; void load(); });
  $("btn-back").addEventListener("click", showGame);
  $("btn-guest-back").addEventListener("click", showGame);
  $("btn-login").addEventListener("click", () => showLoginPrompt());
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const v = document.body.dataset.view;
    if (v === "standings") closeStandings();
    // Escape has to agree with the button, and on this view the button is the only thing that
    // knows where the reader came from. `showGame()` would drop someone who reached their file
    // from the splash onto a board that has never been loaded (dec. 98: that path deliberately
    // does not call /api/daily).
    else if (v === "me") closeMe();
    else if (v !== "game") showGame();
  });
  $("btn-standings").addEventListener("click", openStandings);
  $("btn-lb-all").addEventListener("click", openStandings);
  $("btn-st-back").addEventListener("click", closeStandings);
  $("btn-st-close").addEventListener("click", closeStandings);
  $("btn-me-back").addEventListener("click", closeMe);
  $("btn-me-close").addEventListener("click", closeMe);
  $("btn-me-open").addEventListener("click", () => { void openMe(); });
  // Your own name, in any ledger, opens your file - plan 04 §D.4's own entry point, and the one
  // place a reader is already looking at themselves. Delegated on the four containers rather than
  // bound per row, because every one of them is rebuilt on every repaint. Somebody ELSE's row is
  // deliberately inert: what is public about a player who never opted into a profile is a product
  // decision of a different shape, and nobody has asked for it (docs/11-stats-ia.md §5).
  for (const id of ["r-lb", "r-lbyou", "st-list", "st-you"]) {
    $(id).addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest(".b-row.you")) void openMe();
    });
  }
  wireScope("r-scope", (s) => { lbScope = s; }, () => { void paintResultBoard(); });
  wireScope("st-scope", (s) => { stScope = s; }, () => { void paintStandings(); });
  window.addEventListener("resize", () => { if (tutStep >= 0) coachShow(tutStep); });
  $("coach-next").addEventListener("click", () => { if (tutStep >= TUT_STEPS.length - 1) coachEnd(); else coachShow(tutStep + 1); });
  $("coach-skip").addEventListener("click", coachEnd);
}

// a saved grid must cover every cat/suspect/value of the current case, else it's stale
function gridMatchesCtx(g: GridState | null, c: PuzzleCtx): boolean {
  if (!g) return false;
  for (const cat of c.catIds) {
    if (!g[cat]) return false;
    for (const s of c.suspects) {
      if (!g[cat][s]) return false;
      for (const v of c.cats[cat]) if (!(v in g[cat][s])) return false;
    }
  }
  return true;
}

function ctxFor(pz: DailyResp["puzzle"]): PuzzleCtx {
  return {
    suspects: pz.suspects, catIds: CAT_IDS,
    cats: { flair: [...FLAIR_TOKENS], time: [...TIME_TOKENS], object: pz.objectTokens },
    timeValues: [...TIME_TOKENS],
  };
}

// Cases carry 7-15 clues; the layout gives the clue list the room it needs by trading chip height.
// The fourth step exists because the ladder stopped at the 14-clue tutorial case and the bank also
// holds one 15-clue GREEN case - i.e. a daily. Measured on it: `#clue-list` ran +10px past its own
// box at 375x667 and +16px at 360x800, and `overflow: hidden` means that last clue was missing in
// silence, on the two commonest phones.
function applyDensity() {
  $("view-game").dataset.density = clues.length > 14 ? "tightest"
    : clues.length > 12 ? "tight" : clues.length > 10 ? "dense" : "normal";
}

// ───────────────────────── onboarding: warm-up practice lane ─────────────────────────
function applyPuzzleData(pz: DailyResp["puzzle"], savedGrid: GridState | null) {
  PZ = pz;
  theme = THEME_BY_ID[pz.themeId];
  clues = pz.clues;
  ctx = ctxFor(pz);
  grid = gridMatchesCtx(savedGrid, ctx) && savedGrid ? savedGrid : freshGrid(ctx);
  hints = 0; solved = false; seconds = 0; history = []; rowsDone.clear();
  // a new case means every hint answer we hold is about a board that no longer exists
  lastAdvice = null; serverVerdict = null; revealedHints = []; hintIdx = 0; hintPane = "advice";
  applyDensity();
  renderAll(); updateHintBtn();
}

function setWarmupBtn(inPractice: boolean) {
  const b = $("btn-warmup");
  b.querySelector(".btxt")!.textContent = inPractice ? "Today's case" : "Warm-up";
  b.title = inPractice
    ? "Leave the warm-up and go back to today's case"
    : "Warm-up: practise the mechanic on an over-clued case";
}

// The first-run ladder (plan 02/B2). `showWarmup` is the server's flag and it closes itself - one
// finished warm-up, or one skip, and it never comes back. A guest cannot be tracked at all, so the
// server always offers it and this session's answer is remembered here instead.
function showLadder(pendingTut: boolean) {
  $("ladder").classList.add("show");
  const close = () => { ladderDone = true; $("ladder").classList.remove("show"); };
  $("ladder-go").addEventListener("click", () => { close(); void enterPractice(pendingTut); }, { once: true });
  $("ladder-skip").addEventListener("click", () => {
    close();
    api("/api/practice/skip", {}).catch(() => {}); // without this the ladder returns on every reload
    if (pendingTut) startTutorial(); else startTimer();
  }, { once: true });
}

// The warm-up lane: an over-clued case where every move is forced, isolated from the daily (no
// leaderboard, no streak, its own saved grid). Reachable from the ladder and from the footer.
async function enterPractice(withCoach = false) {
  if (practiceMode || solved) return;
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; api("/api/state", { grid, seconds }).catch(() => {}); } // flush daily
  let pr: PracticeResp;
  try { pr = await api("/api/practice"); } catch { toast("The warm-up didn't load - today's case is still here.", "info"); return; }
  practiceMode = true;
  hideNotice(); hideNudge();
  applyPuzzleData(pr.puzzle, pr.grid ?? null);

  const n = (pr.warmupsDone ?? 0) + 1;
  const total = pr.poolSize ?? 0;
  $("case-no").textContent = total ? `WARM-UP ${n}/${total}` : "WARM-UP";
  $("case-title").textContent = pr.puzzle.title;
  // no tier stamp in the lane: "WARM-UP n/total" in the case slot already carries both the
  // identity and the difficulty, and a second WARM-UP mark beside it is a stamp saying nothing
  paintTier($("tier-badge"), "");
  $("epilogue").textContent = "";
  $("btn-hint").setAttribute("hidden", "");   // hints target the daily case, not practice
  $("btn-results").setAttribute("hidden", "");
  setWarmupBtn(true);
  syncLane();
  showGame();
  // A toast, not the hint slip (dec. 79): this is an acknowledgement of a press, it is gone in
  // five seconds, and it must not look like the panel that answers questions about the board.
  toast(pr.first
    ? "Warm-up: every move here follows straight from a clue."
    : "Warm-up: practice only - it counts towards nothing.", "info", 5000);
  if (withCoach) startTutorial(); else startTimer();
}

// Back to the daily. Deliberately not location.reload(): a reload would lose the "warm-up done"
// hand-off, and for a guest - whose finished warm-up the server cannot record - it would put the
// first-run ladder straight back on screen.
async function exitPractice() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  let data: DailyResp;
  try { data = await api("/api/daily"); } catch { toast("Couldn't reload today's case.", "info"); return; }
  practiceMode = false;
  ladderDone = true;
  applyDaily(data);
  setWarmupBtn(false);
  showGame();
  hideNotice();
  if (!solved) startTimer();
}

// Closing a warm-up is the one moment in the lane worth marking, and it used to be a grey plaque
// followed by a 1.3s timer that drove you somewhere you had not asked to go (dec. 82). It is a
// card now - a stamp, a headline, and the two things a player can actually want next. The pool
// holds 15 warm-ups and rotates, so "one more" is a real offer and not a re-run.
function onPracticeSolved(nextIsDaily: boolean) {
  $("toast").classList.remove("show");
  $("wdone-h").textContent = nextIsDaily ? "That is the whole mechanic" : "Warm-up closed";
  $("wdone-p").textContent = nextIsDaily
    ? "Today's case works exactly the same way - it just doesn't hand you every step."
    : "Nothing here counts towards the board or your streak. Today's case does.";
  $("wdone").classList.add("show");
}
function closeWarmupDone() { $("wdone").classList.remove("show"); }

// "One more warm-up": leave the solved lane and re-enter it. The saveTimer is dropped first on
// purpose - enterPractice flushes a pending save to /api/state, which is the DAILY attempt, and
// the grid in hand right now is a practice grid.
async function anotherWarmup() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  if (timerInt) clearInterval(timerInt);
  practiceMode = false; solved = false;
  await enterPractice();
}

// Everything /api/daily says, applied to the screen. Shared by the first load and by the return
// trip out of the warm-up lane, so the two can never drift apart.
function applyDaily(data: DailyResp) {
  PZ = data.puzzle; META = data.meta;
  // guard: a saved grid from a different puzzle shape (e.g. bank/rename change) is discarded
  const savedOk = gridMatchesCtx(data.attempt.grid, ctxFor(data.puzzle));
  applyPuzzleData(data.puzzle, savedOk ? data.attempt.grid : null);
  hints = data.attempt.hints ?? 0;
  solved = savedOk ? (data.attempt.solved ?? false) : false;
  seconds = savedOk ? (data.attempt.elapsedSec ?? 0) : 0;
  diffVote = data.attempt.vote ?? null;

  $("case-no").textContent = `CASE #${PZ.caseNumber}`;
  $("case-title").textContent = PZ.title;
  paintTier($("tier-badge"), PZ.tier);

  renderAll();
  setStreakHud(META.streakCurrent ?? 0);
  updateHintBtn();
  $("hud-time").textContent = fmtTime(seconds);
  if (solved) { $("btn-hint").setAttribute("hidden", ""); $("btn-results").removeAttribute("hidden"); }
  else $("btn-hint").removeAttribute("hidden");
  syncLane();
  booted = true;
}

async function load() {
  let data: DailyResp;
  try { data = await api("/api/daily"); }
  catch (e) {
    // A bare string in the clue list reads as a broken board. The archive not answering is its
    // own screen (spec 4.11), and its one red mark is the FILE UNAVAILABLE stamp.
    $("err-code").textContent = String((e as Error)?.message ?? "request failed");
    document.body.dataset.view = "error";
    return;
  }
  applyDaily(data);
  showGame();

  if (solved) {
    const solvedAs = JSON.parse(JSON.stringify(grid)) as GridState;   // the saved board, before play-again can clear it
    api("/api/check", { grid }).then((r) => {
      if (r.status !== "solved") return;
      lastResults = r.results;
      solvedGrid = solvedAs;
    }).catch(() => {});
    startTimer();
    return;
  }
  // First run, server-tracked per logged-in player: showWarmup offers the warm-up rung before
  // today's case, showTutorial the 3 coach marks. Both are consumed once. ?tut=1 forces the whole
  // ladder (judges/testing), ?tut=0 suppresses it. No localStorage - unreliable in the webview.
  const tutParam = new URLSearchParams(location.search).get("tut");
  const wantTut = tutParam === "1" || (tutParam !== "0" && META.showTutorial);
  const wantWarmup = tutParam === "1" || (tutParam !== "0" && META.showWarmup && !ladderDone);
  if (wantWarmup) showLadder(wantTut);
  else if (wantTut) startTutorial();
  else startTimer();
}

// wire() is separate from load() so "Try again" can re-run the fetch without stacking a second
// set of listeners on every button.
wire();
// The one thing the splash can hand this document (dec. 98). Expanding REPLACES the document, so
// the press that asked for the standings arrives as a note in the origin's storage rather than in
// memory - handoff.ts carries the argument and the fallbacks. /api/daily is not called on this
// path: it is the request that starts your run, and it waits for the press that asks for a board.
if (takeHandoff() === "standings") openStandings();
else void load();
