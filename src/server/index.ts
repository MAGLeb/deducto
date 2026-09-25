// Deducto - Devvit Web server (source of truth).
// /api/* - webview; /internal/* - menu & cron (daily post creation).
// The case solution and the timer live only on the server (anti-cheat); the client gets no solution.

import { createServer, getServerPort, context, reddit, redis } from "@devvit/web/server";
import express from "express";
import type { Clue, Solution } from "../shared/types.js";
import { effectiveValue, effectiveCount, type GridState, type PuzzleCtx } from "../shared/status.js";
import { FLAIR_TOKENS, TIME_TOKENS, THEME_BY_ID } from "../shared/themes.js";
import { Puzzle, adviseOnGrid, gridFits, type Advice } from "./engine.js";
import {
  leaderboardRouter, writeSolve, readBoard, currentDay, LAST_DAY_KEY, dayKey,
  userKey, daysKey, ALLTIME_KEY,
} from "./leaderboard.js";
import { flairRouter, queueFlairUpdate, rankState } from "./flair.js";
import { countHour } from "./hours.js";
import { maybeDumpStats, seedServed, SERVED_KEY } from "./caselog.js";
import { makeDailyRouter, NEXT_AT as DAILY_NEXT_AT } from "./daily.js";
import { CLOSE_AFTER_MS, heraldRouter, scheduleClose, maybeAnnounce } from "./herald.js";
import {
  dayOfMs, noteRecordedSolve, readStreak, recordVisit, visitDay, type StreakState,
} from "./streak.js";
import { auditRouter } from "./audit.js";
import bankData from "./bank.json";

// "tutorial" = over-clued green (minimized down to a floor of 14 clues): every move is forced AND
// obvious. It is NOT part of the daily ramp - it only feeds the warm-up lane (decision #43).
type Tier = "tutorial" | "green" | "yellow" | "red";

interface BankEntry {
  themeId: string;
  tier: Tier;
  suspects: string[];
  objectTokens: string[];
  clues: Clue[];
  solution: Solution;
  score?: number; // offline difficulty score (build-bank.ts); orders the warm-up pool
  batch?: number;  // bank generation; absent = the original bank. See LEVEL_BUCKETS.
}
const BANK = bankData as unknown as BankEntry[];
const CAT_IDS = ["flair", "time", "object"];

type VoteChoice = "Harder" | "Same" | "Softer";
const VOTE_CHOICES: VoteChoice[] = ["Harder", "Same", "Softer"];
const TIER_OF: Record<VoteChoice, string> = { Harder: "HARD", Same: "SAME", Softer: "SOFT" };

// solve-time histogram bins (shared shape with the client)
const TIME_BINS = [120, 180, 240, 300, 420, 600, 900, Infinity];
const HIST_MIN = 50; // prod rule: distribution/percentile only at N ≥ 50

// ───────────────────────── vote → difficulty ladder (honest) ─────────────────────────
// A 12-agent + solver measurement showed the score bins DON'T map to felt difficulty inside 🟡
// (weak_stuck / grid-rounds / human deduction-steps all flat across the yellow bins - fewer clues
// ≠ harder). The step that DOES map is the tier, so the vote-ramp moves the real 🟢↔🟡.
//
// The default is 🟢 (decision #42): `scripts/check-solvability.ts` shows the 4×3 board forces
// 12/12 cells on green and 0/12 on 69 of 100 yellow cases - 🟡 as a default handed a first-time
// player a board with no legal move on it. 🟡 now arrives only when the sub votes Harder.
const MIN_LEVEL = 0;
const DEFAULT_LEVEL = 0;    // daily default is 🟢 green (index into LEVEL_BUCKETS below)
const VOTE_MIN_TOTAL = 5;   // significance gate (prod). Drop to 1 for solo playtest.
const VOTE_MIN_LEAD = 0.10; // leader must beat the runner-up by ≥10 points

// Tiers the DAILY ramp may serve, easiest first. "tutorial" is deliberately absent: it is the
// warm-up lane's tier, not a difficulty a daily post is allowed to land on. Empty tiers drop out,
// so MAX_LEVEL sizes itself - dropping 🔴 into the bank makes it a real third step for free.
const DAILY_TIERS: Tier[] = ["green", "yellow", "red"];
const TIER_LABEL: Record<Tier, string> = {
  tutorial: "warm-up", green: "daily deduction", yellow: "hard mode", red: "hardcore",
};

const BY_TIER = new Map<Tier, number[]>();
BANK.forEach((e, i) => {
  const b = BY_TIER.get(e.tier);
  if (b) b.push(i); else BY_TIER.set(e.tier, [i]);
});

const LEVEL_TIERS: Tier[] = DAILY_TIERS.filter((t) => (BY_TIER.get(t)?.length ?? 0) > 0);

// build-bank lays one tier down in a run while the theme cycles as `i % THEMES.length` - so all 20
// pinned 🟢 landed on the same theme (pizza). Serving the bucket in bank order therefore means the
// same headline on the first twenty daily posts: a bot-shaped signature, which is exactly what got
// the previous subreddits banned. Interleave greedily instead: always take the theme with the most
// cases left that isn't the one we just used. Max run drops 20 → 3 (tail only, day ~43: unavoidable,
// pizza is 24 of 45 greens).
function spreadByTheme(idxs: number[]): number[] {
  const queues = new Map<string, number[]>();
  for (const i of idxs) {
    const q = queues.get(BANK[i].themeId);
    if (q) q.push(i); else queues.set(BANK[i].themeId, [i]);
  }
  const out: number[] = [];
  let last: string | null = null;
  while (out.length < idxs.length) {
    const live = [...queues.entries()].filter(([, q]) => q.length > 0)
      .sort((a, b) => b[1].length - a[1].length);
    const pick = live.find(([t]) => t !== last) ?? live[0];
    out.push(pick[1].shift()!);
    last = pick[0];
  }
  return out;
}

// ── batch by batch, so a grown bank continues rather than reshuffles ────────────────────────
// A daily post takes `bucket[(cursor - 1) % bucket.length]`, and the cursor is a counter that
// persists in Redis. Spreading a grown tier as ONE pool would reorder all of it - spreadByTheme's
// greedy pick depends on how many cases each theme has left - so the day after an append the
// cursor would point into a different sequence altogether: the next case could be one the sub
// played last month, and some never-played ones would be skipped for a full lap.
//
// Spreading each batch on its own and laying them end to end keeps the original order exactly
// where the cursor left it and puts the new cases AFTER it. A cursor that had already wrapped the
// old batch - which is what 45 greens against case #56 means - lands straight in the new one, and
// nothing already played comes round again until the whole grown bucket has.
function bucketFor(idxs: number[]): number[] {
  const batches = new Map<number, number[]>();
  for (const i of idxs) {
    const b = BANK[i].batch ?? 1;
    const q = batches.get(b);
    if (q) q.push(i); else batches.set(b, [i]);
  }
  return [...batches.keys()].sort((a, b) => a - b).flatMap((b) => spreadByTheme(batches.get(b)!));
}
const LEVEL_BUCKETS: number[][] = LEVEL_TIERS.map((t) => bucketFor(BY_TIER.get(t)!));
const MAX_LEVEL = Math.max(0, LEVEL_BUCKETS.length - 1);
const LEVEL_LABELS = LEVEL_TIERS.map((t) => TIER_LABEL[t]);

// ── the daily level survives the code that wrote it ──────────────────────────────────────────
// `DEFAULT_LEVEL` is only the fallback for a MISSING key, so it reaches exactly one installation:
// one that has never published a case. When the default moved 🟡→🟢 (decision #42), every sub that
// had already published kept serving 🟡 forever - `lt:level` held "1", written by the old build,
// and the vote ramp cannot bring it down on its own (VOTE_MIN_TOTAL = 5 votes; the dev sub has one
// player). Deleting the key by hand fixes one install once and leaves the next change of the
// constant to walk into the same wall.
//
// So the level is stored WITH the default it descends from, and the rule reads that stamp:
//   * the sub is still sitting on the old default (stored === base) → it adopts the new one;
//   * the sub voted itself somewhere else (stored !== base)         → its choice stands, and the
//     re-stamp below means the question is never asked again.
// Nothing has to be remembered when DEFAULT_LEVEL next changes - which is the difference from a
// migration ledger keyed on a schema version: a ledger only fires for whoever remembers to add an
// entry, and "remember to migrate the live value" is exactly the step that was missed here.
const LEVEL_KEY = "lt:level";
const LEVEL_BASE_KEY = "lt:levelBase";
// Installs older than the stamp were all baselined on the previous constant, DEFAULT_LEVEL = 1
// (🟡, decision #33, revoked 2026-08-07). That is this repo's history, not a guess: with no stamp,
// a stored 1 is the old default untouched, and a stored 0 can only be a vote or a fresh install -
// and the rule keeps 0 either way, because 0 is also the level we would migrate it to.
const LEGACY_DEFAULT_LEVEL = 1;

async function resolveLevel(): Promise<number> {
  const raw = await redis.get(LEVEL_KEY);
  const stored = Number(raw);
  if (!raw || !Number.isFinite(stored)) return DEFAULT_LEVEL;      // never published, or garbage
  const rawBase = await redis.get(LEVEL_BASE_KEY);
  const base = Number(rawBase);
  const from = rawBase && Number.isFinite(base) ? base : LEGACY_DEFAULT_LEVEL;
  if (stored !== from) return stored;                               // the sub voted; leave it alone
  if (stored !== DEFAULT_LEVEL)
    console.log(`[level] default moved ${from} → ${DEFAULT_LEVEL}; the sub never voted off it, re-baselining`);
  return DEFAULT_LEVEL;
}

/**
 * Has the vote actually decided anything? One definition, because two screens and the publisher all
 * need the same answer: the ladder below reads it to move the level, and the feed card and the
 * result sheet read it to say what the next case will be (docs/11-stats-ia.md §3). It used to live
 * inside levelFromVote alone, which meant a screen wanting to state the verdict had to re-derive
 * the significance test - and a screen that got it slightly wrong would promise a difficulty change
 * that the publisher then declined to make.
 *
 * `null` is "the sub has not decided", and it is the honest answer at two votes: below
 * VOTE_MIN_TOTAL, or with no clear lead, the vote moves nothing at all.
 */
function voteVerdict(tally: Record<VoteChoice, number>): VoteChoice | null {
  const total = tally.Harder + tally.Same + tally.Softer;
  if (total < VOTE_MIN_TOTAL) return null;
  const sorted = VOTE_CHOICES.slice().sort((a, b) => tally[b] - tally[a]);
  if ((tally[sorted[0]] - tally[sorted[1]]) / total < VOTE_MIN_LEAD) return null; // no clear winner
  return sorted[0];
}

