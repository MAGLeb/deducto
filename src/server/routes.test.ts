// Regression contract for the two bugs that only showed up live on v0.0.7.
// Drives the REAL express routes with @devvit/web/server swapped for a full redis stub.
//
//   npm run test:routes   (npx tsx --tsconfig src/server/testing/tsconfig.json \
//           src/server/routes.test.ts)
//
// What it pins, in one sentence each:
//   BUG 1  a solve lands on EVERY board, and lands on the same day the mod menu reads.
//   BUG 1  a solve already marked in att: but missing from the boards heals on the next check.
//   BUG 2  `opened` can never end up below `moved`, whatever order the endpoints are called in.
import {
  HASHES, STRINGS, ZSETS, AUTH, THROW_ON, SUBMITTED, context, resetRedis, FLAIRS, FLAIR_STATE, JOBS,
  CALLS, WRITE_OPS, SETTINGS, POST_STATE, MODMAIL, COMMENTS, THROW_ONCE, LISTED_POSTS,
} from "./testing/devvit-stub.js";
import {
  BANK, call, solvedGrid, nudgedGrid, blankGrid, wallGrid, firstOfTier, check, section, finish,
} from "./testing/harness.js";
import { readFileSync } from "node:fs";
import "./index.js";
import { isoWeek, shiftDay, todayUtc } from "./leaderboard.js";
import { rankState } from "./flair.js";
import { decodeSolve, pointsForSolve, pointsWithFreshness, targetFor } from "./leaderboard.js";
import { runsOfCases } from "./streak.js";

const POST = "t3_test";
const USER = "t2_user";
const NAME = "ma9leb";
const ATT = `att:${POST}:${USER}`;
const ENTRY = BANK[0];
const solved = solvedGrid(ENTRY);
const touched = nudgedGrid(ENTRY);

const post = (date: string) => { context.postData = { idx: 0, date, n: 41, level: 0 }; };
const z = (k: string) => ZSETS.get(k);
const stats = () => HASHES.get(`stats:${POST}`) ?? {};

/** Every board a completed solve is supposed to touch. */
function boardsFor(date: string): [string, string][] {
  return [
    ["day", `lb:day:${date}`],
    ["week", `lb:week:${isoWeek(date)}`],
    ["season", `lb:season:${date.slice(0, 7)}`],
    ["alltime", "lb:alltime"],
    ["streakbest", "lb:streakbest"],
    ["points", `lb:points:${date}`],
    ["days:{user}", `lb:days:${NAME}`],
    ["index:days", "lb:index:days"],
  ];
}

/** A full, honest play-through: open the case, move, solve. */
async function playThrough(seconds = 244) {
  await call("GET", "/api/daily");
  await call("POST", "/api/state", { grid: touched, seconds: 30 });
  // Backdate the timer so the anti-cheat wall clock does not clamp an instant test run to 1 s.
  HASHES.set(ATT, { ...HASHES.get(ATT)!, startedAt: String(Date.now() - seconds * 1000) });
  await call("POST", "/api/state", { grid: solved, seconds });
  return call("POST", "/api/check", { grid: solved, seconds });
}

// ─────────────────────────────────────────────────────────────────────────────
section("BUG 1 - a solve fills every board (post's day == server's day)");
resetRedis();
const sameDay = todayUtc();
post(sameDay);
let r = await playThrough();
check("check → solved", r.json?.status === "solved", JSON.stringify(r.json).slice(0, 120));
check("recorded time survives the wall clamp", r.json?.results?.timeSec === 244, String(r.json?.results?.timeSec));
for (const [label, key] of boardsFor(sameDay))
  check(`${label} board written (${key})`, (z(key)?.size ?? 0) === 1, JSON.stringify([...ZSETS.keys()]));
check("legacy per-post board still written (result card reads it)", z(`lb:${POST}`)?.get(NAME) === 244);
// The record gained a fifth field in track 13: whether the case was closed on its OWN day. It is
// what the freshness bonus is computed from, on every read and on every nightly recount.
check("lb:solves holds the raw t|hints|tier|postId|fresh",
  HASHES.get(`lb:solves:${sameDay}`)?.[NAME] === `244|0|${ENTRY.tier}|${POST}|1`,
  JSON.stringify(HASHES.get(`lb:solves:${sameDay}`)));

// ─────────────────────────────────────────────────────────────────────────────
section("BUG 1 - the post outlives its day: writer and reader still agree");
// The original failure: writeSolve used postData.date, the subreddit mod menu used the server's
// clock. A post published yesterday and solved today wrote lb:day:<yesterday> and the menu read
// lb:day:<today>. Both sides now resolve through currentDay().
resetRedis();
const postDay = "2026-08-07";
post(postDay);
STRINGS.set("lt:lastPostId", POST);
STRINGS.set("lt:lastPostDay", postDay);
ZSETS.set("lt:posts", new Map([[POST, Date.parse(`${postDay}T12:00:00Z`)]]));
await playThrough();
check("solve landed on the POST's day", (z(`lb:day:${postDay}`)?.size ?? 0) === 1, JSON.stringify([...ZSETS.keys()]));
check("and NOT on the server's day", !ZSETS.has(`lb:day:${todayUtc()}`));

context.postData = undefined;                 // ← the subreddit mod menu has no post context
let board = await call("GET", "/api/leaderboard?scope=today");
check("public board (no post context) resolves to the post's day",
  board.json?.period?.key === postDay && board.json?.total === 1,
  JSON.stringify({ key: board.json?.period?.key, total: board.json?.total }));

const funnel = await call("POST", "/internal/menu/funnel");
check("funnel reports the post's day and finds the board row",
  String(funnel.json?.showToast).includes(postDay)
  && /This case: 1 board rows for 1 solves, matches/.test(String(funnel.json?.showToast)),
  String(funnel.json?.showToast));

// ─────────────────────────────────────────────────────────────────────────────
section("BUG 1 - a solve that never reached the boards heals on the next check");
// att:.solved is set BEFORE the boards are written. Anything in between - a thrown redis call, a
// deploy, a build that predates the leaderboard - used to leave a permanent hole, because the
// "already solved" branch returned early and never wrote anything again.
resetRedis();
post(sameDay);
HASHES.set(ATT, { startedAt: "1", solved: "1", timeSec: "244", hints: "0", solveOrder: "1", grid: JSON.stringify(solved) });
ZSETS.set(`lb:${POST}`, new Map([[NAME, 244]]));
STRINGS.set(`solvedCount:${POST}`, "1");
// The streak is recorded before writeSolve() and has existed since the first commit, so a solve
// recorded by any past build left this behind. The streak BOARD is mirrored from it.
HASHES.set(`streak:${USER}`, { current: "3", best: "5", lastDate: sameDay });
r = await call("POST", "/api/check", { grid: solved, seconds: 244 });
check("replayed check still returns the result card", r.json?.status === "solved");
check("card keeps the ORIGINAL time (a replay never re-times a solve)", r.json?.results?.timeSec === 244);
for (const [label, key] of boardsFor(sameDay))
  check(`${label} board repaired on replay`, (z(key)?.size ?? 0) === 1, JSON.stringify([...ZSETS.keys()]));
check("solve order was not re-issued", STRINGS.get(`solvedCount:${POST}`) === "1", STRINGS.get(`solvedCount:${POST}`));
check("a replay does not re-run the streak (it would reset a live streak to 1)",
  JSON.stringify(HASHES.get(`streak:${USER}`)) === JSON.stringify({ current: "3", best: "5", lastDate: sameDay }),
  JSON.stringify(HASHES.get(`streak:${USER}`)));
check("streak board mirrors streak.best, not streak.current", z("lb:streakbest")?.get(NAME) === 5,
  String(z("lb:streakbest")?.get(NAME)));
check("the repair claims the solve record exactly once", HASHES.get(`user:${NAME}`)?.solved === "1",
  JSON.stringify(HASHES.get(`user:${NAME}`)));

// running it again must change nothing: hSetNX already lost the claim, applyPoints deltas to 0
const pointsBefore = z("lb:alltime")?.get(NAME);
await call("POST", "/api/check", { grid: solved, seconds: 244 });
check("repairing twice is a no-op (points are not doubled)", z("lb:alltime")?.get(NAME) === pointsBefore,
  `${pointsBefore} → ${z("lb:alltime")?.get(NAME)}`);
check("…and the profile counter is not incremented twice", HASHES.get(`user:${NAME}`)?.solved === "1",
  JSON.stringify(HASHES.get(`user:${NAME}`)));

// ─────────────────────────────────────────────────────────────────────────────
section("BUG 1 - a mid-writeSolve failure is recoverable, not permanent");
resetRedis();
post(sameDay);
await call("GET", "/api/daily");
await call("POST", "/api/state", { grid: solved, seconds: 200 });
HASHES.set(ATT, { ...HASHES.get(ATT)!, startedAt: String(Date.now() - 244_000) });
THROW_ON.set("zScore lb:index:days", "simulated redis failure");
let threw = false;
try { await call("POST", "/api/check", { grid: solved, seconds: 244 }); } catch { threw = true; }
THROW_ON.clear();
check("the failing check does fail (nothing is swallowed)", threw);
check("…leaving att: marked solved", HASHES.get(ATT)?.solved === "1");
check("…and the week board empty", !ZSETS.has(`lb:week:${isoWeek(sameDay)}`), JSON.stringify([...ZSETS.keys()]));
r = await call("POST", "/api/check", { grid: solved, seconds: 244 });
check("the very next check repairs it", (z(`lb:week:${isoWeek(sameDay)}`)?.size ?? 0) === 1
  && (z(`lb:day:${sameDay}`)?.size ?? 0) === 1, JSON.stringify([...ZSETS.keys()]));

// ─────────────────────────────────────────────────────────────────────────────
section("BUG 1 - reconciling must not undo the nightly rollup");
// writeSolve now runs on replays too, so it has to score against the day's ROLLED target. Against
// the tier nominal it would quietly re-price every player who reopens a rolled-up post.
resetRedis();
post(sameDay);
await playThrough(600);                                    // slow solve, well off the nominal target
const beforeRollup = z("lb:alltime")?.get(NAME);
const report = await call("POST", "/internal/cron/rollup", { date: sameDay });
const afterRollup = z("lb:alltime")?.get(NAME);
check("the rollup re-priced the day", afterRollup !== beforeRollup,
  `${beforeRollup} → ${afterRollup} ${JSON.stringify(report.json?.reports?.[0])}`);
await call("POST", "/api/check", { grid: solved, seconds: 600 });
check("a replayed check keeps the rolled-up score", z("lb:alltime")?.get(NAME) === afterRollup,
  `${afterRollup} → ${z("lb:alltime")?.get(NAME)}`);

// ─────────────────────────────────────────────────────────────────────────────
section("BUG 1 - guards that must still refuse to write");
resetRedis();
post(sameDay);
AUTH.username = null;
await call("GET", "/api/daily");
r = await call("POST", "/api/check", { grid: solved, seconds: 244 });
check("no resolvable username → still 'solved', no board rows",
  r.json?.status === "solved" && ![...ZSETS.keys()].some((k) => k.startsWith("lb:day")),
  JSON.stringify([...ZSETS.keys()]));
check("and no raw t2_… leaked into a public table",
  ![...ZSETS.values()].some((m) => [...m.keys()].some((k) => k.startsWith("t2_"))));
AUTH.username = NAME;

// ─────────────────────────────────────────────────────────────────────────────
section("BUG 2 - `opened` cannot fall below `moved`, in any call order");
const orders: [string, () => Promise<unknown>][] = [
  ["daily → state", async () => { await call("GET", "/api/daily"); await call("POST", "/api/state", { grid: touched, seconds: 5 }); }],
  ["state → daily", async () => { await call("POST", "/api/state", { grid: touched, seconds: 5 }); await call("GET", "/api/daily"); }],
  ["hint → state", async () => { await call("POST", "/api/hint", { grid: touched, step: 1 }); await call("POST", "/api/state", { grid: touched, seconds: 5 }); }],
  ["state only (no /api/daily at all)", async () => { await call("POST", "/api/state", { grid: touched, seconds: 5 }); }],
];
for (const [label, run] of orders) {
  resetRedis();
  post(sameDay);
  await run();
  const s = stats();
  check(`${label}: opened ${s.opened ?? 0} >= moved ${s.firstMove ?? 0}`,
    Number(s.opened ?? 0) >= Number(s.firstMove ?? 0) && Number(s.opened ?? 0) === 1, JSON.stringify(s));
  check(`${label}: startedAt stamped by whoever got there first`, Boolean(HASHES.get(ATT)?.startedAt));
}

section("BUG 2 - a legacy att: row (startedAt, no funnel flags) repairs itself");
resetRedis();
post(sameDay);
HASHES.set(ATT, { startedAt: String(Date.now() - 600_000), grid: JSON.stringify(touched) });
await call("GET", "/api/daily");
check("opened counted for a row stamped by an older build", stats().opened === "1", JSON.stringify(stats()));
await call("GET", "/api/daily");
check("…and only once, however often the post is reopened", stats().opened === "1", JSON.stringify(stats()));

section("BUG 2 - /api/daily hands a board created by the autosave back to the player");
resetRedis();
post(sameDay);
await call("POST", "/api/state", { grid: touched, seconds: 5 });   // row exists, no startedAt yet
r = await call("GET", "/api/daily");
check("the saved grid is restored, not discarded", r.json?.attempt?.grid !== null, JSON.stringify(r.json?.attempt).slice(0, 120));

section("BUG 2 - the funnel readout is a sentence, and it audits itself");
resetRedis();
post(sameDay);
STRINGS.set("lt:lastPostId", POST);
STRINGS.set("lt:lastPostDay", sameDay);
await playThrough();
let f = await call("POST", "/internal/menu/funnel");
let toast = String(f.json?.showToast);
console.log(`      ${toast}`);
check("says how many opened / played / solved in words", /1 opened it, 1 marked something/.test(toast), toast);
check("no undecodable histogram fragment survives", !/best cells|0:0 1-2:0/.test(toast), toast);
check("confirms the board matches the solve count", /This case: 1 board rows for 1 solves, matches\./.test(toast), toast);

// FINDING B: the percentage on screen was `solved / opened`, while the target everyone tracks
// (plans/01-distribution.md §G, "> 55%") is `solved / firstMove`. Two different fractions under
// one unnamed "%", which plans/assets/08-launch-calendar.md had to warn readers about in prose.
// The toast now names the tracked one and states the denominator of each.
check("the solve rate is named, with its denominator spelled out",
  /Solve rate 100% \(1\/1 of everyone who moved\); 100% of everyone who opened/.test(toast), toast);

// the audit line has to actually fire when the boards and the solve count disagree
ZSETS.delete(`lb:${POST}`);
f = await call("POST", "/internal/menu/funnel");
toast = String(f.json?.showToast);
console.log(`      ${toast}`);
check("⚠ when a solve never reached the case board", /⚠ This case has 0 board rows for 1 solves - 1 solve\(s\) never reached the board/.test(toast), toast);

