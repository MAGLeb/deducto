// Self-test of the TS engine - parity with engine/test_engine.py:
//   * anchors Case #0 (🟡), Case #1 (🟢), fork-case (🔴) classify as expected;
//   * the tutorial/green/yellow generators produce a case of the requested tier, unique solution;
//   * the hint ladder (`adviseOnGrid`) says the right thing on an empty 🟢, an empty 🟡, a solved
//     board, a self-contradicting one - and on a 🟡 played out to the WEAK wall, where the board
//     has nothing left to give and the ladder used to go silent (bankWallSweep, over all 160 cases).
// Run: npx tsx src/server/engine.test.ts
import type { Cats, Clue, Solution } from "../shared/types.js";
import { freshGrid, type GridState, type PuzzleCtx } from "../shared/status.js";
import {
  Puzzle, classify, generate, adviseOnGrid, GREEN, YELLOW, RED,
  DEFAULT_SUS, DEFAULT_CATS, RNG,
} from "./engine.js";
import BANK from "./bank.json";

const FL = ["Red", "Blue", "Green", "Purple"];
const TM = ["09:00", "12:00", "15:00", "18:00"];

// ── canonical cases as regression anchors (same as in Python) ──
const CASE0 = new Puzzle( // 🟡: needs cross-referencing logic, but no guessing
  ["John", "Mira", "Paul", "ModBot"],
  { flair: FL, time: TM, object: ["Pizza", "Keyboard", "Spoon", "Scroll"] } as Cats,
  [
    { k: "same", a: ["object", "Pizza"], b: ["time", "18:00"] },
    { k: "ne", s: "John", cat: "object", v: "Pizza" },
    { k: "before", a: ["flair", "Red"], b: ["s", "John"] },
    { k: "ne", s: "John", cat: "time", v: "15:00" },
    { k: "same", a: ["flair", "Green"], b: ["time", "12:00"] },
    { k: "same", a: ["flair", "Blue"], b: ["object", "Spoon"] },
    { k: "before", a: ["s", "ModBot"], b: ["s", "Mira"] },
    { k: "ne", s: "Paul", cat: "flair", v: "Purple" },
    { k: "before", a: ["object", "Scroll"], b: ["object", "Keyboard"] },
    { k: "ne", s: "ModBot", cat: "object", v: "Scroll" },
  ] as Clue[],
);

const CASE1 = new Puzzle( // 🟢: solvable on a simple board
  ["Nova", "Vega", "Cosmo", "ModBot"],
  { flair: FL, time: TM, object: ["Coffee", "Headphones", "Flashlight", "Sock"] } as Cats,
  [
    { k: "same", a: ["object", "Coffee"], b: ["time", "18:00"] },
    { k: "before", a: ["s", "Nova"], b: ["object", "Coffee"] },
    { k: "before", a: ["s", "Vega"], b: ["object", "Headphones"] },
    { k: "before", a: ["s", "ModBot"], b: ["object", "Headphones"] },
    { k: "ne", s: "Vega", cat: "time", v: "12:00" },
    { k: "same", a: ["flair", "Green"], b: ["object", "Sock"] },
    { k: "ne", s: "ModBot", cat: "flair", v: "Green" },
    { k: "same", a: ["flair", "Purple"], b: ["object", "Flashlight"] },
    { k: "ne", s: "Cosmo", cat: "flair", v: "Blue" },
  ] as Clue[],
);

const RED_CASE = new Puzzle( // 🔴: unique, but requires one guess (fork on Nova.time)
  ["Nova", "Vega", "Cosmo", "ModBot"],
  { flair: FL, time: TM, object: ["Coffee", "Headphones", "Flashlight", "Sock"] } as Cats,
  [
    { k: "same", a: ["flair", "Blue"], b: ["object", "Headphones"] },
    { k: "ne", s: "Vega", cat: "object", v: "Coffee" },
    { k: "ne", s: "ModBot", cat: "flair", v: "Green" },
    { k: "nsame", a: ["flair", "Purple"], b: ["time", "18:00"] },
    { k: "before", a: ["s", "Nova"], b: ["object", "Coffee"] },
    { k: "before", a: ["flair", "Green"], b: ["flair", "Blue"] },
    { k: "before", a: ["flair", "Green"], b: ["object", "Flashlight"] },
    { k: "before", a: ["flair", "Purple"], b: ["s", "Nova"] },
    { k: "before", a: ["s", "ModBot"], b: ["s", "Cosmo"] },
  ] as Clue[],
);

