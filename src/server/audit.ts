// Deducto - "what is ACTUALLY in the database?", a moderator menu item on a case post.
//
// ── why this is a tool and not a query ─────────────────────────────────────────────────────────
// Devvit Redis lives inside the app. There is no CLI, no console, no export - and no way to list
// keys at all: `KEYS` / `SCAN` do not exist. Reading the live state is therefore not an act of
// looking, it is an act of shipping code that looks. This is that code.
//
// Everything below is reached through a collection something already maintains:
//
//   lt:posts          → every case this app published (postId + created ms)
//   stuck:{postId}    → every player who ever autosaved a board on that case (userId)
//   lb:alltime        → every player who ever recorded a solve (username)
//   lb:index:days     → every day that ever recorded a solve
//
// Those four are the whole map. A key that is not reachable from one of them cannot be read back
// by anyone, ever, and the report says so out loud rather than leaving a silent hole - see
// `unreachable()` at the bottom.
//
// A Reddit toast is one short sentence, so the split is deliberate: the toast carries the numbers
// that decide whether something is wrong, and the full dump goes to `devvit logs`.

import { context, redis } from "@devvit/web/server";
import express from "express";
import { hoursLines } from "./hours.js";
import {
  currentDay, decodeSolve, median, targetFor, pointsForSolve, isoWeek, seasonOf, todayUtc,
  dayKey, solvesKey, pointsKey, appliedKey, dayMetaKey, weekKey, seasonKey, daysKey, userKey,
  ALLTIME_KEY, STREAK_BEST_KEY, INDEX_DAYS_KEY, MIN_PLAUSIBLE_SEC, type Tier, registryFront,
} from "./leaderboard.js";

// The streak keys come from their owner, which is a plain module: one definition, so this report
// can never print a key the writer does not use.
import {
  freshCasesKey, runsOf, runsOfCases, streakKey, visitDays, visitsKey, daysBetween,
} from "./streak.js";

// Key builders owned by index.ts. Re-declared rather than imported for the same reason
// leaderboard.ts re-declares `Tier`: importing index.ts boots the HTTP server.
const attKey = (postId: string, userId: string) => `att:${postId}:${userId}`;
const lbKey = (postId: string) => `lb:${postId}`;
const voteKey = (postId: string) => `vote:${postId}`;
const solvedCountKey = (postId: string) => `solvedCount:${postId}`;
const statsKey = (postId: string) => `stats:${postId}`;
const stuckKey = (postId: string) => `stuck:${postId}`;
const POSTS_KEY = "lt:posts";

// Caps, so a mod action on a busy sub cannot turn into a thousand round trips. Every cap that
// actually bites is printed - a silently truncated report reads as "I looked at everything".
const MAX_PLAYERS = 30;   // att: rows walked per case
const MAX_PROFILES = 25;  // per-player aggregate cross-checks
const MAX_DAYS = 14;      // days of rollup history examined

type Line = string;
const fmt = (n: unknown) => (n === undefined || n === null || n === "" ? "—" : String(n));
const zdump = (rows: { member: string; score: number }[], cap = 12) =>
  rows.slice(0, cap).map((m) => `${m.member}=${m.score}`).join(" ") +
  (rows.length > cap ? ` …(+${rows.length - cap})` : "");
const hdump = (h: Record<string, string>, cap = 24) => {
  const e = Object.entries(h);
  return e.length
    ? e.slice(0, cap).map(([k, v]) => `${k}=${v}`).join(" ") + (e.length > cap ? ` …(+${e.length - cap})` : "")
    : "(empty)";
};
const dateOfMs = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const DAY_MS = 86_400_000;

/** Longest run of consecutive calendar days in a list of YYYY-MM-DD strings. */
function longestRun(dates: string[]): number {
  const ms = [...new Set(dates)].map((d) => Date.parse(`${d}T00:00:00Z`))
    .filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  let best = 0, run = 0, prev = NaN;
  for (const t of ms) {
    run = t - prev === DAY_MS ? run + 1 : 1;
    prev = t;
    if (run > best) best = run;
  }
  return best;
}

