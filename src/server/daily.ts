// ── Automatic daily publication, and the loop that exists because the last one had none ────────
//
// The first attempt at this got two subreddits banned. The post-mortem (plans/05-auto-posting.md)
// found four causes, and only one of them was the scheduler itself:
//
//   1. an empty subreddit taking one bot post a day  - a product problem, fixed by having players;
//   2. NO idempotency at all                          - fixed here, first, because it is the one
//      that turns a retried delivery into "the same post twice in a row", i.e. spam by any metric;
//   3. an unapproved app                              - fixed by review (approved 2026-08-16);
//   4. one cron firing into EVERY install at the same
//      minute with the same title                     - fixed here by a per-subreddit opt-in.
//
// And the thing that made it expensive rather than annoying: nobody found out until the subreddit
// was gone. Reddit's site-wide antispam does not act at submit time - it acts minutes later, and
// `submitCustomPost` returns a perfectly good post id either way. So publishing is only half the
// job here. The other half is C3: a one-off job half an hour later that reads the post back, and
// on finding it filtered STOPS the schedule and tells the moderators. A daily poster with no
// feedback loop is the thing that was shipped last time.
//
// Nothing in this file runs unless a moderator of that specific subreddit turns it on.
import { context, reddit, redis, scheduler, settings } from "@devvit/web/server";
import express from "express";

/** Declared in devvit.json under `scheduler.tasks`. Hourly - see `hourFor()`. */
export const DAILY_TASK = "daily-post";
/** Declared alongside it, with no cron: it only ever runs from `runJob({ runAt })`. */
export const DAILY_CHECK_TASK = "daily-check";

// Per-subreddit settings (devvit.json `settings.subreddit`). Both default to OFF/13:00 UTC, which
// is what makes the dev install silent without a second config: an install publishes nothing until
// somebody who moderates that subreddit says so.
const S_ENABLED = "dailyAutoPost";
const S_HOUR = "dailyPostHourUtc";

// ── keys (docs/05-data-model.md) ───────────────────────────────────────────────────────────────
const LOCK_HASH = "daily:posted";      // hash: date -> postId, or "pending" while a run is in flight
const LAST_AT = "daily:lastAt";        // ms of the last successful auto-post
const PAUSED = "daily:paused";         // "1" = the schedule is stopped and will not resume itself
const PAUSED_WHY = "daily:pausedReason";
const LAST_POST = "daily:lastPostId";
/** Read by the feed card's countdown so it names the real next publication (C5). Absent = the
    schedule is off, and the countdown falls back to "24 h after the newest post". */
export const NEXT_AT = "daily:nextAt";

/** The second belt. The lock already makes a day idempotent; this survives a lock that was written
    under a different date because the hour setting moved across UTC midnight between two runs. */
const MIN_GAP_MS = 20 * 3_600_000;
/** How long to wait before reading the post back. Reddit's filters act within minutes, not at
    submit time; 30 minutes is late enough to have caught every removal seen in the incident and
    early enough that the next day's run is still 23 hours away. */
const CHECK_DELAY_MS = 30 * 60_000;

export interface DailyState {
  enabled: boolean;
  hourUtc: number;
  paused: boolean;
  pausedReason: string | null;
  lastPostId: string | null;
  lastAtMs: number;
  postedToday: string | null;   // postId written for today's date, or "pending"
}

/** A setting a moderator has never opened reads as `undefined`, not as its default - so every read
    states the default here rather than trusting the platform to. Out-of-range hours are clamped
    rather than refused: a 25 typed into a number field should not silently stop the schedule. */
async function hourFor(): Promise<number> {
  const raw = await settings.get<number>(S_HOUR);
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) ? Math.min(23, Math.max(0, n)) : 13;
}

async function enabledFor(): Promise<boolean> {
  return (await settings.get<boolean>(S_ENABLED)) === true;
}

/** The next time the hour comes round in UTC, from `now`. Equal-hour is deliberately treated as
    "already gone": the run that fires AT the hour has just published, so the reader's next case is
    tomorrow's, not the one they are looking at. */
export function nextRunAtMs(nowMs: number, hourUtc: number): number {
  const d = new Date(nowMs);
  const at = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hourUtc, 0, 0, 0);
  return at > nowMs ? at : at + 86_400_000;
}

export const utcDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export async function readState(): Promise<DailyState> {
  const [enabled, hourUtc] = await Promise.all([enabledFor(), hourFor()]);
  const [paused, why, lastPostId, lastAt, today] = await Promise.all([
    redis.get(PAUSED), redis.get(PAUSED_WHY), redis.get(LAST_POST), redis.get(LAST_AT),
    redis.hGet(LOCK_HASH, utcDate(Date.now())),
  ]);
  return {
    enabled, hourUtc,
    paused: paused === "1",
    pausedReason: why ?? null,
    lastPostId: lastPostId ?? null,
    lastAtMs: Number(lastAt ?? 0) || 0,
    postedToday: today ?? null,
  };
}

