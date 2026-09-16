// ── the case's own thread: a comment as the permanent record ───────────────────────────────────
//
// The feed card can only ever show what is true RIGHT NOW. `FASTEST` is a live minimum over
// `lb:{postId}`, so the moment somebody beats it the previous holder's name is gone from every
// screen in the app - and there is nowhere left that says they ever held it. The owner's answer is
// the right one: the live figure belongs on the post, and the RECORD belongs in a comment.
//
//   «а на самом посте бы обновлял fastest time. а коммент будет как память.
//    зато если снова кто-то будет быстрее после 24 часов, то опять бы коммент сделал.»
//
// Two announcements, and only two:
//   1. the case closes 24 h after it was published, and the winner of that day is named;
//   2. after that, a time that beats the standing record gets a comment of its own.
//
// The mention IS the notification. A comment naming `u/someone` triggers Reddit's own username
// notification, so the winner is told by the platform rather than by a private message from an app
// account - which is both less intrusive and much less like the behaviour that got this app's
// earlier subreddits filtered.
//
// Everything here is an automated write to Reddit, which is exactly the surface that burned this
// project once. So: one close comment per case, EVER; record comments only after the case has
// closed; only for a strictly better time; and never twice inside `RECORD_FLOOR_MS`.
import { context, reddit, redis, scheduler } from "@devvit/web/server";
import express from "express";

/** Declared in devvit.json under `scheduler.tasks`, both without a cron - they only ever run from
    `runJob({ runAt })`, and both re-enter in the APP ACCOUNT's context, which is what lets them
    comment at all. */
export const CLOSE_TASK = "case-close";
export const RECORD_TASK = "case-record";

/** A case belongs to its day. 24 h after publication the day is over and the winner is the winner,
    whatever the board does afterwards. */
export const CLOSE_AFTER_MS = 86_400_000;
/** A floor between record announcements on one case. A record can only fall to a genuinely faster
    time, so this is not about frequency in normal play - it is the guard that keeps a flurry from
    turning one thread into a column of near-identical comments. */
const RECORD_FLOOR_MS = 6 * 3_600_000;

const CLOSED = "herald:closed";               // hash postId -> "pending" | commentId
const announcedKey = (p: string) => `herald:best:${p}`;   // the time this thread has announced
const announcedAtKey = (p: string) => `herald:at:${p}`;   // when it last announced one

const lbKey = (postId: string) => `lb:${postId}`;
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s) % 60).padStart(2, "0")}`;

/** Queued when a case is published, so a case gets its closing comment whether it went out from the
    scheduler or from a moderator pressing the menu item. */
export async function scheduleClose(postId: string, n: number | null): Promise<void> {
  try {
    await scheduler.runJob({
      name: CLOSE_TASK,
      data: { postId, n },
      runAt: new Date(Date.now() + CLOSE_AFTER_MS),
    });
  } catch (e) {
    // A case that publishes is worth more than a case that publishes AND is announced. The post
    // already exists by here; failing the publication over its epilogue would be the wrong trade.
    console.error("[herald] could not schedule the close", e);
  }
}

async function comment(postId: string, text: string): Promise<string | null> {
  try {
    const c = await reddit.submitComment({ id: postId as `t3_${string}`, text, runAs: "APP" });
    return c.id;
  } catch (e) {
    console.error("[herald] could not comment", e);
    return null;
  }
}

/** The day is over: name the winner. Idempotent by construction - `hSetNX` means exactly one
    delivery of a retried scheduler event can ever write this comment. */
export async function closeCase(postId: string, n: number | null): Promise<string> {
  const won = await redis.hSetNX(CLOSED, postId, "pending");
  if (won !== 1) return "already closed";

  const solvers = await redis.zCard(lbKey(postId));
  if (solvers === 0) {
    // Nothing is invented to fill the silence (dec. 37). The case is still marked closed, so a
    // later solve is a RECORD rather than a second attempt at this announcement.
    return "closed with nobody on the board";
  }
  const top = await redis.zRange(lbKey(postId), 0, 0, { by: "rank" });
  const who = top[0]?.member;
  const best = top[0]?.score ?? 0;
  if (!who) return "closed with no resolvable winner";

  const label = n ? `Case #${n}` : "This case";
  const id = await comment(postId,
    `**${label} is closed.**\n\n` +
    `🥇 Fastest: u/${who} — **${fmt(best)}**\n\n` +
    `${solvers} ${solvers === 1 ? "detective" : "detectives"} closed it.\n\n` +
    "The board stays open. Beat that time and this thread gets a new record.");

  await redis.hSet(CLOSED, { [postId]: id ?? "posted" });
  await redis.set(announcedKey(postId), String(best));
  await redis.set(announcedAtKey(postId), String(Date.now()));
  return `announced u/${who} in ${fmt(best)}`;
}