interface Report { lines: Line[]; alerts: string[] }
const push = (r: Report, s: string) => { r.lines.push(s); };
const alert = (r: Report, s: string) => { r.alerts.push(s); r.lines.push(`⚠ ${s}`); };

// ───────────────────────── the streak, against the days it is made of ─────────────────────────
//
// This is the check the old streak could not have: `current` and `best` were an accumulator, so
// there was nothing to compare them against and a wrong write was indistinguishable from a real
// run. They are now derived from `streak:days:{userId}` on every write (streak.ts), which makes two
// things checkable rather than merely asserted:
//
//   * `best` must cover the longest run in the set. Smaller means the number and its evidence have
//     parted company. LARGER is legitimate and expected - `best` never falls, so it can outlive both
//     the visit set (which started empty when this shipped) and the 400 days it keeps.
//   * the stored `current` must equal the run ending at the last recorded day.
//
// Reachable only for the userIds in `stuck:{postId}`, i.e. players who saved a board on this case.
// `lb:streakbest` is keyed by username and nothing maps a username back to a userId, so the streak
// board itself cannot be cross-checked this way - see the note in auditPlayers().
async function auditStreak(r: Report, uid: string, st: Record<string, string>): Promise<void> {
  const days = await visitDays(uid);
  const d = runsOf(days);
  const today = todayUtc();
  const live = d.last !== null && daysBetween(d.last, today) <= 1;
  push(r, `    streak:${uid} current=${fmt(st.current)} best=${fmt(st.best)} lastDate=${fmt(st.lastDate)}` +
    ` cases=${fmt(st.cases)}${st.casesSeeded ? "" : " (cases floor not seeded yet)"}` +
    ` · ${visitsKey(uid)} n=${days.length} → ${days.slice(-10).join(" ") || "(empty)"}` +
    ` · derived run=${d.run} best=${d.best} last=${fmt(d.last)}` +
    (d.last === null ? "" : ` · ${live ? "live" : `over, ended ${daysBetween(d.last, today)}d ago`}`));
  // ── the CHAIN, which is what a streak actually is since dec. 123 ────────────────────────────
  // The visit days above are still the honest record of when this player came back; they stopped
  // deciding the streak. This is the line that answers "what happened to this player when the unit
  // changed" with facts instead of a guess: how many links they have, against how many cases ran.
  const chain = (await redis.zRange(freshCasesKey(uid), 0, -1, { by: "rank" })).map((m) => m.member);
  // The same split the game itself uses. It was computed here from `lt:lastPostDay` - a second copy
  // of a rule that had already been fixed elsewhere, which would have made the audit CONFIRM a
  // wrong run instead of catching it.
  const regRows = await redis.zRange("lt:posts", 0, -1, { by: "rank" });
  const reg = regRows.map((m) => m.member);
  const { pending } = registryFront(regRows, today);
  const c = runsOfCases(reg, new Set(chain), pending);
  push(r, `      chain ${freshCasesKey(uid)} n=${chain.length}/${reg.length} published` +
    ` → run=${c.run} best=${c.best}` +
    (chain.length === 0 && Number(st.best ?? 0) > 0
      ? ` · LEGACY: best=${fmt(st.best)} was earned under the DAY unit; the chain is empty, so the`
        + ` current run reads 0 and the screens say why (dec. 124). The record is the floor.`
      : ""));
  if (!days.length) return;
  if (Number(st.best ?? 0) < c.best) {
    alert(r, `${uid}: streak.best ${fmt(st.best)} is below the longest chain of fresh cases (${c.best})`);
  }
}

