// Deducto - difficulty engine. A deterministic TypeScript port of a Python reference solver,
// model-for-model, parity-checked by engine.test.ts (same Case #0/#1 anchors + fork).
//
//   Puzzle  - problem + brute-force uniqueness + WEAK model (domains per suspect).
//   Grid    - GRID model (all pairwise value×value grids + transitivity).
//   classify() - tier by the fork of two models: 🟢 weak / 🟡 grid-not-weak / 🔴 not grid.
//   generate() - assembles a case of the given tier: seeded solution → pool of true clues → selection.
//
// Clue shape - see shared/types.ts. The logic is deterministic; the AI does not touch it.

import type { Cats, Clue, Ref, Solution } from "../shared/types.js";
import { clueKey } from "../shared/types.js";
import { candSet, type GridState, type PuzzleCtx } from "../shared/status.js";

// ───────────────────────── seeded RNG (mulberry32) ─────────────────────────
// Parity with Python on OUTPUT is not required: the test checks that the generator produces
// a case of the requested tier with a unique solution, not the bit-for-bit same sequence.
export class RNG {
  private s: number;
  constructor(seed: number) { this.s = seed >>> 0; }
  next(): number {
    this.s = (this.s + 0x6d2b79f5) | 0;
    let t = Math.imul(this.s ^ (this.s >>> 15), 1 | this.s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  randint(n: number): number { return Math.floor(this.next() * n); }
  shuffle<T>(arr: T[]): void {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.randint(i + 1);
      const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    }
  }
  sample<T>(arr: T[], k: number): T[] {
    const copy = arr.slice();
    this.shuffle(copy);
    return copy.slice(0, k);
  }
}

// Deterministic seed from the string `subredditId:date:themeId` (xmur3).
export function seedFromString(str: string): number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

// ───────────────────────── combinatorial helpers ─────────────────────────
export function permutations<T>(arr: T[]): T[][] {
  if (arr.length <= 1) return [arr.slice()];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i++) {
    const rest = arr.slice(0, i).concat(arr.slice(i + 1));
    for (const p of permutations(rest)) out.push([arr[i], ...p]);
  }
  return out;
}

function* product<T>(lists: T[][]): Generator<T[]> {
  if (lists.length === 0) { yield []; return; }
  const [first, ...rest] = lists;
  for (const x of first) for (const r of product(rest)) yield [x, ...r];
}

// itertools.permutations(arr, 2): all ordered pairs i≠j.
function pairs<T>(arr: T[]): [T, T][] {
  const out: [T, T][] = [];
  for (let i = 0; i < arr.length; i++)
    for (let j = 0; j < arr.length; j++)
      if (i !== j) out.push([arr[i], arr[j]]);
  return out;
}

const isSingleton = (set: Set<string>, v: string) => set.size === 1 && set.has(v);

// ───────────────────────── WEAK model + brute-force ─────────────────────────
// The WEAK state is exactly what the 4×3 board can physically record: per (category, suspect) the
// set of candidates still standing. Exported so callers can seed it from a player's board
// (src/server/index.ts, hint ladder) or measure how far it gets (scripts/check-solvability.ts).
export type Poss = Record<string, Record<string, Set<string>>>; // cat -> suspect -> Set(values)

export class Puzzle {
  S: string[];
  CATS: Cats;
  TO: Record<string, number>;
  clues: Clue[];
  solution: Solution | null;

  constructor(suspects: string[], cats: Cats, clues: Clue[], solution: Solution | null = null) {
    this.S = suspects;
    this.CATS = cats;
    this.TO = {};
    cats["time"].forEach((t, i) => { this.TO[t] = i; });
    this.clues = clues;
    this.solution = solution;
  }

  // ---- brute-force ----
  private _ok(a: Solution, clue: Clue): boolean {
    const owner = (cat: string, v: string): string => this.S.find((s) => a[s][cat] === v)!;
    const rtime = (ref: Ref): number => {
      const s = ref[0] === "s" ? ref[1] : owner(ref[0], ref[1]);
      return this.TO[a[s]["time"]];
    };
    switch (clue.k) {
      case "ne": return a[clue.s][clue.cat] !== clue.v;
      case "same": return owner(clue.a[0], clue.a[1]) === owner(clue.b[0], clue.b[1]);
      case "nsame": return owner(clue.a[0], clue.a[1]) !== owner(clue.b[0], clue.b[1]);
      case "before": return rtime(clue.a) < rtime(clue.b);
    }
  }

