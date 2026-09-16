// Deducto - leaderboard, scoring and the nightly rollup (plan 04).
//
// Everything lives in this module on purpose: `src/server/index.ts` is edited by the difficulty
// track and the auto-posting track at the same time, so the leaderboard hooks in through exactly
// two call sites (`writeSolve()` from /api/check, `leaderboardRouter` from app.use).
//
// Two platform constraints shape the whole file:
//   1. Devvit Redis is isolated PER SUBREDDIT. There is no cross-community board without an
//      external service over HTTP fetch (which needs app-review approval). Everything here is
//      within one subreddit.
//   2. Devvit Redis CANNOT ENUMERATE KEYS. Anything we will ever need to walk has to be dropped
//      into an explicit collection up front - hence `lb:index:days` and `lb:solves:{date}`.
//      This is the same lesson `lt:posts` already learned the hard way (docs/05-data-model.md).

import { context, reddit, redis } from "@devvit/web/server";
import express from "express";
import { hoursLines } from "./hours.js";

// Mirrors the tier union in index.ts. Not imported: importing index.ts would boot the HTTP server.
export type Tier = "tutorial" | "green" | "yellow" | "red";

// ───────────────────────── scoring (plan 04 §B - decided 2026-08-07, do not re-open) ─────────────
//
//   POINTS = 500 + SPEED − 60 × hints,  clamped to [300, 1000]
//   SPEED  = round(500 × clamp((2·T − t) / (1.5·T), 0, 1))
//
// t = solve time in seconds, T = the case's target time. The curve is anchored on T:
// t = 0.5·T → 500, t = T → 333, t = 2·T → 0. (The worked examples in the plan - 2.5 min → 500,
// 5 min → 333, 10 min → 0 - are that curve read at T = 300 s.)
//
// The floor of 300 is deliberate: solving WITH hints must always beat not solving, otherwise the
// formula punishes people for trying and they stop pushing through the hard days.
// The streak is NOT a multiplier - a multiplier runs away and makes the board unwinnable for a
// newcomer. It gets its own board (`lb:streakbest`).
export const TARGET_SEC: Record<Tier, number> = {
  tutorial: 180,
  green: 240,
  yellow: 360,
  red: 480, // placeholder: 🔴 is not generated (docs/05-data-model.md); kept on the same ladder step
};

const HINT_COST = 60;
const POINTS_BASE = 500;
const POINTS_MIN = 300;
const POINTS_MAX = 1000;
const SPEED_MAX = 500;
// ── the freshness bonus (owner, 2026-08-17) ────────────────────────────────────────────────────
// A case closed on the day it ran is worth more than the same case closed out of the archive:
// "чтобы не решил все старые задачи и не выбрался в топ". A day holds one scored record per player
// but its DATE is the case's, so ten archive cases closed in one sitting write ten records on ten
// dates - which is the whole exploit, and why a dampener was asked for.
//
// Written as a BONUS on top of the case's worth, never as a cut to the archive, and the wording is
// load-bearing rather than cosmetic: the archive is how a newcomer catches up and how a streak
// survives a day with no new case (src/server/streak.ts deliberately lets ANY case extend a run).
// Taking points off it would contradict that at the same time as this rewards the daily.
const FRESH_BONUS = 250;

// The nightly rollup re-targets T on the day's median, but never lets one freak day move the scale
// by more than ±50% of the tier's nominal target.
const MEDIAN_CLAMP_LO = 0.5;
const MEDIAN_CLAMP_HI = 1.5;

// 12 cells cannot physically be crossed out faster than this even knowing the answer. Below it the
// row is FLAGGED, never dropped: a hard drop would break a fast player replaying from memory.
export const MIN_PLAUSIBLE_SEC = 25;

// Percentages lie on tiny samples. `HIST_MIN = 50` already gates the histogram in index.ts; this is
// the same rule one step lower - under 10 solvers we report "N solved", never a percentile.
export const SMALL_N = 10;

const ROLLING_CASES = 7;   // the week board's window, in CASES rather than days
const MAX_ROWS = 100;      // hard cap on what ever leaves the server
const DEFAULT_ROWS = 50;
const DAYS_KEEP = 400;     // trim lb:index:days - a year and change of history is plenty

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

export function speedPoints(timeSec: number, targetSec: number): number {
  return Math.round(SPEED_MAX * clamp((2 * targetSec - timeSec) / (1.5 * targetSec), 0, 1));
}

/** The formula from §B, verbatim and pure - kept separately so it stays inspectable. */
export function pointsFor(timeSec: number, hints: number, targetSec: number): number {
  const raw = POINTS_BASE + speedPoints(timeSec, targetSec) - HINT_COST * Math.max(0, hints);
  return clamp(Math.round(raw), POINTS_MIN, POINTS_MAX);
}

/**
 * What a recorded solve is actually worth. Identical to `pointsFor` except below the plausibility
 * floor, where the speed bonus is withheld.
 *
 * A sub-floor time is not a time. `/api/check` clamps `timeSec` to the wall clock from above, but
 * nothing stops a tampered client from posting `seconds: 1` after a slow honest solve - and 12
 * cells cannot be crossed out in 14 seconds even knowing the answer, which is the whole point of
 * the floor. Such a row is still SCORED (dropping it would break a fast replayer and would break
 * "solving always beats not solving") and still appears on the day board with its raw time and a
 * ⚠, but it earns no speed - so a forged result cannot take the podium from a real one.
 */
export function pointsForSolve(timeSec: number, hints: number, targetSec: number): number {
  if (timeSec < MIN_PLAUSIBLE_SEC) {
    return clamp(POINTS_BASE - HINT_COST * Math.max(0, hints), POINTS_MIN, POINTS_MAX);
  }
  return pointsFor(timeSec, hints, targetSec);
}

