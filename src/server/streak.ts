// Deducto - the streak: how many days IN A ROW a player came back and closed a case.
//
// ── the bug this file exists to end ────────────────────────────────────────────────────────────
// `updateStreak(userId, day)` in index.ts was handed `currentDay()`, which inside a post is the
// CASE's own publication date. So the accumulator that counts "days you came back" was fed the
// dates of the cases, and a player was measured against a timeline they had never lived:
//
//   * the sub published nothing on 2026-08-04, 08-07 or 08-09, and two cases on 08-14. Walking the
//     archive in order, the first case after a hole read `lastDate !== prevDay(caseDate)` and reset
//     the counter to 1. That is the "counter randomly resets to 1" a live player reported after
//     solving the first ten cases in one sitting.
//   * worse, and not in the report: closing an ARCHIVE case wrote that case's old date into
//     `lastDate`. The next real day's solve then read "you did not play yesterday" and reset a live
//     run to 1. Playing an old case silently cost a player the streak they had built.
//
// ── the unit changed: CASES, not days (2026-08-17, owner) ──────────────────────────────────────
// «надо решить каждый день по кейсу. не просто зайти. не просто подряд решить старые кейсы, а надо
// именно новые кейсы решать».
//
// The hole the owner found is real and the bank makes it cheap: 160 cases sit in the archive, so
// one old case a day is a hundred days of "streak" without ever opening a daily. Counting CALENDAR
// DAYS could not tell those apart, because the thing it measured - did you come back - is exactly
// what an archive grinder also does.
//
// So the unit is now the CASE:
//
//   A streak is the number of PUBLISHED CASES IN A ROW that the player closed on the day the case
//   ran. Not days. Cases.
//
// This satisfies the requirement literally, and - the part worth checking - it does NOT cost the
// argument the rest of this file was built on. A hole in the feed still cannot break a run: if the
// sub published nothing, there is no case to have missed, so the chain neither advances nor breaks.
// The player is still never punished for something they do not control. What they ARE now measured
// on is the one thing they do control: showing up while the case is live.
//
// Two consequences that had to be handled rather than discovered:
//   * The CURRENT case does not break the chain until its day is over. A case published an hour ago
//     and not yet solved is "in progress", not "missed" - otherwise every publication would zero
//     every player's streak until they got round to it.
//   * The word has to change with the unit (docs/11 R1: one word, one number). Every surface that
//     said "3 days" now says "3 cases", and the rank ladder's thresholds are cases too. A number
//     whose unit changed silently is the same defect as a label over the wrong population.
//
// ── what a streak WAS, and why (kept: the reasoning below still governs the parts it names) ─────
// The promise is "solve daily, keep your streak" (dec. 30) and the board one tap away is titled
// "Longest streak - your longest run of days solved back to back". That is a HABIT - the days the
// player showed up - so:
//
//   (SUPERSEDED - see the top of this file. It was: consecutive CALENDAR days on which the player
//   closed at least one case, counted on the wall clock.)
//
// Four consequences, all deliberate:
//   1. A hole in the feed cannot break it. Which dates the sub published on is not something a
//      player controls, so it cannot be something a player is punished for. On a day with no new
//      case, closing an archive case keeps the run alive: the archive is a streak SAVER now, where
//      it used to be the only way to lose one.
//   2. The whole archive in one sitting is ONE day, so the streak is 1. The player who expected 10
//      was counting a different thing - cases closed - and that is a different number under a
//      different name (`cases`), never this one.
//   3. A replay is not a visit. The client re-submits the finished board every time a solved post
//      is reopened, so /api/check runs again on its own; counting that would hand an unbreakable
//      streak to anyone who opens one old post a day. Only the FIRST close of a case is a visit.
//   4. `best` only ever grows (dec. 100 / flair.ts): it is a title that was earned, it drives the
//      subreddit flair, and no repair to a counter is allowed to demote someone publicly.
//
// ── why the days themselves are stored ─────────────────────────────────────────────────────────
// Every other public number in this game is derived from a collection - `lb:day`, `lb:days`,
// `lb:alltime` - so a bad write can be re-derived away. The streak was the one accumulator, and an
// accumulator fed a wrong day cannot be repaired afterwards: that is precisely why the live
// players' broken runs cannot simply be recomputed. `streak:days:{userId}` fixes the shape rather
// than the symptom - the visit days are recorded, `current` / `best` are re-derived from them on
// every write, and the audit can check the number against the days behind it.
//
// It also opens the one repair that IS available. `att:{postId}:{userId}.solvedAt` is the real wall
// clock of a close and has been written since the first commit; nothing had ever read it. The first
// time a player reopens an old case, that timestamp tells the set the day the case was really
// closed (`noteRecordedSolve`), so a pre-fix solve is dated from evidence instead of guessed at.