  // Number of solutions (cut off at limit). Returns [n, example_solution].
  count(clues: Clue[], limit = 2): [number, Solution | null] {
    const cats = Object.keys(this.CATS);
    const perms: string[][][] = cats.map((c) => permutations(this.CATS[c]));
    let n = 0;
    let found: Solution | null = null;
    for (const combo of product(perms)) {
      const a: Solution = {};
      this.S.forEach((s, si) => {
        a[s] = {};
        cats.forEach((c, ci) => { a[s][c] = combo[ci][si]; });
      });
      if (clues.every((cl) => this._ok(a, cl))) {
        n++; found = a;
        if (n >= limit) return [n, found];
      }
    }
    return [n, found];
  }

  // ---- WEAK propagation: domains per suspect, no value×value grids ----
  // Every cell wide open. Mutate the sets to seed it from a partial board.
  freshPoss(): Poss {
    const poss: Poss = {};
    for (const cat of Object.keys(this.CATS)) {
      poss[cat] = {};
      for (const s of this.S) poss[cat][s] = new Set(this.CATS[cat]);
    }
    return poss;
  }

  // The two contradictions the 4×3 board can actually show: a cell with no candidates left, and a
  // value nobody can own (each category has exactly one value per suspect). Anything subtler -
  // general pigeonhole over a subset of suspects - is outside what WEAK models, on purpose: the
  // board can't express it either. Never fires from a cold start on a valid case (propagation is
  // sound, so the true value always survives), only on a board the player has broken.
  contradicts(poss: Poss): boolean {
    for (const cat of Object.keys(this.CATS)) {
      for (const s of this.S) if (poss[cat][s].size === 0) return true;
      for (const v of this.CATS[cat]) if (!this.S.some((s) => poss[cat][s].has(v))) return true;
    }
    return false;
  }

  // How many of the S×CATS cells are pinned to exactly one candidate (out of 12 on the 4×3 board).
  determinedCells(poss: Poss): number {
    let n = 0;
    for (const c of Object.keys(this.CATS)) for (const s of this.S) if (poss[c][s].size === 1) n++;
    return n;
  }

  cellCount(): number { return this.S.length * Object.keys(this.CATS).length; }

  propagate(poss: Poss, clues: Clue[]): void {
    const timesOf = (ref: Ref): Set<number> => {
      const out = new Set<number>();
      if (ref[0] === "s") {
        for (const t of poss["time"][ref[1]]) out.add(this.TO[t]);
        return out;
      }
      const [cat, v] = ref;
      for (const s of this.S) {
        if (poss[cat][s].has(v)) for (const t of poss["time"][s]) out.add(this.TO[t]);
      }
      return out;
    };

    let changed = true;
    while (changed) {
      changed = false;
      for (const clue of clues) {
        if (clue.k === "ne") {
          if (poss[clue.cat][clue.s].has(clue.v)) { poss[clue.cat][clue.s].delete(clue.v); changed = true; }
        } else if (clue.k === "same" || clue.k === "nsame") {
          const [c1, v1] = clue.a;
          const [c2, v2] = clue.b;
          for (const s of this.S) {
            if (clue.k === "same") {
              if (!poss[c1][s].has(v1) && poss[c2][s].has(v2)) { poss[c2][s].delete(v2); changed = true; }
              if (!poss[c2][s].has(v2) && poss[c1][s].has(v1)) { poss[c1][s].delete(v1); changed = true; }
            } else {
              if (isSingleton(poss[c1][s], v1) && poss[c2][s].has(v2)) { poss[c2][s].delete(v2); changed = true; }
              if (isSingleton(poss[c2][s], v2) && poss[c1][s].has(v1)) { poss[c1][s].delete(v1); changed = true; }
            }
          }
        } else if (clue.k === "before") {
          const a = clue.a, b = clue.b;
          const ta = timesOf(a), tb = timesOf(b);
          if (ta.size === 0 || tb.size === 0) continue;
          const limHi = Math.max(...tb), limLo = Math.min(...ta);
          const steps: [Ref, (i: number) => boolean][] = [
            [a, (i) => i < limHi],
            [b, (i) => i > limLo],
          ];
          for (const [ref, keep] of steps) {
            if (ref[0] === "s") {
              const s = ref[1];
              const bad = [...poss["time"][s]].filter((t) => !keep(this.TO[t]));
              if (bad.length) { for (const t of bad) poss["time"][s].delete(t); changed = true; }
            } else {
              const [cat, v] = ref;
              for (const s of this.S) {
                if (poss[cat][s].has(v)) {
                  if (![...poss["time"][s]].some((t) => keep(this.TO[t]))) {
                    poss[cat][s].delete(v); changed = true;
                  } else if (isSingleton(poss[cat][s], v)) {
                    const bad = [...poss["time"][s]].filter((t) => !keep(this.TO[t]));
                    if (bad.length) { for (const t of bad) poss["time"][s].delete(t); changed = true; }
                  }
                }
              }
            }
          }
        }
      }
      // naked single (in a row) + hidden single (in a column)
      for (const cat of Object.keys(this.CATS)) {
        for (const s of this.S) {
          if (poss[cat][s].size === 1) {
            const v = [...poss[cat][s]][0];
            for (const s2 of this.S) {
              if (s2 !== s && poss[cat][s2].has(v)) { poss[cat][s2].delete(v); changed = true; }
            }
          }
        }
        for (const v of this.CATS[cat]) {
          const holders = this.S.filter((s) => poss[cat][s].has(v));
          if (holders.length === 1 && poss[cat][holders[0]].size > 1) {
            poss[cat][holders[0]] = new Set([v]); changed = true;
          }
        }
      }
    }
  }