/**
 * The case's worth, plus the bonus for having closed it on its own day.
 *
 * Added OUTSIDE the [300, 1000] clamp on purpose. Inside it the bonus would be swallowed by the
 * cap for exactly the players it is meant to reward - a fast solve already reaches 1000 on speed
 * alone - and the rule would then only bite slow solves, which is the opposite of the intent. So
 * the daily range is 550-1250 and the archive keeps the original 300-1000.
 */
export function pointsWithFreshness(base: number, fresh: boolean): number {
  return fresh ? base + FRESH_BONUS : base;
}

// T used at solve time (tier nominal) vs. after the rollup (day median, clamped to the tier band).
export function targetFor(tier: Tier, medianSec?: number): number {
  const nominal = TARGET_SEC[tier] ?? TARGET_SEC.green;
  if (!medianSec || !Number.isFinite(medianSec) || medianSec <= 0) return nominal;
  return Math.round(clamp(medianSec, MEDIAN_CLAMP_LO * nominal, MEDIAN_CLAMP_HI * nominal));
}

export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

// ───────────────────────── dates ─────────────────────────
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

/**
 * The server's calendar day. Use it ONLY for things that really are about the wall calendar: the
 * cron lease window, "has this date been passed", and the day a player's VISIT is filed under
 * (`visitDay()` in streak.ts, which is a habit and therefore a calendar question). It is NOT the
 * day a RESULT is filed under - see `currentDay()`.
 */
export function todayUtc(): string { return new Date().toISOString().slice(0, 10); }
export function shiftDay(date: string, days: number): string {
  return new Date(Date.parse(date + "T00:00:00Z") + days * DAY_MS).toISOString().slice(0, 10);
}

// ISO-8601 week, computed in UTC so every player lands in the same week regardless of timezone.
export function isoWeek(date: string): string {
  const d = new Date(Date.parse(date + "T00:00:00Z"));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + 3); // Thursday of this ISO week
  const year = d.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  jan4.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7) + 3); // Thursday of ISO week 1
  const week = 1 + Math.round((d.getTime() - jan4.getTime()) / (7 * DAY_MS));
  return `${year}-W${String(week).padStart(2, "0")}`;
}
export function seasonOf(date: string): string { return date.slice(0, 7); }

// ── THE day: one definition, both sides of the app ───────────────────────────────────────────────
//
// A daily case IS a day. A post created on the 7th and solved at 00:20 UTC on the 8th belongs to
// the 7th - otherwise the 7th's board silently loses a solver and the 8th's board fills up with
// people who played a different case. Two clocks used to answer the question:
//
//   index.ts   todayStr()  = postData.date          (writes: lb:day, lb:week, streak)
//   this file  todayUtc()  = the server's clock     (reads:  the mod menu, /api/leaderboard)
//
// They agree only while a post is younger than one UTC day, which is exactly why the bug hid
// through the whole offline gate and only showed up live. `currentDay()` is now the only answer,
// and every writer and every reader goes through it.
//
//   1. inside a post          → that post's day (postData.date). Definitive: it IS the case's day.
//   2. outside a post         → the day of the newest daily post (the case currently on the sub).
//   3. nothing published yet  → the server's calendar day.
//
// It answers exactly ONE question - "which day's board does this result belong to?" - and the
// streak asks a different one: "did the player come back today?". That answer is `visitDay()` in
// streak.ts, the wall calendar, and the two must never be collapsed again. Handing case dates to
// the streak is what reset a live player's run to 1 on every hole in the archive, and what let
// closing an old case destroy a run that was still going (see the header of streak.ts).
export const LAST_DAY_KEY = "lt:lastPostDay";   // written by createDailyPost() in index.ts
const POSTS_KEY = "lt:posts";                   // ZSET postId -> created ms, also owned by index.ts

/** The day carried by the post this request is running inside, or null outside a post. */
export function postDay(): string | null {
  const d = (context.postData as { date?: string } | undefined)?.date;
  return d && DATE_RE.test(d) ? d : null;
}

export async function currentDay(): Promise<string> {
  const inPost = postDay();
  if (inPost) return inPost;

  const explicit = await redis.get(LAST_DAY_KEY);
  if (explicit && DATE_RE.test(explicit)) return explicit;

  // Installs that published posts before LAST_DAY_KEY existed still have the post registry, and
  // its score is the same clock createDailyPost() read for postData.date - so the day is
  // recoverable without waiting for the next post to be published.
  const posts = await redis.zRange(POSTS_KEY, 0, -1, { by: "rank" });
  const newest = posts[posts.length - 1]?.score;
  if (newest) return new Date(newest).toISOString().slice(0, 10);

  return todayUtc();
}