import { redis } from "@devvit/web/server";
import {
  decodeSolve, INDEX_DAYS_KEY, registryFront, shiftDay, solvesKey, STREAK_CUR_KEY, todayUtc,
  userKey,
} from "./leaderboard.js";

/** HASH: `current`, `best`, `lastDate`, `cases`, `casesSeeded`. Keyed by the opaque Reddit id. */
export const streakKey = (userId: string) => `streak:${userId}`;
/** ZSET member=YYYY-MM-DD score=that day's epoch ms - the days the OLD day-unit run was derived
    from. Still written and still read by the audit: it is the record of when a player actually came
    back, which stays true and stays useful even though it no longer decides the streak. */
export const visitsKey = (userId: string) => `streak:days:${userId}`;
/** ZSET member=postId score=that case's publication ms - the CASES this player closed while they
    were live. The streak is derived from this set against `lt:posts`, exactly as the day-unit run
    was derived from the visit set: facts recorded, number computed, so a bad write cannot compound. */
export const freshCasesKey = (userId: string) => `streak:cases:${userId}`;

/** The registry of published cases, and the day of the newest one. Owned by index.ts; read here. */
const POSTS_KEY = "lt:posts";
// The front pointers `lt:lastPostId` / `lt:lastPostDay` are gone from this module on purpose:
// liveness turns on the newest case whose DAY IS OVER, and neither pointer can name that once a
// newer case has been published today. registryFront() reads the registry itself instead.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;
const VISITS_KEEP = 400;  // same horizon as lb:index:days; `best` is stored, so a trim can't demote
const SEED_MAX = 60;      // cap on the one-time back-fill from the legacy counter

const dayMs = (day: string) => Date.parse(`${day}T00:00:00Z`);
export const dayOfMs = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * The day a VISIT is filed under - the player's habit.
 *
 * Deliberately NOT `currentDay()`. That one answers "which day's board does this result belong
 * to?", and its answer is the case's own publication date, because a case IS a day (leaderboard.ts).
 * This answers "did the player come back today?", which is a question about the wall calendar and
 * about nothing else. One function answering both is the whole bug at the top of this file, so the
 * two are named apart on purpose: `lb:day` / `lb:week` / points stay keyed by the case's day, and
 * only the streak is keyed by this one.
 */
export function visitDay(): string { return todayUtc(); }

export interface StreakState {
  /** The LIVE run, so 0 once it can no longer be extended - see `isLive`. */
  current: number;
  /** Longest run ever. Only ever grows; the rank and the subreddit flair are read off it. */
  best: number;
  /** The most recent day this player closed a case, or null if they never have. */
  lastDate: string | null;
  /** Cases closed - the number the archive walker was actually counting. See `nextCases`. */
  cases: number;
  /**
   * This player holds a `best` earned under the DAY unit and has no chain under the case unit yet.
   *
   * It exists so the screens can SAY so. When the unit changed, every live player's current run
   * went to zero at once - and a number that falls for a reason the player cannot see is the exact
   * failure this project keeps having. `best` is untouched (dec. 100: a title stays earned), so the
   * only honest thing left is to explain the zero rather than let them find it.
   */
  legacyBest: boolean;
}

/**
 * The chain, in CASES: how many published cases in a row - counting back from the newest - this
 * player closed while they were live.
 *
 * `published` is `lt:posts` oldest-first; `closed` is the set of postIds the player closed fresh.
 * `pending` is the newest case when its day is not over yet: it is skipped rather than counted as a
 * miss, because a case published an hour ago has not been missed by anyone.
 *
 * Returns the run ending at the newest decided case, and the longest run anywhere in the registry -
 * the same pair `runsOf` returns for days, so the caller's shape does not change.
 */