/** Stop the schedule and say why, in one place, so a pause always leaves a reason behind it. There
    is deliberately no automatic resume: everything that pauses this is something a person has to
    look at, and a schedule that restarts itself after being filtered is the original incident. */
export async function pause(reason: string): Promise<void> {
  await redis.set(PAUSED, "1");
  await redis.set(PAUSED_WHY, reason);
  await redis.del(NEXT_AT);
  console.log(`[daily] PAUSED: ${reason}`);
}

async function tellTheMods(subject: string, body: string): Promise<void> {
  try {
    const subredditId = context.subredditId;
    if (!subredditId) return;
    await reddit.modMail.createModDiscussionConversation({
      subject, bodyMarkdown: body, subredditId: subredditId as `t5_${string}`,
    });
  } catch (e) {
    // The pause is already recorded and logged. A modmail that cannot be sent must not turn into
    // a scheduler failure, because a failed scheduler task is retried - and retrying this one
    // would mean re-reading a post that is still gone, forever.
    console.error("[daily] could not reach modmail", e);
  }
}

export type Publisher = () => Promise<{ post: { id: string }; n: number; date: string }>;

export function makeDailyRouter(publish: Publisher): express.Router {
  const r = express.Router();

  // ── the hourly tick ──────────────────────────────────────────────────────────────────────────
  // Hourly rather than daily so that `dailyPostHourUtc` is a SETTING and not a redeploy: one cron
  // line serves every subreddit's chosen hour, including one that installs this app later.
  r.post(`/internal/scheduler/${DAILY_TASK}`, async (_req, res) => {
    const out = await tick(publish);
    console.log(`[daily] ${out}`);
    res.json({ status: "ok" });
  });

  // ── the loop that was missing ────────────────────────────────────────────────────────────────
  r.post(`/internal/scheduler/${DAILY_CHECK_TASK}`, async (req, res) => {
    const postId = String((req.body as { data?: { postId?: string } })?.data?.postId ?? "");
    if (postId) await verifyPost(postId);
    // Always 200. A scheduler task that fails is retried, and re-reading a removed post on a loop
    // helps nobody - the pause and the modmail have already happened by here.
    res.json({ status: "ok" });
  });

  // ── mod menu: the switch, and the readout ────────────────────────────────────────────────────
  // ── the switch, and the state it must refuse to create ──────────────────────────────────────
  // This item is a PAUSE, not an on-switch, and the two are easy to confuse because the schedule
  // ships off: a moderator looking for "turn it on" presses the only button that mentions the
  // daily post and gets `PAUSED` back, which reads like a fault report about something that was
  // never running. Pausing a schedule that is already off is also a state with no meaning - two
  // different reasons for the same nothing - so it is refused, and the toast says where the real
  // switch lives instead.
  // The path a moderator actually walks. An earlier version of this string said "Mod Tools > Apps",
  // which is not a menu that exists - and a toast that sends the reader somewhere they cannot find
  // is worse than one that says nothing, because they go looking before they come back.
  const SETTINGS_PATH = "Mod Tools > Community Apps > Installed Apps";
  r.post("/internal/menu/daily-toggle", async (_req, res) => {
    const st = await readState();
    if (!st.enabled) {
      // Clear a pause if one is somehow standing: with the setting off it protects nothing, and
      // leaving it would make the status readout keep reporting a fault that is not one.
      if (st.paused) { await redis.del(PAUSED); await redis.del(PAUSED_WHY); }
      res.json({ showToast: `Auto-posting is OFF for this subreddit. Turn it on in ${SETTINGS_PATH}.` });
      return;
    }
    if (st.paused) {
      await redis.del(PAUSED);
      await redis.del(PAUSED_WHY);
      res.json({
        showToast: `Auto-post resumed. Next case at ${String(st.hourUtc).padStart(2, "0")}:00 UTC.`,
      });
      return;
    }
    await pause("paused by a moderator from the menu");
    res.json({ showToast: "Auto-post PAUSED. Press this again to resume." });
  });

  // A toast is one short line - the client truncates anything longer, and a truncated status is
  // worse than a short one because the part that gets cut is always the end. So the TOAST answers
  // the one question the reader has (is it running, and if not what do I press), and everything
  // else goes to the app logs, which is where a moderator debugging a schedule already is.
  r.post("/internal/menu/daily-status", async (_req, res) => {
    const st = await readState();
    let alive: string | null = null;
    if (st.lastPostId) {
      try {
        const p = await reddit.getPostById(st.lastPostId as `t3_${string}`);
        alive = p.removed ? `REMOVED by ${p.removedBy ?? "unknown"}`
          : p.spam ? "IN THE SPAM FILTER" : "alive";
      } catch { alive = "cannot be read back - deleted?"; }
    }
    console.log(`[daily] enabled=${st.enabled} hourUtc=${st.hourUtc} paused=${st.paused}` +
      ` reason=${st.pausedReason ?? "-"} today=${st.postedToday ?? "-"}` +
      ` lastPost=${st.lastPostId ?? "-"} lastPostState=${alive ?? "-"}`);

    // Ordered by what the reader can act on. A filtered last post outranks everything: it is the
    // one state that means something is wrong rather than merely switched off.
    let msg: string;
    if (alive && alive !== "alive") msg = `Last auto-post ${alive}. Auto-posting is stopped.`;
    else if (!st.enabled) msg = `Auto-posting is OFF. Turn it on in ${SETTINGS_PATH}.`;
    else if (st.paused) msg = `Auto-posting is PAUSED: ${st.pausedReason ?? "no reason recorded"}.`;
    else if (st.postedToday && st.postedToday !== "pending") msg = "Auto-posting is ON. Today's case is out.";
    else msg = `Auto-posting is ON. Next case at ${String(st.hourUtc).padStart(2, "0")}:00 UTC.`;
    res.json({ showToast: msg });
  });

  return r;
}