/** A record fell after the case had closed. Never called before it closes: during the first day the
    board is live on the card and the closing comment is what summarises it. */
export async function announceRecord(postId: string, n: number | null): Promise<string> {
  if (!(await redis.hGet(CLOSED, postId))) return "not closed yet";

  const prevBest = Number((await redis.get(announcedKey(postId))) ?? 0) || 0;
  const at = Number((await redis.get(announcedAtKey(postId))) ?? 0) || 0;
  if (at > 0 && Date.now() - at < RECORD_FLOOR_MS) return "inside the announcement floor";

  const top = await redis.zRange(lbKey(postId), 0, 0, { by: "rank" });
  const who = top[0]?.member;
  const best = top[0]?.score ?? 0;
  if (!who || best <= 0) return "no record to announce";
  // Strictly better, and re-read here rather than trusted from the caller: between queueing and
  // running, somebody else may have taken it, and the comment must name whoever actually holds it.
  if (prevBest > 0 && best >= prevBest) return "the record still stands";

  const label = n ? `Case #${n}` : "this case";
  const beat = prevBest > 0 ? ` — beating the standing **${fmt(prevBest)}**` : "";
  await comment(postId,
    `**New record on ${label}.**\n\n🥇 u/${who} — **${fmt(best)}**${beat}.`);
  await redis.set(announcedKey(postId), String(best));
  await redis.set(announcedAtKey(postId), String(Date.now()));
  return `announced u/${who} in ${fmt(best)}`;
}

/** Called from /api/check once a solve is on the board. Cheap and silent: it only ever queues a job
    when the case has already closed AND this solve is the new best, which is rare by construction. */
export async function maybeAnnounce(postId: string, timeSec: number, n: number | null): Promise<void> {
  try {
    if (!(await redis.hGet(CLOSED, postId))) return;
    const prevBest = Number((await redis.get(announcedKey(postId))) ?? 0) || 0;
    if (prevBest > 0 && timeSec >= prevBest) return;
    await scheduler.runJob({ name: RECORD_TASK, data: { postId, n }, runAt: new Date() });
  } catch {
    /* the solve is recorded; a missed announcement is not worth failing the request over */
  }
}

export const heraldRouter = express.Router();

heraldRouter.post(`/internal/scheduler/${CLOSE_TASK}`, async (req, res) => {
  const d = (req.body as { data?: { postId?: string; n?: number | null } })?.data;
  if (d?.postId) console.log(`[herald] close ${d.postId}: ${await closeCase(d.postId, d.n ?? null)}`);
  // Always 200: a failed scheduler task is retried, and retrying this one would re-read a board
  // that has not changed. The `hSetNX` claim has already made a second delivery a no-op anyway.
  res.json({ status: "ok" });
});

heraldRouter.post(`/internal/scheduler/${RECORD_TASK}`, async (req, res) => {
  const d = (req.body as { data?: { postId?: string; n?: number | null } })?.data;
  if (d?.postId) console.log(`[herald] record ${d.postId}: ${await announceRecord(d.postId, d.n ?? null)}`);
  res.json({ status: "ok" });
});

/** Mod menu: close the current case by hand. For a post published before this shipped - there is no
    job queued for those - and for a moderator who wants the epilogue now rather than on the hour. */
heraldRouter.post("/internal/menu/close-case", async (_req, res) => {
  const postId = context.postId;
  if (!postId) { res.json({ showToast: "Open this from a Deducto post." }); return; }
  const meta = context.postData as { n?: number | null } | undefined;
  res.json({ showToast: `Deducto: ${await closeCase(postId, meta?.n ?? null)}` });
});