// Shift the level by the previous day's vote (raw majority with a significance gate).
function levelFromVote(level: number, tally: Record<VoteChoice, number>): number {
  const v = voteVerdict(tally);
  if (v === "Harder") return Math.min(MAX_LEVEL, level + 1);
  if (v === "Softer") return Math.max(MIN_LEVEL, level - 1);
  return level; // "Same", or nothing decided
}

/**
 * What the NEXT case would be if it were published right now - world ② of docs/11-stats-ia.md.
 *
 * Answerable only for the case the sub is currently on: createDailyPost() reads the vote of
 * `lt:lastPostId`, so an archive case's vote steers nothing and this returns `null` rather than
 * letting an old post claim authorship of tomorrow's difficulty.
 *
 * `moved` is deliberately separate from `verdict`: at the top of the ladder a decided "Harder"
 * changes no level, and a screen that printed the verdict alone would promise a step that cannot
 * be taken.
 */
async function nextLevelState(postId: string, tally: Record<VoteChoice, number>): Promise<
  { tier: Tier; moved: "up" | "down" | null; verdict: VoteChoice | null } | null
> {
  if ((await redis.get("lt:lastPostId")) !== postId) return null;
  const level = Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, await resolveLevel()));
  const voted = levelFromVote(level, tally);
  // The same dice createDailyPost will read, so the tier named for tomorrow is the tier that ships.
  // `moved` stays the VOTE's word: a hard day is not the sub having moved anything, and saying
  // "the vote is sending it up" about dice would be a claim about people that nobody made.
  const nextN = (Number((await redis.get("bank:cursor")) ?? 0) || 0) + 1;
  const ships = voteVerdict(tally) === null && voted === DEFAULT_LEVEL && hardDay(nextN) && MAX_LEVEL > DEFAULT_LEVEL
    ? DEFAULT_LEVEL + 1 : voted;
  return {
    tier: LEVEL_TIERS[ships] ?? LEVEL_TIERS[0],
    moved: voted > level ? "up" : voted < level ? "down" : null,
    verdict: voteVerdict(tally),
  };
}

// ── Onboarding: warm-up practice lane (own keys, isolated from the daily) ──
// The pool is the whole "tutorial" tier, easiest first; the per-user counter walks it, so a second
// warm-up is a DIFFERENT case (it used to be case #78 forever, progress and all). Falls back to the
// easiest greens when the bank was built without the tutorial tier (`build-bank.ts 120`).
// ONE case, the easiest, every time - the owner's call (2026-09-25): "на разминку одну и ту же я бы
// оставил". The lane exists to teach the mechanic, and a mechanic is learned by doing the same thing
// until it is obvious, not by meeting a new board each round. Every round still opens on a clean
// board: a practice slot is keyed by the player's own round counter (`pract:{user}:{k}`), not by
// the case. The other 14 tutorial cases stay in the bank - deleting them would shift every index
// after them, and published posts store those indices.
const WARMUP_POOL: number[] = (() => {
  const byScore = (a: number, b: number) => (BANK[a].score ?? 0) - (BANK[b].score ?? 0);
  const tut = (BY_TIER.get("tutorial") ?? []).slice().sort(byScore);
  if (tut.length) return tut.slice(0, 1);
  const green = (BY_TIER.get("green") ?? []).slice().sort(byScore).slice(0, 8);
  return green.length ? green : [0];
})();
function warmupIdx(k: number): number {
  const n = WARMUP_POOL.length;
  return WARMUP_POOL[((k % n) + n) % n];
}
const onbKey = (userId: string) => `onb:${userId}`;      // # warm-ups completed (0..N)
const onbSkipKey = (userId: string) => `onbSkip:${userId}`; // dismissed the first-run ladder
const pAttKey = (userId: string, k: number) => `pract:${userId}:${k}`; // practice attempt (own grid)

// ───────────────────────── helpers ─────────────────────────
function ctxFor(entry: BankEntry): PuzzleCtx {
  return {
    suspects: entry.suspects,
    catIds: CAT_IDS,
    cats: { flair: [...FLAIR_TOKENS], time: [...TIME_TOKENS], object: entry.objectTokens },
    timeValues: [...TIME_TOKENS],
  };
}

type PostMeta = { idx?: number; date?: string; n?: number | null; level?: number; epilogue?: EpilogueData | null };
// `postId` is what makes the first two fields refreshable. Everything in `postData` is frozen at
// publication, so "u/x in 02:41 · 7 solved it" used to be the previous case as it stood at the
// moment the next one went out - and every solve after that was invisible to a sentence written in
// the present tense. Absent on posts published before this field existed, and the frozen figures
// are then the only ones there are (docs/11-stats-ia.md §4.7).
type EpilogueData = {
  who: string; timeSec: number; solvers: number; tier: string; pct: number; postId?: string;
};

function postMeta(): PostMeta { return (context.postData as PostMeta | undefined) ?? {}; }

function bankIndexForPost(): number {
  const idx = postMeta().idx;
  if (typeof idx === "number") return ((idx % BANK.length) + BANK.length) % BANK.length;
  // No pinned index (dev harness, or a post created before postData). Rotate by day inside the
  // DEFAULT bucket rather than over the raw bank, so the fallback can't serve a warm-up-tier case
  // as the daily now that the bank holds one.
  const bucket = LEVEL_BUCKETS[DEFAULT_LEVEL] ?? WARMUP_POOL;
  return bucket[Math.floor(Date.now() / 86_400_000) % bucket.length];
}
function caseNumber(): number { return postMeta().n ?? bankIndexForPost() + 1; }

// There is no local "what day is it" any more. `currentDay()` in leaderboard.ts is the only
// definition of the day a RESULT is filed under, so a write (this file) and a read (the mod menu,
// /api/leaderboard) can never land on two different days again - see the comment on it. The streak
// asks a different question and has its own day: `visitDay()` in streak.ts.
function minutesToUtcMidnight(): number {
  const now = Date.now();
  const next = new Date(now); next.setUTCHours(24, 0, 0, 0);
  return Math.max(0, Math.round((next.getTime() - now) / 60000));
}

// ── "#N opens in Xh Ym" - both halves used to be guesses ──────────────────────────────────────
//
// The old answer was `caseNumber() + 1` and `minutesToUtcMidnight()`, which stacks two assumptions
// this app does not hold: that the case after the one you are reading has not shipped yet, and
// that cases appear at UTC midnight. On 2026-08-14 both were wrong at the same moment - the card
// on #14 printed "#15 opens in 1h 30m" while #15 had been live for nine minutes.
//
// Both halves are answerable from keys that already exist:
//   * WHICH case is next → `bank:cursor`, the monotonic counter createDailyPost() increments. The
//     next publish takes cursor + 1 exactly, whichever post you happen to be looking at, so a case
//     that is already out can never be counted down to again.
//   * WHEN → 24 h after the newest entry in `lt:posts`. The daily-post scheduler is off and cases
//     go out by a mod pressing a menu item, so the sub's own cadence is the only honest estimate
//     available; UTC midnight is a schedule nothing in this app actually keeps. A case that is
//     already overdue reports 0 rather than a negative countdown.
const NEXT_CASE_GAP_MS = 86_400_000;
async function nextCase(): Promise<{ number: number; inMin: number }> {
  const cursor = Number((await redis.get("bank:cursor")) ?? 0);
  const posts = await redis.zRange(POSTS_KEY, 0, -1, { by: "rank" });
  const newestMs = posts[posts.length - 1]?.score ?? 0;
  // When a schedule is actually running, the honest countdown is to ITS next firing, not to 24 h
  // after whenever the last case happened to go out - those differ by hours the moment a run is
  // skipped or a case is published by hand. `daily:nextAt` is written by the hourly tick and
  // deleted whenever the schedule is off or paused, so its absence means "estimate from cadence"
  // and never means "the schedule is broken". One GET; this endpoint renders on a feed scroll.
  const schedAt = Number((await redis.get(DAILY_NEXT_AT)) ?? 0) || 0;
  if (schedAt > 0) {
    return {
      number: Number.isFinite(cursor) && cursor > 0 ? cursor + 1 : caseNumber() + 1,
      inMin: Math.max(0, Math.round((schedAt - Date.now()) / 60000)),
    };
  }
  return {
    number: Number.isFinite(cursor) && cursor > 0 ? cursor + 1 : caseNumber() + 1,
    inMin: newestMs > 0
      ? Math.max(0, Math.round((newestMs + NEXT_CASE_GAP_MS - Date.now()) / 60000))
      : minutesToUtcMidnight(),   // nothing published yet: no cadence to read
  };
}

// ── an ARCHIVE case: the one state where the card had nothing true left to say ──────────────────
//
// A case you have CLOSED, on a post that is no longer the live one, left the brief holding a single
// countdown - and that countdown was pointing at the wrong case. `nextCase()` counts to #cursor+1
// while #cursor is already published and playable, so an archive card told a reader who had just
// finished to wait seven hours for a case that was already out. The two answers below replace it:
// which case is live now, and when this one's own day ended.

/** The permalink of a post this app created, BUILT rather than fetched: /api/preview renders on a
    feed scroll and is not allowed to spend a Reddit call (see the endpoint's own contract). */
function postUrl(id: string): string {
  return `https://www.reddit.com/r/${context.subredditName}/comments/${id.replace(/^t3_/, "")}/`;
}

/** The case that is live RIGHT NOW, for a card that is not it - `null` on the live post itself.
    Both figures are the published case's own rather than a guess about it: `bank:cursor` is the
    number createDailyPost stamped on that post, and `lt:level` is the level it published at, whose
    bucket is by construction the tier `LEVEL_TIERS` names. Only ever called on the archive path,
    so the live card - which is what nearly every render is - pays nothing for it. */
async function liveCase(postId: string): Promise<{ number: number; tier: Tier; url: string } | null> {
  const id = await redis.get("lt:lastPostId");
  if (!id || id === postId) return null;           // this IS the live case, or nothing was published
  const n = Number(await redis.get("bank:cursor"));
  if (!Number.isFinite(n) || n <= 0) return null;  // no number to name it by, so it is not named
  const lvl = Number(await redis.get(LEVEL_KEY));
  return {
    number: n,
    tier: LEVEL_TIERS[Number.isFinite(lvl) ? lvl : 0] ?? LEVEL_TIERS[0],
    url: postUrl(id),
  };
}

/** When this case's own day ended, in minutes either side of now. A case belongs to its day and the
    day runs `CLOSE_AFTER_MS` from publication - herald.ts owns that definition and schedules the
    closing comment on it - so this is derived from the publication time rather than from a second
    timestamp that could drift out of step with it. Both null when `lt:posts` no longer carries the
    post (it keeps 60), because a card with no date must print no date (dec. 37). */
async function closeClock(
  postId: string,
): Promise<{ closedMinAgo: number | null; closesInMin: number | null }> {
  const publishedMs = await redis.zScore(POSTS_KEY, postId);
  if (!publishedMs) return { closedMinAgo: null, closesInMin: null };
  const delta = Date.now() - (publishedMs + CLOSE_AFTER_MS);
  return delta >= 0
    ? { closedMinAgo: Math.round(delta / 60000), closesInMin: null }
    : { closedMinAgo: null, closesInMin: Math.round(-delta / 60000) };
}

