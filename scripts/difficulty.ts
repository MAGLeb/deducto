// Offline difficulty-score for a fixed-4×3 case. Computed at bank-build time and stored in bank.json
// (runtime only reads the bin). Axis knobs (per docs/04 + design brief; NO transitivity depth):
//   * tier (from engine.classify: 🟢 weak-forced easiest, 🟡 grid-not-weak harder) - coarse offset
//   * clue count / minimality: fewer load-bearing clues = harder
//   * relational share (before / nsame) vs direct pins (same / ne): more relational = harder
//   * "hook" opener (a same-clue anchoring a value to a TIME, e.g. coffee@18:00): present = easier start
import type { Clue } from "../src/shared/types.js";

export interface ScorableEntry { tier: string; clues: Clue[] }

export function difficultyScore(e: ScorableEntry): number {
  const n = e.clues.length;
  const relational = e.clues.filter((c) => c.k === "before" || c.k === "nsame").length;
  const relRatio = n ? relational / n : 0;
  const hooks = e.clues.filter((c) => c.k === "same" && (c.a[0] === "time" || c.b[0] === "time")).length;
  // 🟡 sits well above 🟢; "tutorial" is an over-clued 🟢 and must sort below every real green.
  const tierBase = e.tier === "tutorial" ? -30 : e.tier === "green" ? 0 : 55;
  const s = tierBase + (12 - n) * 3 + relRatio * 45 - hooks * 5;
  return Math.round(s);
}

// ── run directly to inspect the spread over the current bank (the "check FIRST" step) ──
async function main() {
  const bank = (await import("../src/server/bank.json", { with: { type: "json" } })).default as unknown as ScorableEntry[];
  const rows = bank.map((e) => ({ tier: e.tier, n: e.clues.length, score: difficultyScore(e) }));
  const stat = (a: number[]) => a.length ? `min=${Math.min(...a)} max=${Math.max(...a)} mean=${(a.reduce((x, y) => x + y, 0) / a.length).toFixed(1)} span=${Math.max(...a) - Math.min(...a)}` : "-";

  for (const tier of ["tutorial", "green", "yellow", "red"]) {
    const s = rows.filter((r) => r.tier === tier).map((r) => r.score);
    if (s.length) console.log(`${tier.toUpperCase().padEnd(8)} (${s.length}): ${stat(s)}`);
  }

  // text histogram per tier - do the tiers separate, or does one swallow the next?
  const W = 4;
  for (const tier of ["tutorial", "green", "yellow"]) {
    const s = rows.filter((r) => r.tier === tier).map((r) => r.score);
    if (!s.length) continue;
    const lo = Math.min(...s);
    const bins: Record<number, number> = {};
    for (const v of s) { const b = Math.floor((v - lo) / W); bins[b] = (bins[b] ?? 0) + 1; }
    console.log(`\n${tier.toUpperCase()} score histogram (bucket width ${W}):`);
    for (let b = 0; b <= Math.max(...Object.keys(bins).map(Number)); b++) {
      const c = bins[b] ?? 0;
      console.log(`  ${String(lo + b * W).padStart(4)}-${String(lo + b * W + W - 1).padStart(4)}: ${"█".repeat(c)} ${c}`);
    }
  }
}

// tsx runs this file directly; skip when imported by build-bank
if (import.meta.url === `file://${process.argv[1]}`) main();