export function runsOfCases(
  published: string[], closed: Set<string>, pending: Set<string>,
): { run: number; best: number } {
  // A SET, not one id. It used to be a single case - the newest - and that quietly made the FIRST
  // case of a two-case day decided-and-missed while its own day was still running: a player who
  // closed the evening case watched a run of four become one. Two cases on one day is reachable
  // (the publish menu has no same-day guard; see "FINDING E" in routes.test.ts), and the day's
  // pending set is exactly what registryFront() already computes for the read path. One rule.
  const decided = published.filter((id) => !pending.has(id));
  let run = 0, best = 0;
  for (const id of decided) {
    run = closed.has(id) ? run + 1 : 0;
    if (run > best) best = run;
  }
  // A pending case that IS already closed extends the live run - it just cannot end it. Counted in
  // publication order so two closed cases on one day are worth two links, not one.
  for (const id of published) {
    if (!pending.has(id) || !closed.has(id)) continue;
    run += 1;
    if (run > best) best = run;
  }
  return { run, best };
}

/**
 * Longest run ending at the last day, and the longest run anywhere in the list.
 *
 * `days` must be ascending and free of duplicates, which is what a ZSET scored by each day's own
 * epoch hands back from `zRange(..., { by: "rank" })`.
 */
export function runsOf(days: string[]): { run: number; best: number; last: string | null } {
  let run = 0, best = 0;
  let prev: string | null = null;
  for (const d of days) {
    if (!DATE_RE.test(d)) continue;
    run = prev !== null && d === shiftDay(prev, 1) ? run + 1 : 1;
    if (run > best) best = run;
    prev = d;
  }
  return { run, best, last: prev };
}

/**
 * Is a chain that last closed `lastFresh` still alive?
 *
 * Alive means the newest published case has not yet been missed. Two ways that holds:
 *   * the player closed it (the chain reaches the front of the registry), or
 *   * it is still today's case, so there is time left to close it.
 * Anything else means a case ran and went by without them, which is exactly what the unit now
 * measures. Derived on READ rather than stored, because it can stop being true with no action by
 * the player at all - a publication is what ends a run, and that happens while they are asleep.
 */
function chainLive(lastFresh: string | null, decided: string | null, pending: Set<string>): boolean {
  if (!lastFresh) return false;
  if (!decided) return true;                    // nothing has gone by: nothing to have missed
  // The newest case whose day is OVER is the last one that can have been missed. Closing it - or
  // one still in progress - is what keeps a run alive; anything older means a case ran and went by.
  //
  // The previous version compared against the newest case of any kind and, when that one was still
  // today's, declared every run alive. That is silent about a case missed the day before, so a
  // broken run came back at the next publication and stayed back until midnight.
  return lastFresh === decided || pending.has(lastFresh);
}

/**
 * The read model: the hash as the player's screens should read it.
 *
 * `newestPost` / `newestDay` are the front of the case registry. They are what decides whether the
 * stored run is still running, so they are parameters rather than reads - `stateOf` stays pure and
 * the audit can ask it "what would this player see if the newest case were X?".
 */
export function stateOf(
  h: Record<string, string>, decided: string | null = null, pending: Set<string> = new Set(),
): StreakState {
  const run = Number(h.current ?? 0) || 0;
  const last = h.lastDate && DATE_RE.test(h.lastDate) ? h.lastDate : null;
  const lastFresh = h.lastFreshPost || null;
  const best = Number(h.best ?? 0) || 0;
  return {
    current: chainLive(lastFresh, decided, pending) ? run : 0,
    best,
    lastDate: last,
    cases: Number(h.cases ?? 0) || 0,
    // No link has ever been recorded under the case unit, but a record exists: that record can only
    // have come from the old one.
    legacyBest: best > 0 && !lastFresh,
  };
}

/**
 * One hash read - the same cost every payload builder already paid. The visit ZSET is the WRITE
 * model and is deliberately not touched here: `/api/preview` renders whenever the post scrolls past
 * in the feed and must not write a thing.
 */