// ───────────────────────── keys ─────────────────────────
// Keyed by DATE, not postId: the board then survives a post being recreated and lines up with
// `postData.date`. Historic `lb:{postId}` sets are not recoverable (there was no post index when
// they were written) - index.ts keeps writing that key for the existing result card, and this
// module starts a clean count.
// Exported because the mod-menu audit (`src/server/audit.ts`) has to print the REAL contents of
// every one of them, and Devvit Redis cannot list keys - a key nobody names here is a key the
// audit can never look at. One definition, so the report can never drift from the writer.
export const dayKey = (date: string) => `lb:day:${date}`;     // ZSET member=username score=timeSec
export const solvesKey = (date: string) => `lb:solves:${date}`;   // HASH username -> "t|hints|tier|postId"
export const pointsKey = (date: string) => `lb:points:${date}`;   // ZSET member=username score=points
export const appliedKey = (date: string) => `lb:applied:${date}`; // HASH username -> points already in the aggregates
export const dayMetaKey = (date: string) => `lb:daymeta:${date}`; // HASH solvers/medianSec/rolledAt
export const weekKey = (date: string) => `lb:week:${isoWeek(date)}`;
export const seasonKey = (date: string) => `lb:season:${seasonOf(date)}`;
export const daysKey = (username: string) => `lb:days:${username}`;  // ZSET member=YYYY-MM-DD score=points
export const userKey = (username: string) => `user:${username}`;     // HASH solved/totalPoints/bestTimeSec/...
export const ALLTIME_KEY = "lb:alltime";
export const STREAK_BEST_KEY = "lb:streakbest";
/** ZSET member=username score=that player's run AS IT STOOD WHEN THEY LAST SOLVED. Mirrored by
    recordVisit() in streak.ts, which is the only place that knows both the username and the derived
    run. A row here goes stale the moment a case is published and its day passes without the owner
    closing it - and that is fine, because nothing writes on that event and liveStreaks() decides
    liveness at READ time instead. See there for why one global comparison settles the whole board. */
export const STREAK_CUR_KEY = "lb:streakcur";
/**
 * The front of the registry, split by whether a case's own day is OVER.
 *
 * `decided` is the newest case that CAN have been missed. `pending` are the ones published today -
 * they cannot be missed yet, because their day is still running.
 *
 * This split IS the liveness rule, and it lives here rather than in streak.ts so the player's own
 * card and the standings board cannot drift apart: streak.ts already imports this module, and the
 * reverse would be a cycle.
 *
 * It exists because the rule it replaces asked only whether the NEWEST case had been missed - which
 * says nothing about a case that published, went by unclosed, and was superseded between two of the
 * player's own solves. A run broken on Monday came back to life on Wednesday the moment Wednesday's
 * case went out, because "the newest case is still today's" was being read as "nothing was missed".
 * Found by adversarial review and reproduced through the real routes, not by a test.
 */
export function registryFront(
  reg: { member: string; score: number }[], today: string,
): { decided: string | null; pending: Set<string> } {
  const pending = new Set<string>();
  for (let i = reg.length - 1; i >= 0; i--) {
    const day = new Date(reg[i].score).toISOString().slice(0, 10);
    if (day >= today) { pending.add(reg[i].member); continue; }
    return { decided: reg[i].member, pending };
  }
  return { decided: null, pending };   // nothing has gone by yet: nothing can have been missed
}
/** One case's own board, keyed by post. Owned by index.ts; read here only to answer "who closed the
    newest case", which is the entire liveness question once its day has passed. */
const caseBoardKey = (postId: string) => `lb:${postId}`;
export const INDEX_DAYS_KEY = "lb:index:days";                // ZSET member=YYYY-MM-DD score=first solve ms
const streakKey = (userId: string) => `streak:${userId}`;     // owned by streak.ts; read-only here

// ───────────────────────── shared cron guard (see report: to move to src/server/cron.ts) ─────────
// Devvit allows 10 recurring tasks per installation and the auto-posting track (plan 05) needs the
// exact same "did this already run for this window?" primitive. One implementation, two callers.
//
// It is a LEASE, not a permanent marker: `hSetNX` claims atomically, `expire` bounds it, and a
// claim older than the lease is taken over (so a crash between the two calls self-heals instead of
// wedging the task forever). For at-most-once-per-day semantics pass a leaseSec longer than the
// window - the window is part of the key, so tomorrow gets a fresh lock either way.
export async function runOnce<T>(
  task: string, window: string, leaseSec: number, fn: () => Promise<T>,
): Promise<{ ran: true; result: T } | { ran: false; heldSince: number }> {
  const key = `cron:once:${task}:${window}`;
  const now = Date.now();
  if ((await redis.hSetNX(key, "at", String(now))) === 1) {
    await redis.expire(key, leaseSec);
  } else {
    const at = Number((await redis.hGet(key, "at")) ?? 0);
    if (now - at < leaseSec * 1000) return { ran: false, heldSince: at };
    await redis.hSet(key, { at: String(now) });   // stale lease - take over
    await redis.expire(key, leaseSec);
  }
  const result = await fn();
  await redis.hSet(key, { done: String(Date.now()) });
  return { ran: true, result };
}

// ───────────────────────── writing a solve ─────────────────────────
export interface SolveInput {
  userId: string;
  date: string;        // the POST's day (postData.date), not the server's clock
  postId: string;      // which CASE this solve is - two can share a date, see writeSolve()
  tier: Tier;
  timeSec: number;
  hints: number;
  /** Closed on the case's own day, not out of the archive - worth FRESH_BONUS more. */
  fresh: boolean;
}

export interface SolveWrite {
  username: string;
  points: number;      // provisional: computed against the tier's nominal target
  target: number;
  flagged: boolean;
  repeat: boolean;     // this player already had a result for that day
  /** The case that owns the day's record. `!== postId` means this solve did not set it. */
  recordPostId: string;
  /** This solve replaced an earlier, slower close of the same day (a second case that day). */
  improved: boolean;
}

export interface SolveRecord {
  username: string; timeSec: number; hints: number; tier: Tier;
  /** "" for records written before the field existed - those days are single-case by definition. */
  postId: string;
  /** Closed on the case's OWN day, rather than out of the archive. See FRESH_BONUS. */
  fresh: boolean;
}