  // Cells the board alone resolves from a cold start - the WEAK ceiling for this clue set.
  weakCells(clues: Clue[]): number {
    const poss = this.freshPoss();
    this.propagate(poss, clues);
    return this.contradicts(poss) ? -1 : this.determinedCells(poss);
  }

  weak_forced(clues: Clue[]): boolean {
    return this.weakCells(clues) === this.cellCount();
  }
}

// ───────────────────────── hint ladder: WEAK advice on a player's own board ─────────────────────
// Same model, pointed at a live board instead of a cold start. Kept here rather than in the route
// handler so it can be exercised by engine.test.ts (src/server/index.ts imports @devvit and can't
// run under tsx).
export type Advice =
  | { kind: "move"; clue: number; cat?: string; suspect?: string; value?: string; pins?: string | null }
  // The 🟡 rung: these clues still bite, but not on the board - see crossAdvice() below. `clues` is
  // the smallest set that does it (1-3; every member is load-bearing), `via` the value two of them
  // share when there are exactly two - the chain the player has to hold in their head.
  | { kind: "cross"; clues: number[]; via?: string; viaCat?: string;
      cat?: string; suspect?: string; value?: string; pins?: string | null }
  | { kind: "contradiction"; clue: number | null }
  | { kind: "stuck" }
  | { kind: "done" };

// A grid off the wire may be stale (a rebuilt bank moved the case) or malformed. Everything that
// walks one checks the shape first instead of throwing.
export function gridFits(ctx: PuzzleCtx, g: GridState | null | undefined): boolean {
  if (!g) return false;
  for (const c of ctx.catIds) {
    const row = g[c];
    if (!row) return false;
    for (const s of ctx.suspects) {
      const cell = row[s];
      if (!cell) return false;
      for (const v of ctx.cats[c]) if (typeof cell[v] !== "number") return false;
    }
  }
  return true;
}

function clonePoss(p: Poss): Poss {
  const out: Poss = {};
  for (const c of Object.keys(p)) {
    out[c] = {};
    for (const s of Object.keys(p[c])) out[c][s] = new Set(p[c][s]);
  }
  return out;
}

