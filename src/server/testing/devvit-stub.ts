// Full stand-in for @devvit/web/server, so src/server/{index,leaderboard}.ts can be driven
// off-platform through their REAL express routes.
//
// The older stub (../06-server/devvit-stub.ts) only covers what /api/preview touches; the
// leaderboard path needs hGet / hMGet / hSetNX / zScore / zIncrBy / expire and a zRange that
// honours { reverse }. Semantics follow @devvit/redis/types/redis.d.ts:
//   zScore -> number | undefined      zRank -> number | undefined
//   hGet   -> string | undefined      hMGet -> (string | null)[]
//   hSetNX -> 1 when the field was created, 0 when it already existed
import type { Server } from "node:http";

export type Cmd = { op: string; key: string };
export const CALLS: Cmd[] = [];
export const WRITE_OPS = new Set([
  "zRem", "hDel",
  "set", "hSet", "hSetNX", "incrBy", "hIncrBy", "zAdd", "zIncrBy", "del", "zRemRangeByRank", "expire",
]);

export const HASHES = new Map<string, Record<string, string>>();
export const STRINGS = new Map<string, string>();
export const ZSETS = new Map<string, Map<string, number>>();

export function resetRedis(): void {
  CALLS.length = 0; HASHES.clear(); STRINGS.clear(); ZSETS.clear();
  SUBMITTED.length = 0; THROW_ON.clear(); THROW_ONCE.clear();
  FLAIRS.length = 0; JOBS.length = 0;
  SETTINGS.clear(); POST_STATE.clear(); MODMAIL.length = 0; COMMENTS.length = 0;
  FLAIR_STATE.templates = [{ id: "t1" }];
  FLAIR_STATE.current.clear();
}

/** Fault injection: force a redis op to throw, to test "was the exception swallowed?" hypotheses. */
export const THROW_ON = new Map<string, string>(); // `${op} ${key}` -> message, every time
/** Throws ONCE and then clears itself - a transport blip, which is a different thing from an
 *  outage and must be modelled as a different thing. Retry logic tested against a permanent
 *  failure proves only that the retry also fails. */
export const THROW_ONCE = new Map<string, string>();
const rec = (op: string, key: string) => {
  CALLS.push({ op, key });
  const blip = THROW_ONCE.get(`${op} ${key}`);
  if (blip) { THROW_ONCE.delete(`${op} ${key}`); throw new Error(blip); }
  const msg = THROW_ON.get(`${op} ${key}`);
  if (msg) throw new Error(msg);
};

const zs = (key: string) => ZSETS.get(key) ?? new Map<string, number>();
const sortedOf = (key: string) => [...zs(key).entries()].sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1));