function encodeSolve(
  timeSec: number, hints: number, tier: Tier, postId: string, fresh: boolean,
): string {
  return `${timeSec}|${hints}|${tier}|${postId}|${fresh ? 1 : 0}`;
}
export function decodeSolve(username: string, raw: string): SolveRecord | null {
  const [t, h, tier, postId, fresh] = raw.split("|");
  const timeSec = Number(t);
  if (!Number.isFinite(timeSec) || timeSec <= 0) return null;
  return {
    username, timeSec, hints: Number(h) || 0, tier: (tier as Tier) || "green",
    postId: postId ?? "",
    // A record written before the field existed counts as FRESH. It is a migration default and it
    // is the conservative one: the archive was barely reachable while those records were written,
    // so calling them fresh leaves every existing standing where it is, while calling them archive
    // would retroactively demote eight live players for a rule that did not exist when they played.
    fresh: fresh === undefined ? true : fresh === "1",
  };
}

/**
 * One call, every board. Invoked from /api/check on every successful check, fresh or replayed.
 *
 * Returns null - and writes NOTHING - when the username cannot be resolved. The old code fell back
 * to `userId`, which leaks a raw `t2_…` into a public table; not writing is strictly better than
 * writing an id (plan 04 §C).
 *
 * ── why this reconciles instead of short-circuiting ──
 * `lb:solves:{date}` is both the raw record and the "already counted" marker, and it is necessarily
 * written FIRST. The previous version returned early whenever it existed, so a run that died after
 * that first write - or a day whose keys were written by a build that stopped one line short - left
 * the player recorded as a solver with no row on any board, permanently, with no code path able to
 * repair it. That is exactly the hole the live 0-solved leaderboard fell into.
 *
 * So: `hSetNX` makes the record a single atomic claim (it is also what makes two concurrent checks
 * safe), and EVERY board write below runs on every call. All of them are idempotent - `zAdd`
 * re-sets the same score, `applyPoints` is a delta against `lb:applied`. The only once-per-solve
 * write is the profile counter, and it is gated on winning the claim.
 *
 * ── why the record knows which CASE it came from ──
 * A day holds ONE record per player - that is what makes `lb:day` a board, the median a median and
 * the streak a streak. Publishing has no same-day guard, though, and on 2026-08-14 two cases went
 * out. The claim then belonged to whichever case the player happened to open FIRST, and their
 * second close of the day was silently worth nothing: `hSetNX` lost, the record was re-read, the
 * delta came out 0, and the result card still said "solved" over a board row that had not moved.
 * Nobody decided "the first case wins" - it fell out of an implementation detail.
 *
 * The record now carries its postId, which separates the two cases that used to look identical:
 *   * SAME postId  -> a replay. Reconcile from the record, never re-time (the anti-cheat rule).
 *   * OTHER postId -> a genuinely different case closed the same day. The day keeps the player's
 *     BEST close, so `lb:day` matches the board's own title ("Fastest today") and no honest solve
 *     is thrown away. It is still one row per player per day, so nothing downstream changes shape.
 */
export async function writeSolve(input: SolveInput): Promise<SolveWrite | null> {
  const { userId, date, postId, tier, timeSec, hints, fresh } = input;
  if (!DATE_RE.test(date) || !Number.isFinite(timeSec) || timeSec <= 0) return null;

  const username = await reddit.getCurrentUsername();
  if (!username) {
    console.warn("[lb] no username for", userId, "- skipping every leaderboard write");
    return null;
  }

  // A repeat solve never overwrites the recorded result (same rule as att:.solved in index.ts):
  // the claim only lands the first time, and every later call reconciles from what was recorded.
  //
  // `claimed` is "this call won the hSetNX", i.e. it is the first record for that day. It used to
  // be called `fresh`, which now means something else entirely - whether the case was closed on
  // its own day - and the two are independent: an archive solve is the first record for the
  // archive's date while being the opposite of fresh.
  const mine: SolveRecord = { username, timeSec, hints, tier, postId, fresh };
  const claimed = (await redis.hSetNX(
    solvesKey(date), username, encodeSolve(timeSec, hints, tier, postId, fresh))) === 1;
  let rec: SolveRecord = claimed
    ? mine
    : decodeSolve(username, (await redis.hGet(solvesKey(date), username)) ?? "") ?? mine;

  // A different case, closed the same day, faster than what the day holds: that is a new record,
  // not a replay. (`rec.postId === ""` is a row written before the field existed - treat it as the
  // day's only case rather than letting a replay masquerade as a second one.)
  const improved = !claimed && rec.postId !== "" && postId !== "" && rec.postId !== postId
    && timeSec < rec.timeSec;
  if (improved) {
    rec = mine;
    await redis.hSet(solvesKey(date), {
      [username]: encodeSolve(timeSec, hints, tier, postId, fresh),
    });
  }

  // Once the day has been rolled up, its target is the day's median - re-scoring against the tier's
  // nominal target here would silently undo the rollup on the next replayed check.
  const rolledMedian = Number((await redis.hGet(dayMetaKey(date), "medianSec")) ?? 0) || undefined;
  const target = targetFor(rec.tier, rolledMedian);
  const points = pointsWithFreshness(pointsForSolve(rec.timeSec, rec.hints, target), rec.fresh);

  await redis.zAdd(dayKey(date), { member: username, score: rec.timeSec });
  if ((await redis.zScore(INDEX_DAYS_KEY, date)) === undefined) await registerDay(date);
  await applyPoints(date, username, points);
  // `solved` counts DAYS with a recorded solve, so it is claimed once per day and never on a
  // replay; the personal best is a fact about times and moves whenever a faster one is recorded.
  if (claimed || improved) await bumpProfile(username, date, rec.timeSec, rec.hints, claimed);
  await syncStreakBoard(userId, username);
  await redis.hSet(dayMetaKey(date), { solvers: String(await redis.zCard(dayKey(date))) });

  return {
    username, points, target, flagged: rec.timeSec < MIN_PLAUSIBLE_SEC,
    repeat: !claimed, recordPostId: rec.postId, improved,
  };
}