/** One retry, and then the error is the error.
 *
 *  Production logs carry `14 UNAVAILABLE: read ECONNRESET` out of `HGetAll` - twice in a week, both
 *  times on this path, and both times a transport failure rather than anything the app did. It is
 *  worth exactly one retry: a reset connection is re-established on the next call, and the reads
 *  below are pure, so repeating them cannot double anything.
 *
 *  Deliberately NOT a swallow. A streak that answers zero on a transport blip is a card telling a
 *  player their run is gone - the one figure on that screen they would act on - and a wrong figure
 *  delivered confidently is worse than a request that fails and is retried by the client. Two
 *  samples is also thin evidence: the log line stays so the frequency stays visible. */
async function twice<T>(what: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    console.error(`[streak] ${what} failed once, retrying`, e);
    return await fn();
  }
}

export async function readStreak(userId: string): Promise<StreakState> {
  // Two string reads on top of the hash. They are what makes "is the run still alive" answerable at
  // all under the case unit: the run ends when a case is published and goes by, which is an event
  // with no write of the player's to hang off.
  // The registry itself, not just its front: liveness turns on the newest case whose DAY IS OVER,
  // and neither `lt:lastPostId` nor `lt:lastPostDay` can answer that on a day when a newer case has
  // already been published. It caps at 60 entries (registerPost), so this is one small ZSET read on
  // a path that was already making three.
  const [h, reg] = await twice("readStreak", () => Promise.all([
    redis.hGetAll(streakKey(userId)),
    redis.zRange(POSTS_KEY, 0, -1, { by: "rank" }),
  ]));
  const { decided, pending } = registryFront(reg, visitDay());
  return stateOf(h, decided, pending);
}

/**
 * The legacy counter, taken at its word exactly once.
 *
 * A hash that says `current: 3, lastDate: 2026-08-14` is asserting a run of three days ending on
 * the 14th, so the set is seeded with those three days. Nothing is invented - this is the only
 * information the old counter ever held - and it is what keeps a player who has been solving live
 * every day from dropping from 3 to 1 on the day this ships. For a player whose `lastDate` was
 * stomped by an archive case the seed reproduces the number they already have, which is no worse
 * than today and cannot be improved on: the days that run was really made of were never recorded.
 */
async function seedVisits(vkey: string, h: Record<string, string>): Promise<void> {
  const last = h.lastDate;
  if (!last || !DATE_RE.test(last)) return;
  const len = Math.min(Math.max(1, Number(h.current ?? 1) || 1), SEED_MAX);
  const members: { member: string; score: number }[] = [];
  for (let i = len - 1; i >= 0; i--) {
    const d = shiftDay(last, -i);
    members.push({ member: d, score: dayMs(d) });
  }
  await redis.zAdd(vkey, ...members);
}

/**
 * Rebuild the fresh-case set from the day records, once, the first time a player closes anything
 * after this ships.
 *
 * Without it every live player's streak drops to zero on deploy, because the set the chain is
 * derived from starts empty - and that would be a number falling for a reason the player cannot
 * see, which is the failure this whole document set exists to prevent.
 *
 * The evidence is real rather than invented: `lb:solves:{date}` has carried the case's postId since
 * agent R added it, and the freshness flag since yesterday. A record that names a case and says it
 * was closed fresh IS a link in the chain, and it is the only source for one.
 *
 * Two limits, stated because they decide what a player sees rather than being footnotes:
 *   * a day holds ONE record per player, so on a day that published two cases only the case that
 *     owns the record can be recovered - the other is lost to the chain;
 *   * a record written before the flag existed decodes as fresh (leaderboard.ts), which is the
 *     same forgiving default the points migration uses, for the same reason: the archive was barely
 *     reachable while those were written, and guessing "archive" would take away a run somebody
 *     really did earn.
 */