// Which clue moves the player's CURRENT board, and what it moves.
//
// The baseline is their board closed under naked/hidden singles alone, so bookkeeping they could
// have done without reading anything is never credited to a clue. WEAK reaches its fixpoint one
// clue at a time against that baseline, so "no single clue moves it" is exactly "the board offers
// no forced move at all" - which on a 🟡 case happens some minutes in, with most of the 12 cells
// still open. That wall is not the end of the advice: it is where crossAdvice() takes over.
export function adviseOnGrid(pz: Puzzle, ctx: PuzzleCtx, grid: GridState): Advice {
  const base = pz.freshPoss();
  if (gridFits(ctx, grid))
    for (const c of ctx.catIds) for (const s of ctx.suspects) base[c][s] = new Set(candSet(ctx, grid, c, s));
  pz.propagate(base, []);
  if (pz.contradicts(base)) return { kind: "contradiction", clue: null };
  if (pz.determinedCells(base) === pz.cellCount()) return { kind: "done" };

  for (let i = 0; i < pz.clues.length; i++) {
    const trial = clonePoss(base);
    pz.propagate(trial, [pz.clues[i]]);
    if (pz.contradicts(trial)) return { kind: "contradiction", clue: i + 1 };
    for (const c of ctx.catIds)
      for (const s of ctx.suspects)
        for (const v of ctx.cats[c])
          if (base[c][s].has(v) && !trial[c][s].has(v)) {
            const left = [...trial[c][s]];
            return { kind: "move", clue: i + 1, cat: c, suspect: s, value: v, pins: left.length === 1 ? left[0] : null };
          }
  }
  return crossAdvice(pz, ctx, grid);
}

// ───────────────────────── GRID model (full logic-grid) ─────────────────────────
type Node = [string, string]; // (cat, value); cat ∈ "suspect" | ...CATS

export class Grid {
  P: Puzzle;
  cats: string[];
  values: Record<string, string[]>;
  TO: Record<string, number>;
  nodes: Node[];

  constructor(puzzle: Puzzle) {
    this.P = puzzle;
    this.cats = ["suspect", ...Object.keys(puzzle.CATS)];
    this.values = { suspect: [...puzzle.S], ...puzzle.CATS };
    this.TO = puzzle.TO;
    this.nodes = [];
    for (const c of this.cats) for (const v of this.values[c]) this.nodes.push([c, v]);
  }

  private cmp(a: Node, b: Node): number {
    if (a[0] < b[0]) return -1; if (a[0] > b[0]) return 1;
    if (a[1] < b[1]) return -1; if (a[1] > b[1]) return 1;
    return 0;
  }
  // The separators | (cat↔value) and # (node↔node) do not occur in the data
  // (categories and values - only letters/digits/colon).
  private keyOf(a: Node, b: Node): string {
    const [x, y] = this.cmp(a, b) <= 0 ? [a, b] : [b, a];
    return `${x[0]}|${x[1]}#${y[0]}|${y[1]}`;
  }
  private parseKey(k: string): [Node, Node] {
    const [ha, hb] = k.split("#");
    const [ac, av] = ha.split("|");
    const [bc, bv] = hb.split("|");
    return [[ac, av], [bc, bv]];
  }

  get(rel: Map<string, number>, a: Node, b: Node): number {
    return rel.get(this.keyOf(a, b)) ?? 0;
  }

  setrel(rel: Map<string, number>, a: Node, b: Node, val: number): "same" | "conflict" | "changed" {
    if (a[0] === b[0]) {
      if (a[1] === b[1]) return "same";
      return val === -1 ? "same" : "conflict";
    }
    const k = this.keyOf(a, b);
    const cur = rel.get(k) ?? 0;
    if (cur === 0) { rel.set(k, val); return "changed"; }
    return cur === val ? "same" : "conflict";
  }

  init(rel: Map<string, number>, clues: Clue[]): boolean {
    let ok = true;
    const S = (a: Node, b: Node, v: number) => { if (this.setrel(rel, a, b, v) === "conflict") ok = false; };
    for (const cl of clues) {
      if (cl.k === "ne") S(["suspect", cl.s], [cl.cat, cl.v], -1);
      else if (cl.k === "same") S([cl.a[0], cl.a[1]], [cl.b[0], cl.b[1]], 1);
      else if (cl.k === "nsame") S([cl.a[0], cl.a[1]], [cl.b[0], cl.b[1]], -1);
      else if (cl.k === "before") {
        const a: Node = cl.a[0] === "s" ? ["suspect", cl.a[1]] : [cl.a[0], cl.a[1]];
        const b: Node = cl.b[0] === "s" ? ["suspect", cl.b[1]] : [cl.b[0], cl.b[1]];
        if (a[0] !== b[0]) S(a, b, -1);
      }
    }
    return ok;
  }