const attKey = (postId: string, userId: string) => `att:${postId}:${userId}`;
const lbKey = (postId: string) => `lb:${postId}`;
const voteKey = (postId: string) => `vote:${postId}`;
const solvedCountKey = (postId: string) => `solvedCount:${postId}`;

// ── funnel instrumentation (plan 02/A1) ──
// Devvit Redis cannot enumerate keys, so nothing can be derived after the fact by scanning att:* -
// every aggregate has to be an explicit counter written the moment the event happens, and anything
// we ever want to iterate has to be dropped into an explicit collection up front.
const statsKey = (postId: string) => `stats:${postId}`;  // hash: opened/firstMove/reached*/hint*/nudged
const stuckKey = (postId: string) => `stuck:${postId}`;  // zset: member = userId, score = best effectiveCount
const POSTS_KEY = "lt:posts";                            // zset: member = postId, score = created ms
const POSTS_KEEP = 60;                                   // trim the registry so it can't grow forever

// Count a funnel event at most once per player. The "already counted" marker is a field on the
// player's own att: hash (f_*), so this adds no keys. `h` is the caller's already-read hash and is
// updated in place so several thresholds can be checked off in one request.
async function countOnce(
  h: Record<string, string>, attK: string, flag: string, postId: string, field: string,
): Promise<void> {
  if (h[flag]) return;
  h[flag] = "1";
  await redis.hSet(attK, { [flag]: "1" });
  await redis.hIncrBy(statsKey(postId), field, 1);
}


/**
 * Read (creating if needed) the player's attempt row, and count "opened" exactly once.
 *
 * `opened` used to be inferred from the ABSENCE of `startedAt` inside /api/daily alone, which is
 * what produced the impossible live funnel `opened 0 → moved 1`: the row already carried a
 * `startedAt` (stamped by a build that predates this counter), so the one place that could ever
 * count the open had already been disarmed - permanently, with no way to repair it.
 *
 * Two independent things now do two independent jobs:
 *   `startedAt` - the timer baseline, written by whichever endpoint touches the row first, so the
 *                 anti-cheat wall clock in /api/check can never be measured from "now".
 *   `f_open`    - the funnel marker, counted through countOnce() like every other funnel event.
 *
 * Because every entry point calls this, `opened >= firstMove` holds by construction, and a row
 * left over from an older build repairs itself the next time that player touches the post.
 */
async function openAttempt(
  postId: string, userId: string,
): Promise<{ key: string; h: Record<string, string> }> {
  const key = attKey(postId, userId);
  const h = await redis.hGetAll(key);
  if (!h.startedAt) {
    h.startedAt = String(Date.now());
    await redis.hSet(key, { startedAt: h.startedAt });
  }
  // Keyed off the same one-shot flag as the funnel, so a player who reopens a case all evening is
  // one open AND one tick - otherwise the busiest hour would be the hour whoever refreshes most
  // happens to play.
  if (!h.f_open) await countHour();
  await countOnce(h, key, "f_open", postId, "opened");
  return { key, h };
}

function gradeGrid(entry: BankEntry, grid: GridState): "incomplete" | "wrong" | "solved" {
  const ctx = ctxFor(entry);
  if (!gridFits(ctx, grid)) return "incomplete";
  if (effectiveCount(ctx, grid) !== ctx.suspects.length * CAT_IDS.length) return "incomplete";
  for (const c of ctx.catIds)
    for (const s of ctx.suspects)
      if (entry.solution[s][c] !== effectiveValue(ctx, grid, c, s)) return "wrong";
  return "solved";
}

function publicPuzzle(entry: BankEntry, idx: number, day: string) {
  const theme = THEME_BY_ID[entry.themeId];
  return {
    idx, caseNumber: caseNumber(), themeId: entry.themeId, tier: entry.tier,
    level: postMeta().level ?? DEFAULT_LEVEL,
    title: theme?.title ?? "Case", legend: theme?.legend ?? "",
    suspects: entry.suspects, objectTokens: entry.objectTokens, clues: entry.clues,
    day,
  };
}

async function voteTally(postId: string): Promise<Record<VoteChoice, number>> {
  const h = await redis.hGetAll(voteKey(postId));
  return { Harder: Number(h.Harder ?? 0), Same: Number(h.Same ?? 0), Softer: Number(h.Softer ?? 0) };
}
function voteLeader(t: Record<VoteChoice, number>): { tier: string; pct: number; total: number } {
  const total = t.Harder + t.Same + t.Softer;
  if (total === 0) return { tier: "SAME", pct: 0, total: 0 };
  const top = VOTE_CHOICES.reduce((a, b) => (t[b] > t[a] ? b : a), "Same" as VoteChoice);
  return { tier: TIER_OF[top], pct: Math.round((t[top] / total) * 100), total };
}

// ───────────────────────── app ─────────────────────────
const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

const router = express.Router();

router.get("/api/daily", async (_req, res) => {
  const idx = bankIndexForPost();
  const entry = BANK[idx];
  const postId = context.postId ?? "dev";
  const userId = context.userId;

  let attempt = { grid: null as GridState | null, hints: 0, solved: false, elapsedSec: 0, vote: null as string | null };
  let showTutorial = false; // coach marks, once per logged-in player (guests: handled client-side)
  // First-run ladder: send a brand-new player through the over-clued warm-up before today's case.
  // Guests can't be tracked at all, so they are always offered it (the client dismisses it locally).
  let showWarmup = true;

  if (userId) {
    // Hydrate unconditionally. The old code only restored the board on the "row already had
    // startedAt" branch, so a row created by the autosave first (grid, no startedAt) handed the
    // player back an empty board and threw their marks away.
    const { h } = await openAttempt(postId, userId);
    const solvedFlag = h.solved === "1";
    attempt = {
      grid: h.grid ? (JSON.parse(h.grid) as GridState) : null,
      hints: Number(h.hints ?? 0),
      solved: solvedFlag,
      elapsedSec: solvedFlag ? Number(h.timeSec ?? 0) : Number(h.activeSec ?? 0),
      vote: h.vote ?? null,
    };
    const seenTut = await redis.get(`tut:${userId}`);
    showTutorial = !seenTut;
    if (!seenTut) await redis.set(`tut:${userId}`, "1");

    // Self-clearing: solving one warm-up bumps onb: to 1, so the ladder stops offering itself.
    const warmupsDone = Number((await redis.get(onbKey(userId))) ?? 0);
    showWarmup = warmupsDone === 0 && !attempt.solved && !(await redis.get(onbSkipKey(userId)));
  }

  const tally = await voteTally(postId);
  // `streak` is the rank-bearing number, and the rank a player HOLDS comes from `best` - the same
  // input the subreddit flair uses (src/server/flair.ts). See rankState(): one word, one number.
  // `streakCurrent` is the LIVE run (streak.ts): a run that can no longer be extended reads 0
  // rather than printing the length of a run the player is no longer on.
  const st = userId ? await readStreak(userId) : null;
  const next = await nextCase();

  res.json({
    puzzle: publicPuzzle(entry, idx, await currentDay()),
    attempt,
    meta: {
      // `solversTotal: zCard(lb:{postId})` used to ride here. It was declared by the client and
      // rendered by nothing - a redis call on every board load, spent on a figure no reader ever
      // saw, under the word the splash reserves for a different population (docs/11 §6).
      streak: st?.best ?? 0,
      streakBest: st?.best ?? 0,
      streakCurrent: st?.current ?? 0,
      casesSolved: st?.cases ?? 0,
      epilogue: await liveEpilogue(postMeta().epilogue ?? null),
      vote: { choice: attempt.vote, tally, leader: voteLeader(tally) },
      showTutorial,
      showWarmup,
      nextOpensInMin: next.inMin,
      nextCaseNumber: next.number,
    },
  });
});