export const redis = {
  async get(key: string) { rec("get", key); return STRINGS.get(key) ?? undefined; },
  async set(key: string, v: string) { rec("set", key); STRINGS.set(key, v); },
  async del(...keys: string[]) { for (const k of keys) { rec("del", k); HASHES.delete(k); STRINGS.delete(k); ZSETS.delete(k); } },
  async expire(key: string, _sec: number) { rec("expire", key); },

  async hGetAll(key: string) { rec("hGetAll", key); return { ...(HASHES.get(key) ?? {}) }; },
  async hGet(key: string, field: string) { rec("hGet", key); return HASHES.get(key)?.[field] ?? undefined; },
  async hMGet(key: string, fields: string[]) {
    rec("hMGet", key);
    const h = HASHES.get(key) ?? {};
    return fields.map((f) => (h[f] === undefined ? null : h[f]));
  },
  async hSet(key: string, f: Record<string, string>) {
    rec("hSet", key); HASHES.set(key, { ...(HASHES.get(key) ?? {}), ...f });
    return Object.keys(f).length;
  },
  async hSetNX(key: string, field: string, value: string) {
    rec("hSetNX", key);
    const h = HASHES.get(key) ?? {};
    if (h[field] !== undefined) { HASHES.set(key, h); return 0; }
    h[field] = value; HASHES.set(key, h); return 1;
  },
  async hIncrBy(key: string, field: string, by: number) {
    rec("hIncrBy", key);
    const h = HASHES.get(key) ?? {}; h[field] = String(Number(h[field] ?? 0) + by); HASHES.set(key, h);
    return Number(h[field]);
  },
  async incrBy(key: string, by: number) {
    rec("incrBy", key);
    const n = Number(STRINGS.get(key) ?? 0) + by; STRINGS.set(key, String(n)); return n;
  },

  async zAdd(key: string, ...ms: { member: string; score: number }[]) {
    rec("zAdd", key);
    const z = zs(key); for (const m of ms) z.set(m.member, m.score); ZSETS.set(key, z);
    return ms.length;
  },
  async zIncrBy(key: string, member: string, by: number) {
    rec("zIncrBy", key);
    const z = zs(key); const n = (z.get(member) ?? 0) + by; z.set(member, n); ZSETS.set(key, z);
    return n;
  },
  async zCard(key: string) { rec("zCard", key); return ZSETS.get(key)?.size ?? 0; },
  async zScore(key: string, member: string) { rec("zScore", key); return ZSETS.get(key)?.get(member); },
  async zRank(key: string, member: string) {
    rec("zRank", key);
    const i = sortedOf(key).findIndex(([m]) => m === member);
    return i < 0 ? undefined : i;
  },
  // `by` was ignored, and that is not a missing convenience - it is the harness blessing a call it
  // never actually performed. `{ by: "score" }` is ZRANGEBYSCORE: `start`/`stop` are a SCORE range,
  // inclusive at both ends, not rank indices. Read as ranks, a score window of [0, 299] silently
  // returned the first 300 ROWS - i.e. the whole board, on every board this app has - so an
  // implementation counting how many players are faster than you would have been handed the field
  // size and passed. Default (and `{ by: "rank" }`) keeps the index behaviour it always had.
  async zRange(key: string, start: number, stop: number, opts?: { by?: string; reverse?: boolean }) {
    rec("zRange", key);
    let sorted = sortedOf(key);
    if (opts?.by === "score") {
      const lo = Math.min(start, stop), hi = Math.max(start, stop);
      sorted = sorted.filter(([, score]) => score >= lo && score <= hi);
      if (opts.reverse) sorted = sorted.reverse();
      return sorted.map(([member, score]) => ({ member, score }));
    }
    if (opts?.reverse) sorted = sorted.reverse();
    const end = stop < 0 ? sorted.length : stop + 1;
    return sorted.slice(start, end).map(([member, score]) => ({ member, score }));
  },
  async zRem(key: string, members: string[]) {
    rec("zRem", key);
    const z = zs(key); for (const m of members) z.delete(m); ZSETS.set(key, z);
    return members.length;
  },
  async hDel(key: string, fields: string[]) {
    rec("hDel", key);
    const h = HASHES.get(key) ?? {}; for (const f of fields) delete h[f]; HASHES.set(key, h);
    return fields.length;
  },
  async zRemRangeByRank(key: string, s: number, e: number) {
    rec("zRemRangeByRank", key);
    const sorted = sortedOf(key);
    const end = e < 0 ? sorted.length : e + 1;
    const z = zs(key);
    for (const [m] of sorted.slice(s, end)) z.delete(m);
    ZSETS.set(key, z);
    return end - s;
  },
};

// `subredditId` is part of the real context and was simply missing here. Its absence is not
// harmless: modmail is addressed by t5_ id, so code that notifies moderators silently did nothing
// under test while working in production - a stub that answers a field with `undefined` makes the
// suite green about a path it never took.
export const context: {
  postId?: string; userId?: string; subredditName?: string; subredditId?: string; postData?: unknown;
} = {
  postId: "t3_test", userId: "t2_user",
  subredditName: "deducto_puzzle_dev", subredditId: "t5_dev", postData: undefined,
};

export type Submitted = { title: string; entry?: string; postData?: unknown };
export const SUBMITTED: Submitted[] = [];
/** Username the platform resolves for the current request; null reproduces the "no username" guard. */
export const AUTH = { username: "ma9leb" as string | null };