// ───────────────────────── 1. the case the menu was opened from ─────────────────────────
async function auditCase(r: Report, postId: string, day: string): Promise<{ players: string[] }> {
  const meta = (context.postData as { idx?: number; n?: number | null; date?: string; level?: number } | undefined) ?? {};
  push(r, `── CASE ${postId} · #${fmt(meta.n)} · postData.date=${fmt(meta.date)} · idx=${fmt(meta.idx)} · level=${fmt(meta.level)} · resolved day=${day}`);

  const stats = await redis.hGetAll(statsKey(postId));
  const solvedCount = Number((await redis.get(solvedCountKey(postId))) ?? 0);
  const caseBoard = await redis.zRange(lbKey(postId), 0, -1, { by: "rank" });
  const votes = await redis.hGetAll(voteKey(postId));
  const stuck = await redis.zRange(stuckKey(postId), 0, -1, { by: "rank" });

  push(r, `stats:${postId} → ${hdump(stats)}`);
  push(r, `solvedCount:${postId} = ${solvedCount}`);
  push(r, `lb:${postId} (legacy per-case board) n=${caseBoard.length} → ${zdump(caseBoard)}`);
  push(r, `vote:${postId} → ${hdump(votes)}`);
  push(r, `stuck:${postId} n=${stuck.length} (member=userId, score=best cells deduced) → ${zdump(stuck)}`);

  if (caseBoard.length !== solvedCount) {
    alert(r, `case board has ${caseBoard.length} rows for ${solvedCount} recorded solves`);
  }

  // att: rows. `stuck:` is the ONLY index of players on a post, and it is populated by the autosave
  // - so a player who opened the case and never saved a board is counted in `stats.opened` and is
  // then unreachable forever. That gap is the report's, not the reader's, to notice.
  const players = stuck.map((m) => m.member);
  const walked = players.slice(0, MAX_PLAYERS);
  push(r, `att: rows reachable = ${players.length} of ${Number(stats.opened ?? 0)} counted opens` +
    (walked.length < players.length ? ` (walking first ${walked.length})` : ""));
  let activeTotal = 0, activeN = 0;
  for (const uid of walked) {
    const h = await redis.hGetAll(attKey(postId, uid));
    const flags = Object.keys(h).filter((k) => k.startsWith("f_")).sort().join(",");
    const st = await redis.hGetAll(streakKey(uid));
    const active = Number(h.activeSec ?? 0);
    if (active > 0) { activeTotal += active; activeN++; }
    push(r, `  att:${postId}:${uid} startedAt=${fmt(h.startedAt)} activeSec=${fmt(h.activeSec)}` +
      ` timeSec=${fmt(h.timeSec)} hints=${fmt(h.hints)} solved=${fmt(h.solved)} solveOrder=${fmt(h.solveOrder)}` +
      ` maxCells=${fmt(h.maxCells)} vote=${fmt(h.vote)} grid=${h.grid ? `${h.grid.length}B` : "—"} flags=[${flags}]` +
      ` streakDay=${fmt(h.streakDay)} solvedAt=${h.solvedAt ? dateOfMs(Number(h.solvedAt)) : "—"}`);
    await auditStreak(r, uid, st);
  }
  // Dwell time, for everyone the post can still name. It is client-reported (`/api/state`), so it
  // is a floor on attention, not a measurement - which is exactly how it is labelled.
  push(r, `activeSec (client-reported, players who saved a board): n=${activeN}` +
    ` mean=${activeN ? Math.round(activeTotal / activeN) : 0}s`);

  // The funnel is a ladder, so each rung has to be a subset of the one above it. `opened >=
  // firstMove` now holds by construction (openAttempt), but `firstMove >= solved` does not: the
  // solve counter lives in /api/check while `f_move` is stamped by the autosave, so a solve that
  // never went through /api/state - a replay on a row from an older build, a check that beat the
  // first autosave - lands under a rung it never climbed.
  const opened = Number(stats.opened ?? 0), firstMove = Number(stats.firstMove ?? 0);
  if (firstMove > opened) alert(r, `funnel is impossible: firstMove ${firstMove} > opened ${opened}`);
  if (solvedCount > firstMove) {
    alert(r, `funnel is impossible: solved ${solvedCount} > firstMove ${firstMove} on ${postId}` +
      ` - solve rate cannot be computed from it`);
  }
  return { players };
}