// Redis can't list keys, so a day that isn't in this set is a day the rollup can never find again.
async function registerDay(date: string): Promise<void> {
  await redis.zAdd(INDEX_DAYS_KEY, { member: date, score: Date.now() });
  const n = await redis.zCard(INDEX_DAYS_KEY);
  if (n > DAYS_KEEP) await redis.zRemRangeByRank(INDEX_DAYS_KEY, 0, n - DAYS_KEEP - 1);
}

/**
 * The single reason the rollup is idempotent.
 *
 * `lb:applied:{date}` remembers exactly how many points of that day are already inside the week /
 * season / all-time totals, so every write is a DELTA against that number. Re-running the rollup
 * recomputes the same final score, produces delta 0, and changes nothing. There is no incrementing
 * from raw values anywhere - which is what would double a player's total on a retry.
 */
async function applyPoints(date: string, username: string, points: number): Promise<number> {
  const prev = Number((await redis.hGet(appliedKey(date), username)) ?? 0);
  const delta = points - prev;
  if (delta !== 0) {
    await redis.zIncrBy(weekKey(date), username, delta);
    await redis.zIncrBy(seasonKey(date), username, delta);
    await redis.zIncrBy(ALLTIME_KEY, username, delta);
    await redis.hIncrBy(userKey(username), "totalPoints", delta);
    await redis.hSet(appliedKey(date), { [username]: String(points) });
  }
  // Absolute, not incremental: these two are "what that day was worth", not running totals.
  await redis.zAdd(pointsKey(date), { member: username, score: points });
  await redis.zAdd(daysKey(username), { member: date, score: points });
  return delta;
}

async function bumpProfile(
  username: string, date: string, timeSec: number, hints: number, countDay: boolean,
): Promise<void> {
  const key = userKey(username);
  await redis.hSetNX(key, "firstSeen", date);
  // NOTE: `solved` is days-with-a-solve, not cases-solved. They differ only on a day that
  // published two cases, and the day is the unit every other key here is built on.
  if (countDay) await redis.hIncrBy(key, "solved", 1);
  if (countDay && hints > 0) await redis.hIncrBy(key, "hintsTotal", hints);
  const best = Number((await redis.hGet(key, "bestTimeSec")) ?? 0);
  if (!best || timeSec < best) await redis.hSet(key, { bestTimeSec: String(timeSec) });
  await redis.hSet(key, { lastDate: date });
}

// The streak hash is owned by streak.ts (`recordVisit`); this only mirrors its `best` into a board.
// Call order matters: writeSolve() must run AFTER recordVisit() so today's streak is already in.
// It runs on replays too, on purpose: that is what heals a `best` the board never received, and it
// is also what publishes a `best` that a reopened archive case has just corrected upwards.
async function syncStreakBoard(userId: string, username: string): Promise<void> {
  const best = Number((await redis.hGetAll(streakKey(userId))).best ?? 0);
  if (best > 0) await redis.zAdd(STREAK_BEST_KEY, { member: username, score: best });
}

// ───────────────────────── nightly rollup ─────────────────────────
export interface RollupReport {
  date: string;
  solvers: number;
  medianSec: number;
  changed: number;    // players whose score actually moved (0 on a repeat run - that IS the test)
  skipped?: string;
}

/**
 * Recompute a day's points from the ORIGINAL t and hints, with T re-targeted on the day's median.
 * Never increments: every write goes through applyPoints(), which is a delta against what the
 * aggregates already hold. Two runs in a row leave identical totals.
 */
export async function rollupDay(date: string): Promise<RollupReport> {
  const raw = await redis.hGetAll(solvesKey(date));
  const recs = Object.entries(raw)
    .map(([u, v]) => decodeSolve(u, v))
    .filter((r): r is SolveRecord => r !== null);
  if (!recs.length) return { date, solvers: 0, medianSec: 0, changed: 0, skipped: "no solves" };

  // Implausibly fast rows are excluded from the median (they would drag the day's target down for
  // everyone) but they keep their own score - marking, not dropping (plan 04 §F).
  const plausible = recs.filter((r) => r.timeSec >= MIN_PLAUSIBLE_SEC).map((r) => r.timeSec);
  const med = median(plausible.length ? plausible : recs.map((r) => r.timeSec));

  let changed = 0;
  for (const r of recs) {
    const target = targetFor(r.tier, med);
    const delta = await applyPoints(date, r.username,
      pointsWithFreshness(pointsForSolve(r.timeSec, r.hints, target), r.fresh));
    if (delta !== 0) changed++;
  }

  await redis.hSet(dayMetaKey(date), {
    solvers: String(recs.length),
    medianSec: String(med),
    rolledAt: String(Date.now()),
  });
  return { date, solvers: recs.length, medianSec: med, changed };
}

/**
 * Roll up every finished day that still needs it, newest first. A day is re-rolled when a straggler
 * solved it after the previous run (the post stays open past UTC midnight), which shows up as a
 * mismatch between the day board's size and the size recorded at rollup time.
 */
export async function rollupPending(maxDays = 14): Promise<RollupReport[]> {
  // `currentDay()`, not the calendar: the live case's own day is never "finished", even once the
  // server clock has rolled past it. Every earlier day is fair game.
  const today = await currentDay();
  const days = (await redis.zRange(INDEX_DAYS_KEY, 0, -1, { by: "rank" }))
    .map((m) => m.member)
    .filter((d) => d < today)
    .slice(-maxDays)
    .reverse();

  const out: RollupReport[] = [];
  for (const date of days) {
    const meta = await redis.hGetAll(dayMetaKey(date));
    const solversNow = await redis.zCard(dayKey(date));
    if (meta.rolledAt && Number(meta.solvers ?? 0) === solversNow) continue; // already final
    out.push(await rollupDay(date));
  }
  return out;
}

