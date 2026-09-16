// ── when players show up ──────────────────────────────────────────────────────────────────────
//
// The app counted how many opened a case and how many solved it, and nothing at all about WHEN -
// so "what hour should the daily case go out at" had no answer in the data. Reddit's own Insights
// answers it for the last 24 hours only, which on a subreddit averaging a handful of players a day
// is noise rather than a sample. This accrues past that window.
//
// Its own module for one reason: three callers that must not depend on each other. `index.ts` ticks
// it, `audit.ts` prints it in the DB dump, and the nightly rollup in `leaderboard.ts` writes it to
// the app log so it can be READ WITHOUT ANYBODY PRESSING ANYTHING - which is the whole point. The
// owner asked it plainly: "ты сам не можешь молча проверять статистику?" Anything the app logs on a
// schedule is readable with `devvit logs --since`; anything it prints only on a menu press is not.
import { redis } from "@devvit/web/server";

const HOURS_KEY = "hits:hours";   // hash: "0".."23" -> first opens counted in that UTC hour

/** Ticked on the same one-shot event the funnel calls `opened`, so a player who reopens a case all
    evening is one tick - otherwise the busiest hour is the hour whoever refreshes most plays in. */
export async function countHour(): Promise<void> {
  await redis.hIncrBy(HOURS_KEY, String(new Date().getUTCHours()), 1);
}

/** The shape, as lines. The sample size travels WITH the answer on purpose: three busiest hours out
    of eleven opens is a shape nobody should act on, and being told the count is the only way to
    know that. Hours with nothing in them are omitted rather than printed as a row of zeroes. */
export async function hoursLines(): Promise<string[]> {
  const raw = await redis.hGetAll(HOURS_KEY);
  const bars = Array.from({ length: 24 }, (_, i) => Number(raw[String(i)] ?? 0) || 0);
  const total = bars.reduce((a, b) => a + b, 0);
  if (total === 0) return ["nothing counted yet - starts from the next case a player opens"];
  const peak = Math.max(...bars);
  const out = bars.map((n, i) => n === 0 ? null
    : `${String(i).padStart(2, "0")}:00 ${"#".repeat(Math.round((n / peak) * 40))} ${n}`)
    .filter((l): l is string => l !== null);
  const top = bars.map((n, i) => ({ n, i })).sort((a, b) => b.n - a.n).slice(0, 3)
    .filter((x) => x.n > 0).map((x) => `${String(x.i).padStart(2, "0")}:00`);
  out.push(`busiest: ${top.join(", ")} - from ${total} opens`);
  return out;
}
