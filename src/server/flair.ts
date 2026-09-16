// Deducto - the rank flair: the game's own ladder, printed next to a player's name in the
// subreddit so the streak they built is visible in every comment they leave.
//
// ── Why a scheduler job instead of a direct call from /api/check ───────────────────────────────
// Setting a user's flair is a MODERATOR action, and `/api/*` runs in the player's context. A
// one-off job (`runAt: now`) re-enters in the app account's context, and the app account is a
// moderator of every subreddit the app is installed in. Reddit's own Pixelary does exactly this,
// for exactly this reason ("Uses scheduler to run in app context for proper permissions").
// A one-off task still has to be declared in devvit.json, but carries no `cron`, so it does not
// spend one of the 10 recurring slots.
//
// ── Why the flair can never go stale ──────────────────────────────────────────────────────────
// It is recomputed and re-queued on EVERY solve, not written once. A player who climbs from
// Detective to Mastermind carries the new rank from their next solve on. The input is
// `streak.best`, which only ever grows, so:
//   * nobody is ever publicly demoted - the thing that would have forced a daily sweep over
//     every player who has ever played;
//   * a player who stops playing keeps the rank they earned. That is the promise the subreddit
//     copy makes ("a rank you have earned stays earned"), not staleness.
// The one case that does lag is a change to the RANKS ladder itself: existing flairs catch up on
// each player's next solve. Self-healing for anyone still playing, and harmless for anyone not.

import { context, reddit, redis, scheduler } from "@devvit/web/server";
import express from "express";
import { RANKS } from "../shared/themes.js";

/** Declared in devvit.json under `scheduler.tasks` - no cron, it only ever runs on demand. */
export const FLAIR_TASK = "user-flair";

/**
 * The css class a moderator assigns by hand to opt someone out for good. It is the one flair this
 * module will never overwrite. Opting out has to be a mod action rather than a Redis flag because
 * the flair itself is the thing the player wants gone - reading it back is the only honest check.
 */
const OPT_OUT_CSS = "rank-off";

/** `rank-1` … `rank-30`, keyed on the ladder's own thresholds so the two can never drift apart. */
const cssForRank = (min: number) => `rank-${min}`;

export interface RankFlair { text: string; cssClass: string }

/**
 * ── ONE ladder, read once, for both surfaces ──────────────────────────────────────────────────
 *
 * A rank used to be computed twice from two different numbers: the flair here from `streak.best`,
 * and the result card's ladder from `streak.current` (`rankFor(results.streak)`). One player
 * therefore held two titles at once - one in the game, one beside their name in the comments -
 * and nothing on either screen said why. Worse, `current` drops to 1 on a single missed day, so
 * the in-game half publicly demoted people the flair had (deliberately) promised never to demote.
 *
 * The decision, made once and applied everywhere:
 *
 *   * **The rank you HOLD comes from `best`.** A rank is a title that was earned, and the
 *     subreddit copy promises "a rank you have earned stays earned". `best` only ever grows, so
 *     nobody is ever demoted, and the game and the flair are the same word by construction -
 *     they are literally this one function.
 *   * **The distance to the NEXT rank comes from `current`.** Only a live run can produce a new
 *     best, so "N days to Chief Inspector" is a statement about the run you are on right now.
 *     Computing it off `best` would tell a player on a broken streak that they are three days
 *     from a rung that is really thirteen away.
 *   * **The two numbers never share a word.** `best` is "longest streak" (this ladder, the flair,
 *     `lb:streakbest`); `current` is the run in progress. They are separate fields in every
 *     payload, so no surface can print one under the other's label again.
 */
export interface RankState {
  /** The rung held, from `best`. null = not ranked yet - never "Detective by default". */
  label: string | null;
  cssClass: string | null;
  min: number;                // threshold of the rung held; 0 while unranked
  best: number;
  current: number;
  nextLabel: string | null;   // null once the top rung is held
  nextMin: number;
  /** Days the CURRENT run still needs to reach the next rung; 0 at the top. */
  nextIn: number;
}