  private _before_step(rel: Map<string, number>, clues: Clue[]): boolean {
    let ok = true;
    const S = (a: Node, b: Node, v: number) => { if (this.setrel(rel, a, b, v) === "conflict") ok = false; };
    for (const cl of clues) {
      if (cl.k !== "before") continue;
      const a: Node = cl.a[0] === "s" ? ["suspect", cl.a[1]] : [cl.a[0], cl.a[1]];
      const b: Node = cl.b[0] === "s" ? ["suspect", cl.b[1]] : [cl.b[0], cl.b[1]];
      const times = this.values["time"];
      const Ta = times.filter((t) => this.get(rel, a, ["time", t]) !== -1);
      const Tb = times.filter((t) => this.get(rel, b, ["time", t]) !== -1);
      if (!Ta.length || !Tb.length) continue;
      const tbMax = Math.max(...Tb.map((t) => this.TO[t]));
      const taMin = Math.min(...Ta.map((t) => this.TO[t]));
      for (const t of Ta) if (this.TO[t] >= tbMax) S(a, ["time", t], -1);
      for (const t of Tb) if (this.TO[t] <= taMin) S(b, ["time", t], -1);
    }
    return ok;
  }

  propagate(rel: Map<string, number>, clues: Clue[]): boolean {
    if (!this.init(rel, clues)) return false;
    let changed = true;
    while (changed) {
      changed = false;
      const snap = rel.size;
      for (const [kk, v] of Array.from(rel.entries())) {
        if (v !== 1) continue;
        const [a, b] = this.parseKey(kk);
        for (const b2 of this.values[b[0]])
          if (b2 !== b[1] && this.setrel(rel, a, [b[0], b2], -1) === "conflict") return false;
        for (const a2 of this.values[a[0]])
          if (a2 !== a[1] && this.setrel(rel, [a[0], a2], b, -1) === "conflict") return false;
      }
      for (const node of this.nodes) {
        for (const C of this.cats) {
          if (C === node[0]) continue;
          const poss = this.values[C].filter((v) => this.get(rel, node, [C, v]) !== -1);
          if (poss.length === 0) return false;
          if (poss.length === 1 && this.get(rel, node, [C, poss[0]]) !== 1) {
            if (this.setrel(rel, node, [C, poss[0]], 1) === "conflict") return false;
          }
        }
      }
      for (const a of this.nodes) {
        for (const b of this.nodes) {
          if (b[0] === a[0] || this.get(rel, a, b) !== 1) continue;
          for (const c of this.nodes) {
            if (c[0] === a[0] || c[0] === b[0]) continue;
            const rbc = this.get(rel, b, c), rac = this.get(rel, a, c);
            if (rbc === 1 && rac !== 1 && this.setrel(rel, a, c, 1) === "conflict") return false;
            if (rbc === -1 && rac !== -1 && this.setrel(rel, a, c, -1) === "conflict") return false;
            if (rac === -1 && rbc !== -1 && this.setrel(rel, b, c, -1) === "conflict") return false;
          }
        }
      }
      if (!this._before_step(rel, clues)) return false;
      if (rel.size !== snap) changed = true;
    }
    return true;
  }

  solved(rel: Map<string, number>): boolean {
    for (const s of this.values["suspect"]) {
      for (const C of Object.keys(this.P.CATS)) {
        const cnt = this.values[C].filter((v) => this.get(rel, ["suspect", s], [C, v]) !== -1).length;
        if (cnt !== 1) return false;
      }
    }
    return true;
  }

  grid_forced(clues: Clue[]): boolean {
    const rel = new Map<string, number>();
    return this.propagate(rel, clues) && this.solved(rel);
  }
}

// ───────────────── hint ladder, 🟡 rung: advice past the end of the board ─────────────────
// WEAK *is* the 4×3 board, so when adviseOnGrid() runs out of forced moves the board has nothing
// left to give - and that is precisely the definition of 🟡 (`grid_forced && !weak_forced`). Until
// now the ladder stopped there and both free rungs returned the same {kind:"stuck"}: "link two
// categories through a value they share" - an instruction with no address, identical on rung 1 and
// rung 2, which is why pressing either button looked like nothing happening.
//
// The GRID model is exactly the reasoning the board cannot record (value×value + transitivity), so
// running it over the player's own marks finds the address. Measured on all 100 🟡 bank cases, each
// played to its WEAK wall (plans/assets/proto/06-server/measure-yellow-advice.ts):
//
//   the board's own marks, cross-referenced, imply something new   0/100  ← every step costs a clue
//   ONE clue still kills a chip once you cross-reference it       96/100
//   a PAIR of clues                                                +1
//   THREE clues at once (the canonical Case #0 is one of these)    +3
//
// So the search goes by size, smallest first, and stops at three: one clue is a smaller thing to ask
// of a player than two, and "read these four clues together" is not a hint anybody can act on.
// Minimality comes out of the ordering for free - reaching size k means no smaller subset kills any
// still-standing chip, so every clue in the reported set is load-bearing for the chip it names.
type Fact = { cat: string; suspect: string; value: string; pins: string | null };
const factKey = (f: Fact) => `${f.cat}|${f.suspect}|${f.value}`;

