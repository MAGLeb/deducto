// One note, passed from the feed's first screen to the board - the only thing the splash can
// hand the game, and the reason it needs a channel at all.
//
// The two entrypoints are two DOCUMENTS (dec. 46), and expanding the post reloads the document:
// nothing in memory survives the trip. `requestExpandedMode(event, entry)` takes an entrypoint
// NAME and the host builds the destination URL itself out of `devvit.json` (see
// `@devvit/client/effects/web-view-mode.js`: it reads `devvit.entrypoints[entry]`), so the splash
// cannot hang a hash, a query or a payload on it either. What the two documents DO share is an
// origin - both entries are files under `post.dir`, served from the same web view host - so the
// only channel left standing is that origin's storage.
//
// **Two stores are written, because the reload has two shapes and each store survives a different
// one.** Where the client navigates the same browsing context, `sessionStorage` is the guaranteed
// carrier: it is scoped to the tab plus the origin, which a same-origin document swap keeps. A
// native client that tears the web view down and builds a fresh one starts with an empty
// `sessionStorage`, and there `localStorage` is the one that carries. Writing both costs two
// lines and covers both.
//
// **Neither is trusted.** A web view sandboxed without `allow-same-origin` throws on the first
// property access, and `localStorage` has already been called unreliable in this web view once
// (dec. 52, which is why the tutorial flag lives on the server). So every call is guarded, and a
// handoff that does not arrive is not an error: the board opens instead, with the standings one
// tap away in its control rail. The button degrades into the Play button, which is the correct
// thing for it to degrade into.
//
// **The note is stamped and consumed once.** `take()` deletes before it returns, and a note older
// than TTL_MS is ignored - so a press whose reload never happened cannot hijack an unrelated open
// tomorrow. Nothing here is state; it is a single message with a short life.

/** The only thing worth handing over. A union so a second intent has to be named, not guessed. */
export type Intent = "standings";

const KEY = "deducto.open";
const TTL_MS = 120_000; // a web view reload is seconds; two minutes is slack, not a lifetime

/** Leave the note. Call it BEFORE `requestExpandedMode` - that call can destroy this document. */
export function ask(intent: Intent): void {
  const note = JSON.stringify({ v: intent, t: Date.now() });
  try { sessionStorage.setItem(KEY, note); } catch { /* blocked: the other store, or neither */ }
  try { localStorage.setItem(KEY, note); } catch { /* blocked: the other store, or neither */ }
}

/** Read and delete, from whichever store still has it. Never throws, never returns stale. */
export function take(): Intent | null {
  let note: string | null = null;
  try {
    note = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
  } catch { /* no session store here */ }
  try {
    note ??= localStorage.getItem(KEY);
    localStorage.removeItem(KEY);        // cleared either way: one press, one open
  } catch { /* no local store here */ }
  if (!note) return null;
  try {
    const { v, t } = JSON.parse(note) as { v?: unknown; t?: unknown };
    if (v !== "standings") return null;
    if (typeof t !== "number" || Date.now() - t > TTL_MS) return null;
    return "standings";
  } catch { return null; }               // a note we did not write is not a note
}