// ───────────────────────── 2. the day ─────────────────────────
async function auditDay(r: Report, day: string): Promise<{ dayCases: number; rolled: boolean; medianSec: number; wouldChange: number }> {
  push(r, `── DAY ${day}`);

  const posts = await redis.zRange(POSTS_KEY, 0, -1, { by: "rank" });
  const sameDay = posts.filter((m) => dateOfMs(m.score) === day);
  push(r, `cases published on ${day}: ${sameDay.length} → ${sameDay.map((m) => `${m.member}@${new Date(m.score).toISOString().slice(11, 16)}Z`).join(" ")}`);

  const board = await redis.zRange(dayKey(day), 0, -1, { by: "rank" });
  const solvesRaw = await redis.hGetAll(solvesKey(day));
  const points = await redis.zRange(pointsKey(day), 0, -1, { by: "rank" });
  const applied = await redis.hGetAll(appliedKey(day));
  const dmeta = await redis.hGetAll(dayMetaKey(day));

  push(r, `lb:day:${day} n=${board.length} (member=username, score=timeSec) → ${zdump(board)}`);
  push(r, `lb:solves:${day} n=${Object.keys(solvesRaw).length} (t|hints|tier|postId) → ${hdump(solvesRaw)}`);
  push(r, `lb:points:${day} n=${points.length} → ${zdump(points)}`);
  push(r, `lb:applied:${day} n=${Object.keys(applied).length} → ${hdump(applied)}`);
  push(r, `lb:daymeta:${day} → ${hdump(dmeta)}`);

  // lb:points is "what the day was worth"; lb:applied is "what is already inside week/season/
  // all-time". They are written together and must agree member for member - a divergence means an
  // aggregate has drifted from the history it is supposed to be a sum of.
  for (const p of points) {
    const a = Number(applied[p.member] ?? NaN);
    if (!Number.isFinite(a) || a !== p.score) {
      alert(r, `${p.member}: lb:points=${p.score} but lb:applied=${fmt(applied[p.member])} on ${day}`);
    }
  }
  if (board.length !== Object.keys(solvesRaw).length) {
    alert(r, `lb:day has ${board.length} rows but lb:solves has ${Object.keys(solvesRaw).length} records on ${day}`);
  }

  // Which case each recorded result came from - the fact that shows a second case of the day
  // being scored or not. Records written before the postId field carry "".
  const recs = Object.entries(solvesRaw)
    .map(([u, v]) => decodeSolve(u, v))
    .filter((x): x is NonNullable<typeof x> => x !== null);
  if (sameDay.length > 1) {
    const byPost = new Map<string, number>();
    for (const rec of recs) byPost.set(rec.postId || "(pre-postId)", (byPost.get(rec.postId || "(pre-postId)") ?? 0) + 1);
    alert(r, `${sameDay.length} cases published on ${day}: a day holds ONE scored result per player` +
      ` (their fastest close). Day records by case → ${[...byPost].map(([k, v]) => `${k}:${v}`).join(" ")}`);
    for (const m of sameDay) {
      const n = await redis.zCard(lbKey(m.member));
      push(r, `  case ${m.member}: ${n} solver(s) on its own board`);
    }
  }

  // ── what the nightly rollup would do, recomputed here and now ────────────────────────────────
  // The rollup re-targets T on the day's median. Until it runs, T is the tier nominal and every
  // score on every board is provisional - so the honest way to report "has it run" is to show the
  // difference it would make, not just whether a key exists.
  const rolled = Boolean(dmeta.rolledAt);
  const plausible = recs.filter((x) => x.timeSec >= MIN_PLAUSIBLE_SEC).map((x) => x.timeSec);
  const med = median(plausible.length ? plausible : recs.map((x) => x.timeSec));
  let wouldChange = 0;
  for (const rec of recs) {
    const now = Number(applied[rec.username] ?? NaN);
    const after = pointsForSolve(rec.timeSec, rec.hints, targetFor(rec.tier as Tier, med));
    if (Number.isFinite(now) && now !== after) {
      wouldChange++;
      push(r, `  rollup would move ${rec.username}: ${now} → ${after} (t=${rec.timeSec}s, tier ${rec.tier},` +
        ` T ${targetFor(rec.tier as Tier, undefined)} → ${targetFor(rec.tier as Tier, med)})`);
    }
  }
  push(r, `rollup: rolledAt=${fmt(dmeta.rolledAt)} · median(plausible)=${med}s · ${wouldChange} score(s) would move`);
  if (!rolled && recs.length) {
    alert(r, `${day} has ${recs.length} solve(s) and has NEVER been rolled up: T is the tier nominal,` +
      ` not the day median (${med}s), and ${wouldChange} score(s) are mispriced`);
  }
  return { dayCases: sameDay.length, rolled, medianSec: med, wouldChange };
}