function main(): number {
  let fails = 0;

  console.log("- anchors -");
  const anchors: [string, Puzzle, string][] = [
    ["Case #0", CASE0, YELLOW],
    ["Case #1", CASE1, GREEN],
    ["fork-case", RED_CASE, RED],
  ];
  for (const [name, pz, want] of anchors) {
    const info = classify(pz);
    const ok = info.tier === want;
    if (!ok) fails++;
    console.log(
      `[${ok ? "OK" : "FAIL"}] ${name}: ${info.tier} (expected ${want}) ` +
      `| solutions=${info.solutions} weak=${info.weak_forced} grid=${info.grid_forced}`,
    );
  }

  console.log("- generator -");
  const rng = new RNG(2024);
  const N = 3;
  // tutorial is an over-clued 🟢, so the solver tags it GREEN - the extra promise is the shape
  // (few relational clues, ≥2 time hooks), which is checked below.
  for (const [tier, want] of [["tutorial", GREEN], ["green", GREEN], ["yellow", YELLOW]] as [string, string][]) {
    let got = 0;
    for (let i = 0; i < N; i++) {
      const res = generate(tier, rng, DEFAULT_SUS, DEFAULT_CATS, 40);
      if (!res) { console.log(`[FAIL] generate(${tier}): not built`); fails++; continue; }
      const [sol, clues] = res;
      const info = classify(new Puzzle(DEFAULT_SUS, DEFAULT_CATS, clues, sol));
      const rel = clues.filter((c) => c.k === "before" || c.k === "nsame").length;
      const hooks = clues.filter((c) => c.k === "same" && (c.a[0] === "time" || c.b[0] === "time")).length;
      const shaped = tier !== "tutorial" || (rel / clues.length <= 0.35 && hooks >= 2 && clues.length >= 14);
      if (info.tier === want && info.solutions === 1 && shaped) got++;
      else { console.log(`[FAIL] generate(${tier}) → ${JSON.stringify(info)} n=${clues.length} rel=${rel} hooks=${hooks}`); fails++; }
    }
    console.log(`[${got === N ? "OK" : "FAIL"}] generate(${tier}): ${got}/${N} correct`);
  }

  console.log("- hint ladder -");
  fails += adviceChecks();

  console.log("\nRESULT:", fails === 0 ? "ALL PASSED ✅" : `FAILURES: ${fails} ❌`);
  return fails;
}

// ── hint ladder: what `adviseOnGrid` says on five board states ──
function ctxOf(pz: Puzzle): PuzzleCtx {
  return { suspects: pz.S, catIds: Object.keys(pz.CATS), cats: pz.CATS, timeValues: pz.CATS["time"] };
}

/** The board once every crossing-out the 4×3 grid allows has been taken - the WEAK fixpoint. */
function wallGrid(pz: Puzzle, ctx: PuzzleCtx): GridState {
  const g = freshGrid(ctx);
  const poss = pz.freshPoss();
  pz.propagate(poss, pz.clues);
  for (const c of ctx.catIds) for (const s of ctx.suspects)
    for (const v of ctx.cats[c]) g[c][s][v] = poss[c][s].has(v) ? 0 : 1;
  return g;
}

// The same wall, over the whole shipped bank. Two promises, both regressions waiting to happen:
//   * a 🟢/tutorial case is finished by the board alone, so its wall IS the solution ("done");
//   * on 🟡 the ladder stays useful past the wall - and never points at the true answer.
// 99 of 100 is the measured ceiling of the size-1-then-2-then-3 search; the last case needs four
// clues held at once and is answered "stuck", which is still true of it. Pinned as a number so a
// change to the search shows up here as a number rather than as a shrug.
function bankWallSweep(): number {
  const bank = BANK as unknown as
    { tier: string; suspects: string[]; objectTokens: string[]; clues: Clue[]; solution: Solution }[];
  let bad = 0, yellow = 0, answered = 0, pairs = 0, unsound = 0, notOpen = 0, worstMs = 0;
  for (const e of bank) {
    const cats = { flair: FL, time: TM, object: e.objectTokens } as Cats;
    const pz = new Puzzle(e.suspects, cats, e.clues, e.solution);
    const ctx = ctxOf(pz);
    const g = wallGrid(pz, ctx);
    const t0 = performance.now();
    const a = adviseOnGrid(pz, ctx, g);
    worstMs = Math.max(worstMs, performance.now() - t0);
    if (e.tier !== "yellow") { if (a.kind !== "done") bad++; continue; }
    yellow++;
    if (a.kind !== "cross") continue;
    answered++;
    if (a.clues.length > 1) pairs++;
    if (e.solution[a.suspect!][a.cat!] === a.value) unsound++;
    if (g[a.cat!][a.suspect!][a.value!] !== 0) notOpen++;
  }
  const ok = bad === 0 && unsound === 0 && notOpen === 0 && answered >= 99;
  if (!ok) bad++;
  console.log(
    `[${ok ? "OK" : "FAIL"}] bank at the WEAK wall: ${answered}/${yellow} 🟡 boards still get a move` +
    ` (${pairs} of them need more than one clue) · never the true value: ${unsound === 0}` +
    ` · always an open chip: ${notOpen === 0} · 🟢/tutorial finish on the board: ${bad === 0}` +
    ` · worst ${worstMs.toFixed(1)} ms`,
  );
  return ok ? 0 : 1;
}