/** One tick of the hourly cron. Returns the sentence that goes in the log - every early exit says
    which of the guards stopped it, because "the scheduler ran and nothing happened" is exactly the
    state that was impossible to diagnose last time. */
export async function tick(publish: Publisher): Promise<string> {
  if ((await redis.get(PAUSED)) === "1") return "skipped: paused";

  const [enabled, hourUtc] = await Promise.all([enabledFor(), hourFor()]);
  if (!enabled) {
    // The countdown on the feed card must not promise a schedule that is switched off.
    await redis.del(NEXT_AT);
    return "skipped: auto-post is off for this subreddit";
  }

  const now = Date.now();
  // Published or not, a subreddit with the schedule ON has a next publication time, and the card
  // says so. Written on every tick so that changing the hour setting is visible within the hour.
  await redis.set(NEXT_AT, String(nextRunAtMs(now, hourUtc)));

  if (new Date(now).getUTCHours() !== hourUtc) return `skipped: not the hour (want ${hourUtc})`;

  // ── idempotency, and why it is hSetNX ───────────────────────────────────────────────────────
  // `set` has no NX in this client, and a get-then-set is precisely the race that produces two
  // identical posts one second apart. `hSetNX` returns 1 only for the caller that created the
  // field, so exactly one delivery of a retried event can ever get past this line.
  const date = utcDate(now);
  const won = await redis.hSetNX(LOCK_HASH, date, "pending");
  if (won !== 1) return `skipped: already handled ${date}`;

  // Second belt, checked AFTER the lock so it cannot be raced either: a clock or an hour setting
  // that moves across UTC midnight can produce two different `date` values inside one real day.
  const lastAt = Number((await redis.get(LAST_AT)) ?? 0) || 0;
  if (lastAt > 0 && now - lastAt < MIN_GAP_MS) {
    return `skipped: last post was ${Math.round((now - lastAt) / 60000)} min ago`;
  }

  const { post, n } = await publish();
  await redis.hSet(LOCK_HASH, { [date]: post.id });
  await redis.set(LAST_AT, String(now));
  await redis.set(LAST_POST, post.id);
  await redis.set(NEXT_AT, String(nextRunAtMs(now, hourUtc)));

  // The half that was missing. Queued AFTER the post is recorded, so a failure to queue leaves a
  // published case rather than an unpublished one.
  try {
    await scheduler.runJob({
      name: DAILY_CHECK_TASK,
      data: { postId: post.id },
      runAt: new Date(now + CHECK_DELAY_MS),
    });
  } catch (e) {
    console.error("[daily] could not queue the survival check", e);
  }
  return `published case #${n} as ${post.id}`;
}

/** Read the post back half an hour later. This is the whole reason the schedule is allowed to run
    at all: the previous version had no way of learning that its posts were being filtered. */
export async function verifyPost(postId: string): Promise<"alive" | "gone"> {
  let verdict: string | null = null;
  try {
    const p = await reddit.getPostById(postId as `t3_${string}`);
    if (p.removed) verdict = `removed by ${p.removedBy ?? "unknown"}`;
    else if (p.spam) verdict = "caught by the spam filter";
  } catch {
    verdict = "cannot be read back - deleted";
  }
  if (!verdict) return "alive";

  await pause(`${postId} was ${verdict}`);
  await tellTheMods(
    "Deducto: the daily post was filtered - auto-posting is stopped",
    `Half an hour after publishing, \`${postId}\` **${verdict}**.\n\n` +
    "Daily auto-posting has been **paused** and will not restart on its own. " +
    "This is the check that was missing when this app's earlier subreddits were banned for " +
    "auto-posting, so the pause is deliberate rather than cautious.\n\n" +
    "**What to look at**\n\n" +
    "- Mod Tools → Content Controls → post spam filter → *Low*\n" +
    "- Crowd Control → off, or its lowest setting\n" +
    "- AutoModerator rules that act on low-karma or new accounts (the app account is one)\n" +
    "- Add the app account to the subreddit's approved users\n\n" +
    "Publish by hand from the subreddit menu in the meantime. When the cause is understood, " +
    "resume from **Deducto: pause/resume daily auto-post**.",
  );
  return "gone";
}
