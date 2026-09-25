// Offline build of the daily puzzle bank → src/server/bank.json.
// Deterministic (seed from a string), each case is verified by classify() for tier and uniqueness.
//
//   npx tsx scripts/build-bank.ts 260 --append   ← how the bank GROWS. Use this.
//   npx tsx scripts/build-bank.ts [N]            ← full rebuild; see the warning below first
//
// --append copies every existing entry verbatim - clues, solution AND `score` - and generates only
// the indices past the end. A full rebuild is deterministic and reproduces the clues byte for byte
// (verified 2026-09-25 across every tier), but it RECOMPUTES `score` for the whole bank, and the
// score orders the warm-up pool: a changed scoring function would reorder it under players whose
// per-user counter points into it. Growing the bank should never be able to touch a single byte of
// what is already published, and append is the mode where that is true by construction.
import { readFileSync, writeFileSync } from "node:fs";
import type { Clue, Solution } from "../src/shared/types.js";
import {
  Puzzle, classify, generate, GREEN, YELLOW, RED, RNG, seedFromString,
} from "../src/server/engine.js";
import { FLAIR_TOKENS, TIME_TOKENS, THEMES } from "../src/shared/themes.js";
import { renderClue } from "../src/shared/render.js";
import { difficultyScore } from "./difficulty.js";

type Tier = "tutorial" | "green" | "yellow" | "red";

interface BankEntry {
  themeId: string;
  tier: Tier;
  suspects: string[];
  objectTokens: string[];
  clues: Clue[];
  solution: Solution;
  score?: number; // offline difficulty score (higher = harder); orders the warm-up pool at runtime
  // Which generation of the bank this case belongs to. Absent = the original bank (0..159). The
  // runtime serves each tier batch by batch, so a new batch is played AFTER the one before it
  // rather than being shuffled into it - see LEVEL_BUCKETS in src/server/index.ts.
  batch?: number;
}

// A tutorial case is weak-forced, so the engine classifies it 🟢 - the tier name records intent
// (over-clued, built for the warm-up lane), the tag records what the solver says about it.
const TIER_TAG: Record<Tier, string> = { tutorial: GREEN, green: GREEN, yellow: YELLOW, red: RED };
const N = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a)) ?? 160);
const APPEND = process.argv.includes("--append");

// ⚠️ Indices 0..119 are PINNED. A live post stores its bank index in postData, so changing what
// sits at an index swaps the puzzle under an open post and throws away every player's board
// (`gridMatchesCtx` drops a grid whose shape no longer matches). New tiers are therefore APPENDED,
// never interleaved - the first 120 entries must keep byte-identical clues on every rebuild.
const PINNED = 120;
function tierFor(i: number): Tier {
  if (i < PINNED) return i % 6 === 0 ? "green" : "yellow"; // the original layout: 20 🟢 / 100 🟡
  // Append 15 tutorial + 25 green -> bank totals 15 tutorial / 45 green / 100 yellow. The plan's
  // target was 15/45/60; yellow stays at 100 because shrinking it means deleting pinned indices.
  // 🔴 is still not generated here: brute-force on every minimization step, an order of magnitude
  // more expensive - it belongs to a separate hardcore build.
  if (i < 160) return i - PINNED < 15 ? "tutorial" : "green";
  // Batch 2 (2026-09-25): 100 more 🟢. The daily default is green and the bank held only 45 of them,
  // served in a loop - by case #56 the green bucket had gone round once and was repeating. Yellow is
  // served only when the sub votes Harder, so it is not the resource that runs out.
  return "green";
}
const batchFor = (i: number): number | undefined => (i < 160 ? undefined : 2);

// Batch 2 is HARDER by construction - the owner's call (2026-09-25): "потруднее бы побольше". The
// original 45 greens spread across the whole green range (score -2..54, median 28), and the players
// who stayed were closing them in one to two minutes. So batch 2 has no easy band at all: three in
// five come from the hard band (score >= 34) and two in five from the middle (24..33). Still 🟢 -
// every one is solvable on the board, 12/12 - which is the line decision 42 drew and this does not
// cross; "harder" here means fewer and more relational load-bearing clues, not a board that stops
// helping. The band is a deterministic function of the index, so a rebuild reproduces it.
function bandFor(i: number): [number, number] | null {
  if (i < 160) return null;
  return (i - 160) % 5 < 3 ? [34, Infinity] : [24, 33];
}