// Seed the GRID relation map from a player's board: a crossed-out chip is "suspect ≠ value", a cell
// down to one candidate is "suspect = value". null = the board is already self-contradictory (the
// WEAK check in adviseOnGrid catches that first, so this is belt and braces).
function relFromGrid(gr: Grid, ctx: PuzzleCtx, grid: GridState): Map<string, number> | null {
  const rel = new Map<string, number>();
  for (const c of ctx.catIds) {
    for (const s of ctx.suspects) {
      const cand = candSet(ctx, grid, c, s);
      if (!cand.length) return null;
      for (const v of ctx.cats[c])
        if (!cand.includes(v) && gr.setrel(rel, ["suspect", s], [c, v], -1) === "conflict") return null;
      if (cand.length === 1 && gr.setrel(rel, ["suspect", s], [c, cand[0]], 1) === "conflict") return null;
    }
  }
  return rel;
}

// Chips this clue set kills that are still standing on the board. Eliminations only, on purpose:
// the closure rules out a cell's other candidates in the same pass it pins one, so every deduction
// can reach the player in the one language the board speaks - "cross this out".
function killedChips(gr: Grid, ctx: PuzzleCtx, grid: GridState, clues: Clue[]): Fact[] {
  const rel = relFromGrid(gr, ctx, grid);
  if (!rel || !gr.propagate(rel, clues)) return [];
  const out: Fact[] = [];
  for (const c of ctx.catIds) {
    for (const s of ctx.suspects) {
      const cand = candSet(ctx, grid, c, s);
      if (cand.length <= 1) continue;
      for (const v of cand) {
        if (gr.get(rel, ["suspect", s], [c, v]) !== -1) continue;
        const left = cand.filter((x) => x !== v);
        out.push({ cat: c, suspect: s, value: v, pins: left.length === 1 ? left[0] : null });
      }
    }
  }
  return out;
}

// What a clue talks about, in the GRID's vocabulary.
function clueNodes(cl: Clue): Node[] {
  const ref = (r: Ref): Node => (r[0] === "s" ? ["suspect", r[1]] : [r[0], r[1]]);
  return cl.k === "ne" ? [["suspect", cl.s], [cl.cat, cl.v]] : [ref(cl.a), ref(cl.b)];
}

// The link between two clues, if they have one. A shared VALUE is the teachable kind ("clue 3 and
// clue 6 both mention the Red coat" is a chain the player can hold); a shared suspect is weaker, so
// it is only taken when there is no shared value.
function sharedNode(a: Clue, b: Clue): Node | null {
  const nb = clueNodes(b);
  const hit = clueNodes(a).filter((x) => nb.some((y) => y[0] === x[0] && y[1] === x[1]));
  return hit.find((n) => n[0] !== "suspect") ?? hit[0] ?? null;
}

export function crossAdvice(pz: Puzzle, ctx: PuzzleCtx, grid: GridState): Advice {
  const gr = new Grid(pz);
  const C = pz.clues;
  // Never credit a clue with a chip the player's own marks already kill. (Measured empty on every
  // yellow wall - but it is what makes "clue N gives you this" a true sentence rather than a likely one.)
  const base = new Set(killedChips(gr, ctx, grid, []).map(factKey));
  const fresh = (cl: Clue[]): Fact | undefined =>
    killedChips(gr, ctx, grid, cl).find((x) => !base.has(factKey(x)));

  for (let i = 0; i < C.length; i++) {
    const f = fresh([C[i]]);
    if (f) return { kind: "cross", clues: [i + 1], ...f };
  }

  // Two. A pair that shares a value is the one worth naming ("clue 3 and clue 6 both mention the
  // Red coat"), so the scan prefers it and only falls back to a pair with no visible link.
  let unlinked: Advice | null = null;
  for (let i = 0; i < C.length; i++) {
    for (let j = i + 1; j < C.length; j++) {
      const f = fresh([C[i], C[j]]);
      if (!f) continue;
      const via = sharedNode(C[i], C[j]);
      if (via) return { kind: "cross", clues: [i + 1, j + 1], via: via[1], viaCat: via[0], ...f };
      unlinked ??= { kind: "cross", clues: [i + 1, j + 1], ...f };
    }
  }
  if (unlinked) return unlinked;

  for (let i = 0; i < C.length; i++)
    for (let j = i + 1; j < C.length; j++)
      for (let k = j + 1; k < C.length; k++) {
        const f = fresh([C[i], C[j], C[k]]);
        if (f) return { kind: "cross", clues: [i + 1, j + 1, k + 1], ...f };
      }
  return { kind: "stuck" };
}

