// Shared driver for the server-bug harness: express call() + grid builders.
// Importing ../../../../src/server/index.js captures the express app instead of listening
// (@devvit/web/server is aliased to ./devvit-stub.ts by tsconfig.harness.json).
import { APP, HASHES, STRINGS, ZSETS, onJob, type ScheduledJob } from "./devvit-stub.js";
import type { GridState, PuzzleCtx } from "../../shared/status.js";
import type { Clue } from "../../shared/types.js";
import { FLAIR_TOKENS, TIME_TOKENS } from "../../shared/themes.js";
import { Puzzle } from "../engine.js";
import bank from "../bank.json" with { type: "json" };

export interface BankEntry {
  themeId: string; tier: string; suspects: string[]; objectTokens: string[];
  clues: unknown[]; solution: Record<string, Record<string, string>>;
}
export const BANK = bank as unknown as BankEntry[];
export const CAT_IDS = ["flair", "time", "object"];

export function ctxFor(e: BankEntry): PuzzleCtx {
  return {
    suspects: e.suspects, catIds: CAT_IDS,
    cats: { flair: [...FLAIR_TOKENS], time: [...TIME_TOKENS], object: e.objectTokens },
    timeValues: [...TIME_TOKENS],
  };
}

/** Empty board (every cell 0) - what a player starts with. */
export function blankGrid(e: BankEntry): GridState {
  const ctx = ctxFor(e);
  const g: GridState = {};
  for (const c of ctx.catIds) {
    g[c] = {};
    for (const s of ctx.suspects) { g[c][s] = {}; for (const v of ctx.cats[c]) g[c][s][v] = 0; }
  }
  return g;
}

/**
 * Board with the whole case crossed out correctly: for every (cat, suspect) all values but the
 * true one are 1, so effectiveValue() reads back the solution and gradeGrid() says "solved".
 */
export function solvedGrid(e: BankEntry): GridState {
  const ctx = ctxFor(e);
  const g = blankGrid(e);
  for (const c of ctx.catIds)
    for (const s of ctx.suspects)
      for (const v of ctx.cats[c]) g[c][s][v] = v === e.solution[s][c] ? 0 : 1;
  return g;
}

/**
 * The board a player holds once every crossing-out the 4×3 grid allows has been taken - the WEAK
 * fixpoint. On a 🟡 case this is the wall: the board itself has nothing left to give, which is the
 * exact state where both free hint rungs used to answer "stuck" and pressing them did nothing.
 */
export function wallGrid(e: BankEntry): GridState {
  const ctx = ctxFor(e);
  const pz = new Puzzle(e.suspects, ctx.cats, e.clues as Clue[], e.solution);
  const poss = pz.freshPoss();
  pz.propagate(poss, e.clues as Clue[]);
  const g = blankGrid(e);
  for (const c of ctx.catIds)
    for (const s of ctx.suspects)
      for (const v of ctx.cats[c]) g[c][s][v] = poss[c][s].has(v) ? 0 : 1;
  return g;
}

/** First bank index of a tier. A test pins its own case through postData.idx. */
export const firstOfTier = (tier: string): number => BANK.findIndex((e) => e.tier === tier);

/** One crossed-out chip: a board that has been "touched" but deduces nothing. */
export function nudgedGrid(e: BankEntry): GridState {
  const ctx = ctxFor(e);
  const g = blankGrid(e);
  g.flair[ctx.suspects[0]][ctx.cats.flair[0]] = 1;
  return g;
}

// A one-off scheduler job is not a promise the platform keeps quietly - it re-enters the app in
// the APP ACCOUNT's context, which is the entire reason the flair path exists. So the stub runs
// jobs for real, through the same express app, the moment they are queued: `runJob` inside
// /api/check therefore reaches /internal/scheduler/<name> before the request resolves, and a test
// asserting "the solve set a flair" is asserting the real chain rather than an intention.
onJob(async (job: ScheduledJob) => {
  await call("POST", `/internal/scheduler/${job.name}`, { data: job.data });
});

export function call(method: string, url: string, body?: unknown): Promise<{ status: number; json: any }> {
  return new Promise((resolve, reject) => {
    const req: any = {
      method, url, originalUrl: url, headers: { "content-type": "application/json" },
      body, socket: {}, connection: {}, complete: true,
      on(ev: string, cb: (...a: unknown[]) => void) { if (ev === "end") cb(); return req; },
      once() { return req; }, removeListener() { return req; }, resume() { return req; },
      pipe() { return req; }, setEncoding() { return req; }, read() { return null; },
    };
    const chunks: string[] = [];
    const res: any = {
      statusCode: 200, headersSent: false, locals: {},
      setHeader() { return res; }, getHeader() { return undefined; }, removeHeader() { return res; },
      set() { return res; }, type() { return res; }, vary() { return res; },
      status(c: number) { res.statusCode = c; return res; },
      json(v: unknown) { resolve({ status: res.statusCode, json: v }); return res; },
      send(v: unknown) { resolve({ status: res.statusCode, json: v }); return res; },
      end(v?: string) { if (v) chunks.push(v); resolve({ status: res.statusCode, json: chunks.join("") }); return res; },
      on() { return res; }, once() { return res; }, emit() { return true; },
      removeListener() { return res; }, writeHead() { return res; },
    };
    // express 5 forwards a rejected handler here; surface it instead of hanging the promise.
    const done = (err?: unknown) => { if (err) reject(err); else resolve({ status: 404, json: null }); };
    try { (APP as any)(req, res, done); } catch (e) { reject(e); }
  });
}

export const dump = () => ({
  hashes: [...HASHES.keys()].sort(),
  strings: [...STRINGS.keys()].sort(),
  zsets: [...ZSETS.entries()].map(([k, v]) => `${k}{${[...v.entries()].map(([m, s]) => `${m}=${s}`).join(",")}}`).sort(),
});

let fails = 0;
export function check(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "[OK]  " : "[FAIL]"} ${name}${detail && !cond ? ` - ${detail}` : ""}`);
  if (!cond) fails++;
}
export function section(t: string): void { console.log(`\n── ${t} ──`); }
export function finish(): void {
  console.log(fails === 0 ? "\nALL PASSED ✅" : `\nFAILURES: ${fails} ❌`);
  process.exit(fails ? 1 : 0);
}