// ── GET /api/preview: what the splash (feed) screen shows ──
// Counters only - no clues, no grid, no solution: this response is rendered before the player has
// opted into anything, and the feed is the one place where the whole case must NOT leak.
//
// ⚠️ STRICTLY READ-ONLY. It must not do a single thing /api/daily does on the side: no `startedAt`
// stamp, no `att:` row created, no `opened` counter, and above all no consuming `tut:{userId}`.
// The splash renders whenever the post scrolls past in the feed - if this endpoint had those side
// effects, merely SEEING the post would burn your one-time tutorial and start your timed run.
// Pinned by "GET /api/preview is a pure read" in routes.test.ts - the invariant, not a convention.
//
// ── the payload is grouped by WORLD, and that is the whole point (docs/11-stats-ia.md §1/R3) ─────
// It used to carry a `today` group, and the splash used to draw its figures in one typeface, one
// weight and one rhythm whether they were about this case, about the day, or about the player -
// which is how a cell labelled `DETECTIVES` came to carry the all-time community on a card glued to
// one case. The three groups below are the three worlds, and nothing on the splash is scoped to the
// day any more: the day is the standings' unit and is answered there, with names attached.
//
//   case: ① this case      you: ③ the player, all time      next: ② the series
router.get("/api/preview", async (_req, res) => {
  const idx = bankIndexForPost();
  const entry = BANK[idx];
  const postId = context.postId ?? "dev";
  const userId = context.userId;
  const ctx = ctxFor(entry);
  const cells = ctx.suspects.length * CAT_IDS.length;

  let state: "new" | "playing" | "solved" = "new";
  let deduced = 0;
  let st: StreakState | null = null;
  let timeSec: number | null = null;
  let myVote: string | null = null;

  if (userId) {
    const h = await redis.hGetAll(attKey(postId, userId)); // read, never write
    myVote = h.vote ?? null;
    if (h.solved === "1") {
      state = "solved";
      deduced = cells;
      // `null`, not 0, when the row carries no recorded time. That state is real - buildResults
      // names it too ("a replay finds no recorded time"): a solve written by a build that predates
      // the field leaves `solved: "1"` with nothing beside it. Reporting 0 made the card print
      // `YOUR TIME 00:00`, which is a figure nobody achieved (dec. 37).
      const t = Number(h.timeSec ?? 0);
      timeSec = Number.isFinite(t) && t > 0 ? t : null;
    } else if (h.startedAt) {
      state = "playing";
      // A grid saved against a different case (post re-pointed at another idx) no longer fits this
      // ctx and would crash effectiveCount - gridFits is the same guard the autosave path uses.
      const grid = h.grid ? (JSON.parse(h.grid) as GridState) : null;
      if (gridFits(ctx, grid)) deduced = effectiveCount(ctx, grid!);
    }
    // The rank ladder reads `best` (see rankState in flair.ts); `current` rides along named. A pure
    // read: streak.ts keeps the visit ZSET out of this path precisely because this endpoint renders
    // on a feed scroll and is not allowed to write.
    st = await readStreak(userId);
  }

  // ── ① this case, and ONLY this case ─────────────────────────────────────────────────────────
  // Both figures come off `lb:{postId}` - one row per player who closed THIS case, re-written
  // idempotently on every /api/check, so both are correct retroactively for every solve whose
  // username resolved.
  //
  // This is a deliberate reversal of the source (not of the invariant) agent R chose. R found the
  // splash counting the post under the word "today" and moved the count to the day board, which was
  // right for that label. The label is gone: on a card that is a single case's cover page the
  // reader's question is about that case, so the card now counts the case and says so. The day
  // still owns every figure printed under the word "today" - on the result sheet and the standings,
  // where a titled board makes the scope unambiguous.
  const rank = rankState(st?.best ?? 0, st?.current ?? 0);
  const closers = await redis.zCard(lbKey(postId));
  const best = closers > 0 ? await redis.zRange(lbKey(postId), 0, 0, { by: "rank" }) : [];

  // ── your position on THIS case (docs/11-stats-ia.md #4) ─────────────────────────────────────
  // Counted by SCORE, never by member. /api/preview renders on a feed scroll and is not allowed to
  // spend a Reddit call, so it never resolves a username - and `lb:{postId}` is keyed by username,
  // which is what put this figure on the result sheet only and left the card without it. Recorded
  // times are whole seconds, so everyone strictly faster sits in [0, timeSec - 1] and counting that
  // range needs no identity at all. A tie therefore SHARES a position instead of being ordered by
  // who happened to write first, which is the honest reading when the two recorded figures are equal.
  //
  // Clamped to the field: a solve whose username never resolved has no row on the board, and
  // without one an uncounted player slower than everybody would otherwise be told they came
  // `9th of 8`. The clamp keeps the pair readable in the one case the count cannot see itself in.
  let caseRank = 0;
  if (state === "solved" && timeSec !== null && closers > 0) {
    const faster = await redis.zRange(lbKey(postId), 0, timeSec - 1, { by: "score" });
    caseRank = Math.min(faster.length + 1, closers);
  }

  // ── ② the series: when the next case lands, and what the sub is voting it into ───────────────
  // The vote rides along for the solver (the splash renders it only there): once you have closed
  // the case you are no longer this case's player, you are the next one's audience, and "will
  // tomorrow be harder" is the one question the card can still answer for you.
  const next = await nextCase();
  const tally = await voteTally(postId);
  const steer = await nextLevelState(postId, tally);
  const total = tally.Harder + tally.Same + tally.Softer;
  // Archive only. `steer === null` IS the archive test - it is null exactly when this post is not
  // `lt:lastPostId` - so the live card spends not one extra read on either of these.
  const live = steer ? null : await liveCase(postId);
  const clock = steer ? { closedMinAgo: null, closesInMin: null } : await closeClock(postId);

  res.json({
    case: {
      number: caseNumber(),
      title: THEME_BY_ID[entry.themeId]?.title ?? "New Case",
      // The case's own hook - who was involved and what happened. It has existed in themes.ts
      // since the first commit, `publicPuzzle` has always sent it to the board, and NOTHING has
      // ever drawn it. It is the one line on the card that differs from case to case, which is
      // exactly what a player who says "the same task again and again" is not being shown.
      legend: THEME_BY_ID[entry.themeId]?.legend ?? "",
      tier: entry.tier,
      // How much evidence the case hands you. The owner's answer for the cell that used to be
      // twelve empty squares: "может быть сказать, сколько вот улик в кейсе". Unlike the squares it
      // is a property OF THE CASE - it differs between cases, it is the same figure for every
      // reader, and it is the closest thing the card has to a size.
      // `clueCount`, never `clues`: routes.test.ts trips on the literal key `"clues"` anywhere in
      // this payload, which is the tripwire that keeps the puzzle itself off a card rendered to
      // everyone scrolling the feed. A count is not a leak, but the name that carries it should
      // not be the one the guard is watching for - and `clues: 12` reads like the clues anyway.
      clueCount: entry.clues.length,
      // The four items this case runs on, as the same emoji the board prints on its own chips.
      // "у нас же разные предметы каждый раз. и прикольно увидеть маленькие иконки предметов" -
      // and they are the one part of a case that is instantly legible without reading anything.
      // Tokens the theme does not describe are dropped rather than drawn as a hole (dec. 37).
      //
      // The LABEL rides with the glyph now. A row of four emoji is a decoration until the reader
      // knows they are the case's four items, and several of them do not survive being guessed at
      // - a kitchen timer at 21px reads as a clock, a wheat sheaf as a plant. The word under each
      // is what turns the row into the evidence list it actually is.
      objects: entry.objectTokens
        .map((t) => THEME_BY_ID[entry.themeId]?.objects?.[t])
        .filter((o): o is { label: string; emoji: string } => !!o?.emoji)
        .map((o) => ({ emoji: o.emoji, label: o.label })),
      closers,
      fastestSec: best[0]?.score ?? null, // null while nobody has closed it - never a placeholder
      // WHO holds it. The owner asked for the name instead of the field size: "чтобы все видели
      // лучшего на посте" - and it is the better figure, because a headcount beside a benchmark
      // said how many were beaten while a name says who to beat. Public by construction: the same
      // username is already printed on every standings row (`lb:{postId}` members ARE usernames),
      // so this publishes nothing the boards do not.
      fastestBy: best[0]?.member ?? null,
      // When this case's day ended, or when it will. Drawn on an archive card only, which is the
      // one state where the card never said the thing the reader can already see: the file is shut.
      closedMinAgo: clock.closedMinAgo,
      closesInMin: clock.closesInMin,
    },
    you: {
      state, deduced, cells, timeSec,
      caseRank,   // 0 = no position to state (not solved, no time recorded, nobody on the board)
      // The rank the streak has earned, AND the distance to the next one. One ladder for the game,
      // the card and the subreddit flair, all read off `best` (rankState in flair.ts). `rank` is
      // null until the first rung, because "Not ranked yet" under a figure is a caption about
      // nothing; `rankNext` is null only at the top of the ladder, where there is nothing left to
      // climb and a card that invented a target would be lying about the game.
      //
      // `rankIn` counts from the CURRENT run rather than the best one - the number the card prints
      // has to be the number of cases this player must still close, not a distance from a record
      // they are no longer standing on.
      rank: rank.label, rankNext: rank.nextLabel, rankIn: rank.nextIn,
      streakCurrent: st?.current ?? 0,
    },
    next: {
      number: next.number,
      opensInMin: next.inMin,
      // null on an archive case: its vote steers nothing, and a screen that said otherwise would be
      // inventing an outcome (dec. 37). The countdown survives, because that one is still true.
      tier: steer?.tier ?? null,
      moved: steer?.moved ?? null,
      vote: steer
        ? { total, tally, verdict: steer.verdict, yours: myVote, minTotal: VOTE_MIN_TOTAL }
        : null,
      // The case that is live NOW - null on the live post, where the countdown above is the honest
      // answer and this one would be a card pointing at itself. On an archive post it is the only
      // thing left on the card a reader can act on, and it carries the permalink to get there.
      live,
    },
  });
});

// Funnel depth + the "where do people stall" histogram. Runs on the autosave, so it sees every
// board the player ever had; each threshold is counted at most once (flags live on att:).
async function trackProgress(
  postId: string, userId: string, key: string, h: Record<string, string>, grid: GridState,
): Promise<void> {
  const ctx = ctxFor(BANK[bankIndexForPost()]);
  if (!gridFits(ctx, grid)) return;

  const touched = ctx.catIds.some((c) => ctx.suspects.some((s) => ctx.cats[c].some((v) => grid[c][s][v] !== 0)));
  if (touched) await countOnce(h, key, "f_move", postId, "firstMove");

  const cells = effectiveCount(ctx, grid);
  const marks: [number, string, string][] = [[3, "f_r3", "reached3"], [6, "f_r6", "reached6"], [9, "f_r9", "reached9"]];
  for (const [need, flag, field] of marks) if (cells >= need) await countOnce(h, key, flag, postId, field);

  if (cells > Number(h.maxCells ?? -1)) {
    h.maxCells = String(cells);
    h.lastGain = String(Date.now());
    await redis.hSet(key, { maxCells: h.maxCells, lastGain: h.lastGain });
    await redis.zAdd(stuckKey(postId), { member: userId, score: cells });  // last write per user wins
  }
}

// The proactive nudge, decided server-side because the server already owns active time and the
// last time the board actually moved: >3 min in and >90 s without a new cell. Offered once.
const NUDGE_AFTER_SEC = 180;
const NUDGE_STALL_MS = 90_000;
async function stallNudge(
  postId: string, key: string, h: Record<string, string>, activeSec: number,
): Promise<boolean> {
  if (h.solved === "1" || h.f_nudge || activeSec < NUDGE_AFTER_SEC) return false;
  const since = Number(h.lastGain ?? h.startedAt ?? Date.now());
  if (Date.now() - since < NUDGE_STALL_MS) return false;
  await countOnce(h, key, "f_nudge", postId, "nudged");
  return true;
}

router.post("/api/state", async (req, res) => {
  const userId = context.userId;
  const postId = context.postId ?? "dev";
  if (!userId) { res.json({ ok: false }); return; }
  const { key, h } = await openAttempt(postId, userId);
  const grid = (req.body?.grid ?? null) as GridState | null;
  if (grid) {
    await redis.hSet(key, { grid: JSON.stringify(grid) });
    await trackProgress(postId, userId, key, h, grid);
  }
  const seconds = Number(req.body?.seconds);            // active play-time (client-owned, monotonic)
  let activeSec = Number(h.activeSec ?? 0);
  if (Number.isFinite(seconds) && seconds >= 0 && seconds > activeSec) {
    activeSec = Math.round(seconds);
    await redis.hSet(key, { activeSec: String(activeSec) });
  }
  res.json({ ok: true, nudge: await stallNudge(postId, key, h, activeSec) });
});

// ── hint ladder (plan 02/D): teach the next move instead of answering it ──
// Step 1 "which clue is live", step 2 "what it gives you", step 3 "reveal a cell" (the old, only
// spoiler-y one - and the only one that costs a hint). The deduction itself is `adviseOnGrid`
// in engine.ts, where engine.test.ts can reach it.
function puzzleFor(entry: BankEntry): Puzzle {
  const cats = { flair: [...FLAIR_TOKENS], time: [...TIME_TOKENS], object: entry.objectTokens };
  return new Puzzle(entry.suspects, cats, entry.clues, entry.solution);
}

// Step 1 names the clue - and, when it takes two clues, the value they share. Naming the cell is
// what step 2 is for, which is the whole difference between the two free rungs.
function publicAdvice(step: number, a: Advice): Advice {
  if (step >= 2) return a;
  if (a.kind === "move") return { kind: "move", clue: a.clue };
  if (a.kind === "cross") return { kind: "cross", clues: a.clues, via: a.via, viaCat: a.viaCat };
  return a;
}

