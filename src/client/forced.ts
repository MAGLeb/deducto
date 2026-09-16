// "Is anything forced right now?" - the eliminations that follow directly from the board as it
// stands, i.e. exactly what a 4x3 suspect×category board can express: naked/hidden singles plus
// one pass over each clue. No search, no hypotheses - the same WEAK model plans/00-OVERVIEW.md
// measured, which is why a 🟡 case runs out of forced moves long before it is solved.
//
// Deliberately conservative: anything uncertain is left out of the elimination list only when it
// is provably not implied, so an empty list really means the grid has nothing left to say. The UI
// uses that to teach ("combine two clues") instead of leaving the player staring at a dead board.
//
// Rank: this is the FALLBACK, not the authority. `adviseOnGrid` (src/server/engine.ts) runs the
// same WEAK model exactly, and /api/hint now serves its verdict, so `boardStuck()` in main.ts
// prefers a server answer whenever it holds one for the board on screen. This function is what
// keeps the status line honest in between hint requests - it runs on every render and costs no
// round trip, which is precisely what the server verdict cannot do.

import type { Clue, Ref } from "../shared/types.js";
import { candSet, possibleOwners, type GridState, type PuzzleCtx } from "../shared/status.js";

export interface Elimination { cat: string; suspect: string; value: string }

export function forcedEliminations(ctx: PuzzleCtx, grid: GridState, clues: Clue[]): Elimination[] {
  const idx = (t: string) => ctx.timeValues.indexOf(t);
  const cand = (c: string, s: string) => candSet(ctx, grid, c, s);
  const ownersOf = (r: Ref) => (r[0] === "s" ? [r[1]] : possibleOwners(ctx, grid, r[0], r[1]));
  const timesOf = (r: Ref) => {
    const out = new Set<number>();
    for (const s of ownersOf(r)) for (const t of cand("time", s)) out.add(idx(t));
    return [...out];
  };

  const seen = new Set<string>();
  const out: Elimination[] = [];
  const cross = (cat: string, suspect: string, value: string) => {
    // only an untouched candidate in a cell that still has a choice left is a *move*
    if (grid[cat][suspect][value] !== 0 || cand(cat, suspect).length < 2) return;
    const key = `${cat}|${suspect}|${value}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ cat, suspect, value });
  };
  // a determined owner of `ref` collapses that suspect's cell in ref's category
  const pin = (r: Ref, s: string) => {
    if (r[0] === "s") return;
    for (const v of cand(r[0], s)) if (v !== r[1]) cross(r[0], s, v);
  };

  for (const c of ctx.catIds) {
    for (const s of ctx.suspects) {
      const cs = cand(c, s);                                   // naked single ⇒ nobody else has it
      if (cs.length === 1) for (const o of ctx.suspects) if (o !== s) cross(c, o, cs[0]);
    }
    for (const v of ctx.cats[c]) {
      const ow = possibleOwners(ctx, grid, c, v);              // hidden single ⇒ that cell collapses
      if (ow.length === 1) for (const x of cand(c, ow[0])) if (x !== v) cross(c, ow[0], x);
    }
  }

  for (const cl of clues) {
    if (cl.k === "ne") { cross(cl.cat, cl.s, cl.v); continue; }
    const oa = ownersOf(cl.a), ob = ownersOf(cl.b);
    if (cl.k === "same") {
      // an owner of a must be able to own b as well, and the other way round
      if (cl.a[0] !== "s") for (const s of oa) if (!ob.includes(s)) cross(cl.a[0], s, cl.a[1]);
      if (cl.b[0] !== "s") for (const s of ob) if (!oa.includes(s)) cross(cl.b[0], s, cl.b[1]);
      if (oa.length === 1) pin(cl.b, oa[0]);
      if (ob.length === 1) pin(cl.a, ob[0]);
    } else if (cl.k === "nsame") {
      if (oa.length === 1 && cl.b[0] !== "s") cross(cl.b[0], oa[0], cl.b[1]);
      if (ob.length === 1 && cl.a[0] !== "s") cross(cl.a[0], ob[0], cl.a[1]);
    } else {
      const TA = timesOf(cl.a), TB = timesOf(cl.b);
      if (!TA.length || !TB.length) continue;
      const maxB = Math.max(...TB), minA = Math.min(...TA);
      // time(a) < time(b) ≤ maxB ⇒ a's owner cannot be at maxB or later (mirrored for b)
      if (oa.length === 1) for (const t of cand("time", oa[0])) if (idx(t) >= maxB) cross("time", oa[0], t);
      if (ob.length === 1) for (const t of cand("time", ob[0])) if (idx(t) <= minA) cross("time", ob[0], t);
      // and a suspect who can only be late cannot be the one wearing/carrying a
      if (cl.a[0] !== "s") for (const s of oa) if (cand("time", s).every((t) => idx(t) >= maxB)) cross(cl.a[0], s, cl.a[1]);
      if (cl.b[0] !== "s") for (const s of ob) if (cand("time", s).every((t) => idx(t) <= minA)) cross(cl.b[0], s, cl.b[1]);
    }
  }
  return out;
}

export function forcedMoves(ctx: PuzzleCtx, grid: GridState, clues: Clue[]): number {
  return forcedEliminations(ctx, grid, clues).length;
}