// ───────────────────────── 3. every board, with its size ─────────────────────────
async function auditBoards(r: Report, day: string): Promise<{ totals: Record<string, number> }> {
  push(r, `── BOARDS`);
  const keys: [string, string][] = [
    ["day", dayKey(day)],
    ["week", weekKey(day)],
    ["season", seasonKey(day)],
    ["alltime", ALLTIME_KEY],
    ["streakbest", STREAK_BEST_KEY],
    ["points", pointsKey(day)],
    ["index:days", INDEX_DAYS_KEY],
  ];
  const totals: Record<string, number> = {};
  for (const [label, key] of keys) {
    const rows = await redis.zRange(key, 0, -1, { by: "rank" });
    totals[label] = rows.length;
    push(r, `${label.padEnd(11)} ${key} n=${rows.length} → ${zdump(rows)}`);
  }
  // The eighth board is per-player, so it is printed inside the player section below.
  push(r, `days:{username}  lb:days:<player> — one per player, printed under PLAYERS`);
  push(r, `week=${isoWeek(day)} season=${seasonOf(day)} (both derived from the day, not the clock)`);
  return { totals };
}

// ───────────────────────── 4. aggregates vs. the history they sum ─────────────────────────
// `lb:alltime` is maintained by deltas (`applyPoints`), while `lb:days:{username}` records each
// day absolutely. They are two independent representations of the same fact, so comparing them is
// the one check that can catch an aggregate that has drifted - the "5250 all-time vs 1754 this
// week" question. `user:{username}` is a third, and must agree with both.
async function auditPlayers(r: Report, day: string): Promise<{ checked: number; drifted: number }> {
  push(r, `── PLAYERS (aggregate vs. per-day history)`);
  const all = await redis.zRange(ALLTIME_KEY, 0, -1, { by: "rank", reverse: true });
  const walked = all.slice(0, MAX_PROFILES);
  if (all.length > walked.length) push(r, `(${all.length} players on lb:alltime, checking the top ${walked.length})`);

  let drifted = 0;
  for (const row of walked) {
    const name = row.member;
    const days = await redis.zRange(daysKey(name), 0, -1, { by: "rank" });
    const sum = days.reduce((a, d) => a + d.score, 0);
    const prof = await redis.hGetAll(userKey(name));
    const week = await redis.zScore(weekKey(day), name);
    const streakBest = await redis.zScore(STREAK_BEST_KEY, name);
    const ok = sum === row.score && Number(prof.totalPoints ?? NaN) === row.score
      && days.length === Number(prof.solved ?? NaN);
    if (!ok) drifted++;

    // ── these two boards are keyed by DIFFERENT DAYS, and that is now by design ───────────────
    // `lb:days:{username}` is keyed by each case's publication date; the streak is keyed by the
    // calendar day the player came back (`visitDay()` in streak.ts). The whole point of separating
    // them is that they are allowed to diverge: keeping a run alive on a day the sub published
    // nothing means closing an ARCHIVE case, which files its points under that case's old date. So
    // `streakbest > longest consecutive run in lb:days` is no longer evidence of anything, and the
    // alert that used to fire on it has been withdrawn - it would now fire on correct behaviour.
    // The run is still printed, because it is the one number that shows the two date spaces apart;
    // the real check ran in auditCase(), where a userId reaches the days the streak is derived from.
    const run = longestRun(days.map((d) => d.member));

    push(r, `${ok ? "  " : "⚠ "}${name}: alltime=${row.score} sum(lb:days)=${sum}` +
      ` user.totalPoints=${fmt(prof.totalPoints)} · days recorded=${days.length} user.solved=${fmt(prof.solved)}` +
      ` · week(${isoWeek(day)})=${fmt(week)} streakbest=${fmt(streakBest)} longest run of case-dates=${run}` +
      ` · best=${fmt(prof.bestTimeSec)}s hintsTotal=${fmt(prof.hintsTotal)} firstSeen=${fmt(prof.firstSeen)}` +
      ` lastDate=${fmt(prof.lastDate)}`);
    push(r, `    lb:days:${name} → ${zdump(days, 10)}`);
  }
  if (drifted) {
    alert(r, `${drifted} player(s) whose all-time total does not equal the sum of their days` +
      ` (or whose solve count does not equal the days they have)`);
  }
  // `user.solved` counts DAYS with a recorded solve, not cases. Stated here because the two are
  // the same number on every day that published one case, and silently differ on any day that did not.
  push(r, `note: user.solved counts DAYS with a recorded solve, not cases closed`);
  push(r, `note: "longest run of case-dates" is NOT the streak. The streak counts calendar days the` +
    ` player came back (streak.ts); lb:days is keyed by each case's publication date. A run kept` +
    ` alive on a day with no new case files its points under an older date on purpose.`);
  return { checked: walked.length, drifted };
}

