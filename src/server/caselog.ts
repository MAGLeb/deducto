// ── the record of what has actually been published ────────────────────────────────────────────
//
// Two jobs that need the same fact - which bank case each published post carries.
//
// 1. NO REPEATS. The daily pick used to be `bucket[cursor % bucket.length]`: a counter going round a
//    loop. With 45 greens and case #56 published, the loop had already come round and the sub was
//    being handed cases it had played. A counter cannot know what was played; only the posts can.
//    So the published set is kept explicitly (`lt:served`, idx -> case number), the pick skips
//    anything in it, and the set is seeded ONCE from the posts themselves - every app post in the
//    subreddit carries its bank index in postData. Exact, rather than reconstructed from counters
//    whose bucket order changed twice during the project's history.
//
// 2. HOW CASES WERE SOLVED. The same walk gives the case number, date and bank index of every post,
//    which is what turns the boards (keyed by post) into a per-case table: players, times, hints,
//    the funnel - and, because the index is known, the offline difficulty score next to the real
//    solve time. Written to the app log once a day, so it can be read without anybody pressing a
//    button (`devvit logs <sub> --since 2d`).
import { context, reddit, redis } from "@devvit/web/server";
import { decodeSolve, solvesKey } from "./leaderboard.js";

export const SERVED_KEY = "lt:served";          // hash: bank idx -> case number (or "?" if unknown)
const SEEDED_KEY = "lt:servedSeeded";           // "1" once the set has been seeded from the posts
const DUMPED_AT = "caselog:dumpedAt";           // ms of the last per-case table written to the log
const DUMP_EVERY_MS = 20 * 3_600_000;

export interface Published { postId: string; n: number | null; idx: number; date: string; level: number | null }

/** Every Deducto case post in this subreddit, oldest first, read from the posts' own postData. */
export async function publishedCases(): Promise<Published[]> {
  const sub = context.subredditName;
  if (!sub) return [];
  const posts = await reddit.getNewPosts({ subredditName: sub, limit: 1000, pageSize: 100 }).all();
  const out: Published[] = [];
  for (const p of posts) {
    let d: Record<string, unknown> | undefined;
    try { d = (await p.getPostData()) as Record<string, unknown> | undefined; } catch { continue; }
    const idx = Number(d?.idx);
    if (!d || !Number.isInteger(idx)) continue;           // not a case post (welcome post, etc.)
    out.push({
      postId: p.id, idx,
      n: Number.isInteger(Number(d.n)) ? Number(d.n) : null,
      date: typeof d.date === "string" ? d.date : p.createdAt.toISOString().slice(0, 10),
      level: Number.isInteger(Number(d.level)) ? Number(d.level) : null,
    });
  }
  return out.sort((a, b) => (a.n ?? 0) - (b.n ?? 0) || a.date.localeCompare(b.date));
}

/**
 * Seed `lt:served` from the posts, once. Idempotent and safe to call on every publish: after the
 * first success it is one GET. If the listing fails, `fallback` (the counter-derived guess) is used
 * instead and the seed is NOT marked done, so the exact walk is retried next time.
 */
export async function seedServed(fallback: () => Promise<number[]>): Promise<string> {
  if ((await redis.get(SEEDED_KEY)) === "1") return "already seeded";
  try {
    const cases = await publishedCases();
    for (const c of cases) await redis.hSet(SERVED_KEY, { [String(c.idx)]: String(c.n ?? "?") });
    await redis.set(SEEDED_KEY, "1");
    return `seeded ${cases.length} published case(s) from the posts`;
  } catch (e) {
    for (const i of await fallback()) await redis.hSetNX(SERVED_KEY, String(i), "?");
    console.error("[caselog] listing failed, seeded from the cursors instead", e);
    return "seeded from the cursors (posts unreadable) - will retry";
  }
}

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};
const mmss = (s: number) => s > 0 ? `${Math.floor(s / 60)}:${String(Math.round(s) % 60).padStart(2, "0")}` : "-";

export type BankInfo = (idx: number) => { tier: string; score: number; clues: number } | null;

/** One line per published case, oldest first, plus a summary per tier. */
export async function caseStatsLines(info: BankInfo): Promise<string[]> {
  const cases = await publishedCases();
  const lines = ["case  date        idx  tier    score clues | opened moved solved  median   best  hints fresh | winner"];
  const byTier = new Map<string, { medians: number[]; solvers: number[]; conv: number[] }>();
  for (const c of cases) {
    const b = info(c.idx);
    const board = await redis.zRange(`lb:${c.postId}`, 0, -1, { by: "rank" });
    const times = board.map((m) => m.score);
    const st = await redis.hGetAll(`stats:${c.postId}`);
    const day = await redis.hGetAll(solvesKey(c.date));
    let hints = 0, fresh = 0, recs = 0;
    for (const [name, raw] of Object.entries(day)) {
      const r = decodeSolve(name, raw);
      if (!r || r.postId !== c.postId) continue;
      recs++; hints += r.hints; if (r.fresh) fresh++;
    }
    const opened = Number(st.opened ?? 0), moved = Number(st.firstMove ?? 0);
    const tier = b?.tier ?? "?";
    lines.push(
      `#${String(c.n ?? "?").padEnd(4)} ${c.date}  ${String(c.idx).padStart(3)}  ${tier.padEnd(7)} ` +
      `${String(b?.score ?? "-").padStart(5)} ${String(b?.clues ?? "-").padStart(5)} | ` +
      `${String(opened).padStart(6)} ${String(moved).padStart(5)} ${String(times.length).padStart(6)} ` +
      `${mmss(median(times)).padStart(7)} ${mmss(times[0] ?? 0).padStart(6)} ` +
      `${(recs ? (hints / recs).toFixed(1) : "-").padStart(6)} ${(recs ? Math.round(100 * fresh / recs) + "%" : "-").padStart(5)} | ` +
      `${board[0]?.member ?? "-"}`);
    const agg = byTier.get(tier) ?? { medians: [], solvers: [], conv: [] };
    if (times.length) agg.medians.push(median(times));
    agg.solvers.push(times.length);
    if (moved > 0) agg.conv.push(times.length / moved);
    byTier.set(tier, agg);
  }
  lines.push("");
  for (const [tier, a] of byTier) {
    lines.push(`${tier}: ${a.solvers.length} case(s) · players per case median ${median(a.solvers)} · ` +
      `solve-time median of medians ${mmss(median(a.medians))} · ` +
      `solved / started ${a.conv.length ? Math.round(100 * a.conv.reduce((x, y) => x + y, 0) / a.conv.length) + "%" : "-"}`);
  }
  return lines;
}

/** Called by an hourly cron; writes the table at most once every 20 hours. */
export async function maybeDumpStats(
  info: BankInfo, fallback: () => Promise<number[]>, remaining: () => Promise<string>,
): Promise<string> {
  const seeded = await seedServed(fallback);
  const last = Number((await redis.get(DUMPED_AT)) ?? 0) || 0;
  if (Date.now() - last < DUMP_EVERY_MS) return `${seeded}; stats: not due`;
  const lines = await caseStatsLines(info);
  console.log("[cases] per-case record, all published cases:\n  " + lines.join("\n  ") +
    "\n  " + await remaining());
  await redis.set(DUMPED_AT, String(Date.now()));
  return `${seeded}; stats: ${lines.length} line(s) written`;
}