export function rankState(best: number, current: number): RankState {
  const b = Number.isFinite(best) && best > 0 ? Math.floor(best) : 0;
  const c = Number.isFinite(current) && current > 0 ? Math.floor(current) : 0;
  const held = b >= 1 ? RANKS.find((r) => b >= r.min) ?? null : null;
  const min = held?.min ?? 0;
  // RANKS is stored top-first, so the next rung up is the last one whose threshold is above ours.
  const next = [...RANKS].reverse().find((r) => r.min > min) ?? null;
  return {
    label: held?.label ?? null,
    cssClass: held ? cssForRank(held.min) : null,
    min, best: b, current: c,
    nextLabel: next ? next.label : null,
    nextMin: next?.min ?? 0,
    nextIn: next ? Math.max(0, next.min - c) : 0,
  };
}

/**
 * The flair a best-ever streak earns, or null below the first rung.
 *
 * Deliberately NOT `rankFor()` from shared/themes: that one answers "what is this player's rank"
 * and returns Detective for a streak of 0, which is right in the result card (you just solved
 * something) and wrong here - a flair is permanent, and stamping "Detective" on someone who has
 * never solved a case is a label they did not earn. `rankState()` above is the shared answer, and
 * this is the one-line projection of it the flair job needs.
 */
export function flairForBestStreak(best: number): RankFlair | null {
  const r = rankState(best, best);
  return r.label && r.cssClass ? { text: r.label, cssClass: r.cssClass } : null;
}

const lastSetKey = (username: string) => `flair:set:${username}`;

/**
 * Queue a flair update for a player who has just solved. Fire-and-forget by design: a flair is a
 * decoration, and it must never be able to cost someone the solve that earned it.
 */
export async function queueFlairUpdate(username: string, bestStreak: number): Promise<void> {
  try {
    const want = flairForBestStreak(bestStreak);
    if (!want) return;
    // Cheap guard against re-queuing the same rank every single day for years. The authoritative
    // check still happens inside the job - this only keeps the queue quiet.
    if ((await redis.get(lastSetKey(username))) === want.cssClass) return;
    await scheduler.runJob({
      name: FLAIR_TASK,
      data: { username, subredditName: context.subredditName, ...want },
      runAt: new Date(),
    });
  } catch {
    /* the solve is already recorded; a missed flair is not worth failing the request over */
  }
}

export const flairRouter = express.Router();

flairRouter.post(`/internal/scheduler/${FLAIR_TASK}`, async (req, res) => {
  const { username, subredditName, text, cssClass } = (req.body?.data ?? {}) as Partial<
    RankFlair & { username: string; subredditName: string }
  >;
  // Always 200: a scheduler failure is retried, and retrying a flair forever helps nobody.
  const done = (status: string) => res.json({ status });

  if (!username || !subredditName || !text || !cssClass) return done("skipped: incomplete job");

  try {
    // Are user flairs switched on in this subreddit at all? With none configured, setUserFlair
    // succeeds and shows nothing - which would look like a silent bug for as long as nobody
    // checks the sidebar. Say so in the logs instead.
    const templates = await reddit.getUserFlairTemplates(subredditName);
    if (!templates.length) return done("skipped: user flair is not enabled in this subreddit");

    const user = await reddit.getUserByUsername(username);
    if (!user) return done("skipped: no such user");

    const current = await user.getUserFlairBySubreddit(subredditName);
    if (current?.flairCssClass === OPT_OUT_CSS) return done("skipped: player opted out");
    if (current?.flairCssClass === cssClass) {
      await redis.set(lastSetKey(username), cssClass);   // re-sync the guard, write nothing
      return done("unchanged");
    }

    await reddit.setUserFlair({ subredditName, username, text, cssClass });
    await redis.set(lastSetKey(username), cssClass);
    console.log(`[flair] ${username} → ${text}`);
    return done("set");
  } catch (err) {
    console.error(`[flair] ${username}: ${err instanceof Error ? err.message : String(err)}`);
    return done("failed");
  }
});