const HINT_STEPS = [1, 2, 3];

router.post("/api/hint", async (req, res) => {
  const entry = BANK[bankIndexForPost()];
  const postId = context.postId ?? "dev";
  const userId = context.userId;
  const grid = (req.body?.grid ?? {}) as GridState;
  // Legacy bodies keep working: {reveal:false} = "just show my log", {reveal:true}/absent = step 3.
  const raw = Number(req.body?.step);
  const step = HINT_STEPS.includes(raw) ? raw : (req.body?.reveal === false ? 0 : 3);
  const ctx = ctxFor(entry);

  // count only NEW reveals - repeated presses on the same board must not inflate the counter
  const hintedSet = new Set<string>();
  let hints = 0;
  let att: Record<string, string> = {};
  let key = "";
  if (userId) {
    ({ key, h: att } = await openAttempt(postId, userId));
    hints = Number(att.hints ?? 0);
    if (att.hinted) for (const k of att.hinted.split(",")) hintedSet.add(k);
  }

  // steps 1-2 are free: they point at the board, they don't fill it in
  let advice: Advice | null = null;
  if (step === 1 || step === 2) {
    advice = publicAdvice(step, adviseOnGrid(puzzleFor(entry), ctx, grid));
    if (userId) {
      await countOnce(att, key, `f_h${step}`, postId, `hintStep${step}`);
      // `hintStep1 + hintStep2` is not a number of PEOPLE - each is unique per rung, so anyone who
      // pressed both was counted twice in the funnel's "N asked what to do next". This is the
      // union, counted the same once-per-player way. New counter: it starts at the deploy, so on
      // older posts it reads 0 while the per-rung counters do not, and the readout says so.
      await countOnce(att, key, "f_hany", postId, "hintAny");
    }
  }

  // step 3: reveal the first still-undetermined cell the player hasn't been shown yet.
  // A body with no usable grid (or a stale one) counts every cell as undetermined rather than
  // throwing - effectiveValue walks the grid unguarded.
  const fitted = gridFits(ctx, grid);
  let pick: { cat: string; suspect: string; value: string } | null = null;
  if (step === 3) {
    outer: for (const s of ctx.suspects)
      for (const c of ctx.catIds) {
        const cellKey = `${c}|${s}`;
        if (!(fitted && effectiveValue(ctx, grid, c, s)) && !hintedSet.has(cellKey)) {
          pick = { cat: c, suspect: s, value: entry.solution[s][c] };
          hintedSet.add(cellKey);
          break outer;
        }
      }
    if (userId && pick) {
      hints += 1;
      await redis.hSet(key, { hints: String(hints), hinted: [...hintedSet].join(",") });
      await countOnce(att, key, "f_hint", postId, "hintUsers");
    }
  }
  // full log of everything revealed so far (survives reload - the player can review past hints)
  const revealed = [...hintedSet].map((k) => {
    const [cat, s] = k.split("|");
    return { cat, suspect: s, value: entry.solution[s]?.[cat] ?? "" };
  }).filter((r) => r.value);
  res.json({ step, advice, hint: pick, hints, revealed });
});

router.post("/api/vote", async (req, res) => {
  const postId = context.postId ?? "dev";
  const userId = context.userId;
  const choice = req.body?.choice as VoteChoice | undefined;
  if (!choice || !VOTE_CHOICES.includes(choice)) { res.json({ ok: false, tally: await voteTally(postId) }); return; }
  if (userId) {
    const key = attKey(postId, userId);
    const h = await redis.hGetAll(key);
    if (h.solved !== "1") { res.json({ ok: false, error: "solve first", tally: await voteTally(postId) }); return; }
    if (!h.vote) { // one vote per player; play-again doesn't reset
      await redis.hSet(key, { vote: choice });
      await redis.hIncrBy(voteKey(postId), choice, 1);
    }
  }
  const tally = await voteTally(postId);
  // The vote that was just cast can be the one that DECIDES, so the verdict has to be recomputed
  // from the tally that now includes it. Without this the sheet keeps the verdict it was built
  // with - taken before the press - and pairs it with a total that has moved, which is how a
  // player's own decisive fifth vote came back as "no clear winner" (docs/11-stats-ia.md §3).
  res.json({ ok: true, tally, leader: voteLeader(tally), next: await nextLevelState(postId, tally) });
});

router.post("/api/check", async (req, res) => {
  const entry = BANK[bankIndexForPost()];
  const postId = context.postId ?? "dev";
  const userId = context.userId;
  const grid = (req.body?.grid ?? {}) as GridState;

  const verdict = gradeGrid(entry, grid);
  if (verdict === "incomplete") { res.json({ status: "incomplete" }); return; }
  if (verdict === "wrong") { res.json({ status: "wrong" }); return; }

  // A guest solved it, and we can't record a thing: no time, no rank, no streak. Say that instead
  // of inventing "streak 1 · rank 1 · faster than 50%" (decision #37: no fake social proof).
  if (!userId) {
    res.json({ status: "solved", guest: true, results: null });
    return;
  }

  const key = attKey(postId, userId);
  const h = await redis.hGetAll(key);
  const day = await currentDay();
  const repeat = h.solved === "1";
  // Resolved once, up here: the case board, the day's record, the flair and the "cases closed"
  // floor all need it. Never falling back to `userId` is what keeps a raw t2_… out of a public
  // table, so every one of those writes is conditional on this being a real name.
  const uname = await reddit.getCurrentUsername();
  // ── the record as it stands BEFORE this solve is folded into it ─────────────────────────────
  // Read here, not after the writes, and deliberately not from `bestTimeSec` afterwards: inside
  // writeSolve, `bumpProfile` runs only when this close is the day's first or an improvement on
  // it, so a second case closed on the same day slower than the day's record never reaches the
  // profile at all - even when it beats the player's ALL-TIME best. Comparing against the value
  // afterwards would then read "still better than the record" on every later solve and announce a
  // personal best again and again. Comparing against the record this solve had to beat cannot.
  const bestBefore = uname ? Number((await redis.hGet(userKey(uname), "bestTimeSec")) ?? 0) : 0;

  let timeSec: number;
  let hints: number;
  let solveOrder: number;

  if (repeat) {
    // Replay of an already-recorded solve. The recorded result is never overwritten.
    timeSec = Number(h.timeSec ?? 0);
    hints = Number(h.hints ?? 0);
    solveOrder = Number(h.solveOrder ?? 0);
    // ── the one place an old solve can still be dated ────────────────────────────────────────
    // A replay is NOT a visit (streak.ts): the client re-submits the finished board every time a
    // solved post is reopened, so crediting it would hand out an unbreakable streak for opening one
    // archive post a day. What the row does carry is `solvedAt` - the wall clock of the original
    // close, written since the first commit and never read until now - so the streak learns the day
    // that case was really closed, whatever day that is. Once per (case, player).
    const solvedAt = Number(h.solvedAt ?? 0);
    if (!h.streakDay && Number.isFinite(solvedAt) && solvedAt > 0) {
      await noteRecordedSolve(userId, solvedAt, uname ?? null);
      await redis.hSet(key, { streakDay: dayOfMs(solvedAt) });
    }
  } else {
    const startedAt = Number(h.startedAt ?? Date.now());
    const wall = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
    const reported = Math.max(Number(req.body?.seconds) || 0, Number(h.activeSec ?? 0));
    timeSec = Math.min(Math.max(1, Math.round(reported)), wall); // active play-time, clamped ≤ wall-clock (anti-cheat upper bound)
    hints = Number(h.hints ?? 0);
    solveOrder = await redis.incrBy(solvedCountKey(postId), 1);   // finishing position (temporal)
    await redis.hSet(key, {
      solved: "1", solvedAt: String(Date.now()), timeSec: String(timeSec), solveOrder: String(solveOrder),
    });
    // `visitDay()`, NOT `day`: the streak counts the days the player came back, and `day` is the
    // CASE's publication date. Feeding this the case's date is the bug in streak.ts's header - it
    // reset a run to 1 on every hole in the archive, and let closing an old case destroy a live run.
    const visit = visitDay();
    // `fresh` is the same question the points bonus asks - closed on the case's own day - and the
    // streak now counts exactly those. `postId` is what the chain is made of: the run is a walk
    // back along `lt:posts`, so a link has to name the case it is.
    await recordVisit(userId, visit, {
      newCase: true, username: uname ?? null, postId, fresh: visit === day,
    });
    // The marker goes down only once the visit is actually in, for the same reason the boards
    // reconcile on every check: if the line above throws, the retry arrives as a replay and heals
    // this close from `solvedAt` instead of losing it - which is what a marker written first would do.
    await redis.hSet(key, { streakDay: visit });
  }
  // Read after the write, so the flair and the result card cannot disagree with what was just
  // recorded - and so a repair that raised `best` reaches both in the same request.
  const st = await readStreak(userId);

  // ── reconcile, every time ────────────────────────────────────────────────────────────────────
  // `att:.solved` is set BEFORE the boards are written, so anything that interrupts the rest -
  // a thrown redis call, a deploy landing between the two, a solve recorded by a build that
  // predates the leaderboard - leaves a player marked solved with no row on any board. The old
  // code returned early here, which made that hole permanent: there was no second chance to write
  // it, ever. Both writes are idempotent - `zAdd` re-sets the same score, and writeSolve() claims
  // the day's record with hSetNX and then reconciles every board from it - so re-running them on
  // every check costs nothing and heals the hole the next time the player opens the post.
  // `timeSec` is 0 only when a replay finds no recorded time, i.e. nothing to reconcile from.
  if (timeSec > 0) {
    if (uname) await redis.zAdd(lbKey(postId), { member: uname, score: timeSec });
    // Order matters: writeSolve mirrors streak.best into the streak board, so it runs AFTER the
    // streak has been recorded. `postId` rides along so the day's record can tell a replay of THIS
    // case from a second case published the same day - see writeSolve().
    // ── was this closed on the case's OWN day? ──────────────────────────────────────────────
    // `day` is the CASE's date (currentDay() resolves from postData); `visitDay()` is the wall
    // clock. Equal means the player solved the case on the day it ran, which is what the freshness
    // bonus rewards. The two are deliberately different questions, and streak.ts keeps them apart
    // for the opposite purpose - there, ANY case extends a run, the archive included.
    //
    // Ignored on a replay: writeSolve reconciles from the stored record, so a case closed fresh
    // stays fresh however often the post is reopened, and an archive close cannot become fresh by
    // being reopened on a later day.
    await writeSolve({
      userId, date: day, postId, tier: entry.tier, timeSec, hints, fresh: visitDay() === day,
    });
    // Rank flair, queued on EVERY solve rather than written once - that is what keeps it from
    // freezing at whatever rank the player held the first time. See src/server/flair.ts.
    if (uname) await queueFlairUpdate(uname, st.best);
    // A record that falls AFTER the case has closed gets a comment of its own, because the closing
    // comment is the only place the previous holder's name survives once the live figure moves off
    // them. Silent during the case's own day: the card is showing the board in real time then, and
    // the closing comment is what summarises it. See src/server/herald.ts.
    await maybeAnnounce(postId, timeSec, postMeta().n ?? null);
  }

  // ── ① × ③: is this the fastest you have ever been? ───────────────────────────────────────────
  // Strictly faster than the record it had to beat (`bestBefore`, read above the writes). Two
  // further guards, both about honesty rather than arithmetic: a REPLAY re-submits a recorded time
  // and would re-announce an old solve as news every time the post is reopened, and a player's
  // FIRST close is trivially their best - a record needs a record to beat (docs/11 §7).
  const personalBest = !repeat && st.cases > 1 && timeSec > 0 && bestBefore > 0 && timeSec < bestBefore;

  res.json({
    status: "solved",
    results: await buildResults(
      postId, uname ?? null, st, day, timeSec, hints, solveOrder, personalBest,
    ),
  });
});