// In --append mode the existing file is the source of truth for every index it already holds.
const existing: BankEntry[] = APPEND
  ? JSON.parse(readFileSync(new URL("../src/server/bank.json", import.meta.url), "utf8"))
  : [];

const bank: BankEntry[] = [];
let fails = 0;
const dist: Record<Tier, number> = { tutorial: 0, green: 0, yellow: 0, red: 0 };

for (let i = 0; i < N; i++) {
  if (i < existing.length) { bank.push(existing[i]); dist[existing[i].tier]++; continue; }
  const theme = THEMES[i % THEMES.length];
  const tier = tierFor(i);
  const objectTokens = Object.keys(theme.objects);
  const cats = { flair: [...FLAIR_TOKENS], time: [...TIME_TOKENS], object: objectTokens };

  let entry: BankEntry | null = null;
  const band = bandFor(i);
  // 24 attempts for the original indices - that is what they were built with, and a rebuild must
  // reproduce them. A banded slot rejects most candidates on purpose, so it gets far more.
  const maxAttempts = band ? 800 : 24;
  for (let attempt = 0; attempt < maxAttempts && !entry; attempt++) {
    const rng = new RNG(seedFromString(`logic-thread:v1:${i}:${attempt}`));
    const res = generate(tier, rng, theme.suspects, cats, tier === "red" ? 30 : 60);
    if (!res) continue;
    const [solution, clues] = res;
    const info = classify(new Puzzle(theme.suspects, cats, clues, solution));
    if (info.tier !== TIER_TAG[tier] || info.solutions !== 1) continue;
    // sanity: rendering all clues must not fail (all tokens exist in the theme)
    for (const c of clues) renderClue(c, theme);
    const candidate: BankEntry = { themeId: theme.id, tier, suspects: theme.suspects, objectTokens, clues, solution };
    if (band) {
      const sc = difficultyScore(candidate);
      if (sc < band[0] || sc > band[1]) continue;
    }
    entry = candidate;
    const batch = batchFor(i);
    if (batch !== undefined) entry.batch = batch;
  }

  if (!entry) { console.log(`[FAIL] i=${i} theme=${theme.id} tier=${tier}: not built`); fails++; continue; }
  bank.push(entry);
  dist[tier]++;
}

// Offline difficulty score. The runtime reads it to order the warm-up pool easiest-first;
// scripts/difficulty.ts reads it to inspect the spread.
// In append mode ONLY the new entries are scored - an existing score is part of what is published.
for (const e of bank.slice(existing.length)) e.score = difficultyScore(e);

const outUrl = new URL("../src/server/bank.json", import.meta.url);
writeFileSync(outUrl, JSON.stringify(bank, null, 0) + "\n");

const avgClues = (t: Tier) => {
  const g = bank.filter((e) => e.tier === t);
  return g.length ? (g.reduce((a, b) => a + b.clues.length, 0) / g.length).toFixed(1) : "-";
};
const scoreSpan = (t: Tier) => {
  const s = bank.filter((e) => e.tier === t).map((e) => e.score!);
  return s.length ? `${Math.min(...s)}..${Math.max(...s)}` : "-";
};
console.log(`Built ${bank.length}/${N} cases -> src/server/bank.json`);
console.log(
  `Tiers: 📘 tutorial ${dist.tutorial} · 🟢 ${dist.green} · 🟡 ${dist.yellow} · 🔴 ${dist.red}`,
);
for (const t of ["tutorial", "green", "yellow", "red"] as Tier[])
  if (dist[t]) console.log(`  ${t.padEnd(8)}: avg clues ${avgClues(t)} · score ${scoreSpan(t)}`);
console.log(fails === 0 ? "All cases passed verification ✅" : `FAILURES: ${fails} ❌`);
console.log("Next: npx tsx scripts/check-solvability.ts (tutorial + green must be 12/12)");

// Show an example (first case) for an eyeball check of the clue text
const first = bank[0];
if (first) {
  const theme = THEMES.find((t) => t.id === first.themeId)!;
  console.log(`\nExample - ${theme.title} (${first.tier}):`);
  first.clues.forEach((c, k) => console.log(`  ${k + 1}. ${renderClue(c, theme)}`));
}

process.exit(fails ? 1 : 0);