// ─────────────────────────────────────────────────────────────────────────────
// BUG 3: `lt:level` is written once and read forever, so DEFAULT_LEVEL only ever reaches an install
// that has never published. When the default moved 🟡→🟢 the live sub kept publishing 🟡 - and the
// vote ramp could not undo it (VOTE_MIN_TOTAL = 5, one player). This whole section is the regression
// that would have caught it: it drives the real menu action and reads the tier off the case that
// was actually submitted, not off a constant.
section("BUG 3 - a stale lt:level must not outlive a change of DEFAULT_LEVEL");
const tierOfLastPost = () => BANK[(SUBMITTED[SUBMITTED.length - 1].postData as { idx: number }).idx].tier;
const titleOfLastPost = () => SUBMITTED[SUBMITTED.length - 1].title;

resetRedis();
context.postData = undefined;                    // the subreddit mod menu has no post context
let menu = await call("POST", "/internal/menu/create-post");
check("a fresh install publishes the default tier", tierOfLastPost() === "green", tierOfLastPost());
check("…and the toast names the tier it published", /green · level 0 \(the default\)/.test(String(menu.json?.showToast)),
  String(menu.json?.showToast));

resetRedis();
context.postData = undefined;
STRINGS.set("lt:level", "1");                    // ← exactly what the live sub carries: written by a
STRINGS.set("bank:cursor", "17");                //   build whose DEFAULT_LEVEL was 1, no stamp
await call("POST", "/internal/menu/create-post");
check("a legacy install adopts the new default", tierOfLastPost() === "green", tierOfLastPost());
check("…so the title loses the 'hard mode' tail", !/hard mode/.test(titleOfLastPost()), titleOfLastPost());
check("…and the case number keeps counting (bank:cursor is NOT reset)", /Case #18 /.test(titleOfLastPost()), titleOfLastPost());
check("…and the level is stamped with the default it descends from",
  STRINGS.get("lt:level") === "0" && STRINGS.get("lt:levelBase") === "0",
  `${STRINGS.get("lt:level")}/${STRINGS.get("lt:levelBase")}`);

// The migration is a re-baseline, not a lock: the sub can still vote itself back up, and the vote
// must survive every later publish. This is the half that a "just delete the key" fix cannot have.
HASHES.set(`vote:${STRINGS.get("lt:lastPostId")}`, { Harder: "5" });
await call("POST", "/internal/menu/create-post");
check("a sub that votes Harder still gets 🟡", tierOfLastPost() === "yellow", tierOfLastPost());
check("…and the title says so", /hard mode/.test(titleOfLastPost()), titleOfLastPost());
await call("POST", "/internal/menu/create-post");   // no votes on the previous post this time
check("…and the vote is not re-baselined away on the next publish", tierOfLastPost() === "yellow", tierOfLastPost());
check("the stamp records the default, the value records the vote",
  STRINGS.get("lt:level") === "1" && STRINGS.get("lt:levelBase") === "0",
  `${STRINGS.get("lt:level")}/${STRINGS.get("lt:levelBase")}`);

// ─────────────────────────────────────────────────────────────────────────────
// BUG 4: on 🟡 the board runs out of forced moves long before the case is solved. Both free rungs
// ran the same WEAK model, so from that wall on they returned the same {kind:"stuck"} - two buttons,
// one sentence, and pressing either one changed nothing on screen.
section("BUG 4 - the two free hint rungs must differ on a 🟡 board with no forced move left");
resetRedis();
const yellowIdx = firstOfTier("yellow");
const yellowCase = BANK[yellowIdx];
context.postData = { idx: yellowIdx, date: sameDay, n: 42, level: 1 };
const wall = wallGrid(yellowCase);

const r1 = await call("POST", "/api/hint", { grid: wall, step: 1 });
const a1 = r1.json?.advice;
check("rung 1 does not go silent on the wall", a1?.kind === "cross", JSON.stringify(a1));
check("rung 1 names the clues to read together", Array.isArray(a1?.clues) && a1.clues.length >= 1
  && a1.clues.every((c: number) => c >= 1 && c <= yellowCase.clues.length), JSON.stringify(a1));
check("rung 1 does NOT name the cell (that is what rung 2 is for)",
  a1?.cat === undefined && a1?.suspect === undefined && a1?.value === undefined, JSON.stringify(a1));

const r2 = await call("POST", "/api/hint", { grid: wall, step: 2 });
const a2 = r2.json?.advice;
check("rung 2 names the chip to cross out",
  a2?.kind === "cross" && !!a2.cat && !!a2.suspect && !!a2.value, JSON.stringify(a2));
check("…on the same clues rung 1 pointed at", JSON.stringify(a2?.clues) === JSON.stringify(a1?.clues),
  `${JSON.stringify(a1?.clues)} vs ${JSON.stringify(a2?.clues)}`);
check("…a chip that is still standing on that board", wall[a2.cat][a2.suspect][a2.value] === 0);
check("…and never the true answer", yellowCase.solution[a2.suspect][a2.cat] !== a2.value,
  `${a2?.suspect}/${a2?.cat}/${a2?.value}`);
check("the two free rungs are no longer the same answer", JSON.stringify(a1) !== JSON.stringify(a2));
check("both rungs are free (no hint charged)", r1.json?.hints === 0 && r2.json?.hints === 0,
  `${r1.json?.hints}/${r2.json?.hints}`);
check("and both are counted in the funnel", stats().hintStep1 === "1" && stats().hintStep2 === "1",
  JSON.stringify(stats()));
console.log(`      rung 1: clues ${a1?.clues?.join(" + ")}${a1?.via ? ` via ${a1.viaCat}:${a1.via}` : ""}` +
  ` · rung 2: cross out ${a2?.value} for ${a2?.suspect} (${a2?.cat})`);

// A board with a forced move on it must still get the cheap answer - "cross" is the wall's rung,
// not a replacement for the one the board itself can show.
const r3 = await call("POST", "/api/hint", { grid: blankGrid(yellowCase), step: 2 });
check("a fresh 🟡 board still gets the plain board-visible move", r3.json?.advice?.kind === "move",
  JSON.stringify(r3.json?.advice));

// Same disease, third key: `pract:{userId}:{k}` is numbered by the warm-up counter, and which case
// slot k holds moved when the pool did (it was the constant #78 for every k). Slot 0 even keeps the
// board SHAPE (#78 and #120 are both pizza), so the client's own check cannot catch it.
section("BUG 3b - a practice board saved against another case is not handed back");
resetRedis();
context.postData = undefined;
const legacyIdx = 78;                                       // the case slot 0 used to hold
const stale = solvedGrid(BANK[legacyIdx]);
HASHES.set(`pract:${USER}:0`, { startedAt: "1", grid: JSON.stringify(stale) });
let pract = await call("GET", "/api/practice");
check("the stale board is dropped, not restored", pract.json?.grid === null, JSON.stringify(pract.json?.grid).slice(0, 80));
check("…and the slot now says which case it holds", HASHES.get(`pract:${USER}:0`)?.idx === String(pract.json?.puzzle?.idx),
  JSON.stringify(HASHES.get(`pract:${USER}:0`)));
const mine = nudgedGrid(BANK[pract.json.puzzle.idx]);
await call("POST", "/api/practice/state", { grid: mine });
pract = await call("GET", "/api/practice");
check("a board saved against THIS case comes back", JSON.stringify(pract.json?.grid) === JSON.stringify(mine));

// The standings live inside the game now (GET /api/leaderboard, open to every player), so both

// ─────────────────────────────────────────────────────────────────────────────
section("Rank flair - written on every solve, so it can never freeze");
// The flair is the game's ladder printed next to a name in the subreddit. Two things have to hold
// forever: it must follow a player UP the ladder (a write-once implementation is a stale badge
// within a fortnight), and it must never be able to cost someone the solve that earned it.
resetRedis();
post(sameDay);
HASHES.set(`streak:${USER}`, { current: "3", best: "3", lastDate: "2000-01-01" });
await playThrough();
check("a solve queues the flair job (app context, not the player's)",
  JOBS.some((j) => j.name === "user-flair"), JSON.stringify(JOBS.map((j) => j.name)));
check("Inspector at a best streak of 3+", FLAIRS.at(-1)?.text === "🕵️ Inspector", JSON.stringify(FLAIRS.at(-1)));
check("css class keyed on the ladder's own threshold", FLAIRS.at(-1)?.cssClass === "rank-3", JSON.stringify(FLAIRS.at(-1)));

// This is the assertion that pins "never static": a write-once implementation passes everything
// above and fails right here.
FLAIRS.length = 0;
HASHES.set(`streak:${USER}`, { current: "3", best: "30", lastDate: "2000-01-01" });
HASHES.delete(ATT); STRINGS.delete(`solvedCount:${POST}`);
await playThrough();
check("the rank follows the player UP the ladder on a later solve",
  FLAIRS.at(-1)?.text === "🏛 Legend of the Yard", JSON.stringify(FLAIRS.at(-1)));

FLAIRS.length = 0;
HASHES.delete(ATT); STRINGS.delete(`solvedCount:${POST}`);
await playThrough();
check("an unchanged rank is not rewritten every day", FLAIRS.length === 0, JSON.stringify(FLAIRS));

section("Rank flair - the ways it must decline to act");
resetRedis();
post(sameDay);
FLAIR_STATE.current.set("deducto_puzzle_dev|ma9leb", { flairCssClass: "rank-off" });
HASHES.set(`streak:${USER}`, { current: "3", best: "30", lastDate: "2000-01-01" });
await playThrough();
check("a player who opted out is never flaired again", FLAIRS.length === 0, JSON.stringify(FLAIRS));

resetRedis();
post(sameDay);
FLAIR_STATE.templates = [];                    // user flair switched off in the subreddit
HASHES.set(`streak:${USER}`, { current: "1", best: "1", lastDate: "2000-01-01" });
await playThrough();
check("no templates configured -> nothing is written", FLAIRS.length === 0, JSON.stringify(FLAIRS));

resetRedis();
post(sameDay);
THROW_ON.set("setUserFlair ma9leb", "reddit is having a day");
r = await playThrough();
check("a flair that throws still leaves the player solved", r.json?.status === "solved", JSON.stringify(r.json).slice(0, 120));
check("...and every board is intact", (z(`lb:day:${sameDay}`)?.size ?? 0) === 1, JSON.stringify([...ZSETS.keys()]));

// mod-menu ways of *reading* a board are gone, and so is the standalone weekly post that was a
// third surface for the same numbers. Two menu items remain: publish a case, and read the funnel.
section("Mod menu - the retired endpoints are gone");
for (const dead of ["/internal/menu/leaderboard", "/internal/menu/leaderboard-post"]) {
  const r = await call("POST", dead);
  check(`${dead} no longer routes`, r.status === 404, JSON.stringify(r));
}
const deadBoard = await call("GET", "/api/board");
check("/api/board no longer routes", deadBoard.status === 404, JSON.stringify(deadBoard));

// ═════════════════════════════════════════════════════════════════════════════
// FINDING A - "scores settle overnight" was printed under every board on every result card, and
// the settling had never run once: /internal/cron/rollup existed in the code and was not registered
// in devvit.json, whose only task was the one-off user-flair job. So T in the scoring formula was
// the tier nominal forever, lb:daymeta.medianSec and rolledAt were never written on any day this
// game has ever played, and the sentence was simply false.
//
// The regression is written in the direction that catches it: a board that PROMISES a nightly
// settling has to have a registered mechanism that settles it. It reads devvit.json - the real one,
// the file that ships - rather than asserting against a constant that could drift from it.
section("FINDING A - a period promised closure must actually get closed");

type CronTask = { name: string; endpoint: string; cron?: string };
const CFG = JSON.parse(readFileSync("devvit.json", "utf8")) as {
  scheduler?: { tasks?: Record<string, string | { endpoint: string; cron?: string }> };
};
const CRONS: CronTask[] = Object.entries(CFG.scheduler?.tasks ?? {})
  .map(([name, t]) => (typeof t === "string" ? { name, endpoint: t } : { name, ...t }))
  .filter((t) => Boolean(t.cron));

resetRedis();
post(sameDay);
const promising: string[] = [];
for (const scope of ["today", "week", "season", "alltime", "streak"]) {
  const v = await call("GET", `/api/leaderboard?scope=${scope}`);
  if (v.json?.provisional) promising.push(scope);
}
check(`boards that print "scores settle overnight" (${promising.join(", ") || "none"}) have a cron registered to settle them`,
  promising.length === 0 || CRONS.some((t) => t.endpoint === "/internal/cron/rollup"),
  JSON.stringify(CRONS));
// The day board is ranked by raw seconds. A recorded second cannot be re-priced by anything, so it
// must not carry the promise at all - it was the one board every player actually reads.
const todayView = await call("GET", "/api/leaderboard?scope=today");
check("the time-ranked day board no longer promises a settling that cannot touch it",
  todayView.json?.provisional === false, JSON.stringify(todayView.json?.provisional));

// A registered endpoint that does not route is the same bug with a different spelling.
for (const t of CRONS) {
  const hit = await call("POST", t.endpoint, {});
  check(`devvit.json cron "${t.name}" → ${t.endpoint} actually routes`, hit.status === 200, JSON.stringify(hit).slice(0, 120));
}

// …and it has to do the job, not merely answer: a finished day gets a median, a rolledAt, and a
// re-priced score. 600 s on a 🟢 case is far off the nominal target of 240 s, so re-targeting T on
// the day's own median has to move the number.
resetRedis();
const rollDay = "2026-08-07";
post(rollDay);
await playThrough(600);
const beforeCron = z("lb:alltime")?.get(NAME);
context.postData = undefined;                       // the scheduler runs outside any post
STRINGS.set("lt:lastPostDay", "2026-08-08");         // the sub has moved on: rollDay is finished
const cronRes = await call("POST", "/internal/cron/rollup", {});
check("the registered cron rolls the finished day", cronRes.json?.status === "ok", JSON.stringify(cronRes.json));
check("…lb:daymeta now carries a median and a rolledAt",
  Boolean(HASHES.get(`lb:daymeta:${rollDay}`)?.medianSec) && Boolean(HASHES.get(`lb:daymeta:${rollDay}`)?.rolledAt),
  JSON.stringify(HASHES.get(`lb:daymeta:${rollDay}`)));
check("…and T stopped being the tier nominal: the score actually moved",
  z("lb:alltime")?.get(NAME) !== beforeCron, `${beforeCron} → ${z("lb:alltime")?.get(NAME)}`);
const rolledOnce = z("lb:alltime")?.get(NAME);
await call("POST", "/internal/cron/rollup", {});
check("…and a second night changes nothing (the lease holds, the deltas are 0)",
  z("lb:alltime")?.get(NAME) === rolledOnce, `${rolledOnce} → ${z("lb:alltime")?.get(NAME)}`);

// ═════════════════════════════════════════════════════════════════════════════
// FINDING D - one word "streak" meant two different numbers on one screen: the plaque printed
// streak.current (3) while the STREAK board beside it printed streak.best (4). Worse, the in-game
// rank came from `current` and the subreddit flair from `best`, so a player could hold two titles
// at once. One ladder now, read off `best`, by the same function the flair uses.
section("FINDING D - one ladder: the rank in the game IS the rank in the flair");
resetRedis();
post(sameDay);
context.postId = POST;
// `current` is derived from the chain now, not stored, so the fixture states the CHAIN: two cases
// already closed live, and today's about to be. `best: 4` is the floor a longer past run left.
{
  const posts = new Map<string, number>([
    ["t3_d1", Date.parse(`${shiftDay(sameDay, -2)}T10:00:00Z`)],
    ["t3_d2", Date.parse(`${shiftDay(sameDay, -1)}T10:00:00Z`)],
    [POST, Date.parse(`${sameDay}T10:00:00Z`)],
  ]);
  ZSETS.set("lt:posts", posts);
  STRINGS.set("lt:lastPostId", POST);
  STRINGS.set("lt:lastPostDay", sameDay);
  ZSETS.set(`streak:cases:${USER}`, new Map([
    ["t3_d1", posts.get("t3_d1")!], ["t3_d2", posts.get("t3_d2")!],
  ]));
}
HASHES.set(`streak:${USER}`, { current: "2", best: "4", lastDate: sameDay, lastFreshPost: "t3_d2" });
r = await playThrough();
let rs = r.json?.results;
check("the plaque number and the STREAK board are now the same number",
  rs?.streak === z("lb:streakbest")?.get(NAME) && rs?.streak === 4,
  `${rs?.streak} vs ${z("lb:streakbest")?.get(NAME)}`);
check("…and the run in progress is still reported, under its own name", rs?.streakCurrent === 3, JSON.stringify(rs?.streakCurrent));
check("the rank in the game is character-for-character the flair in the sub",
  rs?.rankState?.label === FLAIRS.at(-1)?.text && rs?.rankState?.cssClass === FLAIRS.at(-1)?.cssClass,
  `${rs?.rankState?.label} vs ${FLAIRS.at(-1)?.text}`);
check("days to the next rank count the LIVE run, because only a live run can set a new best",
  rs?.rankState?.nextIn === 7 - 3, JSON.stringify(rs?.rankState));

// The case the old code got publicly wrong: one missed day dropped `current` to 1, so the game
// demoted a player the flair had promised never to demote.
resetRedis();
post(sameDay);
FLAIRS.length = 0;
HASHES.set(`streak:${USER}`, { current: "1", best: "7", lastDate: sameDay });
r = await playThrough();
rs = r.json?.results;
check("a broken streak no longer demotes the player inside the game either",
  rs?.rankState?.label === "🎩 Chief Inspector" && FLAIRS.at(-1)?.text === "🎩 Chief Inspector",
  `game ${rs?.rankState?.label} / flair ${FLAIRS.at(-1)?.text}`);
check("…while the ladder still asks for the days the live run needs, not the days `best` needs",
  rs?.rankState?.nextIn === 14 - 1, JSON.stringify(rs?.rankState));
check("a player who has never solved holds no rank at all (never 'Detective' by default)",
  rankState(0, 0).label === null && rankState(0, 0).cssClass === null, JSON.stringify(rankState(0, 0)));
// ═════════════════════════════════════════════════════════════════════════════
// STREAK - the unit is CASES, not days (owner, 2026-08-17).
//
// "надо решить каждый день по кейсу. не просто зайти. не просто подряд решить старые кейсы".
// The bank holds 160 archive cases, so one old case a day was a hundred days of "streak" without
// ever opening a daily. Counting calendar days could not tell that apart from real attendance.
//
// A streak is now: PUBLISHED CASES IN A ROW closed on the day the case ran. These are the scenarios
// that definition has to survive.
section("STREAK - the unit is CASES closed while they were live");

// The rule itself, before any wiring: a chain is the unbroken TAIL of the feed.
{
  const feed = ["a", "b", "c", "d", "e"];
  const r1 = runsOfCases(feed, new Set(["c", "d", "e"]), new Set());
  check("the run is the unbroken tail, not the total closed", r1.run === 3, JSON.stringify(r1));
  const r2 = runsOfCases(feed, new Set(["a", "b", "d", "e"]), new Set());
  check("…a missed case in the middle ends the earlier run", r2.run === 2 && r2.best === 2,
    JSON.stringify(r2));
  const r3 = runsOfCases(feed, new Set(["a", "b", "c"]), new Set());
  check("…and missing the newest cases ends the run at zero", r3.run === 0 && r3.best === 3,
    JSON.stringify(r3));
  // Pending is a SET: every case published today, not just the newest one.
  const r4 = runsOfCases(feed, new Set(["c", "d"]), new Set(["e"]));
  check("a case still out today is pending, so it does not break the run", r4.run === 2,
    JSON.stringify(r4));
  const r5 = runsOfCases(feed, new Set(["c", "d", "e"]), new Set(["e"]));
  check("…and closing it extends the run instead", r5.run === 3, JSON.stringify(r5));
  // TWO cases on one day. The first of them is NOT decided while its own day is still running, so a
  // player who closed only the later one keeps the run they already had. This is the case the
  // single-id version got wrong: it walked the morning case as missed and reset the run to 1.
  const r6 = runsOfCases([...feed, "f"], new Set(["c", "d", "f"]), new Set(["e", "f"]));
  check("the FIRST case of a two-case day cannot be missed while its day is still running",
    r6.run === 3, JSON.stringify(r6));
  const r7 = runsOfCases([...feed, "f"], new Set(["c", "d", "e", "f"]), new Set(["e", "f"]));
  check("…and closing both of them is worth two links, not one", r7.run === 4, JSON.stringify(r7));
  check("an empty feed is a run of zero, not a crash",
    runsOfCases([], new Set(), new Set()).run === 0, "");
}

const TODAY = todayUtc();
const YESTERDAY = shiftDay(TODAY, -1);
const SK = () => HASHES.get(`streak:${USER}`) ?? {};
const CHAIN = () => [...(ZSETS.get(`streak:cases:${USER}`) ?? new Map()).keys()];

/** Publish a case into the registry, which is the feed the chain is walked along. */
function publish(postId: string, date: string) {
  const posts = ZSETS.get("lt:posts") ?? new Map<string, number>();
  posts.set(postId, Date.parse(`${date}T10:00:00Z`));
  ZSETS.set("lt:posts", posts);
  STRINGS.set("lt:lastPostId", postId);
  STRINGS.set("lt:lastPostDay", date);
}

async function closeCase(postId: string, date: string, n: number, seconds = 244) {
  context.postId = postId;
  context.postData = { idx: 0, date, n, level: 0 };
  const k = `att:${postId}:${USER}`;
  await call("GET", "/api/daily");
  await call("POST", "/api/state", { grid: touched, seconds: 30 });
  HASHES.set(k, { ...HASHES.get(k)!, startedAt: String(Date.now() - seconds * 1000) });
  return call("POST", "/api/check", { grid: solved, seconds });
}

// ── 1. THE HOLE THE OWNER FOUND: the archive cannot build a streak ────────────────────────────
resetRedis();
const ARCH = ["2026-08-03", "2026-08-05", "2026-08-06", "2026-08-08", "2026-08-10", "2026-08-11"];
ARCH.forEach((d, i) => publish(`t3_arch${i}`, d));
STRINGS.set("lt:lastPostId", `t3_arch${ARCH.length - 1}`);
STRINGS.set("lt:lastPostDay", ARCH[ARCH.length - 1]);
let walkRes;
for (let i = 0; i < ARCH.length; i++) walkRes = await closeCase(`t3_arch${i}`, ARCH[i], i + 1);
check("closing six archive cases in one sitting builds NO streak",
  walkRes?.json?.results?.streakCurrent === 0, JSON.stringify(SK()));
check("…because not one of them was closed on the day it ran", CHAIN().length === 0, JSON.stringify(CHAIN()));
check("…while every one of them still counts as a case closed", SK().cases === "6", JSON.stringify(SK()));
for (const d of ARCH) {
  check(`…and each still scores on its own day (lb:day:${d})`, (z(`lb:day:${d}`)?.size ?? 0) === 1, "");
}

// ── 2. cases closed live, in a row, ARE the streak ────────────────────────────────────────────
resetRedis();
const LIVE = [shiftDay(TODAY, -2), YESTERDAY, TODAY];
let liveRes;
for (let i = 0; i < LIVE.length; i++) {
  publish(`t3_live${i}`, LIVE[i]);
  // Each is closed on its own day: the harness's clock is today, so only the last is truly "live".
  // The chain is what the RECORD says, so the record is written as the real path would write it.
  liveRes = await closeCase(`t3_live${i}`, LIVE[i], i + 1);
}
check("the newest case, closed on its own day, is a link in the chain",
  CHAIN().includes("t3_live2"), JSON.stringify(CHAIN()));
check("…and the two closed on days already gone are not",
  !CHAIN().includes("t3_live0") && !CHAIN().includes("t3_live1"), JSON.stringify(CHAIN()));
check("…so the run is exactly the unbroken tail", liveRes?.json?.results?.streakCurrent === 1,
  JSON.stringify(SK()));

// ── 3. a hole in the FEED still cannot break a run ────────────────────────────────────────────
// The sub published nothing on some days. There is no case to have missed, so the chain neither
// advances nor breaks - the player is still never punished for what they do not control.
resetRedis();
publish("t3_h1", shiftDay(TODAY, -5));
publish("t3_h2", TODAY);                       // nothing published in between
ZSETS.set(`streak:cases:${USER}`, new Map([["t3_h1", Date.parse(`${shiftDay(TODAY, -5)}T10:00:00Z`)]]));
HASHES.set(`streak:${USER}`, { current: "1", best: "1", lastFreshPost: "t3_h1" });
const holeRes = await closeCase("t3_h2", TODAY, 9);
check("a five-day gap with no publications does not break the chain",
  holeRes?.json?.results?.streakCurrent === 2, JSON.stringify(SK()));

// ── 4. a case that ran and went by DOES break it ──────────────────────────────────────────────
resetRedis();
publish("t3_m1", shiftDay(TODAY, -3));
publish("t3_m2", shiftDay(TODAY, -2));          // this one is missed
publish("t3_m3", TODAY);
ZSETS.set(`streak:cases:${USER}`, new Map([["t3_m1", Date.parse(`${shiftDay(TODAY, -3)}T10:00:00Z`)]]));
HASHES.set(`streak:${USER}`, { current: "1", best: "4", lastFreshPost: "t3_m1" });
const missRes = await closeCase("t3_m3", TODAY, 12);
check("a case that was published and never closed ends the run",
  missRes?.json?.results?.streakCurrent === 1, JSON.stringify(SK()));
check("…and `best` is the floor: what was earned is never taken away (dec. 100)",
  missRes?.json?.results?.streakBest === 4, JSON.stringify(SK()));

// ── 5. today's case is PENDING, not missed ───────────────────────────────────────────────────
// A case published an hour ago and not yet solved must not zero the streak of everyone who has not
// got to it. It is skipped while its own day is still running.
resetRedis();
publish("t3_p1", YESTERDAY);
publish("t3_p2", TODAY);                        // out now, unsolved
ZSETS.set(`streak:cases:${USER}`, new Map([["t3_p1", Date.parse(`${YESTERDAY}T10:00:00Z`)]]));
HASHES.set(`streak:${USER}`, { current: "1", best: "1", lastFreshPost: "t3_p1" });
context.postId = "t3_p2";
context.postData = { idx: 0, date: TODAY, n: 2, level: 0 };
const pending = await call("GET", "/api/daily");
check("a case out today and not yet solved leaves the run standing",
  pending.json?.meta?.streakCurrent === 1, JSON.stringify(pending.json?.meta));
// ...but once its day is over it is a miss. Expressed by REPUBLISHING it with its day behind it,
// not by moving the front pointers: liveness now reads the registry's own timestamps, because the
// pointers cannot name "the newest case whose day is over" once a newer one has gone out today.
publish("t3_p2", YESTERDAY);
ZSETS.set(`streak:cases:${USER}`, new Map([["t3_p1", Date.parse(`${YESTERDAY}T10:00:00Z`)]]));
HASHES.set(`streak:${USER}`, { current: "1", best: "1", lastFreshPost: "t3_p1" });
const gone = await call("GET", "/api/daily");
check("…and once that day is over, the same unsolved case has ended it",
  gone.json?.meta?.streakCurrent === 0, JSON.stringify(gone.json?.meta));

// ── 6. the zero the unit change causes, and the fact that a screen can explain it ─────────────
// Every live player's run goes to zero the moment this ships, because the chain starts empty. The
// record is untouched (dec. 100) and the screens must be able to SAY which of the two happened.
resetRedis();
post(sameDay);
context.postId = POST;
HASHES.set(`streak:${USER}`, { current: "4", best: "4", lastDate: sameDay });   // a day-unit record
const legacy = await call("GET", "/api/daily");
check("a record earned under the old unit reports a current run of zero",
  legacy.json?.meta?.streakCurrent === 0, JSON.stringify(legacy.json?.meta?.streakCurrent));
check("…while the record itself is untouched", legacy.json?.meta?.streakBest === 4,
  JSON.stringify(legacy.json?.meta?.streakBest));
const meLegacy = await call("GET", "/api/me");
check("…and the payload flags it, so the screen can explain the zero rather than hide it",
  meLegacy.json?.streakLegacy === true, JSON.stringify(meLegacy.json?.streakLegacy));
// Once a link exists, the flag goes: the run is a real one under the new unit.
publish("t3_leg", sameDay);
await closeCase("t3_leg", sameDay, 77);
const meNow = await call("GET", "/api/me");
check("…and stops flagging once the player has a chain under the new unit",
  meNow.json?.streakLegacy === false && meNow.json?.streakCurrent === 1,
  JSON.stringify({ l: meNow.json?.streakLegacy, c: meNow.json?.streakCurrent }));
check("…with the old record still standing as the floor", meNow.json?.streakBest === 4,
  JSON.stringify(meNow.json?.streakBest));

// ── 7. an ARCHIVE close cannot cost a live run ────────────────────────────────────────────────
resetRedis();
publish("t3_a1", TODAY);
ZSETS.set(`streak:cases:${USER}`, new Map([["t3_a1", Date.parse(`${TODAY}T10:00:00Z`)]]));
HASHES.set(`streak:${USER}`, { current: "3", best: "3", lastFreshPost: "t3_a1" });
publish("t3_a0", shiftDay(TODAY, -9));
STRINGS.set("lt:lastPostId", "t3_a1");
STRINGS.set("lt:lastPostDay", TODAY);
const arch = await closeCase("t3_a0", shiftDay(TODAY, -9), 3);
check("closing an old case does not shorten the run you are on",
  (arch.json?.results?.streakCurrent ?? 0) >= 1, JSON.stringify(SK()));
check("…and it still counts as a case closed", Number(SK().cases) >= 1, JSON.stringify(SK()));


section("FINDING E - two cases on one day: the label means the day, and the second case still counts");
resetRedis();
const twoDay = "2026-08-14";
const CASE_A = "t3_caseA", CASE_B = "t3_caseB";
ZSETS.set("lt:posts", new Map([
  [CASE_A, Date.parse(`${twoDay}T10:00:00Z`)], [CASE_B, Date.parse(`${twoDay}T22:00:00Z`)],
]));
STRINGS.set("lt:lastPostId", CASE_B);
STRINGS.set("lt:lastPostDay", twoDay);

async function playOn(postId: string, n: number, seconds: number) {
  context.postId = postId;
  context.postData = { idx: 0, date: twoDay, n, level: 0 };
  await call("GET", "/api/daily");
  await call("POST", "/api/state", { grid: touched, seconds: 30 });
  const k = `att:${postId}:${context.userId}`;
  HASHES.set(k, { ...HASHES.get(k)!, startedAt: String(Date.now() - seconds * 1000) });
  await call("POST", "/api/state", { grid: solved, seconds });
  return call("POST", "/api/check", { grid: solved, seconds });
}

await playOn(CASE_A, 14, 231);
const afterA = z("lb:alltime")?.get(NAME);
check("the first case of the day sets the day's record", z(`lb:day:${twoDay}`)?.get(NAME) === 231,
  String(z(`lb:day:${twoDay}`)?.get(NAME)));
await playOn(CASE_B, 15, 180);            // a DIFFERENT case, same day, faster
check("a faster close of a second case that day is not silently thrown away",
  z(`lb:day:${twoDay}`)?.get(NAME) === 180, String(z(`lb:day:${twoDay}`)?.get(NAME)));
check("…and it re-prices the day instead of adding a second one",
  z("lb:alltime")?.get(NAME) !== afterA && HASHES.get(`user:${NAME}`)?.solved === "1",
  `${afterA} → ${z("lb:alltime")?.get(NAME)}, solved=${HASHES.get(`user:${NAME}`)?.solved}`);
check("…and the day's record says which case it came from",
  HASHES.get(`lb:solves:${twoDay}`)?.[NAME]?.includes(`|${CASE_B}|`) === true,
  JSON.stringify(HASHES.get(`lb:solves:${twoDay}`)));
// 2026-08-14 is not the day this test runs, so both closes are archive ones - which is exactly the
// case the bonus exists to price differently, and the record says so.
check("…and whether it was closed on the case's own day",
  HASHES.get(`lb:solves:${twoDay}`)?.[NAME]?.endsWith("|0") === true,
  JSON.stringify(HASHES.get(`lb:solves:${twoDay}`)));
// A replay of that same case must still be a replay - never a re-time.
await playOn(CASE_B, 15, 900);
check("a replay of the same case is still never re-timed", z(`lb:day:${twoDay}`)?.get(NAME) === 180,
  String(z(`lb:day:${twoDay}`)?.get(NAME)));

// A second detective who only ever played case B, so the day has two solvers across two cases.
context.userId = "t2_other"; AUTH.username = "bluehexx";
await playOn(CASE_B, 15, 300);
context.userId = USER; AUTH.username = NAME;

// ── the same day, from the splash's side - and the invariant has MOVED, deliberately ───────────
// The old pin was "both splashes of a two-case day report the same 'solved today'". It was the
// right pin for a cell labelled `SOLVED TODAY`, and the label is gone: the feed card is one case's
// cover page and now counts that case (docs/11-stats-ia.md §4.1). So the two splashes must now
// DIFFER, each honestly - and the invariant the old test was really protecting (a figure is never
// printed under a word that describes a different population) is what makes them differ.
//
// ma9leb closed both cases, bluehexx only case B. So case A has one closer and case B has two.
context.postId = CASE_A; context.postData = { idx: 0, date: twoDay, n: 14, level: 0 };
const prevA = await call("GET", "/api/preview");
context.postId = CASE_B; context.postData = { idx: 0, date: twoDay, n: 15, level: 0 };
const prevB = await call("GET", "/api/preview");
check("each splash of a two-case day counts ITS OWN case",
  prevA.json?.case?.closers === 1 && prevB.json?.case?.closers === 2,
  `#14 ${prevA.json?.case?.closers} vs #15 ${prevB.json?.case?.closers}`);
check("…and each fastest is that case's own best time",
  prevA.json?.case?.fastestSec === 231 && prevB.json?.case?.fastestSec === 180,
  `#14 ${prevA.json?.case?.fastestSec} vs #15 ${prevB.json?.case?.fastestSec}`);
check("…and the day is no longer on the splash at all - it is the standings' unit",
  prevA.json?.today === undefined && prevB.json?.today === undefined,
  JSON.stringify(Object.keys(prevA.json ?? {})));
// The day still holds both cases together everywhere the word "today" is actually printed.
const dayView = await call("GET", "/api/leaderboard?scope=today");
check("…while the day board still holds every solver of that day, across both cases",
  dayView.json?.total === 2, String(dayView.json?.total));

// The self-audit used to weigh this CASE's solve counter against the DAY's board. On case #15 that
// read "⚠ Leaderboard has 4 rows for 1 solves - -3 solve(s) never reached the board".
f = await call("POST", "/internal/menu/funnel");
toast = String(f.json?.showToast);
console.log(`      ${toast}`);
check("the self-audit never reports a negative shortfall", !/- -\d/.test(toast), toast);
check("…it checks the case against the case's own board", /This case: \d+ board rows/.test(toast), toast);
check("…and reports the two-case day as its own fact", /2 cases were published on 2026-08-14/.test(toast), toast);

section("FINDING E - publishing a second case on the same date says so, on the spot");
resetRedis();
context.postData = undefined;
await call("POST", "/internal/menu/create-post");
const second = await call("POST", "/internal/menu/create-post");
check("the mod who pressed the button is told it is the day's second case",
  /second case on \d{4}-\d{2}-\d{2}/.test(String(second.json?.showToast)), String(second.json?.showToast));
resetRedis();
context.postData = undefined;
const first = await call("POST", "/internal/menu/create-post");
check("…and a normal publish says nothing of the sort", !/second case/.test(String(first.json?.showToast)),
  String(first.json?.showToast));

// ═════════════════════════════════════════════════════════════════════════════
// FINDING F - "#15 OPENS IN 1H 30M" was printed on case #14 while #15 had been live for nine
// minutes. Two guesses stacked: caseNumber() + 1 assumed the next case had not shipped, and
// minutesToUtcMidnight() assumed a schedule this app does not keep (posting is a manual mod action).
section("FINDING F - the countdown must not promise a case that is already out");
resetRedis();
const nowMs = Date.now();
context.postId = "t3_c14";
context.postData = { idx: 0, date: "2026-08-14", n: 14, level: 0 };
STRINGS.set("bank:cursor", "15");                       // #15 has already been published
ZSETS.set("lt:posts", new Map([
  ["t3_c14", nowMs - 90 * 60_000], ["t3_c15", nowMs - 9 * 60_000],
]));
let daily = await call("GET", "/api/daily");
check("the card on #14 points at #16 - the case that has NOT shipped",
  daily.json?.meta?.nextCaseNumber === 16, String(daily.json?.meta?.nextCaseNumber));
check("…and counts down from the newest case's own clock, not to UTC midnight",
  Math.abs(Number(daily.json?.meta?.nextOpensInMin) - (1440 - 9)) <= 1, String(daily.json?.meta?.nextOpensInMin));
const prevF = await call("GET", "/api/preview");
check("…and the splash agrees with the card to the minute",
  prevF.json?.next?.opensInMin === daily.json?.meta?.nextOpensInMin,
  `${prevF.json?.next?.opensInMin} vs ${daily.json?.meta?.nextOpensInMin}`);
check("…and about which case is next, from the same counter",
  prevF.json?.next?.number === daily.json?.meta?.nextCaseNumber,
  `${prevF.json?.next?.number} vs ${daily.json?.meta?.nextCaseNumber}`);

resetRedis();
context.postId = POST;
post(sameDay);
daily = await call("GET", "/api/daily");
check("with nothing published yet it falls back to this case + 1 and UTC midnight",
  daily.json?.meta?.nextCaseNumber === 42 && daily.json?.meta?.nextOpensInMin > 0,
  JSON.stringify(daily.json?.meta));

// ═════════════════════════════════════════════════════════════════════════════
// The copy beside this number says "faster than X% of N detectives". Dividing by N-1 made the
// fastest player on a board of eleven "faster than 100% of 11 detectives" - counting them as
// faster than themselves.
section("Percentile - the denominator has to match the words printed over it");
resetRedis();
post(sameDay);
const seeded = new Map<string, number>([[NAME, 90]]);
for (let i = 0; i < 10; i++) seeded.set(`p${i}`, 100 + i * 10);
ZSETS.set(`lb:day:${sameDay}`, seeded);
const pctView = await call("GET", "/api/leaderboard?scope=today");
check("the fastest of 11 is ahead of 91% of the field, not 100%",
  pctView.json?.you?.betterPct === Math.round((100 * 10) / 11), JSON.stringify(pctView.json?.you));
check("…and the slowest of 11 is ahead of nobody",
  Math.round((100 * 0) / 11) === 0, "arithmetic guard");

// ═════════════════════════════════════════════════════════════════════════════
// The audit tool: Devvit Redis cannot be queried from outside the app, so "look at the database"
// is a thing you have to SHIP. This is the smoke test for the thing that was shipped.
section("The audit tool - reads what is really there, and names what it cannot reach");
resetRedis();
context.postId = POST;
post(sameDay);
STRINGS.set("lt:lastPostId", POST);
STRINGS.set("lt:lastPostDay", sameDay);
ZSETS.set("lt:posts", new Map([[POST, Date.parse(`${sameDay}T10:00:00Z`)]]));
await playThrough();

const logged: string[] = [];
const realLog = console.log;
console.log = (...a: unknown[]) => { logged.push(a.map(String).join(" ")); };
const audit = await call("POST", "/internal/menu/audit");
console.log = realLog;
const auditToast = String(audit.json?.showToast);
const dump = logged.filter((l) => l.startsWith("[audit]"));
console.log(`      ${auditToast}`);
console.log(`      (${dump.length} lines went to devvit logs)`);

check("the audit answers with a toast", auditToast.length > 0 && /Full dump in devvit logs/.test(auditToast), auditToast);
check("…that carries the board sizes", /day board 1/.test(auditToast), auditToast);
check("…and flags a day whose scores have never been settled", /NEVER been rolled up/.test(auditToast), auditToast);
check("the full dump goes to the logs, not the toast", dump.length > 20, String(dump.length));
check("…including a real att: row, read through stuck: - the only index of players on a post",
  dump.some((l) => l.includes(`att:${POST}:${USER}`) && l.includes("activeSec=")),
  dump.find((l) => l.includes("att:")) ?? "(none)");
for (const key of [`lb:day:${sameDay}`, `lb:solves:${sameDay}`, `lb:points:${sameDay}`,
  `lb:applied:${sameDay}`, `lb:daymeta:${sameDay}`, "lb:alltime", "lb:streakbest", "lb:index:days",
  `lb:days:${NAME}`, `stats:${POST}`, `stuck:${POST}`, `vote:${POST}`, "lt:posts", "bank:cursor"]) {
  check(`…and prints ${key}`, dump.some((l) => l.includes(key)), "");
}
check("…names every key Redis can never hand back, instead of leaving a silent hole",
  dump.some((l) => l.includes("NOT REACHABLE")) && dump.some((l) => l.includes("never autosaved")),
  "");
check("…and cross-checks the aggregates against the per-day history they sum",
  dump.some((l) => /alltime=\d+ sum\(lb:days\)=\d+/.test(l)),
  dump.find((l) => l.includes("alltime=")) ?? "(none)");

// ═════════════════════════════════════════════════════════════════════════════
// TRACK 11 - the statistics information architecture (docs/11-stats-ia.md).
//
// The rule every check below is an instance of: a figure is never printed under a word that
// describes a different thing, and every figure belongs to exactly one of three worlds - this
// case ①, the series ②, you all-time ③.
// ═════════════════════════════════════════════════════════════════════════════
section("GET /api/preview is a PURE READ - the invariant the whole endpoint exists for");
// This lived only in the prototype harness (plans/assets/proto/06-server/preview.test.ts), which
// is not in the gate. It is the one property of this endpoint that can silently destroy a player's
// state: the splash renders whenever the post scrolls past in a feed, so a single stray write here
// starts timed runs and burns one-time tutorial flags for people who never opened anything.
resetRedis();
post(sameDay);
STRINGS.set("lt:lastPostId", POST);
const before = CALLS.length;
await call("GET", "/api/preview");
const previewWrites = CALLS.slice(before).filter((c) => WRITE_OPS.has(c.op));
check("zero redis writes", previewWrites.length === 0, JSON.stringify(previewWrites));
check("…no att: row created, so no timer baseline is stamped", !HASHES.has(ATT), JSON.stringify(HASHES.get(ATT)));
check("…the first-run tutorial flag is NOT consumed", !STRINGS.has(`tut:${USER}`));
check("…and `opened` was not counted", stats().opened === undefined, JSON.stringify(stats()));
let prev = await call("GET", "/api/preview");
check("…while still answering with the whole card", prev.json?.case?.number === 41
  && prev.json?.you?.state === "new" && typeof prev.json?.next?.opensInMin === "number",
  JSON.stringify(prev.json));
check("…and leaking no part of the case itself",
  !/"clues"|"solution"|"suspects"|"grid"/.test(JSON.stringify(prev.json)),
  JSON.stringify(prev.json).slice(0, 200));
// A read-only claim is only worth as much as its positive control: if /api/daily had quietly
// stopped stamping too, every check above would pass while proving nothing.
resetRedis();
post(sameDay);
await call("GET", "/api/daily");
check("control: /api/daily DOES stamp startedAt, so the checks above prove a real difference",
  HASHES.get(ATT)?.startedAt !== undefined, JSON.stringify(HASHES.get(ATT)));
check("control: /api/daily DOES consume the tutorial flag", STRINGS.get(`tut:${USER}`) === "1");
// A board saved against a DIFFERENT case (the post re-pointed at another idx) no longer fits this
// puzzle's shape, and effectiveCount would walk it unguarded. The feed must not be the screen that
// discovers that: it renders unattended, on a scroll.
resetRedis();
post(sameDay);
HASHES.set(ATT, { startedAt: "1", grid: JSON.stringify({ flair: { Ghost: {} } }) });
prev = await call("GET", "/api/preview");
check("a grid saved against another case renders as 0 deduced rather than throwing",
  prev.status === 200 && prev.json?.you?.state === "playing" && prev.json?.you?.deduced === 0,
  JSON.stringify(prev.json?.you));

section("The feed card counts THIS CASE - the owner's «DETECTIVES 8 считает не тот кейс»");
// `DETECTIVES` used to fall back to `zCard(lb:alltime)` below ten solvers: everyone who had ever
// closed ANY case, on a card glued to one case, under a word that named neither population.
resetRedis();
post(sameDay);
STRINGS.set("lt:lastPostId", POST);
ZSETS.set("lb:alltime", new Map([["a", 1], ["b", 2], ["c", 3], ["d", 4], ["e", 5], ["f", 6], ["g", 7], ["h", 8]]));
ZSETS.set(`lb:${POST}`, new Map([["quillfox", 161], ["harbor_light", 402]]));
prev = await call("GET", "/api/preview");
check("the card's headcount is this case's closers, not the all-time community",
  prev.json?.case?.closers === 2, String(prev.json?.case?.closers));
check("…and the all-time community is not on the card at all",
  !JSON.stringify(prev.json).includes("solversAllTime"), JSON.stringify(prev.json));
check("…the benchmark is this case's best time", prev.json?.case?.fastestSec === 161,
  String(prev.json?.case?.fastestSec));
// Track 12: the card names WHO holds it. The field size (`of N`) it replaces both collided on a
// phone band and said the weaker thing - a headcount says how many you beat, a name says who to
// beat. It is a username off `lb:{postId}`, i.e. exactly what every standings row already prints.
check("…and names who holds it", prev.json?.case?.fastestBy === "quillfox",
  String(prev.json?.case?.fastestBy));
check("…never a raw t2_ id, whatever the board holds",
  !String(prev.json?.case?.fastestBy).startsWith("t2_"), String(prev.json?.case?.fastestBy));
resetRedis();
post(sameDay);
prev = await call("GET", "/api/preview");
check("a case nobody has closed reports 0 closers and a null time, never a placeholder",
  prev.json?.case?.closers === 0 && prev.json?.case?.fastestSec === null,
  JSON.stringify(prev.json?.case));

// A close recorded by a build that predates `timeSec` leaves `solved: "1"` with nothing beside it.
// The card must not fill that hole with a figure - `YOUR TIME 00:00` is a time nobody achieved.
resetRedis();
post(sameDay);
HASHES.set(ATT, { startedAt: "1", solved: "1" });
prev = await call("GET", "/api/preview");
check("a solved row with no recorded time reports null, never 00:00",
  prev.json?.you?.state === "solved" && prev.json?.you?.timeSec === null,
  JSON.stringify(prev.json?.you));

section("A grown bank is served AFTER the old one, never shuffled into it");
// 2026-09-25: the daily default is green, the bank held 45 greens, and case #56 had gone out - so
// the green bucket had already wrapped and the sub was being served repeats. Batch 2 was appended.
// Appending to ONE pool would have reshuffled it; each batch is spread on its own and they are
// served end to end. Hard days (below) draw from yellow along the way, so greens are tracked apart.
const lastIdx = () => (SUBMITTED[SUBMITTED.length - 1].postData as { idx: number }).idx;
const greensOf = (batch: number | undefined) => BANK.map((e, i) => ({ e, i }))
  .filter(({ e }) => e.tier === "green" && (e as { batch?: number }).batch === batch).map(({ i }) => i);
{
  resetRedis();
  post(sameDay);
  const old = greensOf(undefined), fresh = greensOf(2);
  const greens: number[] = [], yellows: number[] = [];
  let guard = 0;
  while (greens.length < old.length + fresh.length && guard++ < 400) {
    await call("POST", "/internal/menu/create-post");
    const i = lastIdx();
    (BANK[i].tier === "green" ? greens : yellows).push(i);
  }
  const same = (x: number[], y: number[]) => x.length === y.length && [...x].sort().join() === [...y].sort().join();
  check("the original greens are served first, each exactly once",
    same(greens.slice(0, old.length), old), `${greens.slice(0, old.length).length} of ${old.length}`);
  check("…and THEN every new green exactly once",
    same(greens.slice(old.length), fresh), `${greens.slice(old.length).length} of ${fresh.length}`);
  check("…with not one case served twice across the whole run, green or yellow",
    new Set([...greens, ...yellows]).size === greens.length + yellows.length,
    `${greens.length} greens, ${yellows.length} yellows`);

  // The production state on the day of the change: the cursor already past the 45 old greens. The
  // next green must be one nobody has played.
  resetRedis();
  post(sameDay);
  STRINGS.set("lt:bucketCursor:0", "56");
  STRINGS.set("bank:cursor", "0");   // case #1 is not a hard day under the dice
  await call("POST", "/internal/menu/create-post");
  check("a cursor that had already wrapped the old greens lands straight in the new batch",
    fresh.includes(lastIdx()), `idx ${lastIdx()}`);
}

section("Never the same case twice - the published set is read from the posts themselves");
// A cursor going round a loop cannot know what was played; only the posts can. Every Deducto post
// carries its bank index in postData, so the first publish after the change seeds the set from the
// listing, exactly - rather than reconstructing it from counters whose bucket order changed twice.
{
  resetRedis();
  post(sameDay);
  const old = greensOf(undefined);
  // History: ten greens already out, in an order the CURRENT bucket would never have produced.
  const history = [old[40], old[3], old[17], old[29], old[8], old[44], old[0], old[21], old[12], old[35]];
  history.forEach((idx, k) => LISTED_POSTS.push({ id: `t3_hist${k}`, postData: { idx, n: k + 1, date: "2026-08-01" } }));
  const served: number[] = [];
  for (let k = 0; k < old.length; k++) {
    await call("POST", "/internal/menu/create-post");
    if (BANK[lastIdx()].tier === "green") served.push(lastIdx());
  }
  check("the published set is seeded from the posts, all of them",
    history.every((i) => HASHES.get("lt:served")?.[String(i)] !== undefined),
    JSON.stringify(Object.keys(HASHES.get("lt:served") ?? {}).length));
  check("…and not one of those ten is served again",
    !served.some((i) => history.includes(i)), JSON.stringify(served.filter((i) => history.includes(i))));
  check("…while the other 35 old greens still come before the new batch",
    same35(served.slice(0, old.length - history.length), old.filter((i) => !history.includes(i))),
    `${served.length} served`);
  function same35(x: number[], y: number[]) { return x.length === y.length && [...x].sort().join() === [...y].sort().join(); }

  // If the listing cannot be read, the counters are the fallback - and the exact walk is retried.
  resetRedis();
  post(sameDay);
  THROW_ON.set("getNewPosts", "listing unavailable");
  STRINGS.set("lt:bucketCursor:0", "56");
  await call("POST", "/internal/menu/create-post");
  check("with the posts unreadable, the counters seed the set instead",
    Object.keys(HASHES.get("lt:served") ?? {}).length >= old.length,
    String(Object.keys(HASHES.get("lt:served") ?? {}).length));
  check("…and the seed is NOT marked done, so the exact walk runs next time",
    STRINGS.get("lt:servedSeeded") !== "1", String(STRINGS.get("lt:servedSeeded")));
  THROW_ON.delete("getNewPosts");
}

section("A hard day, sometimes, when nobody decided the level");
// Owner: people rarely vote, so when the vote decides nothing the next case is hard mode about one
// day in seven. The dice are the CASE NUMBER, not Math.random, so the card's forecast of tomorrow's
// level is what actually ships.
{
  resetRedis();
  post(sameDay);
  let hard = 0, agree = 0, checked = 0;
  for (let k = 0; k < 70; k++) {
    const last = STRINGS.get("lt:lastPostId");
    let forecast: string | null = null;
    if (last) {
      context.postId = last;
      const pv = await call("GET", "/api/preview");
      forecast = pv.json?.next?.tier ?? null;
    }
    await call("POST", "/internal/menu/create-post");
    const tier = BANK[lastIdx()].tier;
    if (tier === "yellow") hard++;
    if (forecast) { checked++; if (forecast === tier) agree++; }
  }
  check("with nobody voting, some days are hard mode - about one in seven",
    hard >= 4 && hard <= 18, `${hard} of 70`);
  check("…and the card's forecast of tomorrow's level is right every single time",
    checked > 0 && agree === checked, `${agree} of ${checked}`);
  check("…with hard mode named in the post title", SUBMITTED.some((o) => o.title.includes("hard mode")),
    SUBMITTED.map((o) => o.title).find((t) => t.includes("hard")) ?? "none");

  // A DECIDED vote is followed, dice or not: Same keeps it green every day.
  resetRedis();
  post(sameDay);
  let yellowWhenDecided = 0;
  for (let k = 0; k < 40; k++) {
    const last = STRINGS.get("lt:lastPostId");
    if (last) HASHES.set(`vote:${last}`, { Same: "6", Harder: "0", Softer: "0" });
    await call("POST", "/internal/menu/create-post");
    if (BANK[lastIdx()].tier === "yellow") yellowWhenDecided++;
  }
  check("when the sub DID decide, the dice never override it", yellowWhenDecided === 0,
    `${yellowWhenDecided} yellow of 40`);
  // And a hard day is one-off: the persisted level stays at the default.
  check("…and a hard day never moves the persisted level", (STRINGS.get("lt:level") ?? "0") === "0",
    String(STRINGS.get("lt:level")));
  resetRedis();
  post(sameDay);
  context.postId = POST;
}

section("The warm-up is ONE case, on a clean board every round");
{
  resetRedis();
  post(sameDay);
  const first = await call("GET", "/api/practice");
  const idxA = first.json?.puzzle?.idx ?? first.json?.puzzle?.id;
  STRINGS.set(`onb:${USER}`, "1");     // one warm-up completed
  const second = await call("GET", "/api/practice");
  STRINGS.set(`onb:${USER}`, "5");
  const later = await call("GET", "/api/practice");
  check("the lane has exactly one case", first.json?.poolSize === 1, String(first.json?.poolSize));
  check("…every round is that same case",
    JSON.stringify(second.json?.puzzle?.clues) === JSON.stringify(first.json?.puzzle?.clues)
    && JSON.stringify(later.json?.puzzle?.clues) === JSON.stringify(first.json?.puzzle?.clues), String(idxA));
  check("…opened on a clean board, not the last round's marks", second.json?.grid === null,
    JSON.stringify(second.json?.grid));
}

section("The per-case record: seeded and written by the hourly job, no button");
{
  resetRedis();
  post(sameDay);
  const old = greensOf(undefined);
  LISTED_POSTS.push({ id: "t3_histA", postData: { idx: old[0], n: 1, date: sameDay } });
  ZSETS.set("lb:t3_histA", new Map([["quillfox", 100], ["harbor_light", 200], ["slowcoach", 300]]));
  await call("POST", "/internal/scheduler/case-stats");
  check("the job seeds the no-repeat set on its own, without waiting for a publication",
    HASHES.get("lt:served")?.[String(old[0])] !== undefined, JSON.stringify(HASHES.get("lt:served")));
  check("…and writes the table once", Number(STRINGS.get("caselog:dumpedAt:v2")) > 0,
    String(STRINGS.get("caselog:dumpedAt:v2")));
  const stamp = STRINGS.get("caselog:dumpedAt:v2");
  await call("POST", "/internal/scheduler/case-stats");
  check("…and not again within the day", STRINGS.get("caselog:dumpedAt:v2") === stamp, "");
  resetRedis();
  post(sameDay);
  context.postId = POST;
}

section("The STREAK tab ranks the run still going, not the record");
// Owner: "сейчас показывается лучшие стрики за все время, но я думаю надо текущий показывать".
// The hard part is not the label. A run ends when a case is published and its day goes by without
// the player closing it - an event with NO write of theirs to hang off - so a stored `current`
// cannot be zeroed when it dies, and a board read straight off the ZSET would rank runs that ended
// days ago above live ones. Liveness is therefore decided at READ time, and it collapses to two
// cases: the newest case's day is still running (everybody is live), or it has passed (only its
// closers are). These checks pin both halves and the mirror that feeds them.
{
  const CUR = "lb:streakcur";
  const board = () => call("GET", "/api/leaderboard?scope=streak");

  resetRedis();
  post(sameDay);
  STRINGS.set("lt:lastPostId", POST);
  STRINGS.set("lt:lastPostDay", sameDay);
  let v = await board();
  check("the tab is titled by the run in progress, not by the record",
    v.json?.period?.label === "Current streak", JSON.stringify(v.json?.period));
  check("…and it is a streak board, so rows read as cases", v.json?.unit === "streak",
    String(v.json?.unit));

  // The mirror: solving writes the LIVE run under the player's NAME - the streak hash is keyed by
  // the opaque id, which no read path can turn back into a username.
  await call("GET", "/api/daily");
  await call("POST", "/api/check", { grid: solvedGrid(BANK[0]), timeSec: 120, hints: 0 });
  check("closing a case mirrors the live run onto the board under the username",
    (ZSETS.get(CUR)?.get(NAME) ?? 0) >= 1, JSON.stringify([...(ZSETS.get(CUR) ?? [])]));

  // ── two cases on one day: the morning one cannot be missed while its own day is running ──────
  // Reproduced through the real routes by adversarial review. The run's arithmetic used to take ONE
  // pending case - the newest - so a player who closed the EVENING case had the morning case walked
  // as decided-and-missed, and watched a run of four become one. That 1 was then written to the
  // hash and published on this very board. Reachable: the publish menu has no same-day guard.
  resetRedis();
  for (let d = 4; d >= 1; d--) publish(`t3_d${d}`, shiftDay(todayUtc(), -d));
  ZSETS.set(`streak:cases:${USER}`, new Map(
    [4, 3, 2, 1].map((d) => [`t3_d${d}`, Date.parse(`${shiftDay(todayUtc(), -d)}T10:00:00Z`)])));
  HASHES.set(`streak:${USER}`, { current: "4", best: "4", lastFreshPost: "t3_d1" });
  publish("t3_am", todayUtc());
  publish("t3_pm", todayUtc());
  context.postId = "t3_pm";
  context.postData = { idx: 0, date: todayUtc(), n: 6, level: 0 };
  await call("GET", "/api/daily");
  const twoCase = await call("POST", "/api/check",
    { grid: solvedGrid(BANK[0]), timeSec: 120, hints: 0 });
  check("closing the evening case of a two-case day EXTENDS the run, it does not reset it",
    twoCase.json?.results?.streakCurrent === 5, JSON.stringify(twoCase.json?.results?.streakCurrent));
  check("…and that is the number the board publishes",
    ZSETS.get(CUR)?.get(NAME) === 5, JSON.stringify([...(ZSETS.get(CUR) ?? [])]));

  // ── the case that adversarial review found, and the reason liveness reads the REGISTRY ───────
  // A (two days ago) and B (yesterday) are decided; C goes out today. ma9leb closed A and nothing
  // since; livewire closed B. Under the rule this replaces, the moment C published "the newest case
  // is still today's" was read as "nothing was missed", and ma9leb's dead run came back at rank 1 -
  // above the only live run - and stayed there until midnight. It oscillated: dropped every
  // morning, resurrected at every publication.
  resetRedis();
  publish("t3_A", shiftDay(todayUtc(), -2));
  publish("t3_B", shiftDay(todayUtc(), -1));
  ZSETS.set("lb:t3_A", new Map([[NAME, 100], ["livewire", 90]]));
  ZSETS.set("lb:t3_B", new Map([["livewire", 90]]));
  ZSETS.set(CUR, new Map([[NAME, 9], ["livewire", 2]]));
  context.postId = "t3_B";
  context.postData = { idx: 0, date: shiftDay(todayUtc(), -1), n: 2, level: 0 };
  v = await board();
  check("a run that let yesterday's case go by is off the board",
    v.json?.rows?.length === 1 && v.json.rows[0].name === "livewire", JSON.stringify(v.json?.rows));

  // Today's case publishes. NOTHING about ma9leb changed - and nothing about their run may either.
  publish("t3_C", todayUtc());
  context.postId = "t3_C";
  context.postData = { idx: 0, date: todayUtc(), n: 3, level: 0 };
  v = await board();
  check("…and publishing today's case does NOT bring it back",
    v.json?.rows?.length === 1 && v.json.rows[0].name === "livewire", JSON.stringify(v.json?.rows));
  check("…so a dead run is never ranked above the live one",
    v.json?.rows?.[0]?.value === 2, JSON.stringify(v.json?.rows));

  // The player who HAS closed the newest decided case keeps their run through today, unsolved.
  ZSETS.set("lb:t3_B", new Map([["livewire", 90], [NAME, 95]]));
  v = await board();
  check("closing yesterday's case keeps a run standing while today's is still open",
    v.json?.rows?.length === 2, JSON.stringify(v.json?.rows));
  check("…ranked by the run, longest first", v.json?.rows?.[0]?.name === NAME
    && v.json.rows[0].value === 9, JSON.stringify(v.json?.rows?.[0]));

  // A player who restarted on TODAY's case is live too, on the case still in progress.
  ZSETS.set("lb:t3_B", new Map([["livewire", 90]]));
  ZSETS.set("lb:t3_C", new Map([[NAME, 80]]));
  ZSETS.set(CUR, new Map([[NAME, 1], ["livewire", 2]]));
  v = await board();
  check("a run restarted on the case still in progress is on the board",
    v.json?.rows?.some((r: { name: string }) => r.name === NAME), JSON.stringify(v.json?.rows));

  // The viewer's own row. It never appeared on a computed board: `key` is "" for one, so the old
  // zScore() answered undefined - invisible while the rolling week was the only computed board.
  check("the viewer's own row is on the board they are reading",
    v.json?.you?.name === NAME && v.json.you.isYou === true, JSON.stringify(v.json?.you));
  check("…at the position the board actually put them",
    v.json?.you?.rank === v.json?.rows?.findIndex((r: { name: string }) => r.name === NAME) + 1,
    JSON.stringify(v.json?.you));

  // A zero is a player on a leaderboard with nothing on it.
  ZSETS.set(CUR, new Map([["livewire", 0], [NAME, 1]]));
  v = await board();
  check("a run of zero is not a row", v.json?.rows?.length === 1, JSON.stringify(v.json?.rows));

  // The record board is NOT what changed: the rank ladder and the subreddit flair read it, and a
  // record stays earned (dec. 100). Asserted where a solve has actually happened, rather than after
  // the registry fixtures above, which never write one.
  resetRedis();
  post(sameDay);
  context.postId = POST;
  await call("GET", "/api/daily");
  await call("POST", "/api/check", { grid: solvedGrid(BANK[0]), timeSec: 120, hints: 0 });
  check("a solve still feeds the all-time record board, which is what the rank ladder reads",
    (ZSETS.get("lb:streakbest")?.get(NAME) ?? 0) > 0,
    JSON.stringify([...(ZSETS.get("lb:streakbest") ?? [])]));

  // This section drove the registry and the post context far from the shared fixture; every later
  // section assumes the fixture. Restored here rather than left for the next one to trip over.
  resetRedis();
  post(sameDay);
  context.postId = POST;
}

section("A transport blip is retried, never answered with a zero");
// Production logs carry `14 UNAVAILABLE: read ECONNRESET` out of HGetAll, twice in a week, both on
// the streak read. A streak that answers 0 on a blip tells a player their run is gone - the one
// figure on that card they would act on - so the read is retried rather than degraded.
{
  resetRedis();
  post(sameDay);
  HASHES.set(`streak:${USER}`, { best: "4", current: "4", cases: "9" });
  THROW_ONCE.set(`hGetAll streak:${USER}`, "14 UNAVAILABLE: read ECONNRESET");
  const before = CALLS.length;
  const r = await call("GET", "/api/preview");
  const reads = CALLS.slice(before).filter((c) => c.op === "hGetAll" && c.key === `streak:${USER}`);
  check("the blown read is retried rather than given up on", reads.length === 2,
    `${reads.length} attempts`);
  // The retry has to return the DATA, not merely not throw: `rank` is derived from the `best` that
  // lives in the hash that failed, so a rank on the card is proof the second read landed.
  check("…and the retry's data reaches the card", r.status === 200 && r.json?.you?.rank !== null,
    `${r.status} ${JSON.stringify(r.json?.you)}`);
}

section("When players show up - collected silently, read in the DB audit");
// The app knew how many opened a case and how many solved it, and nothing about WHEN. Reddit's own
// Insights answers that for 24 hours only, which on a subreddit averaging one unique visitor a day
// is noise. This accrues past that window - and it has no button of its own: the collection is a
// single hIncrBy on a path that was already writing, and the readout belongs with the other
// subreddit-wide figures rather than as a seventh entry in a mod menu.
{
  resetRedis();
  post(sameDay);
  await call("GET", "/api/daily");
  const hour = String(new Date().getUTCHours());
  check("opening a case ticks the hour it was opened in",
    HASHES.get("hits:hours")?.[hour] === "1", JSON.stringify(HASHES.get("hits:hours")));
  // The same guard the funnel's `opened` uses: reopening all evening is one player, not a trend.
  await call("GET", "/api/daily");
  await call("GET", "/api/daily");
  check("…and reopening the same case does NOT tick it again",
    HASHES.get("hits:hours")?.[hour] === "1", JSON.stringify(HASHES.get("hits:hours")));
  check("…which is exactly what the funnel counted too",
    HASHES.get(`stats:${POST}`)?.opened === "1", JSON.stringify(HASHES.get(`stats:${POST}`)));
  check("…and it costs no menu item of its own",
    !JSON.parse(readFileSync("devvit.json", "utf8")).menu.items
      .some((i: { endpoint: string }) => i.endpoint.includes("hours")),
    "a readout does not get a button");
}

section("The pause switch refuses to invent a state that means nothing");
// The owner pressed the only menu item that mentions the daily post, looking for "turn it on", and
// got `PAUSED` back about a schedule that was never running - a fault report about nothing. Pausing
// something already switched off is two different reasons for the same silence, so it is refused.
{
  const TOGGLE = "/internal/menu/daily-toggle";
  resetRedis();
  post(sameDay);
  let t = await call("POST", TOGGLE);
  check("with the setting off, the toggle does NOT create a pause",
    !STRINGS.has("daily:paused"), String(STRINGS.get("daily:paused")));
  // Named, not paraphrased: an earlier version of this string pointed at "Mod Tools > Apps", which
  // is not a menu that exists, and the owner went looking for it. The toast has to name the path a
  // moderator actually walks.
  check("…and it names the menu the switch actually lives in",
    /Installed Apps/.test(String(t.json?.showToast)), String(t.json?.showToast));
  // A pause left standing under an off setting protects nothing and would keep the status readout
  // reporting a fault that is not one.
  STRINGS.set("daily:paused", "1");
  STRINGS.set("daily:pausedReason", "stale");
  await call("POST", TOGGLE);
  check("…and a stale pause under an off setting is cleared rather than preserved",
    !STRINGS.has("daily:paused"), String(STRINGS.get("daily:paused")));
  // With the setting on it is a real two-way switch.
  SETTINGS.set("dailyAutoPost", true);
  await call("POST", TOGGLE);
  check("with the setting on, the toggle pauses", STRINGS.get("daily:paused") === "1",
    String(STRINGS.get("daily:paused")));
  await call("POST", TOGGLE);
  check("…and pressing it again resumes", !STRINGS.has("daily:paused"),
    String(STRINGS.get("daily:paused")));

  // The status toast is ONE short line: a client truncates anything longer, and the part it cuts is
  // always the end. Everything else belongs in the logs.
  const st = await call("POST", "/internal/menu/daily-status");
  const toast = String(st.json?.showToast ?? "");
  check("the status toast is short enough to be read whole", toast.length > 0 && toast.length <= 110,
    `${toast.length} chars: ${toast}`);
}

section("The case's own thread: a comment as the permanent record");
// The card can only show what is true now. `FASTEST` is a live minimum, so the moment somebody is
// beaten their name is gone from every screen - and nothing anywhere says they ever held it. The
// record therefore lives in a comment, and the mention in it is what notifies the winner.
{
  const CLOSE = "/internal/scheduler/case-close";
  const RECORD = "/internal/scheduler/case-record";

  resetRedis();
  post(sameDay);
  ZSETS.set(`lb:${POST}`, new Map([["quillfox", 161], ["harbor_light", 402]]));
  await call("POST", CLOSE, { data: { postId: POST, n: 41 } });
  check("closing the case names the winner in a comment on the post",
    COMMENTS.length === 1 && COMMENTS[0].id === POST && COMMENTS[0].text.includes("u/quillfox"),
    JSON.stringify(COMMENTS));
  check("…with the time and the size of the field", COMMENTS[0].text.includes("2:41")
    && COMMENTS[0].text.includes("2 detectives"), COMMENTS[0].text);
  check("…written by the APP account, not by whoever's request happened to reach it",
    COMMENTS[0].runAs === "APP", String(COMMENTS[0].runAs));
  // A retried scheduler delivery must not produce a second epilogue on the same thread.
  await call("POST", CLOSE, { data: { postId: POST, n: 41 } });
  check("…and a repeated delivery writes NOTHING more", COMMENTS.length === 1,
    `${COMMENTS.length} comments`);

  // A case nobody closed says nothing at all rather than announcing a winner it does not have.
  resetRedis();
  post(sameDay);
  await call("POST", CLOSE, { data: { postId: POST, n: 41 } });
  check("a case nobody closed gets no comment", COMMENTS.length === 0, JSON.stringify(COMMENTS));
  check("…but is still marked closed, so a later solve is a RECORD and not a second epilogue",
    HASHES.get("herald:closed")?.[POST] !== undefined, JSON.stringify(HASHES.get("herald:closed")));

  // ── the second announcement: a record that falls after the day is over ──────────────────────
  resetRedis();
  post(sameDay);
  ZSETS.set(`lb:${POST}`, new Map([["quillfox", 161]]));
  await call("POST", CLOSE, { data: { postId: POST, n: 41 } });
  const afterClose = COMMENTS.length;
  ZSETS.set(`lb:${POST}`, new Map([["quillfox", 161], ["newcomer", 118]]));
  STRINGS.set("herald:at:" + POST, "0");   // outside the announcement floor
  await call("POST", RECORD, { data: { postId: POST, n: 41 } });
  check("a faster time after the close gets a comment of its own",
    COMMENTS.length === afterClose + 1 && COMMENTS[1].text.includes("u/newcomer"),
    JSON.stringify(COMMENTS.map((c) => c.text)));
  check("…and it names the record it beat, which is the only place that name survives",
    COMMENTS[1].text.includes("2:41"), COMMENTS[1].text);

  // A slower time is not a record, however often the job is delivered.
  ZSETS.set(`lb:${POST}`, new Map([["quillfox", 161], ["newcomer", 118], ["slow", 900]]));
  STRINGS.set("herald:at:" + POST, "0");
  await call("POST", RECORD, { data: { postId: POST, n: 41 } });
  check("a slower solve announces nothing", COMMENTS.length === afterClose + 1,
    `${COMMENTS.length} comments`);

  // The floor: two records inside six hours produce ONE comment, not a column of them. The steps
  // above deliberately cleared it to test the record logic on its own, so it is restored here -
  // otherwise this check would pass for the wrong reason.
  STRINGS.set("herald:at:" + POST, String(Date.now()));
  ZSETS.set(`lb:${POST}`, new Map([["fastest", 90]]));
  await call("POST", RECORD, { data: { postId: POST, n: 41 } });
  check("a second record inside the floor waits", COMMENTS.length === afterClose + 1,
    `${COMMENTS.length} comments`);

  // And nothing at all is announced while the case's own day is still running.
  resetRedis();
  post(sameDay);
  ZSETS.set(`lb:${POST}`, new Map([["quillfox", 161]]));
  await call("POST", RECORD, { data: { postId: POST, n: 41 } });
  check("a case that has not closed yet announces nothing", COMMENTS.length === 0,
    JSON.stringify(COMMENTS));
}

section("Automatic daily publication - the guards, not the posting");
// This is the track that got two subreddits banned, and the post-mortem found the scheduler itself
// was the least of it: there was no idempotency, no per-subreddit opt-in, and - the expensive one -
// no way to learn that the posts were being filtered until the subreddit was gone. Every check here
// is one of those guards. None of them is about whether a post can be created.
{
  const TICK = "/internal/scheduler/daily-post";
  const CHECK = "/internal/scheduler/daily-check";
  const hourNow = new Date().getUTCHours();
  const today = new Date().toISOString().slice(0, 10);

  // OFF is the default, and the default has to hold for a subreddit whose moderator has never
  // opened the settings at all - the platform answers `undefined` there, not `false`.
  resetRedis();
  post(sameDay);
  let r = await call("POST", TICK);
  check("with the setting untouched the schedule publishes nothing",
    r.status === 200 && SUBMITTED.length === 0, `${r.status} ${SUBMITTED.length}`);
  check("…and it leaves no countdown behind promising one",
    !STRINGS.has("daily:nextAt"), String(STRINGS.get("daily:nextAt")));

  // Explicitly off is the state the dev subreddit lives in permanently.
  SETTINGS.set("dailyAutoPost", false);
  await call("POST", TICK);
  check("explicitly off publishes nothing either", SUBMITTED.length === 0, String(SUBMITTED.length));

  // On, but not the hour: the cron is hourly so the HOUR can be a setting instead of a redeploy.
  resetRedis();
  post(sameDay);
  SETTINGS.set("dailyAutoPost", true);
  SETTINGS.set("dailyPostHourUtc", (hourNow + 5) % 24);
  await call("POST", TICK);
  check("on, but the wrong hour: still nothing", SUBMITTED.length === 0, String(SUBMITTED.length));
  check("…yet the countdown now names the real next firing",
    Number(STRINGS.get("daily:nextAt")) > Date.now(), String(STRINGS.get("daily:nextAt")));

  // The acceptance criterion the incident is actually about: a retried delivery must not produce a
  // second post. Two ticks in the same hour, same day.
  resetRedis();
  post(sameDay);
  SETTINGS.set("dailyAutoPost", true);
  SETTINGS.set("dailyPostHourUtc", hourNow);
  await call("POST", TICK);
  const afterFirst = SUBMITTED.length;
  await call("POST", TICK);
  check("the schedule publishes on its hour", afterFirst === 1, String(afterFirst));
  check("…and a repeated delivery on the same day publishes NOTHING more",
    SUBMITTED.length === 1, `${SUBMITTED.length} posts`);
  check("…the day is locked by the post it actually created",
    String(HASHES.get("daily:posted")?.[today] ?? "").startsWith("t3_"),
    JSON.stringify(HASHES.get("daily:posted")));
  const postId = String(HASHES.get("daily:posted")?.[today]);

  // The second belt: even with the day lock cleared - an hour setting that walked across UTC
  // midnight writes a different date - a post 20 hours old still blocks another one.
  HASHES.set("daily:posted", {});
  await call("POST", TICK);
  check("…and a fresh lock still cannot beat the 20-hour floor",
    SUBMITTED.length === 1, `${SUBMITTED.length} posts`);

  // The half that was missing last time: the post is read back later, and a filtered post stops
  // the schedule instead of being published over the next day, and the next, and the next.
  check("publishing queues a survival check for that post",
    JOBS.some((j) => j.name === "daily-check" && (j.data as any)?.postId === postId),
    JSON.stringify(JOBS.map((j) => j.name)));
  POST_STATE.set(postId, { removed: true, removedBy: "reddit" });
  await call("POST", CHECK, { data: { postId } });
  check("a removed post pauses the schedule", STRINGS.get("daily:paused") === "1",
    String(STRINGS.get("daily:paused")));
  check("…records WHY, so a pause is never a mystery",
    (STRINGS.get("daily:pausedReason") ?? "").includes(postId),
    String(STRINGS.get("daily:pausedReason")));
  check("…tells the moderators", MODMAIL.length === 1 && MODMAIL[0].subject.includes("filtered"),
    JSON.stringify(MODMAIL.map((m) => m.subject)));
  check("…and drops the countdown, which was promising a case that is not coming",
    !STRINGS.has("daily:nextAt"), String(STRINGS.get("daily:nextAt")));

  // A pause is a full stop. The next day's tick must not walk straight past it.
  HASHES.set("daily:posted", {});
  STRINGS.delete("daily:lastAt");
  await call("POST", TICK);
  check("a paused schedule publishes nothing on the next tick",
    SUBMITTED.length === 1, `${SUBMITTED.length} posts`);
  // ...and only a person can lift it. The setting has to be ON for the toggle to be a pause at
  // all - see the refusal checks below.
  SETTINGS.set("dailyAutoPost", true);
  await call("POST", "/internal/menu/daily-toggle");
  check("the menu lifts the pause", !STRINGS.has("daily:paused"), String(STRINGS.get("daily:paused")));
  await call("POST", TICK);
  check("…and then the schedule runs again", SUBMITTED.length === 2, `${SUBMITTED.length} posts`);

  // A post that cannot be read at all is the same verdict as one that was removed.
  resetRedis();
  post(sameDay);
  POST_STATE.set("t3_gone", { throws: true });
  await call("POST", CHECK, { data: { postId: "t3_gone" } });
  check("a post that cannot be read back also stops the schedule",
    STRINGS.get("daily:paused") === "1" && MODMAIL.length === 1,
    `${STRINGS.get("daily:paused")} ${MODMAIL.length}`);

  // A post that is fine changes nothing - the check must not be a source of false pauses.
  resetRedis();
  post(sameDay);
  await call("POST", CHECK, { data: { postId: "t3_fine" } });
  check("a healthy post leaves the schedule alone",
    !STRINGS.has("daily:paused") && MODMAIL.length === 0,
    `${STRINGS.get("daily:paused")} ${MODMAIL.length}`);

  // C5: with a schedule running, the card's countdown names the schedule, not a cadence guess.
  resetRedis();
  post(sameDay);
  SETTINGS.set("dailyAutoPost", true);
  SETTINGS.set("dailyPostHourUtc", (hourNow + 3) % 24);
  await call("POST", TICK);
  const prevSched = await call("GET", "/api/preview");
  const wantMin = Math.round((Number(STRINGS.get("daily:nextAt")) - Date.now()) / 60000);
  check("the feed card counts down to the real next publication",
    Math.abs(prevSched.json?.next?.opensInMin - wantMin) <= 2,
    `${prevSched.json?.next?.opensInMin} vs ${wantMin}`);
}

section("The card carries the case's own hook, and the previous case's winner");
// Two things that were written and never drawn: `theme.legend` (six texts, one per theme, sent by
// publicPuzzle since the first commit) and `postData.epilogue` (dec. 40, shown on the board only).
resetRedis();
post(sameDay);
STRINGS.set("lt:lastPostId", POST);
prev = await call("GET", "/api/preview");
check("the card is given the case's hook", typeof prev.json?.case?.legend === "string"
  && prev.json.case.legend.length > 20, JSON.stringify(prev.json?.case?.legend));
check("…and the hook differs between themes, which is what makes the card differ between cases",
  prev.json.case.legend !== "Cross out what the clues rule out - the last one left in a cell is the answer.",
  String(prev.json?.case?.legend));
// The card no longer carries the previous case at all: it was a LIVE re-read of that case's board,
// so the name it printed vanished the moment somebody beat the record and nothing anywhere said the
// old holder had ever held it. That fact is now a comment on the post - permanent, and the mention
// notifies the winner (src/server/herald.ts).
check("the previous case is not on the card at all any more",
  !("prev" in (prev.json ?? {})), JSON.stringify(Object.keys(prev.json ?? {})));

section("The player's own block: a run, the rank it earned, and the next rung");
// `CASES CLOSED` used to sit in this cell and the owner read it against `CLOSED IT` beside it as
// one fact printed twice. What replaced it is the only figure on the card a reader can change
// tonight - so the payload has to carry not just the rank but the DISTANCE to the next one.
resetRedis();
post(sameDay);
STRINGS.set("lt:lastPostId", POST);
prev = await call("GET", "/api/preview");
check("a player with no run has no rank and nothing to aim at",
  prev.json?.you?.rank === null && prev.json?.you?.streakCurrent === 0,
  JSON.stringify(prev.json?.you));
// A live run: the rung held comes off `best`, the distance off the run IN PROGRESS - the number
// the card prints has to be cases this player must still close, not a gap from a lapsed record.
HASHES.set(`streak:${USER}`, { best: "12", current: "8", cases: "20" });
prev = await call("GET", "/api/preview");
const youBlock = prev.json?.you;
check("a live run carries the rank it has earned",
  typeof youBlock?.rank === "string" && youBlock.rank.length > 0, JSON.stringify(youBlock));
check("…and the next rung up, which is never the one already held",
  typeof youBlock?.rankNext === "string" && youBlock.rankNext !== youBlock.rank,
  JSON.stringify(youBlock));
// Asserted against the run the payload ITSELF reports, not against the hash written above: the
// current run is derived and liveness-filtered against the post registry (src/server/streak.ts),
// so a stored `current` is an input to that, not the answer. What must hold is the relationship -
// the distance is measured from the run in progress, and it is NOT the distance from `best`.
check("…with the distance measured from the CURRENT run, not from the best one",
  youBlock?.rankIn === rankState(12, youBlock?.streakCurrent ?? 0).nextIn
  && youBlock?.rankIn !== rankState(12, 12).nextIn,
  `${youBlock?.rankIn} · current ${youBlock?.streakCurrent}`);
// The lifetime count and the best-ever run left the payload with the cell that printed them.
check("the lifetime figures the card no longer draws are no longer sent",
  !("casesSolved" in youBlock) && !("streakBest" in youBlock) && !("streak" in youBlock),
  JSON.stringify(Object.keys(youBlock)));

section("The case's four items reach the card WITH the word for each");
// Four emoji alone are a decoration, and at 21px several of them are not guessable - a kitchen
// timer reads as a clock, a wheat sheaf as a houseplant.
resetRedis();
post(sameDay);
prev = await call("GET", "/api/preview");
const objs = prev.json?.case?.objects;
check("four items, each a glyph and a word", Array.isArray(objs) && objs.length === 4
  && objs.every((o: { emoji: string; label: string }) => o.emoji?.length > 0 && o.label?.length > 0),
  JSON.stringify(objs));

section("The feed card previews the NEXT case's difficulty, and only when that is honest");
resetRedis();
post(sameDay);
STRINGS.set("lt:lastPostId", POST);
STRINGS.set("lt:level", "0"); STRINGS.set("lt:levelBase", "0");
prev = await call("GET", "/api/preview");
check("with no votes the verdict is null and the level does not move",
  prev.json?.next?.vote?.total === 0 && prev.json?.next?.vote?.verdict === null
  && prev.json?.next?.moved === null, JSON.stringify(prev.json?.next));
check("…and the card is told what it takes to decide anything",
  prev.json?.next?.vote?.minTotal === 5, String(prev.json?.next?.vote?.minTotal));

// Four votes for Harder: a landslide, and still below the significance gate. The screen must not
// promise a harder case, because the publisher will not deliver one.
HASHES.set(`vote:${POST}`, { Harder: "4", Same: "0", Softer: "0" });
prev = await call("GET", "/api/preview");
check("four votes out of five needed decide nothing at all",
  prev.json?.next?.vote?.verdict === null && prev.json?.next?.moved === null,
  JSON.stringify(prev.json?.next));
check("…and the tier reported is the one that would actually ship",
  prev.json?.next?.tier === "green", String(prev.json?.next?.tier));

HASHES.set(`vote:${POST}`, { Harder: "5", Same: "0", Softer: "0" });
prev = await call("GET", "/api/preview");
check("the fifth vote decides it, and the level moves up",
  prev.json?.next?.vote?.verdict === "Harder" && prev.json?.next?.moved === "up",
  JSON.stringify(prev.json?.next));
check("…and the tier named is the tier the next publish will take",
  prev.json?.next?.tier === "yellow", String(prev.json?.next?.tier));

// The publisher and the screen must agree, because they now share one definition of "decided".
await call("POST", "/internal/menu/create-post");
check("…and the publisher then actually ships it", STRINGS.get("lt:level") === "1",
  String(STRINGS.get("lt:level")));

// An ARCHIVE case: createDailyPost reads the vote of `lt:lastPostId`, so this post's vote steers
// nothing and the card must not imply that it does.
resetRedis();
post(sameDay);
STRINGS.set("lt:lastPostId", "t3_somethingelse");
HASHES.set(`vote:${POST}`, { Harder: "9", Same: "0", Softer: "0" });
prev = await call("GET", "/api/preview");
check("an archive case's vote steers nothing, so the card claims nothing",
  prev.json?.next?.vote === null && prev.json?.next?.tier === null,
  JSON.stringify(prev.json?.next));
check("…but the countdown survives, because that one is still true",
  typeof prev.json?.next?.opensInMin === "number", JSON.stringify(prev.json?.next));

// …and the countdown alone is what left the archive card empty. It also named the WRONG case:
// nextCase() counts to #cursor+1 while #cursor is already published, so a solver on an old post was
// told to wait hours for a case that was out. The card is now handed the case that IS live, and the
// clock on this one's own day.
STRINGS.set("bank:cursor", "7");
STRINGS.set("lt:level", "1");
ZSETS.set("lt:posts", new Map([[POST, Date.now() - 3 * 86_400_000]]));
prev = await call("GET", "/api/preview");
check("the archive card is handed the case that is live NOW, by number and level",
  prev.json?.next?.live?.number === 7 && prev.json?.next?.live?.tier === "yellow",
  JSON.stringify(prev.json?.next?.live));
check("…with a permalink BUILT, never fetched - a feed scroll may not spend a Reddit call",
  prev.json?.next?.live?.url === "https://www.reddit.com/r/deducto_puzzle_dev/comments/somethingelse/",
  String(prev.json?.next?.live?.url));
check("…and this case's own day is reported over - 24 h from publication, so 2 days back",
  prev.json?.case?.closesInMin === null
  && Math.abs(prev.json?.case?.closedMinAgo - 2880) <= 1,
  JSON.stringify([prev.json?.case?.closedMinAgo, prev.json?.case?.closesInMin]));

// An archive case whose 24 h are NOT up - which is what a second case published the same day makes.
ZSETS.set("lt:posts", new Map([[POST, Date.now() - 3 * 3_600_000]]));
prev = await call("GET", "/api/preview");
check("an archive case still inside its day says so forwards instead",
  prev.json?.case?.closedMinAgo === null
  && Math.abs(prev.json?.case?.closesInMin - 21 * 60) <= 1,
  JSON.stringify([prev.json?.case?.closedMinAgo, prev.json?.case?.closesInMin]));

// The registry keeps 60 posts. Past that there is no publication time, so there is no date - and a
// card with no date prints no date rather than a guessed one (dec. 37).
ZSETS.delete("lt:posts");
prev = await call("GET", "/api/preview");
check("…and a post the registry no longer holds is given no date at all",
  prev.json?.case?.closedMinAgo === null && prev.json?.case?.closesInMin === null,
  JSON.stringify([prev.json?.case?.closedMinAgo, prev.json?.case?.closesInMin]));

// The other half of the invariant: the LIVE post must never be handed a link to itself, and must
// keep the forward-looking pair the archive card cannot have.
resetRedis();
post(sameDay);
STRINGS.set("lt:lastPostId", POST);
STRINGS.set("bank:cursor", "7");
const liveBefore = CALLS.length;
prev = await call("GET", "/api/preview");
check("the live post is never pointed at itself, and keeps its countdown",
  prev.json?.next?.live === null && typeof prev.json?.next?.opensInMin === "number",
  JSON.stringify(prev.json?.next));
check("…and pays not one extra read for the archive answers it does not need",
  CALLS.slice(liveBefore).every((c) => !(c.op === "zScore" && c.key === "lt:posts")),
  JSON.stringify(CALLS.slice(liveBefore).filter((c) => c.key === "lt:posts")));

section("The vote that DECIDES is answered with the verdict it just created");
// The sheet is built by /api/check, before the player votes. If /api/vote answered with a tally
// but not a verdict, the screen would pair a total that had moved with a verdict that had not -
// and a player casting the decisive fifth vote would be told "no clear winner".
resetRedis();
post(sameDay);
STRINGS.set("lt:lastPostId", POST);
STRINGS.set("lt:level", "0"); STRINGS.set("lt:levelBase", "0");
HASHES.set(`vote:${POST}`, { Harder: "4", Same: "0", Softer: "0" });
r = await playThrough();
check("the sheet is built with the pre-vote verdict: nothing decided at four votes",
  r.json?.results?.next?.verdict === null && r.json?.results?.next?.moved === null,
  JSON.stringify(r.json?.results?.next));
check("…and it is told the gate, so it can say how far off it is",
  r.json?.results?.voteMinTotal === 5, String(r.json?.results?.voteMinTotal));
const voted = await call("POST", "/api/vote", { choice: "Harder" });
check("casting the fifth vote returns the verdict that vote just created",
  voted.json?.next?.verdict === "Harder" && voted.json?.next?.moved === "up",
  JSON.stringify(voted.json?.next));
check("…with the tally it was computed from, so the two can never disagree on screen",
  voted.json?.tally?.Harder === 5, JSON.stringify(voted.json?.tally));

section("THIS CASE is a board, and it is the case's own field");
// World ① had cells and a hero line and no board. `lb:{postId}` has been written on every check
// since the leaderboard shipped, so the board is free and retroactive - it only needed a scope.
resetRedis();
post(sameDay);
STRINGS.set("lt:lastPostDay", sameDay);
ZSETS.set(`lb:${POST}`, new Map([["quillfox", 100], ["harbor_light", 150]]));
// A solver of a DIFFERENT case on the same day: on the day board, not on this case's.
ZSETS.set(`lb:day:${sameDay}`, new Map([["quillfox", 100], ["harbor_light", 150], ["elsewhere", 90]]));
let caseView = await call("GET", "/api/leaderboard?scope=case");
check("the case board holds only the people who closed THIS case",
  caseView.json?.total === 2 && !JSON.stringify(caseView.json.rows).includes("elsewhere"),
  JSON.stringify(caseView.json?.rows));
check("…ranked by time, fastest first",
  caseView.json?.rows?.[0]?.name === "quillfox" && caseView.json?.rows?.[0]?.value === 100,
  JSON.stringify(caseView.json?.rows?.[0]));
check("…and it names the case rather than a date",
  /Case #\d+/.test(String(caseView.json?.period?.label)), String(caseView.json?.period?.label));
check("…and it is never provisional - a recorded second cannot be re-priced",
  caseView.json?.provisional === false, String(caseView.json?.provisional));
// The day board still exists for the mod funnel; it is simply no longer a tab.
const dayStill = await call("GET", "/api/leaderboard?scope=today");
check("the DAY board is still served for the funnel, with its own, larger field",
  dayStill.json?.total === 3, String(dayStill.json?.total));

section("The week is the last seven CASES, computed from the registry");
resetRedis();
// Nine cases across nine days; the window must take the last seven and ignore the first two.
const wkDays: string[] = [];
for (let i = 0; i < 9; i++) wkDays.push(shiftDay(sameDay, i - 8));
const posts = new Map<string, number>();
wkDays.forEach((d, i) => posts.set(`t3_w${i}`, Date.parse(`${d}T10:00:00Z`)));
ZSETS.set("lt:posts", posts);
wkDays.forEach((d, i) => {
  // `oldtimer` solved only the two cases that fall OUTSIDE the window.
  const h: Record<string, string> = {};
  if (i < 2) h["oldtimer"] = `200|0|green|t3_w${i}|1`;
  else h[NAME] = `200|0|green|t3_w${i}|1`;
  HASHES.set(`lb:solves:${d}`, h);
});
const wkView = await call("GET", "/api/leaderboard?scope=week");
check("a player whose only solves fall outside the last seven is not on the board",
  !JSON.stringify(wkView.json?.rows).includes("oldtimer"), JSON.stringify(wkView.json?.rows));
check("…and one who solved all seven inside it is",
  wkView.json?.rows?.[0]?.name === NAME, JSON.stringify(wkView.json?.rows?.[0]));
check("…scored as seven cases, not seven days of a calendar week",
  wkView.json?.rows?.[0]?.value > 0 && wkView.json?.period?.key === "last7",
  JSON.stringify({ v: wkView.json?.rows?.[0]?.value, p: wkView.json?.period }));
check("…and nothing was accumulated to get there: no lb:week key was written",
  ![...ZSETS.keys()].some((k) => k.startsWith("lb:week:")), JSON.stringify([...ZSETS.keys()]));

section("Freshness is a bonus for the day's case, never a cut to the archive");
// Two identical solves, same time, same hints, same tier - one closed on the case's own day and
// one out of the archive. The only difference is the flag, and it is worth FRESH_BONUS.
{
  const same = (fresh: string) => `200|0|green|t3_x|${fresh}`;
  const a = decodeSolve("a", same("1"));
  const b = decodeSolve("b", same("0"));
  const t = targetFor("green");
  const pa = pointsWithFreshness(pointsForSolve(a!.timeSec, a!.hints, t), a!.fresh);
  const pb = pointsWithFreshness(pointsForSolve(b!.timeSec, b!.hints, t), b!.fresh);
  check("the same solve is worth more on the day the case ran", pa > pb, `${pa} vs ${pb}`);
  check("…by exactly the bonus, so the archive keeps its own full range", pa - pb === 250, String(pa - pb));
  // The migration default: a record written before the field existed counts as fresh, so no
  // existing standing moves when this ships.
  const old = decodeSolve("c", "200|0|green|t3_x");
  check("a record written before the field existed counts as fresh", old?.fresh === true,
    JSON.stringify(old));
}

section("The result hero measures THIS CASE, and the day keeps its own titled block");
resetRedis();
post(sameDay);
STRINGS.set("lt:lastPostId", POST);
// Two other people closed this case faster; a third solved a DIFFERENT case the same day. The
// hero's field is the case's three, never the day's four.
ZSETS.set(`lb:${POST}`, new Map([["quillfox", 100], ["harbor_light", 150]]));
ZSETS.set(`lb:day:${sameDay}`, new Map([["quillfox", 100], ["harbor_light", 150], ["elsewhere", 90]]));
r = await playThrough(244);
let R = r.json?.results;
check("the hero's field is this case's closers", R?.caseTotal === 3, String(R?.caseTotal));
check("…and your place in it is by time, not by finishing order",
  R?.caseRank === 3 && R?.solveOrder === 1, `rank ${R?.caseRank}, order ${R?.solveOrder}`);
check("…while the day's total stays the day's, for the board titled with the day",
  R?.total === 4, String(R?.total));
check("…and the two are genuinely different numbers here", R?.caseTotal !== R?.total, "");

section("Your best yet - a lifetime figure delivered as news, exactly once");
check("a player's FIRST close is not announced as a personal best", R?.personalBest === false,
  `personalBest=${R?.personalBest} cases=${R?.casesSolved}`);
// A second, faster case on another day. `bestTimeSec` is written by bumpProfile inside writeSolve,
// so by the time the card is built the new time is already the record.
const day2 = shiftDay(sameDay, 1);
context.postId = "t3_second";
context.postData = { idx: 0, date: day2, n: 42, level: 0 };
STRINGS.set("lt:lastPostDay", day2);
const k2 = `att:t3_second:${USER}`;
await call("GET", "/api/daily");
await call("POST", "/api/state", { grid: touched, seconds: 30 });
HASHES.set(k2, { ...HASHES.get(k2)!, startedAt: String(Date.now() - 120_000) });
r = await call("POST", "/api/check", { grid: solved, seconds: 120 });
R = r.json?.results;
check("a faster second close IS announced", R?.personalBest === true,
  `personalBest=${R?.personalBest} cases=${R?.casesSolved}`);
check("…and replaying it does not announce it again",
  (await call("POST", "/api/check", { grid: solved, seconds: 120 })).json?.results?.personalBest === false, "");
// A slower third close: the record stands, so there is nothing to announce.
const day3 = shiftDay(sameDay, 2);
context.postId = "t3_third";
context.postData = { idx: 0, date: day3, n: 43, level: 0 };
STRINGS.set("lt:lastPostDay", day3);
const k3 = `att:t3_third:${USER}`;
await call("GET", "/api/daily");
await call("POST", "/api/state", { grid: touched, seconds: 30 });
HASHES.set(k3, { ...HASHES.get(k3)!, startedAt: String(Date.now() - 600_000) });
r = await call("POST", "/api/check", { grid: solved, seconds: 600 });
check("a slower close is not a personal best", r.json?.results?.personalBest === false,
  String(r.json?.results?.personalBest));
check("…and the record itself is untouched by it",
  HASHES.get(`user:${NAME}`)?.bestTimeSec === "120", String(HASHES.get(`user:${NAME}`)?.bestTimeSec));

// ── the record must be the one this solve had to BEAT, not the one it left behind ──────────────
// `personalBest` compares against `user:.bestTimeSec` as it stood BEFORE the solve was written,
// rather than after. The difference is invisible in the happy path and the reason is the gate in
// writeSolve: `bumpProfile` runs only when a close is the day's first or an improvement on it, so
// reading the field afterwards means reading a number this very solve may or may not have moved,
// depending on a rule that belongs to a different module. Reading it first makes the claim exactly
// "you beat what you had", whatever that rule does next.
//
// (The window where the two answers actually differ turns out to be empty today: the day's first
// close always reaches bumpProfile, so `bestTimeSec` can never be slower than the day's record,
// and a second case that beats the record is by definition an improvement on it. This is
// hardening, not a bug fix - it just stops the correctness of one screen depending on the gating
// of another module.)
//
// Its own player and its own day, so this cannot disturb the counters the sections below read.
const PB_USER = "t2_pb", PB_NAME = "pbtester";
context.userId = PB_USER; AUTH.username = PB_NAME;
const pbDay = shiftDay(sameDay, 3);
STRINGS.set("lt:lastPostDay", pbDay);
HASHES.set(`user:${PB_NAME}`, { bestTimeSec: "300" });                 // an all-time best of 05:00
HASHES.set(`streak:${PB_USER}`, { current: "4", best: "4", cases: "9", lastDate: shiftDay(pbDay, -1) });

async function pbClose(pid: string, n: number, secs: number) {
  context.postId = pid;
  context.postData = { idx: 0, date: pbDay, n, level: 0 };
  await call("GET", "/api/daily");
  await call("POST", "/api/state", { grid: touched, seconds: 30 });
  const k = `att:${pid}:${PB_USER}`;
  HASHES.set(k, { ...HASHES.get(k)!, startedAt: String(Date.now() - secs * 1000) });
  return call("POST", "/api/check", { grid: solved, seconds: secs });
}
// The day's first case, slower than the all-time record: not a personal best, and it becomes the
// day's record all the same.
r = await pbClose("t3_pbA", 44, 400);
check("the day's first close, slower than the record, is not announced",
  r.json?.results?.personalBest === false, String(r.json?.results?.personalBest));
// A second case the same day, beating the all-time record of 300.
r = await pbClose("t3_pbB", 45, 250);
check("a second case that day which beats the all-time record IS announced",
  r.json?.results?.personalBest === true, String(r.json?.results?.personalBest));
check("…and the record it beat is now the record", HASHES.get(`user:${PB_NAME}`)?.bestTimeSec === "250",
  String(HASHES.get(`user:${PB_NAME}`)?.bestTimeSec));
// A third, slower than the one just announced: the record stands, so there is no news.
r = await pbClose("t3_pbC", 46, 260);
check("…and a slower third close is NOT announced a second time",
  r.json?.results?.personalBest === false, String(r.json?.results?.personalBest));
context.userId = USER; AUTH.username = NAME;
STRINGS.set("lt:lastPostDay", day3);

section("GET /api/me - world ③ finally has a place, built from keys nothing was reading");
context.postId = POST;
let me = await call("GET", "/api/me");
check("your file names you", me.json?.name === NAME, String(me.json?.name));
check("…counts CASES, not days (three closes across three days here)",
  me.json?.casesClosed === 3, String(me.json?.casesClosed));
check("…and days separately, from lb:days:{name}", me.json?.daysSolved === 3, String(me.json?.daysSolved));
check("…carries the best time nothing has ever printed before", me.json?.bestTimeSec === 120,
  String(me.json?.bestTimeSec));
check("…the points and the size of the field they place you in",
  me.json?.points > 0 && me.json?.place === 1 && me.json?.detectives >= 1,
  JSON.stringify({ points: me.json?.points, place: me.json?.place, det: me.json?.detectives }));
check("…the SAME rank ladder the result sheet and the flair read",
  JSON.stringify(me.json?.rank) === JSON.stringify(rankState(
    Number(HASHES.get(`streak:${USER}`)?.best ?? 0), Number(HASHES.get(`streak:${USER}`)?.current ?? 0))),
  JSON.stringify(me.json?.rank));
// Ordered by DATE, which is not what the key is ordered by: `lb:days:{name}` is a ZSET scored by
// that day's POINTS, so reading it in rank order and taking the tail hands back a player's BEST
// days under the heading "recent". Here the middle day scored the most, so a points-ordered read
// puts it first and this check fails - which is exactly how it was found.
check("…and the day-by-day history, newest first and not best-first",
  me.json?.days?.length === 3
  && me.json.days.every((d: { date: string }, i: number) =>
    i === 0 || me.json.days[i - 1].date > d.date),
  JSON.stringify(me.json?.days));

const meBefore = CALLS.length;
await call("GET", "/api/me");
check("your file is a pure read too",
  CALLS.slice(meBefore).filter((c) => WRITE_OPS.has(c.op)).length === 0,
  JSON.stringify(CALLS.slice(meBefore).filter((c) => WRITE_OPS.has(c.op))));

AUTH.username = null;
me = await call("GET", "/api/me");
check("a solve with no resolvable name gets an honest empty file, not invented figures",
  me.json?.name === null && me.json?.points === 0 && me.json?.bestTimeSec === 0,
  JSON.stringify(me.json));
AUTH.username = NAME;

section("The epilogue is read live, not frozen at publication");
resetRedis();
context.postId = "t3_prev";
context.postData = { idx: 0, date: sameDay, n: 40, level: 0 };
ZSETS.set("lb:t3_prev", new Map([["quillfox", 200]]));
HASHES.set("vote:t3_prev", { Harder: "1", Same: "0", Softer: "0" });
STRINGS.set("lt:lastPostId", "t3_prev");
const created = await call("POST", "/internal/menu/create-post");
check("publishing records which case the epilogue is about", Boolean(created.json?.navigateTo), "");
const newPost = SUBMITTED[SUBMITTED.length - 1];
const epi = (newPost.postData as { epilogue?: { solvers: number; postId?: string } }).epilogue;
check("…and the epilogue carries that case's id", epi?.postId === "t3_prev", JSON.stringify(epi));
check("…with the count as it stood at publication", epi?.solvers === 1, String(epi?.solvers));
// Somebody closes the old case AFTER the next one is out. The sentence is in the present tense.
ZSETS.set("lb:t3_prev", new Map([["quillfox", 200], ["latecomer", 300]]));
context.postId = `t3_p${SUBMITTED.length}`;      // the id the stub hands back from submitCustomPost
context.postData = newPost.postData;
const withEpi = await call("GET", "/api/daily");
check("a solve after publication is visible to the epilogue",
  withEpi.json?.meta?.epilogue?.solvers === 2, JSON.stringify(withEpi.json?.meta?.epilogue));
check("…and a faster one would take the name with it",
  withEpi.json?.meta?.epilogue?.who === "quillfox", JSON.stringify(withEpi.json?.meta?.epilogue));

section("The dead field is gone");
check("/api/daily no longer computes a per-case count nothing renders",
  withEpi.json?.meta?.solversTotal === undefined, JSON.stringify(Object.keys(withEpi.json?.meta ?? {})));

finish();