/**
 * The result card's numbers.
 *
 * ── every figure here is scoped to the DAY, not to the post ──
 * `total` / `rank` / `betterPct` / the histogram / the top three used to come out of the legacy
 * per-post `lb:{postId}`, while the copy printed around them says "detectives" and "today" and the
 * standings block right underneath fetches the day board (`/api/leaderboard?scope=today`). On a
 * one-case day the two agree, which is why it went unnoticed; on 2026-08-14 two cases went out and
 * the card was quietly comparing a player against the case's five instead of the day's. One source
 * for every figure the word "today" is printed over. `lb:{postId}` is still written (the client's
 * offline fallback and the epilogue read it) - it is simply no longer what the card counts.
 */
async function buildResults(
  postId: string, uname: string | null, st: StreakState,
  day: string, timeSec: number, hints: number, solveOrder: number, personalBest: boolean,
) {
  // ── ① the hero's own comparison, scoped to THIS CASE ─────────────────────────────────────────
  // The hero line used to switch between a percentile over the DAY and a finishing order over the
  // CASE, depending on whether the day board had 50 rows - one sentence, two subjects, chosen by a
  // threshold no reader can see. Both branches now measure one thing: where you came among the
  // people who closed this same puzzle. The threshold chooses only how precisely to say it, and the
  // day keeps every figure inside the block that is titled with the day (docs/11-stats-ia.md §4.3).
  const caseLb = lbKey(postId);
  const caseTotal = await redis.zCard(caseLb);
  const caseRank0 = uname ? await redis.zRank(caseLb, uname) : undefined;
  const caseBetterPct: number | null = caseRank0 !== undefined && caseTotal > 1
    ? Math.round((100 * (caseTotal - 1 - caseRank0)) / caseTotal)
    : null;

  const lb = dayKey(day);
  const total = await redis.zCard(lb);
  // undefined = this player has no row on the day board at all (no resolvable username, or a solve
  // that has not reconciled yet). Reporting rank 1 for that is an invented figure, so it reports 0
  // - "not on the board" - and the percentile drops out with it.
  const rank0 = uname ? await redis.zRank(lb, uname) : undefined;   // 0 = fastest
  // null, not 50: with nobody else on the board there is no percentile to report, and an invented
  // one is the fake social proof decision #37 forbids. The client already gates the line on
  // hasHistogram (N ≥ 50); the nullable type is what forces the leaderboard's scoring to handle it.
  // Denominator is `total`, matching the copy ("faster than X% of N detectives") - see readBoard().
  const betterPct: number | null = rank0 !== undefined && total > 1
    ? Math.round((100 * (total - 1 - rank0)) / total)
    : null;

  // One ladder for the game and for the subreddit flair, both read off `best` - see rankState().
  // `streak` keeps its name and its place in the payload but is now the SAME number the STREAK
  // board and the flair show, so one screen can no longer print 3 on the plaque and 4 on the board.
  const rank = rankState(st.best, st.current);

  let hasHistogram = false;
  let histogram: { counts: number[]; youIdx: number } | null = null;
  if (total >= HIST_MIN) {
    const all = await redis.zRange(lb, 0, -1, { by: "rank" });
    const counts = new Array(TIME_BINS.length).fill(0);
    for (const m of all) {
      const bi = TIME_BINS.findIndex((mx) => m.score < mx);
      counts[bi >= 0 ? bi : TIME_BINS.length - 1]++;
    }
    const yi = TIME_BINS.findIndex((mx) => timeSec < mx);
    hasHistogram = true;
    histogram = { counts, youIdx: yi >= 0 ? yi : TIME_BINS.length - 1 };
  }

  const top3 = await redis.zRange(lb, 0, 2, { by: "rank" }); // fastest 3 (ascending time)

  const tally = await voteTally(postId);
  return {
    timeSec, hints, solveOrder, total, betterPct, hasHistogram, histogram,
    // ① this case: the hero's figures.
    caseTotal, caseBetterPct,
    caseRank: caseRank0 === undefined ? 0 : caseRank0 + 1,
    personalBest,
    streak: rank.best, streakBest: rank.best, streakCurrent: rank.current, rankState: rank,
    streakLegacy: st.legacyBest,
    // Cases closed: the number the archive walker was counting when they expected 10 and read 1.
    // A different question from the streak, so it never shares its word (streak.ts). It is no
    // longer a cell of its own on the sheet - it is the kicker's cross-world link, `CASE #47 ·
    // YOUR 9TH`, and a cell in the file that owns world ③ (docs/11-stats-ia.md §6/§7).
    casesSolved: st.cases,
    rank: rank0 === undefined ? 0 : rank0 + 1,
    voteTally: tally,
    // ② what the vote is doing to the next case - the same answer the feed card gives, from the
    // same function, so the two screens can never disagree about tomorrow.
    next: await nextLevelState(postId, tally),
    voteMinTotal: VOTE_MIN_TOTAL,
    you: uname ?? "",
    leaderboard: top3.map((m) => ({ name: m.member, timeSec: m.score })),
  };
}

// ── GET /api/me: your file - the whole of world ③ in one place ───────────────────────────────────
//
// Every figure here already existed and was read by nothing. `user:{username}` has been carrying
// `solved`, `totalPoints`, `bestTimeSec` and `firstSeen` since the leaderboard shipped
// (leaderboard.ts bumpProfile) and no surface has ever printed one of them; `lb:days:{username}` has
// held the day-by-day history just as long. What was missing was not the data - it was a PLACE.
//
// That absence is the root of the complaint this track exists for (docs/11-stats-ia.md §5): with
// nowhere of its own, "you here" was smeared across screens that belong to a case and to a day, and
// a figure with no home takes the nearest one. The `DETECTIVES 8` cell on a case's cover page was
// that, exactly.
//
// Read-only, like /api/preview, and for the same reason it is cheap: every number is either a count
// of rows in a collection that already exists or a field somebody else's write already maintains.
const DAYS_SHOWN = 14;                            // the history strip: a fortnight reads as a habit

router.get("/api/me", async (_req, res) => {
  const userId = context.userId;
  const st = userId ? await readStreak(userId) : null;
  // The ladder is the server's answer everywhere (dec. 100) - `best` holds the rung, `current`
  // measures the distance to the next one - so this screen asks the same function the result sheet
  // and the subreddit flair ask, rather than deriving a second opinion.
  const rank = rankState(st?.best ?? 0, st?.current ?? 0);
  // A guest, or a solve whose username never resolved: there is no file to open and nothing to
  // invent (dec. 37). The streak keys are per-userId, so a logged-in player with no recorded solve
  // still gets their (zero) run rather than an empty screen.
  const uname = userId ? await reddit.getCurrentUsername() : null;
  if (!uname) {
    res.json({
      name: null, casesClosed: st?.cases ?? 0, daysSolved: 0, firstSeen: null,
      streakCurrent: st?.current ?? 0, streakBest: st?.best ?? 0,
      bestTimeSec: 0, points: 0, place: 0, detectives: await redis.zCard(ALLTIME_KEY),
      rank, days: [],
    });
    return;
  }

  const prof = await redis.hGetAll(userKey(uname));
  const detectives = await redis.zCard(ALLTIME_KEY);
  // The all-time board is scored by POINTS, so rank ascends the wrong way: zRank 0 is the lowest
  // score. Inverting against the row count is the same arithmetic readBoard() does for every points
  // board, and 0 means "no row" rather than "first" (leaderboard.ts).
  const rank0 = await redis.zRank(ALLTIME_KEY, uname);
  const days = await redis.zRange(daysKey(uname), 0, -1, { by: "rank" });

  res.json({
    name: uname,
    // `streak:{userId}.cases` and not `user:.solved`: the profile hash counts DAYS with a solve, so
    // a two-case day makes them differ - and this cell says "cases" (docs/11 §2, #23 vs #29).
    casesClosed: st?.cases ?? 0,
    daysSolved: days.length,
    firstSeen: prof.firstSeen ?? null,
    streakCurrent: st?.current ?? 0,
    streakBest: st?.best ?? 0,
    // The unit of a streak changed under this player's feet (dec. 123). Their record stands and
    // their current run is zero, and the screen has to say which of those two things happened.
    streakLegacy: st?.legacyBest ?? false,
    bestTimeSec: Number(prof.bestTimeSec ?? 0),
    points: Math.round((await redis.zScore(ALLTIME_KEY, uname)) ?? 0),
    place: rank0 === undefined ? 0 : detectives - rank0,
    detectives,
    rank,
    // Newest first - a history is read backwards from now. `lb:days` is a ZSET scored by that day's
    // POINTS, not by the date, so rank order is a ranking and taking the tail of it would hand back
    // a player's best days dressed as their most recent ones. The members are ISO dates, which sort
    // chronologically as strings, so the ordering comes from them.
    days: days.map((d) => ({ date: d.member, points: d.score }))
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .slice(0, DAYS_SHOWN),
  });
});

// ───────────────────────── /internal: daily post creation ─────────────────────────
async function summarize(prevPostId: string): Promise<EpilogueData | null> {
  const solvers = await redis.zCard(lbKey(prevPostId));
  if (solvers === 0) return null;
  const top = await redis.zRange(lbKey(prevPostId), 0, 0, { by: "rank" });
  const tally = await voteTally(prevPostId);
  const { tier, pct } = voteLeader(tally);
  return {
    who: top[0]?.member ?? "someone", timeSec: top[0]?.score ?? 0, solvers, tier, pct,
    postId: prevPostId,
  };
}