// ───────────────────────── tier classification ─────────────────────────
export const GREEN = "🟢 green";
export const YELLOW = "🟡 yellow";
export const RED = "🔴 red";

export interface TierInfo { tier: string; solutions: number; weak_forced: boolean; grid_forced: boolean; }

export function classify(puzzle: Puzzle, clues?: Clue[]): TierInfo {
  const cl = clues ?? puzzle.clues;
  const [n] = puzzle.count(cl);
  const weak = puzzle.weak_forced(cl);
  const grid = new Grid(puzzle).grid_forced(cl);
  let tier: string;
  if (n !== 1) tier = `⚠️ not unique (${n} solutions)`;
  else if (weak) tier = GREEN;
  else if (grid) tier = YELLOW;
  else tier = RED;
  return { tier, solutions: n, weak_forced: weak, grid_forced: grid };
}

// ───────────────────────── generator (no AI) ─────────────────────────
export const DEFAULT_SUS = ["S1", "S2", "S3", "S4"];
export const DEFAULT_CATS: Cats = {
  flair: ["Red", "Blue", "Green", "Purple"],
  time: ["09:00", "12:00", "15:00", "18:00"],
  object: ["A", "B", "C", "D"],
};
const _PAIRS: [string, string][] = [["flair", "time"], ["flair", "object"], ["time", "object"]];

export function make_solution(rng: RNG, sus = DEFAULT_SUS, cats = DEFAULT_CATS): Solution {
  const perms: Record<string, string[]> = {};
  for (const c of Object.keys(cats)) perms[c] = rng.sample(cats[c], cats[c].length);
  const sol: Solution = {};
  sus.forEach((s, i) => { sol[s] = {}; for (const c of Object.keys(cats)) sol[s][c] = perms[c][i]; });
  return sol;
}

export function gen_pool(solution: Solution, sus = DEFAULT_SUS, cats = DEFAULT_CATS): Clue[] {
  const nons = Object.keys(cats);
  const owner = (cat: string, v: string): string => sus.find((s) => solution[s][cat] === v)!;
  const to: Record<string, number> = {}; cats["time"].forEach((t, i) => { to[t] = i; });
  const pool: Clue[] = [];
  for (const s of sus)
    for (const [ca, cb] of _PAIRS)
      pool.push({ k: "same", a: [ca, solution[s][ca]], b: [cb, solution[s][cb]] });
  for (const s of sus)
    for (const cat of nons)
      for (const v of cats[cat])
        if (solution[s][cat] !== v) pool.push({ k: "ne", s, cat, v });
  for (const [ca, cb] of _PAIRS)
    for (const va of cats[ca])
      for (const vb of cats[cb])
        if (owner(ca, va) !== owner(cb, vb)) pool.push({ k: "nsame", a: [ca, va], b: [cb, vb] });
  const descs = (s: string): Ref[] => [["s", s], ["flair", solution[s]["flair"]], ["object", solution[s]["object"]]];
  for (const [sa, sb] of pairs(sus)) {
    if (to[solution[sa]["time"]] < to[solution[sb]["time"]]) {
      for (const X of descs(sa)) for (const Y of descs(sb)) pool.push({ k: "before", a: X, b: Y });
    }
  }
  const seen = new Set<string>();
  const out: Clue[] = [];
  for (const c of pool) { const r = clueKey(c); if (!seen.has(r)) { seen.add(r); out.push(c); } }
  return out;
}