// ───────────────────────── reading boards ─────────────────────────
export type Scope = "case" | "today" | "week" | "isoweek" | "season" | "alltime" | "streak";
export type Unit = "time" | "points" | "streak";

export interface BoardRow {
  rank: number;
  name: string;
  value: number;            // seconds / points / days, per `unit`
  hints: number | null;     // today only - a time board without the 💡 count is not an honest board
  flagged: boolean;         // below the plausibility floor; shown, never silently dropped
  isYou: boolean;
}

export interface YouRow extends BoardRow {
  betterPct: number | null; // null under SMALL_N solvers - "N solved" instead of a fake percentile
}

export interface BoardView {
  scope: Scope;
  unit: Unit;
  period: { key: string; label: string };
  rows: BoardRow[];
  you: YouRow | null;
  total: number;
  shown: number;
  provisional: boolean;     // the period is still running / not rolled up - scores can still move
  updatedAt: number;
}

function normalizeScope(raw: unknown): Scope {
  const s = String(raw ?? "today").toLowerCase();
  if (s === "all" || s === "all-time" || s === "alltime") return "alltime";
  if (s === "case" || s === "week" || s === "isoweek" || s === "season"
      || s === "streak" || s === "today") return s;
  return "case";
}

function boardFor(scope: Scope, date: string): { key: string; unit: Unit; period: { key: string; label: string } } {
  switch (scope) {
    // ── THIS CASE (owner, 2026-08-17) ────────────────────────────────────────────────────────
    // World ① had cells on the feed card and a line on the result sheet, and no board at all. This
    // is that board, and it replaces TODAY rather than joining it: `lb:day` is scoped to the DAY,
    // which equals the case on every day except one that published twice - so a TODAY tab serves
    // the consequence of a missing double-press guard rather than any question a player has.
    // `lb:{postId}` has been written on every check since the leaderboard shipped, so the board is
    // free and correct retroactively.
    case "case": {
      const postId = context.postId ?? "";
      const n = (context.postData as { n?: number } | undefined)?.n;
      return {
        key: postId ? `lb:${postId}` : "",
        unit: "time",
        period: { key: postId, label: n ? `Case #${n}` : "This case" },
      };
    }
    // ── the week is the LAST SEVEN CASES, not a calendar week ────────────────────────────────
    // Computed at read time (see rollingWeek), so this key is a placeholder the reader never uses.
    case "week":
      return { key: "", unit: "points", period: { key: "last7", label: "Last 7 cases" } };
    case "isoweek": {
      const key = isoWeek(date);
      return { key: `lb:week:${key}`, unit: "points", period: { key, label: `Week ${key.split("-W")[1]}` } };
    }
    case "season": {
      const key = seasonOf(date);
      const label = new Date(Date.parse(key + "-01T00:00:00Z"))
        .toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
      return { key: `lb:season:${key}`, unit: "points", period: { key, label } };
    }
    case "alltime":
      return { key: ALLTIME_KEY, unit: "points", period: { key: "alltime", label: "All time" } };
    // Computed, like the rolling week - `key: ""` is the marker for "this board is not a ZSET read".
    // The owner's call: a table of records nobody can affect today is a monument, and the run a
    // reader can still lose tonight is the one worth ranking. `lb:streakbest` is untouched: it is
    // what the rank ladder and the subreddit flair read, and a record stays earned (dec. 100).
    case "streak":
      return { key: "", unit: "streak", period: { key: "streak", label: "Current streak" } };
    default:
      return { key: dayKey(date), unit: "time", period: { key: date, label: date } };
  }
}

/**
 * The CURRENT-streak board, computed rather than stored - and it is computed for a reason that is
 * worth stating, because "just read the ZSET" is the obvious wrong answer.
 *
 * A run ends when a case is published and its day goes by without the player closing it. That event
 * has no write of the player's to hang off, so a stored `current` cannot be zeroed when it dies; a
 * board read straight off the ZSET would list runs that ended days ago, ranked above live ones.
 *
 * What makes this cheap is that liveness (`chainLive` in streak.ts) turns out to depend on exactly
 * one per-player field and two globals, and collapses into two cases:
 *
 *   - the newest case's own day is STILL RUNNING → nobody has missed anything yet, so every stored
 *     run is live, and the board is the ZSET as it stands;
 *   - that day has PASSED → a run survives only if its owner closed that case, and the set of
 *     people who closed it is already a board of usernames (`lb:{postId}`).
 *
 * So one comparison and at most one extra read answer it for everybody at once - no per-player
 * lookup, and no nightly sweep to keep a stored board honest.
 */
async function liveStreaks() {
  const rows = await redis.zRange(STREAK_CUR_KEY, 0, -1, { by: "rank", reverse: true });
  const live = rows.filter((r) => r.score > 0);
  if (!live.length) return [];
  const reg = await redis.zRange(POSTS_KEY, 0, -1, { by: "rank" });
  const { decided, pending } = registryFront(reg, todayUtc());
  if (!decided) return live;          // nothing has gone by yet: nothing can have been missed
  // A run survives if its owner closed the newest DECIDED case - or one of today's, which is the
  // player who has already restarted a run on a case still in progress. Everyone else let a case
  // run and go by, which is exactly what this unit measures.
  const alive = new Set();
  for (const id of [decided, ...pending]) {
    for (const m of await redis.zRange(caseBoardKey(id), 0, -1, { by: "rank" })) alive.add(m.member);
  }
  return live.filter((r) => alive.has(r.member));
}

