// Verify the vote→difficulty ramp against the real bank (mirrors src/server/index.ts; the server
// itself can't run under tsx - it imports @devvit). Levels are TIERS, not score bins: the score
// spread inside 🟡 was measured not to map to felt difficulty, the tier fork is what does.
// "tutorial" is deliberately absent from the ladder - it is the warm-up lane's tier.
import bank from "../src/server/bank.json";
const BANK = bank as unknown as { tier: string; score?: number; clues: unknown[] }[];

const DAILY_TIERS = ["green", "yellow", "red"];
const DEFAULT_LEVEL = 0;   // 🟢
const VOTE_MIN_TOTAL = 5;
const VOTE_MIN_LEAD = 0.10;

const byTier = new Map<string, number[]>();
BANK.forEach((e, i) => {
  const b = byTier.get(e.tier);
  if (b) b.push(i); else byTier.set(e.tier, [i]);
});
const levelTiers = DAILY_TIERS.filter((t) => (byTier.get(t)?.length ?? 0) > 0);
const buckets = levelTiers.map((t) => byTier.get(t)!);
const MAX_LEVEL = Math.max(0, buckets.length - 1);

console.log(`ladder: ${levelTiers.map((t, i) => `L${i}=${t}(${buckets[i].length})`).join(" · ")} (MAX_LEVEL=${MAX_LEVEL}, default L${DEFAULT_LEVEL}=${levelTiers[DEFAULT_LEVEL]})`);
const warmup = byTier.get("tutorial") ?? [];
console.log(`warm-up lane (off-ladder): tutorial=${warmup.length} case${warmup.length === 1 ? "" : "s"}`);
for (let b = 0; b < buckets.length; b++) {
  const scores = buckets[b].map((i) => BANK[i].score ?? 0);
  const clues = buckets[b].map((i) => BANK[i].clues.length);
  const avg = (a: number[]) => (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1);
  console.log(`  L${b} ${levelTiers[b]}: score ${Math.min(...scores)}..${Math.max(...scores)} (avg ${avg(scores)}) · avg clues ${avg(clues)} · rotation ${buckets[b].length} days`);
}

const VOTE_CHOICES = ["Harder", "Same", "Softer"] as const;
type T = Record<string, number>;
function levelFromVote(level: number, t: T): number {
  const total = t.Harder + t.Same + t.Softer;
  if (total < VOTE_MIN_TOTAL) return level;
  const s = VOTE_CHOICES.slice().sort((a, b) => t[b] - t[a]);
  if ((t[s[0]] - t[s[1]]) / total < VOTE_MIN_LEAD) return level;
  if (s[0] === "Harder") return Math.min(MAX_LEVEL, level + 1);
  if (s[0] === "Softer") return Math.max(0, level - 1);
  return level;
}

// simulate a week from the new default: the sub has to actively ask for 🟡, it is not the floor
console.log(`\nramp simulation (start L${DEFAULT_LEVEL} = ${levelTiers[DEFAULT_LEVEL]}):`);
let level = DEFAULT_LEVEL;
const votes: [string, T][] = [
  ["Harder 4/1/1", { Harder: 4, Same: 1, Softer: 1 }],   // → 🟡
  ["Harder 5/0/1", { Harder: 5, Same: 0, Softer: 1 }],   // caps (no 🔴 in the bank)
  ["Harder 9/0/0", { Harder: 9, Same: 0, Softer: 0 }],   // stays at cap
  ["Softer 1/1/7", { Harder: 1, Same: 1, Softer: 7 }],   // back to 🟢
  ["Softer 1/1/7", { Harder: 1, Same: 1, Softer: 7 }],   // floors at 🟢, never reaches tutorial
  ["Same 2/6/2", { Harder: 2, Same: 6, Softer: 2 }],
  ["tie 3/3/1 (7)", { Harder: 3, Same: 3, Softer: 1 }],  // weak lead → hold
  ["thin 2/1/0 (3)", { Harder: 2, Same: 1, Softer: 0 }], // under VOTE_MIN_TOTAL → hold
];
const arrow = (a: number, b: number) => (b > a ? "harder ▲" : b < a ? "softer ▼" : "hold =");
for (const [label, t] of votes) {
  const next = levelFromVote(level, t);
  console.log(`  ${label.padEnd(16)} L${level} ${levelTiers[level]} → L${next} ${levelTiers[next]}  (${arrow(level, next)})`);
  level = next;
}
