// Smoke test of the shared client/server logic (the webview can't be launched here):
// for each bank case we set grid = solution and check that
//   * effectiveCount === 12 (all cells derived),
//   * all clues have status "ok" (client's "solved" condition),
//   * gradeGrid == "solved" (server check) - i.e. client and server agree.
// Plus we check that on an empty grid the statuses are computed without crashes.
import type { Clue, Solution } from "../src/shared/types.js";
import {
  freshGrid, effectiveCount, effectiveValue, clueStatus,
  type GridState, type PuzzleCtx,
} from "../src/shared/status.js";
import { renderClue } from "../src/shared/render.js";
import { FLAIR_TOKENS, TIME_TOKENS, THEME_BY_ID } from "../src/shared/themes.js";
import bank from "../src/server/bank.json";

interface Entry { themeId: string; tier: string; suspects: string[]; objectTokens: string[]; clues: Clue[]; solution: Solution; }
const BANK = bank as unknown as Entry[];
const CAT_IDS = ["flair", "time", "object"];

function ctxFor(e: Entry): PuzzleCtx {
  return { suspects: e.suspects, catIds: CAT_IDS,
    cats: { flair: [...FLAIR_TOKENS], time: [...TIME_TOKENS], object: e.objectTokens },
    timeValues: [...TIME_TOKENS] };
}

// Grid where each solution cell is confirmed(2), and competing values are crossed(1).
function solvedGrid(e: Entry, ctx: PuzzleCtx): GridState {
  const g = freshGrid(ctx);
  for (const c of CAT_IDS) for (const s of e.suspects) {
    const ans = e.solution[s][c];
    for (const v of ctx.cats[c]) g[c][s][v] = v === ans ? 2 : 1;
  }
  return g;
}

function grade(e: Entry, g: GridState, ctx: PuzzleCtx): "incomplete" | "wrong" | "solved" {
  if (effectiveCount(ctx, g) !== ctx.suspects.length * CAT_IDS.length) return "incomplete";
  for (const c of CAT_IDS) for (const s of e.suspects)
    if (e.solution[s][c] !== effectiveValue(ctx, g, c, s)) return "wrong";
  return "solved";
}

let fails = 0;
for (let i = 0; i < BANK.length; i++) {
  const e = BANK[i];
  const ctx = ctxFor(e);
  if (!THEME_BY_ID[e.themeId]) { console.log(`[FAIL] #${i}: no theme ${e.themeId}`); fails++; continue; }
  // empty grid: statuses without crashes + text rendering
  const empty = freshGrid(ctx);
  for (const c of e.clues) { clueStatus(ctx, empty, c); renderClue(c, THEME_BY_ID[e.themeId]); }
  // grid = solution
  const g = solvedGrid(e, ctx);
  const full = effectiveCount(ctx, g) === 12;
  const allOk = e.clues.every((c) => clueStatus(ctx, g, c) === "ok");
  const graded = grade(e, g, ctx);
  if (!full || !allOk || graded !== "solved") {
    fails++;
    const bad = e.clues.map((c, k) => [k, clueStatus(ctx, g, c)]).filter(([, s]) => s !== "ok");
    console.log(`[FAIL] #${i} ${e.themeId}/${e.tier}: full=${full} allOk=${allOk} graded=${graded} badClues=${JSON.stringify(bad)}`);
  }
}

// ── pinned indices: a live post stores its bank index in postData ──
// If a rebuild moves what sits at an index, every open post on that index silently starts showing
// a DIFFERENT puzzle and throws away the player's saved board. The first 120 entries must survive
// every rebuild unchanged; these two are additionally referenced by name from the server.
const PINNED: [number, string, string, number, string][] = [
  // idx, themeId, tier, clues, solution fingerprint (first suspect's row)
  [72, "pizza", "green", 10, "John=Blue|09:00|Scroll"],   // SHOWCASE_IDX - the judge/demo post
  [78, "pizza", "green", 12, "John=Purple|18:00|Spoon"],  // the old fixed warm-up, now in the pool
];
for (const [i, themeId, tier, nClues, fingerprint] of PINNED) {
  const e = BANK[i];
  const s = e?.suspects[0];
  const got = e ? `${s}=${e.solution[s].flair}|${e.solution[s].time}|${e.solution[s].object}` : "missing";
  if (!e || e.themeId !== themeId || e.tier !== tier || e.clues.length !== nClues || got !== fingerprint) {
    fails++;
    console.log(`[FAIL] pinned idx ${i} moved: ${e?.themeId}/${e?.tier} ${e?.clues.length} clues ${got}` +
      ` (expected ${themeId}/${tier} ${nClues} clues ${fingerprint}) - live posts on this index would break`);
  }
}

console.log(`Cases checked: ${BANK.length} · pinned indices verified: ${PINNED.map(([i]) => i).join(", ")}`);
console.log(fails === 0
  ? "OK ✅ - on the solution every clue is green, the client detects solved, the server confirms (client and server agree)"
  : `FAILURES: ${fails} ❌`);
process.exit(fails ? 1 : 0);