function _minimize(
  pool: Clue[],
  keep: (c: Clue[]) => boolean,
  rng: RNG,
  floor = 4,
  stopWhen?: (c: Clue[]) => boolean,
  removeFirst?: (c: Clue) => number, // lower = offered for removal earlier; ties stay random
): Clue[] {
  let clues = pool.slice();
  const order = pool.slice(); rng.shuffle(order);
  if (removeFirst) order.sort((a, b) => removeFirst(a) - removeFirst(b));
  for (const c of order) {
    if (clues.length <= floor) break;
    const ck = clueKey(c);
    const sub = clues.filter((x) => clueKey(x) !== ck);
    if (keep(sub)) {
      clues = sub;
      if (stopWhen && stopWhen(clues)) return clues;
    }
  }
  return clues;
}

// ── "tutorial": an over-clued 🟢 ─────────────────────────────────────────────────────────────
// A 🟢 case is already solvable on the board, but 🟢 spans score −2…54 - "green" is not the same
// thing as "easy". What makes a case hard is the minimization: it strips every clue that isn't
// load-bearing, so the player has to work out each step from a single angle. Stopping the strip at
// a floor of 14 leaves the case over-determined - most clues are direct pins and there is usually
// more than one way to see the next move.
//
// Two shape filters on top, because clue COUNT alone doesn't make a case gentle:
//   * relational clues (before/nsame) force you to hold two categories in your head at once, so
//     they stay a minority;
//   * a `same` clue that nails a value to a TIME is a hook - the place a beginner starts. Demand
//     at least two, so the opening move is findable without a strategy.
const TUTORIAL_FLOOR = 14;
const TUTORIAL_MAX_RELATIONAL = 0.35;
const TUTORIAL_MIN_HOOKS = 2;

const isRelational = (c: Clue): boolean => c.k === "before" || c.k === "nsame";
const isHook = (c: Clue): boolean => c.k === "same" && (c.a[0] === "time" || c.b[0] === "time");

// Offer the relational clues for removal first, leave everything else in random order. Measured:
// with a plain shuffle only 1 case in 60 passes the filters (the pool is mostly before/nsame, so a
// random strip keeps mostly those) - pure rejection sampling would never build a bank. With this
// one nudge, 59 in 60 pass and the surviving shapes still vary (2-5 hooks, 8-11 direct exclusions).
// Sorting on MORE bands than this collapses every case to the same 8-hook skeleton - a transcription
// exercise, not a puzzle - so the bias stops here.
const tutorialRemoveFirst = (c: Clue): number => (isRelational(c) ? 0 : 1);

function tutorialShaped(clues: Clue[]): boolean {
  return clues.filter(isRelational).length / clues.length <= TUTORIAL_MAX_RELATIONAL
    && clues.filter(isHook).length >= TUTORIAL_MIN_HOOKS;
}

// Assemble [solution, clues] of the given tier ('tutorial'|'green'|'yellow'|'red') or null.
export function generate(
  tier: string,
  rng: RNG,
  sus = DEFAULT_SUS,
  cats = DEFAULT_CATS,
  tries = 12,
): [Solution, Clue[]] | null {
  tier = tier.toLowerCase();
  for (let t = 0; t < tries; t++) {
    const sol = make_solution(rng, sus, cats);
    const pz = new Puzzle(sus, cats, [], sol);
    const grid = new Grid(pz);
    const pool = gen_pool(sol, sus, cats);
    if (pz.count(pool)[0] !== 1) continue;
    if (tier === "tutorial") {
      const clues = _minimize(pool, (c) => pz.weak_forced(c), rng, TUTORIAL_FLOOR, undefined, tutorialRemoveFirst);
      if (pz.weak_forced(clues) && tutorialShaped(clues)) return [sol, clues];
    } else if (tier === "green") {
      const clues = _minimize(pool, (c) => pz.weak_forced(c), rng);
      if (pz.weak_forced(clues)) return [sol, clues];
    } else if (tier === "yellow") {
      const clues = _minimize(pool, (c) => grid.grid_forced(c), rng);
      if (grid.grid_forced(clues) && !pz.weak_forced(clues)) return [sol, clues];
    } else if (tier === "red") {
      for (let r = 0; r < 6; r++) {
        const clues = _minimize(pool, (c) => pz.count(c)[0] === 1, rng, 4, (c) => !grid.grid_forced(c));
        if (pz.count(clues)[0] === 1 && !grid.grid_forced(clues)) return [sol, clues];
      }
    } else {
      throw new Error(tier);
    }
  }
  return null;
}