// ───────────────────────── 5. the series, and whether the cron is alive ─────────────────────────
async function auditSeries(r: Report, day: string): Promise<{ rolledDays: number; totalDays: number }> {
  push(r, `── SERIES / lt:*`);
  // Anything synthetic, named. The seeder itself is gone (the seed/unseed menu items were removed),
  // but rows it wrote may still exist, and each is marked twice over: the "[test]" prefix cannot be
  // a Reddit username, and `lt:seeded` lists every one - so a leftover on a real board can be
  // identified rather than suspected.
  const fake = (await redis.zRange("lt:seeded", 0, -1, { by: "rank" })).map((r) => r.member);
  push(r, fake.length
    ? `  ⚠ SEEDED TEST PLAYERS PRESENT (${fake.length}): ${fake.join(", ")}`
    : `  lt:seeded: none - every row on every board is a real person`);
  for (const k of ["lt:level", "lt:levelBase", "lt:lastPostId", "lt:lastPostDay", "bank:cursor"]) {
    push(r, `${k} = ${fmt(await redis.get(k))}`);
  }
  for (let lvl = 0; lvl < 4; lvl++) {
    const v = await redis.get(`lt:bucketCursor:${lvl}`);
    if (v !== undefined) push(r, `lt:bucketCursor:${lvl} = ${v}`);
  }
  const posts = await redis.zRange(POSTS_KEY, 0, -1, { by: "rank" });
  push(r, `lt:posts n=${posts.length} → ${posts.slice(-10).map((m) => `${m.member}@${dateOfMs(m.score)}`).join(" ")}`);
  const perDay = new Map<string, number>();
  for (const p of posts) perDay.set(dateOfMs(p.score), (perDay.get(dateOfMs(p.score)) ?? 0) + 1);
  const doubles = [...perDay].filter(([, n]) => n > 1);
  if (doubles.length) alert(r, `days with more than one case: ${doubles.map(([d, n]) => `${d}×${n}`).join(" ")}`);

  // ── did the nightly rollup ever actually fire? ───────────────────────────────────────────────
  // `runOnce` leaves `cron:once:lb-rollup:{YYYY-MM-DD}` behind for each window it claimed, and the
  // key is named after a date, so it can be probed without listing keys. Two independent proofs:
  // the lease keys, and `rolledAt` on each day that recorded solves.
  const days = (await redis.zRange(INDEX_DAYS_KEY, 0, -1, { by: "rank" })).map((m) => m.member);
  const recent = days.slice(-MAX_DAYS);
  let rolledDays = 0;
  for (const d of recent) {
    const meta = await redis.hGetAll(dayMetaKey(d));
    if (meta.rolledAt) rolledDays++;
    const lease = await redis.hGetAll(`cron:once:lb-rollup:${d}`);
    push(r, `  ${d}: solvers=${fmt(meta.solvers)} medianSec=${fmt(meta.medianSec)} rolledAt=${fmt(meta.rolledAt)}` +
      ` · cron lease ${Object.keys(lease).length ? hdump(lease) : "(none)"}`);
  }
  const todayLease = await redis.hGetAll(`cron:once:lb-rollup:${todayUtc()}`);
  push(r, `cron:once:lb-rollup:${todayUtc()} (today's window) → ${Object.keys(todayLease).length ? hdump(todayLease) : "(never claimed)"}`);
  const finished = recent.filter((d) => d < day);
  if (finished.length && rolledDays === 0) {
    alert(r, `${finished.length} finished day(s) recorded solves and NONE has been rolled up -` +
      ` the nightly recount has never run on this install`);
  }
  return { rolledDays, totalDays: days.length };
}