async function seedFreshCases(ckey: string, userId: string, username: string | null): Promise<void> {
  if (!username) return;
  const days = await redis.zRange(INDEX_DAYS_KEY, 0, -1, { by: "rank" });
  const recent = days.slice(-SEED_MAX);
  const members: { member: string; score: number }[] = [];
  for (const { member: date } of recent) {
    const raw = await redis.hGet(solvesKey(date), username);
    if (!raw) continue;
    const rec = decodeSolve(username, raw);
    if (!rec || !rec.postId || !rec.fresh) continue;
    const at = await redis.zScore(POSTS_KEY, rec.postId);
    members.push({ member: rec.postId, score: at ?? dayMs(date) });
  }
  if (members.length) await redis.zAdd(ckey, ...members);
  console.log(`[streak] seeded ${members.length} fresh case(s) for ${username} (${userId})`);
}

/**
 * Cases closed. A different question from the streak, so a different number under its own name -
 * and the one the player who filed the bug was actually asking about.
 *
 * Exact from this build on. For play that predates it the postIds are gone (`lt:posts` only started
 * being written recently, and Redis cannot list keys), so the seed is the best truthful floor
 * available: `user:{name}.solved` counts DAYS with a recorded solve, which is ≤ cases closed and
 * equal to it on every day that published one case. Seeded before this solve is counted, hence
 * the `+1`.
 */
async function nextCases(
  h: Record<string, string>, newCase: boolean, username: string | null,
): Promise<number> {
  const add = newCase ? 1 : 0;
  if (h.casesSeeded) return (Number(h.cases ?? 0) || 0) + add;
  const days = username ? Number((await redis.hGet(userKey(username), "solved")) ?? 0) || 0 : 0;
  return Math.max(days, Number(h.cases ?? 0) || 0) + add;
}

/**
 * Record that this player closed a case on `day`, and re-derive the streak from the days recorded.
 *
 * Every number written here is a function of the visit set (plus `best`, which is maxed with what
 * the hash already held so it can never fall). That is the property the old accumulator lacked: a
 * wrong write cannot compound, because the next write recomputes from the days themselves.
 *
 * `day` is `visitDay()` for a live solve and the day off `solvedAt` when an old case is being dated
 * from evidence - which is also why this never assumes `day` is today.
 */
