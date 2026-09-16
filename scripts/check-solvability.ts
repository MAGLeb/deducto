// Regression test for "can this case actually be solved ON THE BOARD?".
//
// The 4×3 board stores exactly one thing: for suspect S in category C, which candidates are still
// standing. That is the WEAK model (`Puzzle.propagate`) - no value×value sub-grids, no transitivity.
// So "how many of the 12 cells does WEAK pin down" is a hard upper bound on what a player can reach
// by writing only on the board. 12/12 = every move is forced and visible; 0/12 = the board offers no
// forced move at all and the player must cross-reference coat↔time↔item in their head.
//
// Baseline before the tutorial tier landed (bank of 120): green 12.00/12 · yellow 0.73/12,
// 69 of 100 yellow cases at 0/12. That measurement is why the daily default dropped to 🟢
// (decision #42 in docs/09-design-decisions.md).
//
// Run: npx tsx scripts/check-solvability.ts   (npm run check:solvability)
// Exits non-zero if any tutorial/green case fails to reach 12/12.
import type { Clue, Solution } from "../src/shared/types.js";
import { Puzzle } from "../src/server/engine.js";
import { FLAIR_TOKENS, TIME_TOKENS } from "../src/shared/themes.js";
import bank from "../src/server/bank.json";

interface Entry {
  themeId: string; tier: string; suspects: string[]; objectTokens: string[];
  clues: Clue[]; solution: Solution; score?: number;
}
const BANK = bank as unknown as Entry[];

// Tiers that promise "solvable on the board" - these must be 12/12, they are the onboarding lane.
const MUST_BE_FULL = ["tutorial", "green"];
const TIER_ORDER = ["tutorial", "green", "yellow", "red"];

function weakCellsOf(e: Entry): number {
  const cats = { flair: [...FLAIR_TOKENS], time: [...TIME_TOKENS], object: e.objectTokens };
  return new Puzzle(e.suspects, cats, e.clues, e.solution).weakCells(e.clues);
}

const rows = BANK.map((e, i) => ({ i, tier: e.tier, cells: weakCellsOf(e), clues: e.clues.length }));

const byTier = new Map<string, typeof rows>();
for (const r of rows) {
  if (!byTier.has(r.tier)) byTier.set(r.tier, []);
  byTier.get(r.tier)!.push(r);
}

const pad = (s: string | number, n: number) => String(s).padStart(n);
let fails = 0;

console.log(`WEAK solvability over ${BANK.length} cases (cells the 4×3 board pins down, out of 12)\n`);
for (const tier of TIER_ORDER) {
  const g = byTier.get(tier);
  if (!g) continue;
  const cells = g.map((r) => r.cells);
  const mean = cells.reduce((a, b) => a + b, 0) / cells.length;
  const zero = cells.filter((c) => c === 0).length;
  const under6 = cells.filter((c) => c < 6).length;
  const full = cells.filter((c) => c === 12).length;
  console.log(
    `${tier.toUpperCase().padEnd(8)} (${pad(g.length, 3)}): ${mean.toFixed(2)}/12 mean · ` +
    `min ${Math.min(...cells)} · max ${Math.max(...cells)} · ` +
    `12/12: ${full} · <6: ${under6} · 0/12: ${zero}`,
  );
  if (MUST_BE_FULL.includes(tier)) {
    const bad = g.filter((r) => r.cells !== 12);
    for (const r of bad) console.log(`  [FAIL] #${r.i} (${tier}, ${r.clues} clues): only ${r.cells}/12 on the board`);
    fails += bad.length;
  }
}

// Histogram over the whole bank - the shape of "how far does the board get you".
const hist = new Array(13).fill(0);
for (const r of rows) if (r.cells >= 0) hist[r.cells]++;
console.log("\nCells resolved on the board (all tiers):");
for (let c = 0; c <= 12; c++) if (hist[c]) console.log(`  ${pad(c, 2)}/12: ${"█".repeat(hist[c])} ${hist[c]}`);

const broken = rows.filter((r) => r.cells < 0);
for (const r of broken) console.log(`[FAIL] #${r.i} (${r.tier}): WEAK propagation hits a contradiction`);
fails += broken.length;

console.log(
  fails === 0
    ? `\nOK ✅ - every ${MUST_BE_FULL.join("/")} case is fully solvable on the board`
    : `\nFAILURES: ${fails} ❌`,
);
process.exit(fails ? 1 : 0);