/** The epilogue's two case-scoped figures, re-read now instead of as they stood at publication. */
async function liveEpilogue(e: EpilogueData | null): Promise<EpilogueData | null> {
  if (!e?.postId) return e;                       // an older post: the frozen figures are all there is
  const solvers = await redis.zCard(lbKey(e.postId));
  if (solvers === 0) return e;                    // board trimmed or never written - keep the record
  const top = await redis.zRange(lbKey(e.postId), 0, 0, { by: "rank" });
  return { ...e, solvers, who: top[0]?.member ?? e.who, timeSec: top[0]?.score ?? e.timeSec };
}

// ── never the same case twice ─────────────────────────────────────────────────────────────────
// The pick walks the level's bucket from where its cursor stands and takes the first case that has
// never been published (`lt:served`, seeded once from the posts themselves - see caselog.ts). The
// claim is an hSetNX, so two publishes racing for one case cannot both win it. Only when EVERY case
// of the level has gone out does it repeat, and it says so in the log rather than quietly looping.
async function pickCase(level: number, n: number): Promise<number> {
  const bucket = LEVEL_BUCKETS[level] ?? LEVEL_BUCKETS[0] ?? WARMUP_POOL;
  const cursorKey = `lt:bucketCursor:${level}`;
  const start = Number((await redis.get(cursorKey)) ?? 0) || 0;
  const served = await redis.hGetAll(SERVED_KEY);
  for (let step = 0; step < bucket.length; step++) {
    const idx = bucket[(start + step) % bucket.length];
    if (served[String(idx)] !== undefined) continue;
    if ((await redis.hSetNX(SERVED_KEY, String(idx), String(n))) !== 1) continue;
    await redis.set(cursorKey, String(start + step + 1));
    return idx;
  }
  console.error(`[bank] level ${level}: all ${bucket.length} cases have been published - REPEATING. ` +
    "Grow the bank: npx tsx scripts/build-bank.ts <N> --append");
  await redis.set(cursorKey, String(start + 1));
  return bucket[start % bucket.length];
}

/** The fallback seed, used only if the posts cannot be listed: what the old counters imply. Under
    the old pick a level's cursor `c` had served bucket positions 0..c-1 of its FIRST batch. */
async function servedFromCursors(): Promise<number[]> {
  const out: number[] = [];
  for (let level = 0; level < LEVEL_BUCKETS.length; level++) {
    const c = Number((await redis.get(`lt:bucketCursor:${level}`)) ?? 0) || 0;
    const first = LEVEL_BUCKETS[level].filter((i) => (BANK[i].batch ?? 1) === 1);
    out.push(...first.slice(0, Math.min(c, first.length)));
  }
  return out;
}

// ── a hard day, sometimes, when nobody decided ────────────────────────────────────────────────
// Owner (2026-09-25): "люди мало голосуют ... если не проголосовали, пусть иногда случайно
// попадаются сложная". So when the previous case's vote decided nothing, the next case is hard mode
// about one day in HARD_EVERY. The dice are a hash of the CASE NUMBER rather than Math.random, for
// one reason: the feed card and the result sheet announce the next case's level in advance, and a
// random draw at publish time would make that announcement a guess. Keyed on the number, the server
// knows today what tomorrow will be, and everything it prints about it stays true.
const HARD_EVERY = 7;
function hardDay(n: number): boolean {
  // Never in a subreddit's first week. The dice put case #1 on a hard day, which on a fresh install
  // is a newcomer's FIRST case being hard mode - the worst first impression this app can make, and
  // exactly the drop-off decision 42 moved the default to green to stop.
  if (n <= HARD_EVERY) return false;
  let h = 2166136261;
  for (const ch of `deducto:hard:${n}`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % HARD_EVERY) === 0;
}

async function createDailyPost() {
  const prevPostId = await redis.get("lt:lastPostId");
  const epilogue = prevPostId ? await summarize(prevPostId) : null;

  // vote → difficulty: shift the global series level by the previous post's community vote
  let level = await resolveLevel();
  let decided = false;
  if (prevPostId) {
    const tally = await voteTally(prevPostId);
    decided = voteVerdict(tally) !== null;
    level = levelFromVote(level, tally);
  }
  level = Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, level));
  await redis.set(LEVEL_KEY, String(level));
  await redis.set(LEVEL_BASE_KEY, String(DEFAULT_LEVEL)); // the default this value descends from

  // The case number is drawn FIRST, because it is what the hard-day dice read - see hardDay().
  const n = await redis.incrBy("bank:cursor", 1); // monotonic case number
  // A hard day: nobody decided the level, it is sitting at the default, and the dice for this case
  // number say so. One-off - `level` is what persists, `serveLevel` is only what goes out today.
  const serveLevel = !decided && level === DEFAULT_LEVEL && hardDay(n) && MAX_LEVEL > DEFAULT_LEVEL
    ? DEFAULT_LEVEL + 1 : level;
  await seedServed(servedFromCursors);
  const idx = await pickCase(serveLevel, n);
  const date = new Date().toISOString().slice(0, 10);
  const entry = BANK[idx];
  const theme = THEME_BY_ID[entry.themeId];
  // The date is what keeps a daily series out of the "identical repost" filter (r/xpuzzle posts
  // daily and passes for exactly that reason). The tier label rides along ONLY when the ramp has
  // moved off the default - on the default it is a constant tail on every single post, i.e. more
  // headline similarity, not less.
  const tierLabel = serveLevel === DEFAULT_LEVEL ? "" : ` · ${LEVEL_LABELS[serveLevel] ?? ""}`;

  const post = await reddit.submitCustomPost({
    subredditName: context.subredditName,
    title: `Case #${n} · ${date} · ${theme?.title ?? "New Case"}${tierLabel}`,
    entry: "default",
    postData: { idx, date, n, level: serveLevel, epilogue },
  });
  await redis.set("lt:lastPostId", post.id);
  // The day the sub is currently playing. Written from the SAME `date` that went into postData, so
  // "the post's day" and "the day a request outside a post resolves to" cannot disagree.
  await redis.set(LAST_DAY_KEY, date);
  await registerPost(post.id);
  // The case's day ends 24 h from now, and when it does the winner is named in a comment on the
  // post itself. Queued from HERE rather than from the scheduler, so a case published by hand from
  // the mod menu gets its epilogue on exactly the same terms as one published automatically.
  await scheduleClose(post.id, n);
  return { post, n, level: serveLevel, tier: entry.tier, date, hard: serveLevel !== level };
}

// Devvit Redis cannot list keys, so a post we never wrote down is a post the funnel can never find
// again. Every post this app creates goes into one explicit sorted set, newest last.
async function registerPost(postId: string): Promise<void> {
  await redis.zAdd(POSTS_KEY, { member: postId, score: Date.now() });
  const n = await redis.zCard(POSTS_KEY);
  if (n > POSTS_KEEP) await redis.zRemRangeByRank(POSTS_KEY, 0, n - POSTS_KEEP - 1);
}

// The toast names the tier it just published. "Case published!" was true of a 🟢 and of a 🟡 alike,
// so a series that had been stuck on the wrong tier for weeks read exactly like a correct one -
// the difficulty was only visible by opening the post. One clause is the whole difference.
router.post("/internal/menu/create-post", async (_req, res) => {
  const previousDay = await redis.get(LAST_DAY_KEY);
  const { post, n, level, tier, date, hard } = await createDailyPost();
  // A day holds ONE scored result per player (writeSolve keeps their best close of the day), so a
  // second case on the same date does not double anyone's points and does not get its own board.
  // Publishing has no same-day guard - README calls that a known gap - and it has already happened
  // once, silently. It is not silent any more: the mod who pressed the button is told on the spot.
  const sameDay = previousDay === date;
  res.json({
    navigateTo: post.url,
    showToast: `Case #${n} published · ${tier} · level ${level}` +
      (hard ? " (a random hard day - nobody voted)"
        : level === DEFAULT_LEVEL ? " (the default)" : " (moved here by the vote)") +
      (sameDay
        ? ` · ⚠ second case on ${date}: the day already has a board, so each player is still scored once for the day (their fastest close) and this case adds no points to anyone who already solved today.`
        : ""),
  });
});