export async function recordVisit(
  userId: string, day: string,
  opts: { newCase?: boolean; username?: string | null; postId?: string; fresh?: boolean } = {},
): Promise<StreakState> {
  const key = streakKey(userId);
  const vkey = visitsKey(userId);
  const ckey = freshCasesKey(userId);
  const h = await redis.hGetAll(key);
  if (!DATE_RE.test(day) || !Number.isFinite(dayMs(day))) return stateOf(h);

  // The visit set is still kept. It stopped deciding the streak and it is still the honest record
  // of when this player came back - the audit prints it, and it is the only thing that could ever
  // answer "how often do they turn up" once the streak stopped answering it.
  if ((await redis.zCard(vkey)) === 0) await seedVisits(vkey, h);
  await redis.zAdd(vkey, { member: day, score: dayMs(day) });
  const n = await redis.zCard(vkey);
  if (n > VISITS_KEEP) await redis.zRemRangeByRank(vkey, 0, n - VISITS_KEEP - 1);

  // ── the chain itself ────────────────────────────────────────────────────────────────────────
  // Only a case closed while it was live joins the set. An archive close is still a visit, still
  // counts towards `cases`, still keeps a player's history - it simply does not advance the chain,
  // which is the whole of the owner's requirement.
  if (opts.fresh && opts.postId) {
    if ((await redis.zCard(ckey)) === 0) await seedFreshCases(ckey, userId, opts.username ?? null);
    const at = await redis.zScore(POSTS_KEY, opts.postId);
    await redis.zAdd(ckey, { member: opts.postId, score: at ?? dayMs(day) });
  }

  // The feed the chain is walked along is the registry UNIONED with the cases this player closed.
  // `lt:posts` only started being written recently, so a case published before it exists nowhere in
  // the registry - and walking the registry alone would make a real, live close invisible to the
  // chain. A case the player closed is a case that was published, whatever the registry remembers;
  // one that is in neither is one nobody can prove ran, so it cannot break anything either.
  const reg = await redis.zRange(POSTS_KEY, 0, -1, { by: "rank" });
  const mine = await redis.zRange(ckey, 0, -1, { by: "rank" });
  const closed = new Set(mine.map((m) => m.member));
  const feed = new Map<string, number>();
  for (const m of [...reg, ...mine]) if (!feed.has(m.member)) feed.set(m.member, m.score);
  const posts = [...feed.entries()].sort((a, b) => a[1] - b[1]).map(([member]) => ({ member }));
  // The SAME split the read path uses (registryFront in leaderboard.ts), over the SAME feed the run
  // is walked on. It used to be derived here from `lt:lastPostDay`, which this file's own header
  // says cannot name the newest decided case once a newer one has gone out today - and the write
  // path is the one that owns the number, so the two definitions could not be allowed to differ.
  const scored = [...feed.entries()].map(([member, score]) => ({ member, score }))
    .sort((a, b) => a.score - b.score);
  const front = registryFront(scored, visitDay());
  const { run, best } = runsOfCases(posts.map((p) => p.member), closed, front.pending);

  const days = (await redis.zRange(vkey, 0, -1, { by: "rank" })).map((m) => m.member);
  const { last } = runsOf(days);
  const username = opts.username ?? null;
  // `best` is a title, not a measurement (dec. 100): it feeds the subreddit flair, so the max keeps
  // a run earned under the OLD unit from being taken away by the new one. That is the floor the
  // owner asked for, and it is the same line that used to protect a pre-visit-set run.
  const bestOut = Math.max(best, Number(h.best ?? 0) || 0);
  const cases = await nextCases(h, opts.newCase === true, username);
  // The newest case this player actually closed - which IS what liveness is measured against, so it
  // is taken from the walked feed rather than from a front pointer.
  const lastFresh = [...posts].reverse().find((p) => closed.has(p.member))?.member
    ?? h.lastFreshPost ?? "";

  const write: Record<string, string> = {
    current: String(run), best: String(bestOut), lastDate: last ?? day, cases: String(cases),
    lastFreshPost: lastFresh ?? "",
  };
  if (username) write.casesSeeded = "1";
  await redis.hSet(key, write);

  const state = stateOf({ ...h, ...write }, front.decided, front.pending);
  // Mirror the LIVE run onto the board, here and nowhere else: this is the only place that holds
  // the username, the userId and the derived run at the same moment. The board is keyed by username
  // because every other board is, and the streak hash is keyed by the opaque id, which no read path
  // can turn back into a name.
  //
  // Removed rather than written as 0 when the run is gone: a zero row is a player on a leaderboard
  // with nothing on it. This only fires when the player acts, so a run that dies quietly leaves its
  // row behind - which is what liveStreaks() filters at read time instead of a nightly sweep.
  if (username) {
    if (state.current > 0) await redis.zAdd(STREAK_CUR_KEY, { member: username, score: state.current });
    else await redis.zRem(STREAK_CUR_KEY, [username]);
  }
  return state;
}

/**
 * Date a solve that was recorded before the streak knew what a day was.
 *
 * `att:.solvedAt` is the wall clock of the original close, so this is evidence rather than a guess -
 * and it is the only repair the platform allows: Redis cannot list keys, so nothing can walk every
 * player's history in one pass. It heals one case at a time, the first time that case is reopened.
 *
 * `startedAt` is deliberately NOT a fallback. It is stamped when a row is first touched, which for a
 * legacy row can be today - so a player could credit themselves a visit by merely opening an old
 * post. A close we cannot date is left undated.
 */
export async function noteRecordedSolve(
  userId: string, solvedAtMs: number, username: string | null,
): Promise<void> {
  if (!Number.isFinite(solvedAtMs) || solvedAtMs <= 0) return;
  await recordVisit(userId, dayOfMs(solvedAtMs), { newCase: false, username });
}

/** Every visit day on record, oldest first - for the audit, which has to print what is really there. */
export async function visitDays(userId: string): Promise<string[]> {
  return (await redis.zRange(visitsKey(userId), 0, -1, { by: "rank" })).map((m) => m.member);
}

/** Days between two dates, for the audit's "the run ended N days ago" line. */
export function daysBetween(from: string, to: string): number {
  return Math.round((dayMs(to) - dayMs(from)) / DAY_MS);
}