// ───────────────────────── 6. retention, measured rather than proxied ─────────────────────────
//
// plans/01-distribution.md §G wants day-1 and day-3 retention, and plans/assets/08-launch-calendar.md
// gates the featuring request on "rows on the streak board with value ≥ 3" because that was believed
// to be the only available proxy. It is not: `lb:day:{date}` is an explicit collection of the
// players who solved that day, and `lb:index:days` enumerates the days - so the intersection of two
// day boards is a real cohort measurement, computable today and correct retroactively for every day
// the leaderboard has ever recorded.
//
// The cohort is SOLVERS, not players. Retention among people who merely opened a case is not
// computable and never will be: the funnel counts opens, and nothing enumerates who did the opening
// (see `unreachable()`). Reporting the solver cohort under the plan's label without that sentence
// attached would be the same class of mistake this whole audit is about.
async function auditRetention(r: Report): Promise<{ d1: string; d3: string }> {
  push(r, `── RETENTION (cohort = players who SOLVED that day; openers are not enumerable)`);
  const days = (await redis.zRange(INDEX_DAYS_KEY, 0, -1, { by: "rank" })).map((m) => m.member);
  const recent = days.slice(-10);
  const members = new Map<string, Set<string>>();
  for (const d of recent) {
    members.set(d, new Set((await redis.zRange(dayKey(d), 0, -1, { by: "rank" })).map((m) => m.member)));
  }
  const shift = (d: string, n: number) =>
    new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
  const rate = (base: string, n: number): number | null => {
    const from = members.get(base), to = members.get(shift(base, n));
    if (!from || !to || from.size === 0) return null;
    return Math.round((100 * [...from].filter((u) => to.has(u)).length) / from.size);
  };
  let d1n = 0, d1s = 0, d3n = 0, d3s = 0;
  for (const d of recent) {
    const a = rate(d, 1), b = rate(d, 3);
    if (a !== null) { d1s += a; d1n++; }
    if (b !== null) { d3s += b; d3n++; }
    push(r, `  ${d}: ${members.get(d)?.size ?? 0} solver(s) · came back next day ${a === null ? "n/a" : `${a}%`}` +
      ` · came back on day+3 ${b === null ? "n/a" : `${b}%`}`);
  }
  const d1 = d1n ? `${Math.round(d1s / d1n)}%` : "n/a";
  const d3 = d3n ? `${Math.round(d3s / d3n)}%` : "n/a";
  push(r, `day-1 retention ${d1} (over ${d1n} day pair(s)) · day-3 retention ${d3} (over ${d3n})` +
    ` — targets in plans/01-distribution.md §G: >25% and >15%`);

  // The proxy the launch calendar gates on, printed beside the real number so the two can be
  // compared rather than confused.
  const streaks = await redis.zRange(STREAK_BEST_KEY, 0, -1, { by: "rank" });
  push(r, `lb:streakbest proxy — rows ≥2: ${streaks.filter((m) => m.score >= 2).length},` +
    ` rows ≥3: ${streaks.filter((m) => m.score >= 3).length} (featuring gate wants ≥5 rows at ≥3)`);
  return { d1, d3 };
}