function adviceChecks(): number {
  let bad = 0;
  const check = (name: string, got: string, want: string) => {
    const ok = got === want;
    if (!ok) bad++;
    console.log(`[${ok ? "OK" : "FAIL"}] ${name}: ${got}${ok ? "" : ` (expected ${want})`}`);
  };

  // 🟢 from a cold start: the board DOES have a forced move, so step 1 must name a clue.
  const g1 = adviseOnGrid(CASE1, ctxOf(CASE1), freshGrid(ctxOf(CASE1)));
  check("empty 🟢 → a clue is live", g1.kind === "move" && g1.clue >= 1 ? "move" : g1.kind, "move");

  // 🟡 from a cold start still offers crossings-out - the board just can't FINISH (0/12 cells
  // pinned on 69 of 100 yellow cases). So the wall isn't at move one, it's at the WEAK fixpoint.
  check("empty 🟡 → a clue is still live", adviseOnGrid(CASE0, ctxOf(CASE0), freshGrid(ctxOf(CASE0))).kind, "move");

  // Play a 🟡 out to that fixpoint - every crossing-out the board allows, taken. This is the board
  // the whole ladder exists for, and the one it used to answer with a bare {kind:"stuck"} on BOTH
  // free rungs. It now has to name a clue that still bites off the board (crossAdvice).
  const ctx0 = ctxOf(CASE0);
  const wall: GridState = wallGrid(CASE0, ctx0);
  const fix = CASE0.freshPoss();
  CASE0.propagate(fix, CASE0.clues);
  const atWall = adviseOnGrid(CASE0, ctx0, wall);
  check(`🟡 played to the WEAK wall (${CASE0.determinedCells(fix)}/12) → cross`, atWall.kind, "cross");
  if (atWall.kind === "cross") {
    const sol0 = CASE0.count(CASE0.clues, 1)[1]!;
    const named = !!atWall.cat && !!atWall.suspect && !!atWall.value;
    check("…names the smallest set of clues that does it",
      atWall.clues.length === 3 && atWall.clues.every((c) => c >= 1 && c <= CASE0.clues.length) ? "3 clues" : JSON.stringify(atWall.clues),
      "3 clues");
    check("…and a chip that is still open on that board",
      named && wall[atWall.cat!][atWall.suspect!][atWall.value!] === 0 ? "open" : "not open", "open");
    // The one mistake this rung must never make: telling a player to cross out the true answer.
    check("…which is not the true value",
      named && sol0[atWall.suspect!][atWall.cat!] === atWall.value ? "the answer" : "safe", "safe");
    console.log(`      → clues ${atWall.clues.join(" + ")}${atWall.via ? ` via ${atWall.viaCat}:${atWall.via}` : ""}` +
      `: cross out ${atWall.value} for ${atWall.suspect}`);
  }
  bad += bankWallSweep();

  // A board filled in with the right answer has nothing left to advise.
  const ctx1 = ctxOf(CASE1);
  const solved: GridState = freshGrid(ctx1);
  const sol = CASE1.count(CASE1.clues, 1)[1]!;
  for (const c of ctx1.catIds) for (const s of ctx1.suspects)
    for (const v of ctx1.cats[c]) solved[c][s][v] = v === sol[s][c] ? 2 : 1;
  check("solved board → done", adviseOnGrid(CASE1, ctx1, solved).kind, "done");

  // A board that crosses out the truth: clue 1 pins the coffee to 18:00, so denying every suspect
  // 18:00 must come back as a contradiction, not as a move.
  const wrong: GridState = freshGrid(ctx1);
  for (const s of ctx1.suspects) wrong["time"][s]["18:00"] = 1;
  check("self-contradicting board → contradiction", adviseOnGrid(CASE1, ctx1, wrong).kind, "contradiction");

  // Step 2 must name a real elimination: the value it points at is still a candidate now and gone
  // after the clue is applied - i.e. the advice is actionable on the board as it stands.
  const half: GridState = freshGrid(ctx1);
  const a = adviseOnGrid(CASE1, ctx1, half);
  const actionable = a.kind === "move" && !!a.cat && !!a.suspect && !!a.value
    && half[a.cat!][a.suspect!][a.value!] === 0;
  check("step 2 names a cell that is still open", actionable ? "actionable" : "not actionable", "actionable");
  return bad;
}

process.exit(main() ? 1 : 0);