// Points and streaks rank high-to-low; the daily race ranks low-to-high (fastest first).
const isAscending = (unit: Unit) => unit === "time";

/**
 * `provisional` means exactly one thing, because the client prints exactly one sentence for it:
 * **"scores settle overnight"** - the nightly rollup can still move a row on this board.
 *
 * So it is a question about POINTS, not about whether the period is over. The day board is ranked
 * by raw seconds, and a recorded second never moves: the rollup re-targets T and re-prices points,
 * and there are no points on that board to re-price. It printed the promise anyway, under every
 * result card, on the one board a player actually reads - a promise about a number that cannot
 * change. More rows can still arrive, which is a different fact and the one `boardNote` already
 * states ("Top 4 of 12").
 *
 * "Still running" is measured against the game's day, not the server's: a case published on the
 * 7th is still live at 01:00 on the 8th, and calling its board final while people are solving it
 * is the same clock-mismatch that emptied the day board.
 */
function isProvisional(scope: Scope, date: string, today: string): boolean {
  switch (scope) {
    case "case": return false;     // ranked by time; a recorded second is already final
    case "today": return false;    // same
    // The rolling window is recomputed on every read from the raw records, so there is no stored
    // number for the nightly pass to move. What CAN move is a day's target once its median is
    // known, which is why this is true while the newest case's own day is still open.
    case "week": return true;
    case "isoweek": return isoWeek(date) === isoWeek(today);
    case "season": return seasonOf(date) === seasonOf(today);
    case "alltime": return true;   // today's provisional scores are always inside it
    case "streak": return false;
  }
}

/**
 * The last seven CASES, scored at read time.
 *
 * A calendar week empties every Monday and means a different amount of play depending on how many
 * cases went out; a rolling window of seven cases is always full and always the same size. The
 * owner's call, and it has a property worth stating: this board CANNOT be accumulated with
 * `zIncrBy`, because "the last seven" changes membership on every publish. It has to be computed,
 * which also means it cannot drift - `lb:applied` exists precisely to stop an accumulated board
 * drifting from the days it is made of, and there is nothing here to drift.
 *
 * Seven posts, each mapped to its date through `lt:posts`, then one hash read per date. Per-case
 * points are recomputed from the raw record rather than read off `lb:points:{date}`, because that
 * key holds one figure per DAY and a day can hold two cases.
 */
async function rollingWeek(): Promise<{ member: string; score: number }[]> {
  const posts = await redis.zRange(POSTS_KEY, 0, -1, { by: "rank" });
  const last = posts.slice(-ROLLING_CASES);
  const byDate = new Map<string, Set<string>>();
  for (const p of last) {
    const d = new Date(p.score).toISOString().slice(0, 10);
    if (!byDate.has(d)) byDate.set(d, new Set());
    byDate.get(d)!.add(p.member);
  }
  const totals = new Map<string, number>();
  for (const [date, ids] of byDate) {
    const raw = await redis.hGetAll(solvesKey(date));
    if (!Object.keys(raw).length) continue;
    const median = Number((await redis.hGet(dayMetaKey(date), "medianSec")) ?? 0) || undefined;
    for (const [name, v] of Object.entries(raw)) {
      const rec = decodeSolve(name, v);
      if (!rec) continue;
      // A record written before `postId` existed belongs to a single-case day, so if that day is in
      // the window the record is in it too. Otherwise the case has to be one of the seven.
      if (rec.postId !== "" && !ids.has(rec.postId)) continue;
      const pts = pointsWithFreshness(
        pointsForSolve(rec.timeSec, rec.hints, targetFor(rec.tier, median)), rec.fresh);
      totals.set(name, (totals.get(name) ?? 0) + pts);
    }
  }
  return [...totals.entries()].map(([member, score]) => ({ member, score }))
    .sort((a, b) => b.score - a.score);
}