/** Every flair this run wrote, newest last, so a test can assert what a player ended up wearing. */
export type FlairWrite = { subredditName: string; username: string; text?: string; cssClass?: string };
export const FLAIRS: FlairWrite[] = [];
/** Flair state the "subreddit" already holds: templates configured, and each player's current flair. */
export const FLAIR_STATE = {
  templates: [{ id: "t1" }] as { id: string }[],   // empty list = user flair switched off in the sub
  current: new Map<string, { flairCssClass?: string }>(),
};

/** Per-subreddit app settings. A key a moderator has never opened reads as `undefined` on the real
 * platform, NOT as the default declared in devvit.json - so the map starts empty and the code under
 * test has to supply its own default. That is the difference this stub exists to preserve. */
export const SETTINGS = new Map<string, string | number | boolean>();
export const settings = {
  async get<T>(name: string): Promise<T | undefined> { return SETTINGS.get(name) as T | undefined; },
  async getAll() { return Object.fromEntries(SETTINGS); },
};

/** How the "subreddit" answers when a post is read back. `removed`/`spam` are what the survival
 * check reads; `throws` reproduces a post that cannot be fetched at all (deleted). */
export const POST_STATE = new Map<string, { removed?: boolean; spam?: boolean; removedBy?: string; throws?: boolean }>();
/** Every modmail this run sent, so a test can assert the moderators were actually told. */
export const MODMAIL: { subject: string; bodyMarkdown: string }[] = [];
/** Every comment this run wrote, so a test can assert what the case's thread actually says. */
export const COMMENTS: { id: string; text: string; runAs?: string }[] = [];

export const reddit = {
  async getCurrentUsername() { return AUTH.username ?? undefined; },
  modMail: {
    async createModDiscussionConversation(m: { subject: string; bodyMarkdown: string }) {
      MODMAIL.push(m);
      return "conv1";
    },
  },
  async submitCustomPost(o: Submitted) {
    SUBMITTED.push(o);
    return { id: `t3_p${SUBMITTED.length}`, url: `/r/x/${SUBMITTED.length}`, async sticky(_n: number) {} };
  },
  async getPostById(id: string) {
    const st = POST_STATE.get(id);
    if (st?.throws) throw new Error("no such post");
    return {
      permalink: `/r/x/${id}`, url: `/r/x/${id}`,
      removed: st?.removed ?? false, spam: st?.spam ?? false, removedBy: st?.removedBy,
    };
  },
  async submitComment(o: { id: string; text: string; runAs?: string }) {
    COMMENTS.push(o);
    return { id: `t1_c${COMMENTS.length}` };
  },
  async getUserFlairTemplates(_sub: string) { return FLAIR_STATE.templates; },
  async getUserByUsername(username: string) {
    return {
      username,
      async getUserFlairBySubreddit(sub: string) { return FLAIR_STATE.current.get(`${sub}|${username}`); },
    };
  },
  async setUserFlair(o: FlairWrite) {
    const boom = THROW_ON.get(`setUserFlair ${o.username}`);
    if (boom) throw new Error(boom);
    FLAIRS.push(o);
    FLAIR_STATE.current.set(`${o.subredditName}|${o.username}`, { flairCssClass: o.cssClass });
  },
};

/**
 * One-off scheduler jobs. The real platform re-enters the app in the APP ACCOUNT's context, which
 * is the whole reason flair goes through here rather than straight out of /api/check - so the stub
 * runs the job for real, through the same express app, instead of pretending it fired.
 */
export type ScheduledJob = { name: string; data?: unknown; runAt?: Date };
export const JOBS: ScheduledJob[] = [];
export const scheduler = {
  async runJob(job: ScheduledJob) {
    JOBS.push(job);
    await RUN_JOB?.(job);
    return `job-${JOBS.length}`;
  },
  async cancelJob(_id: string) {},
  async listJobs() { return JOBS; },
};
/** Set by the harness once the express app exists; keeps this module free of a cycle. */
export let RUN_JOB: ((job: ScheduledJob) => Promise<void>) | null = null;
export function onJob(fn: ((job: ScheduledJob) => Promise<void>) | null): void { RUN_JOB = fn; }

export let APP: ((req: unknown, res: unknown) => void) | null = null;
export function createServer(app: (req: unknown, res: unknown) => void): Server {
  APP = app;
  return { on() { return this; }, listen() { return this; } } as unknown as Server;
}
export function getServerPort(): number { return 0; }