// ───────────────────────── 7. what cannot be read back, and why ─────────────────────────
function unreachable(r: Report, playersOnCase: number): void {
  push(r, `── NOT REACHABLE (Devvit Redis has no KEYS/SCAN; only explicit collections can be walked)`);
  push(r, `tut:{userId}, onb:{userId}, onbSkip:{userId}, pract:{userId}:{k}, streak:{userId},` +
    ` streak:days:{userId} — keyed by userId with no index. Reachable only for the ${playersOnCase}` +
    ` userId(s) in stuck:{postId}, i.e. players who saved a board.`);
  push(r, `cases closed before streak.cases shipped — exact only from that build on. The postIds of` +
    ` cases published before lt:posts existed are gone, so the floor is user.solved (DAYS with a` +
    ` solve, ≤ cases), and a player who closed two cases on one pre-fix day counts as one.`);
  push(r, `the calendar days of pre-fix solves — only recoverable one case at a time, from` +
    ` att:.solvedAt, the first time that player reopens that case (streak.ts noteRecordedSolve).` +
    ` Nothing can walk every player's history in one pass, so there is no bulk migration.`);
  push(r, `att:{postId}:{userId} for openers who never autosaved — counted in stats.opened, then unreachable.` +
    ` The count is right; the rows behind it are gone.`);
  push(r, `flair:set:{username} — reachable only for names on lb:alltime.`);
  push(r, `lb:{postId} for posts older than the last ${60} in lt:posts — trimmed out of the registry.`);
  push(r, `feed impressions / CTR — never written, so there is no denominator for "opened / saw it".` +
    ` /api/preview is read-only by design; the safe shape would be hSetNX into one seen:{postId}` +
    ` hash (no att: row, no tut: consumption), and it would count from the day it ships, not before.`);
  push(r, `retention among people who only OPENED a case — the funnel counts opens but nothing` +
    ` enumerates who opened, so only the solver cohort above can ever be measured.`);
}

// The shape lives in src/server/hours.ts, which is also what the nightly rollup logs - one renderer,
// so the dump a moderator reads and the line I read out of `devvit logs` can never disagree.
async function auditHours(r: Report): Promise<void> {
  push(r, "── WHEN PLAYERS SHOW UP (hits:hours · first opens by UTC hour)");
  for (const line of await hoursLines()) push(r, `    ${line}`);
}

// ───────────────────────── the route ─────────────────────────
export const auditRouter = express.Router();

auditRouter.post("/internal/menu/audit", async (_req, res) => {
  const postId = context.postId ?? (await redis.get("lt:lastPostId"));
  if (!postId) {
    res.json({ showToast: "No case has been published yet - nothing to audit." });
    return;
  }
  const day = await currentDay();
  const r: Report = { lines: [], alerts: [] };

  const stamp = `${postId} · ${day}`;
  push(r, `════ DEDUCTO DB AUDIT · ${stamp} · generated ${new Date().toISOString()} ════`);

  const { players } = await auditCase(r, postId, day);
  const dayInfo = await auditDay(r, day);
  const boards = await auditBoards(r, day);
  const people = await auditPlayers(r, day);
  const series = await auditSeries(r, day);
  const ret = await auditRetention(r);
  await auditHours(r);
  unreachable(r, players.length);

  for (const line of r.lines) console.log(`[audit] ${line}`);

  // The toast is what a moderator reads standing up: the sizes that say whether the shape is
  // right, then every alert. Everything else is in `devvit logs`.
  const head = `${day}: day board ${boards.totals.day}, week ${boards.totals.week},` +
    ` all-time ${boards.totals.alltime}, streaks ${boards.totals.streakbest},` +
    ` ${dayInfo.dayCases} case(s) that day, ${players.length} att: rows on this case.` +
    ` Rolled up ${series.rolledDays}/${series.totalDays} days. Solver retention d1 ${ret.d1} / d3 ${ret.d3}.`;
  const tail = r.alerts.length
    ? ` ⚠ ${r.alerts.length}: ${r.alerts.slice(0, 3).join(" · ")}${r.alerts.length > 3 ? " · …" : ""}`
    : ` No inconsistency found (${people.checked} player total(s) match their day history).`;
  res.json({ showToast: `${head}${tail} Full dump in devvit logs.` });
});