// ── mod menu: how the current case is going (plan 02/A1) ──
//
// A toast is the whole UI on purpose - a real admin screen costs a week and answers the same
// question. But a toast a moderator cannot read is not a readout: the old one ended in
// `best cells 0:0 1-2:0 3-5:0 6-8:0 9-11:0 12:1`, which is a stall histogram nobody can decode
// without this file open next to them. The numbers are the same; the sentence is now the product.
// The raw table still goes to `devvit logs` for whoever wants to diff it.
// `stuck:{postId}` scores are `effectiveCount` - cells DETERMINED, not chips marked. The old label
// for score 0 read "never marked a cell", which is a different population: crossing out chips that
// force nothing leaves a board at 0 determined cells and its owner very much marked something.
// The label now says what the number is.
const STALL_BUCKETS: [string, number, number][] = [
  ["0 of 12 deduced", 0, 0], ["1-2 of 12", 1, 2], ["3-5 of 12", 3, 5],
  ["6-8 of 12", 6, 8], ["9-11 of 12", 9, 11],
];
const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((100 * part) / whole)}%` : "—");

async function funnelFor(postId: string) {
  const s = await redis.hGetAll(statsKey(postId));
  const n = (f: string) => Number(s[f] ?? 0);
  const solved = Number((await redis.get(solvedCountKey(postId))) ?? 0);
  const stuck = await redis.zRange(stuckKey(postId), 0, -1, { by: "rank" });
  const bucket = STALL_BUCKETS.map(([label, lo, hi]) =>
    ({ label, count: stuck.filter((m) => m.score >= lo && m.score <= hi).length }));
  const opened = n("opened"), firstMove = n("firstMove");
  const boardRows = await redis.zCard(lbKey(postId));
  return {
    postId, opened, firstMove, solved, bucket, boardRows,
    hint1: n("hintStep1"), hint2: n("hintStep2"), hintAny: n("hintAny"),
    reveal: n("hintUsers"), nudged: n("nudged"),
    // The old ladder, kept verbatim for the log: it is the only place the 3/6/9 thresholds show up.
    raw: `opened ${opened} → moved ${firstMove} → 3+ ${n("reached3")} → 6+ ${n("reached6")}` +
      ` → 9+ ${n("reached9")} → solved ${solved}` +
      ` · solve rate ${pct(solved, firstMove)} of players who moved, ${pct(solved, opened)} of openers` +
      ` · hints l1/l2/any/reveal ${n("hintStep1")}/${n("hintStep2")}/${n("hintAny")}/${n("hintUsers")}` +
      ` · nudged ${n("nudged")} · case board ${boardRows} rows` +
      ` · best cells ${bucket.map((b) => `${b.label}=${b.count}`).join(" ")}`,
  };
}

type Funnel = Awaited<ReturnType<typeof funnelFor>>;

/**
 * @param dayRows  rows on the DAY board (`lb:day:{day}`) - the day's distinct solvers.
 * @param dayCases how many cases this app published on `day`, from `lt:posts`.
 */
function funnelSentence(f: Funnel, day: string, dayRows: number, dayCases: number): string {
  const openedWithoutMoving = Math.max(0, f.opened - f.firstMove);
  const gaveUp = Math.max(0, f.firstMove - f.solved);
  const worst = f.bucket.filter((b) => b.count > 0).sort((a, b) => b.count - a.count)[0];

  // ── the solve rate is NAMED, because the two fractions are not the same number ────────────────
  // This line used to print `solved / opened` alone, and the target in plans/01-distribution.md §G
  // (">55%") is `solved / firstMove`. plans/assets/08-launch-calendar.md had to warn the reader to
  // divide by hand on every reading, which is a workaround for a label, not a metric. Both
  // fractions are here now and each says which denominator it used; the tracked one goes first and
  // by name, so "solve rate" on this screen and "solve rate" in the plan are one number.
  const parts = [
    `Case of ${day}: ${f.opened} opened it, ${f.firstMove} marked something` +
    ` (${pct(f.firstMove, f.opened)} of openers), ${f.solved} solved it.`,
    // Each rung of the funnel must be a subset of the one above it. `opened >= firstMove` holds by
    // construction (openAttempt), but the solve counter lives in /api/check while `f_move` is
    // stamped by the autosave, so a solve that never went through /api/state lands under a rung it
    // never climbed - and then "solve rate" would be a fraction above 1 dressed up as a percentage.
    f.solved > f.firstMove
      ? `⚠ Solve rate cannot be computed: ${f.solved} solved but only ${f.firstMove} were recorded moving,` +
        ` which is impossible - solves reached this case without passing the autosave.`
      : `Solve rate ${pct(f.solved, f.firstMove)} (${f.solved}/${f.firstMove} of everyone who moved);` +
        ` ${pct(f.solved, f.opened)} of everyone who opened.`,
  ];
  if (openedWithoutMoving) parts.push(`${openedWithoutMoving} opened and never touched the board.`);
  if (gaveUp) parts.push(`${gaveUp} started and gave up.`);
  // Separate sentence, deliberately: the buckets count every board this case ever recorded below
  // 12 cells, which is not the same set as `gaveUp` (it also holds people who opened, autosaved an
  // untouched board and left). Attaching it to "gave up, most of them at…" attributed one group's
  // shape to another group's count.
  if (worst) parts.push(`Boards that stopped short of 12: the biggest group stopped at ${worst.label} (${worst.count}).`);
  // Rungs are reported separately: each is unique per player per rung, so adding them counts anyone
  // who pressed both twice. `hintAny` is the honest union and only appears once it has data.
  parts.push(f.hint1 || f.hint2 || f.reveal || f.nudged
    ? `Help: rung 1 ${f.hint1}, rung 2 ${f.hint2}` +
      (f.hintAny ? ` (${f.hintAny} distinct players)` : "") +
      `, ${f.reveal} had a cell revealed, ${f.nudged} got the stall nudge.`
    : `Nobody asked for a hint.`);

  // ── the self-audit, comparing like with like ─────────────────────────────────────────────────
  // It used to weigh this CASE's solve counter against the DAY's board, which are the same number
  // only while one case is published per day. On 2026-08-14 two went out, so the menu on the second
  // case would have reported "⚠ Leaderboard has 4 rows for 1 solves - -3 solve(s) never reached the
  // board": a negative shortfall, from a check whose whole job is to be trustworthy. Per-case
  // integrity is now checked against the per-case board, and the day is reported as its own fact.
  parts.push(f.boardRows === f.solved
    ? `This case: ${f.boardRows} board rows for ${f.solved} solves, matches.`
    : `⚠ This case has ${f.boardRows} board rows for ${f.solved} solves - ` +
      `${Math.abs(f.solved - f.boardRows)} ${f.solved > f.boardRows ? "solve(s) never reached the board" : "extra row(s) with no recorded solve"}.`);
  parts.push(dayCases > 1
    ? `⚠ ${dayCases} cases were published on ${day}; the day board holds ${dayRows} distinct solvers across all of them, and each player is scored once for the day.`
    : `Day board ${day}: ${dayRows} distinct solvers.`);
  return parts.join(" ");
}

// Registered on the POST menu, not the subreddit menu. It used to be both - the two items existed
// only because `postFilter: "currentApp"` may not be combined with `location: ["subreddit"]`, and
// without the filter a subreddit-wide item would attach to posts this app never created. One item
// is enough, and the post is the better half of the pair: `postData.date` is right there, so the
// report is always about a case the moderator is actually looking at, with no "which post did it
// mean?" and no dependence on `lt:lastPostId` pointing anywhere useful.
router.post("/internal/menu/funnel", async (_req, res) => {
  const postId = context.postId ?? (await redis.get("lt:lastPostId"));
  if (!postId) {
    res.json({ showToast: "No case has been published yet - use “Deducto: publish a case” first." });
    return;
  }

  const day = await currentDay();
  const cur = await funnelFor(postId);
  const dayBoard = await readBoard("today", day, 1, null);

  const posts = await redis.zRange(POSTS_KEY, 0, -1, { by: "rank" });
  // `lt:posts` scores are creation ms, so the registry also answers "how many cases went out that
  // day" - the fact that decides whether a per-case number and a per-day number may be compared.
  const dayCases = posts.filter((m) => new Date(m.score).toISOString().slice(0, 10) === day).length;

  const recent = posts.slice(-7).map((m) => m.member);
  let opened = 0, firstMove = 0, solved = 0;
  for (const p of recent) {
    const f = await funnelFor(p);
    opened += f.opened; firstMove += f.firstMove; solved += f.solved;
    console.log(`[funnel] ${p}: ${f.raw}`);
  }
  const trend = recent.length > 1
    ? ` Last ${recent.length} cases: ${opened} opened → ${firstMove} played → ${solved} solved,` +
      ` solve rate ${pct(solved, firstMove)}.`
    : "";

  console.log(`[funnel] current ${postId} (${day}, ${dayCases} case(s) that day): ${cur.raw}` +
    ` · day board rows ${dayBoard.total}`);
  res.json({ showToast: funnelSentence(cur, day, dayBoard.total, dayCases) + trend });
});

// Automatic daily publication lives in src/server/daily.ts, and everything that makes it safe to
// switch on lives there with it: the per-subreddit opt-in, the idempotency lock, the 20-hour floor
// and the survival check that stops the schedule when a post is filtered. This route used to be a
// bare `await createDailyPost()` with none of that, which is the version that got two subreddits
// banned - it is gone rather than left as a second, unguarded way in.
router.use(makeDailyRouter(createDailyPost));
router.use(heraldRouter);

// Hourly, and a no-op 19 hours in 20: it seeds the no-repeat set on its first run after a deploy
// (so the seed does not wait for the next publication) and writes the per-case table once a day.
router.post("/internal/scheduler/case-stats", async (_req, res) => {
  try {
    const info = (i: number) => BANK[i]
      ? { tier: BANK[i].tier, score: BANK[i].score ?? 0, clues: BANK[i].clues.length } : null;
    const remaining = async () => {
      const served = await redis.hGetAll(SERVED_KEY);
      return "unplayed left: " + LEVEL_TIERS.map((t, l) =>
        `${t} ${LEVEL_BUCKETS[l].filter((i) => served[String(i)] === undefined).length}/${LEVEL_BUCKETS[l].length}`)
        .join(" · ");
    };
    console.log(`[cases] ${await maybeDumpStats(info, servedFromCursors, remaining)}`);
  } catch (e) {
    console.error("[cases] stats job failed", e);
  }
  res.json({ status: "ok" });
});

// ── practice / onboarding: warm-up lane, isolated from the daily (no lb/vote/streak) ──
// Serves the tutorial tier, rotating through WARMUP_POOL by the per-user counter, so a second
// warm-up is a new case rather than the same board with yesterday's marks still on it.
router.get("/api/practice", async (_req, res) => {
  const userId = context.userId;
  const done = userId ? Number((await redis.get(onbKey(userId))) ?? 0) : 0;
  const idx = warmupIdx(done);
  let grid: GridState | null = null;
  if (userId) {
    const key = pAttKey(userId, done);
    const h = await redis.hGetAll(key);
    // The slot is numbered by the per-user counter, not by the case - and which case a slot holds
    // moved when the warm-up pool did (it used to be the constant #78 for every k). A board saved
    // against the old case therefore lands on a different one, and slot 0 happens to keep the same
    // shape (#78 and #120 are both pizza), so the client's own shape check cannot see it either.
    // Stamping the case the board belongs to is what makes the slot self-describing.
    if (!h.startedAt) await redis.hSet(key, { startedAt: String(Date.now()), idx: String(idx) });
    else if (Number(h.idx) !== idx) await redis.hSet(key, { idx: String(idx) }); // someone else's case: forget the board
    else if (h.grid) grid = JSON.parse(h.grid) as GridState;
  }
  // `first` drives the ladder copy: rung 1 is "learn the mechanic", later ones are just practice.
  res.json({ puzzle: publicPuzzle(BANK[idx], idx, await currentDay()), grid, warmupsDone: done, first: done === 0, poolSize: WARMUP_POOL.length });
});

router.post("/api/practice/state", async (req, res) => {
  const userId = context.userId;
  if (!userId) { res.json({ ok: false }); return; }
  const done = Number((await redis.get(onbKey(userId))) ?? 0);
  const grid = (req.body?.grid ?? null) as GridState | null;
  // idx rides along with the board: a slot that says which case it holds cannot hand the marks to
  // the next case that lands in that slot (see GET /api/practice).
  if (grid) await redis.hSet(pAttKey(userId, done), { grid: JSON.stringify(grid), idx: String(warmupIdx(done)) });
  res.json({ ok: true });
});

router.post("/api/practice/check", async (req, res) => {
  const userId = context.userId;
  const done = userId ? Number((await redis.get(onbKey(userId))) ?? 0) : 0;
  const idx = warmupIdx(done);
  const verdict = gradeGrid(BANK[idx], (req.body?.grid ?? {}) as GridState);
  if (verdict !== "solved") { res.json({ status: verdict }); return; }
  if (userId) await redis.incrBy(onbKey(userId), 1); // rotate to the next warm-up case + close the ladder
  // Rung 2 of the first-run ladder: the client hands them today's case, labelled as harder.
  res.json({ status: "solved", warmupsDone: done + 1, nextIsDaily: done === 0 });
});

// "Skip the warm-up" - the player wants today's case straight away. Without this the ladder would
// re-offer itself on every reload until they finish a warm-up.
router.post("/api/practice/skip", async (_req, res) => {
  const userId = context.userId;
  if (userId) await redis.set(onbSkipKey(userId), "1");
  res.json({ ok: true });
});

app.use(leaderboardRouter);
app.use(flairRouter);
app.use(auditRouter);
app.use(router);

const server = createServer(app);
server.on("error", (err) => console.error(`server error; ${err.stack}`));
server.listen(getServerPort());