export async function readBoard(scope: Scope, date: string, limit: number, viewer: string | null): Promise<BoardView> {
  const { key, unit, period } = boardFor(scope, date);
  const asc = isAscending(unit);
  const n = clamp(Math.round(limit) || DEFAULT_ROWS, 1, MAX_ROWS);

  // Two boards are not a ZSET read. The rolling week is computed (see rollingWeek); the case board
  // IS a ZSET but has no key at all outside a post, and an empty key must read as an empty board
  // rather than as a redis call on "".
  const computed = scope === "week" ? await rollingWeek()
    : scope === "streak" ? await liveStreaks()
    : null;
  const total = computed ? computed.length : key ? await redis.zCard(key) : 0;
  const raw = computed
    ? computed.slice(0, n)
    : total && key ? await redis.zRange(key, 0, n - 1, { by: "rank", reverse: !asc }) : [];

  // The 💡 count only exists per day; aggregate boards have nothing meaningful to show.
  // hMGet of just the visible names, not hGetAll: on a busy day the full hash is every solver.
  const wanted = [...new Set([...raw.map((m) => m.member), ...(viewer ? [viewer] : [])])];
  const solves = new Map<string, number>();
  const timeBoard = scope === "today" || scope === "case";
  if (timeBoard && wanted.length) {
    const got = await redis.hMGet(solvesKey(date), wanted);
    wanted.forEach((name, i) => {
      const rec = got[i] ? decodeSolve(name, got[i] as string) : null;
      // On the CASE board only the day's record for THIS case can speak for it: a day holds one
      // record per player, so if that record belongs to the other case of a two-case day its hint
      // count is about a different puzzle. Unknown is null, which prints no tag at all.
      const mine = rec && (scope === "today" || rec.postId === "" || rec.postId === context.postId);
      solves.set(name, mine ? rec.hints : -1);
    });
  }
  const hintsOf = (name: string): number | null => {
    if (!timeBoard) return null;
    const h = solves.get(name);
    return h === undefined || h < 0 ? null : h;
  };

  const rows: BoardRow[] = raw.map((m, i) => ({
    rank: i + 1,
    name: m.member,
    value: Math.round(m.score),
    hints: hintsOf(m.member),
    flagged: unit === "time" && m.score < MIN_PLAUSIBLE_SEC,
    isYou: viewer !== null && m.member === viewer,
  }));

  let you: YouRow | null = null;
  if (viewer) {
    // A computed board has no ZSET to ask, and `key` is "" for one - so the old `zScore(key, ...)`
    // silently answered undefined and the viewer's own row never appeared. That was invisible while
    // the rolling week was the only computed board; it would have shipped with the current-streak
    // board too, on the one screen where a player is looking for exactly their own line.
    const idx = computed ? computed.findIndex((m) => m.member === viewer) : -1;
    const score = computed
      ? (idx >= 0 ? computed[idx].score : undefined)
      : await redis.zScore(key, viewer);
    if (score !== undefined) {
      // A computed board is already in rank order, so the position IS the index.
      const rankAsc = computed ? idx : ((await redis.zRank(key, viewer)) ?? 0);
      const rank = computed ? idx + 1 : asc ? rankAsc + 1 : total - rankAsc;
      you = {
        rank,
        name: viewer,
        value: Math.round(score),
        hints: hintsOf(viewer),
        flagged: unit === "time" && score < MIN_PLAUSIBLE_SEC,
        isYou: true,
        // Under SMALL_N a percentage is noise dressed up as a fact (decision #37).
        //
        // Denominator = `total`, not `total - 1`. The copy beside this number says "ahead of X%"
        // / "faster than X% of N detectives", i.e. X is a share of N - and dividing by N-1 made
        // the fastest player on a board of ten "faster than 100% of 10 detectives", which counts
        // them as faster than themselves. Ahead of 9 of 10 is 90%, and that is what it now says.
        betterPct: total >= SMALL_N && total > 1 ? Math.round((100 * (total - rank)) / total) : null,
      };
    }
  }

  const today = await currentDay();
  return {
    scope, unit, period, rows, you, total, shown: rows.length,
    provisional: isProvisional(scope, date, today),
    updatedAt: Date.now(),
  };
}

// ───────────────────────── post context ─────────────────────────
/** An explicit ?date= wins; otherwise the day is whatever `currentDay()` says it is. */
async function dateParam(raw: unknown): Promise<string> {
  const q = String(raw ?? "");
  return DATE_RE.test(q) ? q : await currentDay();
}

async function viewerName(): Promise<string | null> {
  if (!context.userId) return null;
  return (await reddit.getCurrentUsername()) ?? null;
}

// ───────────────────────── routes ─────────────────────────

export const leaderboardRouter = express.Router();

leaderboardRouter.get("/api/leaderboard", async (req, res) => {
  const scope = normalizeScope(req.query.scope);
  const date = await dateParam(req.query.date);
  const limit = Number(req.query.limit ?? DEFAULT_ROWS);
  res.json(await readBoard(scope, date, limit, await viewerName()));
});

// ── Nightly rollup. REGISTERED in devvit.json (`scheduler.tasks.lb-rollup`, 03:00 UTC) ──────────
//
// It used to be deliberately left out, to keep the last word on cron scheduling with the
// auto-posting track (plan 05). The cost of waiting turned out to be a lie on screen: every board
// under every result card printed "scores settle overnight", the settling never happened, so T in
// the scoring formula stayed the tier nominal forever and `lb:daymeta.medianSec` / `rolledAt` were
// never written on any day this game has ever run. A promise printed to players is not something a
// track can hold in reserve.
//
// The two tracks still share ONE idempotency primitive (`runOnce`), which was the real requirement;
// this spends 1 of the 10 recurring slots and leaves 9. Auto-posting can take a second, or fold
// into a `/internal/cron/tick` dispatcher later - either way, no player-facing sentence waits on it.
//
// 03:00 UTC: past midnight so a straggler on yesterday's case is already in, and well before the
// daily post goes out. `rollupPending()` deliberately never rolls the day the sub is still playing
// (`currentDay()`), so a day settles on the first run after the sub has moved on to the next case.
leaderboardRouter.post("/internal/cron/rollup", async (req, res) => {
  // Printed here rather than only on a menu press, so the shape is READABLE WITHOUT ANYBODY
  // PRESSING ANYTHING: `devvit logs --since 7d` carries a week of these. That is the difference
  // between a figure somebody has to go and fetch and a figure that simply arrives, and it is the
  // reason this line lives on the one job that already runs every night.
  try {
    console.log("[hours] first opens by UTC hour, all time:\n  " +
      (await hoursLines()).join("\n  "));
  } catch (e) {
    // A readout must never be the reason the night's points do not settle.
    console.error("[hours] could not be read", e);
  }
  const forced = String(req.body?.date ?? "");
  if (DATE_RE.test(forced)) {
    const report = await rollupDay(forced);            // manual re-run: always recompute
    console.log(`[lb] rollup ${forced}: ${JSON.stringify(report)}`);
    res.json({ status: "ok", reports: [report] });
    return;
  }
  // 20 h lease: long enough that a retry inside the same night is a no-op, short enough that a
  // wedged run cannot block tomorrow.
  const run = await runOnce("lb-rollup", todayUtc(), 20 * 3600, () => rollupPending());
  if (!run.ran) { res.json({ status: "ok", skipped: "already ran", heldSince: run.heldSince }); return; }
  for (const r of run.result) console.log(`[lb] rollup ${r.date}: ${JSON.stringify(r)}`);
  res.json({ status: "ok", reports: run.result });
});
