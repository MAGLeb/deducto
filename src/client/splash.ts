// Deducto - the feed's first screen. It shows what the case is, what you do, and one button.
// The board lives in the "game" entrypoint and opens fullscreen; nothing here scrolls.
//
// Data comes from GET /api/preview - a counters-only endpoint (no clues, no grid, no solution)
// that MUST NOT carry the side effects of /api/daily (it must not consume the first-run tutorial
// flag nor stamp `startedAt`, or merely seeing the post in the feed would start your run).
// Until the server ships it, the splash renders its neutral state: real CTA, no invented numbers.
import { navigateTo, requestExpandedMode } from "@devvit/web/client";
import { paintTier, tierTechnique, tierWord } from "./tiers.js";
import { ask } from "./handoff.js";

// ── the payload is grouped by WORLD, and so is the card (docs/11-stats-ia.md §1/R3) ──────────────
//   `case` = ① this case · `you` = ③ the player, all time · `next` = ② the series
// There is no `today` group any more. Nothing on a card that is one case's cover page is scoped to
// the day: the day is the standings' unit, and it is answered there with names attached.
export interface PreviewResp {
  case: {
    number: number | null;          // case number; null only if the post predates postData.n
    title: string;
    tier: "tutorial" | "green" | "yellow" | "red";
    legend: string;                 // the case's own hook - what happened, and to whom
    clueCount: number;              // how much evidence the case hands you
    // The four items, each with the word for it. A glyph alone is a decoration until the reader
    // knows what the row IS, and at 21px several of them do not survive being guessed at.
    objects: { emoji: string; label: string }[];
    closers: number;                // people who have closed THIS case (`zCard(lb:{postId})`)
    fastestSec: number | null;      // best time on THIS case; null while nobody has closed it
    fastestBy: string | null;       // and who holds it - a username, as on every standings row
    // When this case's own day ended, or when it will - a case runs 24 h from publication. Exactly
    // one of the two is ever a number, and BOTH are null when the post has aged out of `lt:posts`,
    // because a card with no date must print no date (dec. 37).
    closedMinAgo: number | null;
    closesInMin: number | null;
  };
  you: {
    state: "new" | "playing" | "solved";
    deduced: number;                // cells already deduced (0..cells)
    cells: number;                  // 12 today
    // The run IN PROGRESS, and the only streak this screen has ever read. The best-ever run and
    // the lifetime case count were carried here too and are gone with the cell that printed them:
    // `CASES CLOSED` was read against `CLOSED IT` beside it as the same fact twice, and a payload
    // that keeps answering a question no surface asks is how a card ends up with a figure nobody
    // chose. Both still live where they are read - the streak board, the result sheet, the flair.
    streakCurrent: number;
    timeSec: number | null;         // your time, only when state === "solved"
    // Where your time places you on THIS case. 0 = no position to state. Counted by score rather
    // than by name (src/server/index.ts), so equal times share a position.
    caseRank: number;
    // The rank the streak has earned, or null before the first rung. Same ladder as the flair.
    rank: string | null;
    // The next rung up, and how many more cases in a row it takes to reach it. `rankNext` is null
    // only at the top, where there is nothing left to climb.
    rankNext: string | null;
    rankIn: number;
  };
  next: {
    number: number;
    opensInMin: number;
    // Both null on an archive case: the publisher reads the vote of the CURRENT post, so an old
    // case's vote steers nothing and this screen must not say otherwise (dec. 37). The countdown
    // survives either way, because that one is still true.
    tier: "tutorial" | "green" | "yellow" | "red" | null;
    moved: "up" | "down" | null;    // whether the verdict actually moves the level, or is at a wall
    vote: {
      total: number;
      tally: { Harder: number; Same: number; Softer: number };
      verdict: "Harder" | "Same" | "Softer" | null;   // null = the sub has NOT decided
      yours: string | null;
      minTotal: number;             // VOTE_MIN_TOTAL - how many votes it takes to decide anything
    } | null;
    // The case that is live right now, and `null` on the live post itself - where the countdown
    // above is the honest answer and this would be a card pointing at itself. It carries the
    // permalink, so the archive card can hand a reader straight into the case they can play.
    live: { number: number; tier: "tutorial" | "green" | "yellow" | "red"; url: string } | null;
  };
}

const $ = (id: string) => document.getElementById(id)!;
/** The rule of the game. One sentence, worded once - the board prints the same one under the grid,
    which is where a player meets it again at the moment it applies. */
const RULE = "Cross out what the clues rule out - the last one left in a cell is the answer.";
const pad = (n: number) => String(n).padStart(2, "0");
const fmtTime = (s: number) => `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;

// Both buttons are wired before any fetch: they must work even if the network is slow or
// /api/preview is absent. requestExpandedMode throws if the web view is expanded already - a
// no-op, not an error.
$("play").addEventListener("click", (e) => {
  try { requestExpandedMode(e, "game"); } catch { /* already expanded */ }
});

// The standings, from the feed (dec. 98). There is only one expanded entrypoint - the board - so
// the destination is the same `game` document, and the note that says WHICH screen to open on
// arrival travels in the origin's storage, because expanding replaces this document and
// requestExpandedMode carries no payload of its own (handoff.ts states the whole argument).
//
// The note is written BEFORE the request: that call can destroy this document on the spot. It is
// deliberately NOT rolled back if the request throws - the only throw in production is "already
// expanded", where nothing is going to reload and the note expires on its own two minutes later.
$("standings").addEventListener("click", (e) => {
  ask("standings");
  try { requestExpandedMode(e, "game"); } catch { /* already expanded */ }
});

function setCta(label: string, sub?: string) {
  $("play-label").textContent = label;
  const el = $("play-sub");
  if (sub) { el.textContent = sub; el.removeAttribute("hidden"); }
  else el.setAttribute("hidden", "");
}

function el(tag: string, cls?: string, text?: string): HTMLElement {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

/** One cell of the docket: a caps key over a mono figure, the same idiom as the result sheet.
    `wide` takes three bands of the phone strip, for a cell whose value is a sentence because there
    is no honest figure to print (dec. 37). */
function dcell(key: string, value: string, mod?: "wide"): HTMLElement {
  const d = el("div", "dcell" + (mod ? " " + mod : ""));
  d.append(el("div", "dk", key), el("div", "dv", value));
  return d;
}

// ── the room's cell: how many detectives have closed THIS case ───────────────────────────────────
//
// It used to be a cell with two subjects and a hidden switch: `SOLVED TODAY` carried the day board
// from ten solvers up, `DETECTIVES` carried the all-time community below it, and the reader was
// never told the population had changed under them (dec. 96, revoked here). That is the exact
// failure "one word, one number" is written against - and it is what the owner met as
// «DETECTIVES 8 считает не тот кейс», with 8 being everyone who had ever closed anything.
//
// The card is one case's cover page, so the count is that case's, in every state. Two consequences
// worth stating: the threshold goes with the swap (`ROOM_MIN` is deleted - it gated a change of
// SUBJECT, not a change of precision), and the all-time community leaves this card entirely for
// the surface that owns world ③ (`/api/me`) and for the all-time board's own footer, where the
// board's title makes `detectives` unambiguous.
//
// Zero is still words rather than a figure (dec. 37) - and on a fresh case that sentence is a
// better hook than any headcount would have been.
/** `1st` `2nd` `3rd` `4th` ... `11th` `12th` `13th` - the teens are the exception every naive
    implementation of this gets wrong, and a card that prints `11st` looks broken rather than terse. */
function ordinal(n: number): string {
  const t = n % 100;
  const s = t >= 11 && t <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${s}`;
}

function closersCell(p: PreviewResp): HTMLElement {
  const n = p.case.closers;
  if (n <= 0) return dcell("Closed it", "Nobody yet - be the first", "wide");
  return dcell("Closed it", n.toLocaleString("en-US"));
}

/** The case's benchmark and WHO holds it. Solved state only. */
function fastestCell(p: PreviewResp): HTMLElement | null {
  const f = p.case.fastestSec;
  if (f === null) return null;
  const d = dcell("Fastest", fmtTime(f));
  const v = d.lastElementChild!;
  // ── when the benchmark is YOUR OWN figure ────────────────────────────────────────────────────
  // The old cell printed the word "Yours" instead of the time, on the reasoning that `04:31` twice
  // 40px apart reads as a rendering fault. The reasoning is right and the conclusion was not: it
  // withheld the number the cell exists to state. The ledger had already solved this exact problem
  // one screen away - a filled `You` tag on your own row - so the tag is borrowed rather than a
  // third idiom invented.
  //
  // Equality, not `>=`. Both tag a tie, which dec. 97 asks for, because a row carries your exact
  // recorded second. What `>=` also tagged is the case with no row at all: a solver whose username
  // never resolved is NOT on `lb:{postId}`, so the best time there belongs to somebody else - and
  // whenever theirs was the slower of the two, the card put a `You` on a stranger's figure.
  const mine = p.you.state === "solved" && p.you.timeSec !== null && f === p.you.timeSec;
  if (mine) v.appendChild(el("span", "tag you", "You"));
  // ── WHO holds it, on its own line (track 12) ─────────────────────────────────────────────────
  // This slot used to carry `of 7`, the size of the field. Two things were wrong with it. It
  // collided: on a phone band the figure, the tag and `of 7` do not fit on one line, and the owner
  // photographed `4` and `7` from neighbouring cells run together. And it was the weaker fact -
  // a headcount says how many you beat, a NAME says who to beat, and it is the name that makes a
  // post feel like a room. Owner's call: "чтобы все видели лучшего на посте".
  //
  // Its own line rather than beside the time, because a Reddit username runs to 20 characters and
  // the band is ~93px: there is no width to share. One line, ellipsis, `dir=ltr` so a name cannot
  // reorder the row. Never printed when the time is yours - the `You` tag has already said it.
  if (!mine && p.case.fastestBy) {
    const who = el("div", "dwho", `u/${p.case.fastestBy}`);
    who.dir = "ltr";
    d.appendChild(who);
  }
  return d;
}

/** The card's one cell about the player's record - and which record it is depends on whether they
    still have a run going.
    A streak that has ended is `streakCurrent: 0`, and that is a fact rather than missing data
    (src/server/streak.ts), so the cell is not drawn: there is no run left to protect. Which used
    to leave a veteran who missed a day looking at a card with nothing of theirs on it at all -
    and the figure they would have been looking for is the one the bug report was about. So when
    the run is gone the cell carries the cases instead. Never both: the strip on a phone draws
    three cells, and one line about you is what this screen can afford. */
/** Where your time placed you on this case. Absent only when there is no position to state - you
    have not solved it, or the solve carries no recorded time. */
function placeCell(p: PreviewResp): HTMLElement | null {
  if (p.you.caseRank <= 0 || p.case.closers <= 0) return null;
  const d = dcell("Your place", ordinal(p.you.caseRank));
  d.appendChild(el("div", "drank", `of ${p.case.closers}`));
  return d;
}

// ── the player's own block ─────────────────────────────────────────────────────────────────────
// Three things in one cell, and the order is the argument: what you have, what that makes you, and
// what you would be next. `CASES CLOSED` used to sit here and the owner read it against `CLOSED IT`
// beside it as one fact printed twice - two headings, both counting closures, neither saying whose.
// It is gone. What replaced it is the only figure on this card a reader can change tonight:
//
//     CURRENT STREAK
//     8 cases
//     🔎 Inspector
//     2 more cases to Detective
//
// The last line is the whole point of the block - "задача блока не просто показывать статистику, а
// мотивировать продолжать решать". It is absent at the top of the ladder rather than invented, and
// absent for a player with no run, who has nothing to protect and is told so by its absence.
function recordCell(p: PreviewResp): HTMLElement | null {
  const run = p.you.streakCurrent;
  if (run <= 0) return null;
  const cell = dcell("Current streak", `${run} ${run === 1 ? "case" : "cases"}`);
  // The rung and the target share one wrapping row rather than owning a line each. On the phone
  // they fit side by side and the cell costs one line instead of two, which is the difference
  // between this block fitting the 320px feed slot and painting through the brief above it; where
  // there is width to spare they wrap, and where there is not they were never going to.
  const prog = el("div", "dprog");
  if (p.you.rank) prog.appendChild(el("span", "drank rank", p.you.rank));
  // `rankIn` can be 0 on the rung you have just earned - the next rung is known but you are not
  // short of it by anything. A line reading "0 more cases" is arithmetic, not encouragement.
  if (p.you.rankNext && p.you.rankIn > 0) {
    prog.appendChild(el("span", "dgoal",
      `${p.you.rankIn} more ${p.you.rankIn === 1 ? "case" : "cases"} to ${p.you.rankNext}`));
  }
  if (prog.childElementCount > 0) cell.appendChild(prog);
  return cell;
}

// ── the docket ───────────────────────────────────────────────────────────────────────────────
//
// The middle of the feed slot, which used to be empty page (dec. 84). Built out of what
// /api/preview answers and nothing else: a fact with no number is not printed (dec. 37).
//
// What changed is not which figures are available but WHICH WORLD each belongs to. The card used
// to draw, in one typeface and one rhythm and with nothing to tell them apart:
//
//     YOUR TIME 05:20 · FASTEST 01:54 · NEXT CASE 8h 53m · CURRENT STREAK 4 · DETECTIVES 8
//     └──────────── this case ───────┘  └── the series ─┘  └──────── you, all time ─────────┘
//
// Five cells, three subjects, zero sign of it - which is why a cell that looked glued to the case
// was read as being about the case. So (docs/11-stats-ia.md §1/R3):
//
//   * cells of one world stand together and are never interleaved;
//   * the boundary BETWEEN worlds is drawn one weight heavier than the boundary inside one
//     (`--rule-strong` vs `--rule`) - same ink, no colour, no extra word;
//   * the world ② figures leave the strip entirely for the sentence above it, so the docket is
//     ① then ③, one boundary, and never more than three cells.
//
// Three is what the 320px feed slot draws, so the strip is now complete on a phone in every state
// rather than truncated - which also means dec. 93's four- and five-band type ladder is
// unreachable and has been deleted with it.
type Cell = { node: HTMLElement; world: 1 | 3 };
const c1 = (node: HTMLElement | null): Cell | null => (node ? { node, world: 1 } : null);
const c3 = (node: HTMLElement | null): Cell | null => (node ? { node, world: 3 } : null);

/** "3h 07m", and "soon" at zero: `nextOpensInMin` floors at 0, so a case whose slot has already
    come round printed `0h 00m` - a countdown that has run out and is still counting. */
function opensIn(min: number): string {
  return min <= 0 ? "soon" : `${Math.floor(min / 60)}h ${pad(min % 60)}m`;
}

function renderDocket(p: PreviewResp) {
  const box = $("docket");
  box.textContent = "";
  const solved = p.you.state === "solved";
  const cells: (Cell | null)[] = [];

  if (solved) {
    // What you got and the mark to read it against, side by side: adjacency is what makes a second
    // time figure a benchmark rather than a stray clock (dec. 97). Both are this case's, so both
    // are world ① and no rule divides them.
    //
    // The cell is conditional because `timeSec` can be null on a solved row - a close recorded by a
    // build that predates the field. There is no honest figure to print then, so the cell is not
    // drawn rather than printing the 00:00 nobody achieved (dec. 37).
    if (p.you.timeSec !== null) {
      const t = dcell("Your time", fmtTime(p.you.timeSec));
      cells.push(c1(t));
    }
    cells.push(c1(fastestCell(p)));
    // Your place, as a CELL rather than a caption. It was a small line under your time and the
    // third band carried `CASES CLOSED` - a lifetime total, on a card about one case - which the
    // owner answered directly: "Cases closed - вместо этого я бы писал 5th of 5, место твоё из
    // скольки". So the solved strip is now three bands and all three are about THIS case: what you
    // got, what the best is, and where that puts you. Your rank and your totals moved to the plate
    // in the corner, which is where a fact about the player belongs on a case's cover page.
    //
    // `1st of 1` is printed rather than suppressed. It looks odd and it is true: it says you are
    // the only person who has closed this one, which is the same fact the unsolved card states in
    // words, and withholding a standing the reader asked for because the field is small would be
    // the card deciding which of its own figures the reader is allowed to see.
    cells.push(c1(placeCell(p)));
  } else {
    // ── what a card shows someone who has not closed the case ────────────────────────────────
    // This strip used to lead with the board: twelve squares, of which zero were filled for every
    // reader who had not started. The owner met it three times and finally as "почему когда я кейс
    // не решил есть эти ебаные ячейки пустые" - and the answer is that an empty progress bar is
    // the same picture on every reader's screen, so it carries no information at all. The card's
    // own convention already said so about the fraction beside it ("drawn above zero, absent
    // below it", dec. 95); the graphic was simply never held to it.
    //
    // What replaced it is the owner's own answer, and all three are things a reader who has not
    // begun can actually act on: how much evidence is in the file, how many people have already
    // closed it, and the run of their own that is on the line tonight.
    cells.push(c1(dcell("Clues", String(p.case.clueCount))));
    cells.push(c1(closersCell(p)));
    cells.push(c3(recordCell(p)));
    // `FASTEST` is deliberately absent before you have solved. That is dec. 97's own argument
    // applied where it leads: adjacency is what makes a second time figure a benchmark, and with
    // no time of your own on the card it is a stray one. It also buys the third phone cell for the
    // record cell, which dec. 102 requires to be there for a player whose run has lapsed.
  }

  let prev: 1 | 3 | null = null;
  for (const c of cells) {
    if (!c) continue;
    // The heavier rule goes on the cell that OPENS a world, because the strip draws its divider on
    // a cell's leading edge (`border-left` across, `border-top` down the two-column layout).
    if (prev !== null && c.world !== prev) c.node.classList.add("wbreak");
    prev = c.world;
    box.appendChild(c.node);
  }
  // The band count is data, so the layout is told it rather than left to discover it at paint
  // time. splash.css divides the right-hand column into exactly this many bands.
  box.dataset.n = String(box.childElementCount);
}


// ── the hook, and why it is only the first sentence ─────────────────────────────────────────────
// `theme.legend` is two sentences: what happened ("Someone trampled the seedlings in the community
// garden"), then how the puzzle is shaped ("Four gardeners filed reports - each at their own time,
// coat and tool"). The second half is a description of the board, and the board is already on the
// card as twelve countable squares and behind the button as the thing itself - so printing it here
// spends the most expensive line on the screen restating what the reader can see.
//
// The first sentence is the part nothing else says, and it is the ONLY line on this card that
// differs from case to case. Measured across all six themes it runs 44-62 characters, which is
// shorter than the rule of the game it replaces - so this buys a better line AND a shorter one.
function hook(legend: string): string {
  const first = /^[^.!?]+[.!?]/.exec(legend.trim());
  return (first ? first[0] : legend).trim();
}

/** Five countable squares - the same component the game's HUD uses for a board, borrowed here to
    show a vote walking towards the verdict it takes `minTotal` of them to reach. */
function ticks(done: number, total: number): HTMLElement {
  const box = el("span", "ticks");
  for (let i = 0; i < total; i++) box.appendChild(el("i", i < done ? "on" : undefined));
  return box;
}

/** One labelled fact: a caps key in its own column, the fact beside it, figures picked out in full
    ink. `parts` are appended in order; a string becomes text, an element is taken as it is. */
function brow(key: string, ...parts: (string | HTMLElement)[]): HTMLElement {
  const row = el("div", "brow");
  row.appendChild(el("div", "bk", key));
  const v = el("div", "bv");
  for (const part of parts) {
    if (typeof part === "string") v.appendChild(document.createTextNode(part));
    else v.appendChild(part);
  }
  row.appendChild(v);
  return row;
}

const fig = (text: string) => el("b", undefined, text);

/** When the next case lands, and - in three or four words - what the sub is voting it into. The
    long form of the steer lives in the vote row below, which only the wide card draws; this is the
    half of it that has to survive on a phone. */
function nextRow(p: PreviewResp): HTMLElement {
  const when = p.next.opensInMin <= 0 ? "soon" : opensIn(p.next.opensInMin);
  const parts: (string | HTMLElement)[] = [fig(when)];
  const steer = steerPhrase(p);
  if (steer) parts.push(` \u00b7 ${steer}`);
  return brow("Next case", ...parts);
}

/** What the vote is doing to the next case, short enough to ride the countdown's own line. `null`
    on an archive case: the publisher reads the CURRENT post's vote, so an old case's vote steers
    nothing and this card must not say otherwise (dec. 37). */
function steerPhrase(p: PreviewResp): string {
  const v = p.next.vote;
  if (!v || !p.next.tier) return "";
  const word = tierWord(p.next.tier);
  if (v.total === 0) return "nobody has voted yet";
  if (v.verdict === null) {
    return v.total < v.minTotal ? `${v.total} of ${v.minTotal} votes in` : "no clear winner";
  }
  if (p.next.moved === "up") return `going up to ${word}`;
  if (p.next.moved === "down") return `coming down to ${word}`;
  // Decided, and the level does NOT move: either the sub voted to keep it, or it voted for a step
  // off the end of the ladder. Saying "harder" while nothing gets harder would be a promise the
  // publisher then declines to make - the ladder the vote walks is sized from what is in the bank.
  if (v.verdict === "Same") return `staying ${word}`;
  // Short on purpose. These two are the longest phrases this row can produce and the probe caught
  // both wrapping it to a second line inside the 320px slot, where there is no second line to have.
  // They also say the same thing in a third of the characters: the ladder has ends, and the vote
  // has hit one.
  return v.verdict === "Harder" ? "already the hardest" : "already the easiest";
}

/** The vote itself, on the wide layout only: a meter walking towards the verdict, then the counts.
    Counts, never percentages - a percentage is a claim about a distribution and this one is five
    votes wide. */
function voteRow(p: PreviewResp): HTMLElement | null {
  const v = p.next.vote;
  if (!v || v.total === 0) return null;
  const t = v.tally;
  const parts: (string | HTMLElement)[] = [
    ticks(Math.min(v.total, v.minTotal), v.minTotal),
    `Harder ${t.Harder} \u00b7 Same ${t.Same} \u00b7 Softer ${t.Softer}`,
  ];
  if (v.yours) parts.push(` \u00b7 you voted `, fig(v.yours.toLowerCase()));
  return brow("The vote", ...parts);
}

// ── the archive card: two rows in place of a countdown that named the wrong case ────────────────
//
// A case you have CLOSED, on a post that is no longer the live one, left this block holding
// `NEXT CASE 7h 49m` and nothing else - the vote steers nothing on an archive case, so its row is
// null, and the hook and the items belong to the unsolved state. Worse than empty: that countdown
// runs to #cursor+1 while #cursor is already published, so it told a reader who had just finished
// to wait seven hours for a case that was out. The two rows below answer what is actually left -
// where the live case is, and when this one's own day ended.

/** How long ago, in the coarsest unit that is still true. An archive case is days old and
    `4 days ago` is what a reader takes from a glance; a figure in minutes would be precision about
    something nobody is timing. */
function agoPhrase(min: number): string {
  if (min < 60) return "just now";
  const h = Math.floor(min / 60);
  if (h < 24) return h === 1 ? "an hour ago" : `${h} hours ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

/** The live case - the one thing on an archive card a reader can still act on. It is a ROW and not
    a third button on purpose: dec. 98 gives this card exactly two, and neither is one to give up -
    the standings least of all, since being unreachable is what put it there in the first place. So
    the affordance lives in the row: reading ink against the muted sentence around it, a rule under
    it, and the arrow that says this one leaves the post. */
function liveRow(live: NonNullable<PreviewResp["next"]["live"]>): HTMLElement {
  const go = document.createElement("button");
  go.type = "button";
  go.className = "golive";
  const word = tierWord(live.tier);
  go.appendChild(fig(`#${live.number}`));
  // The arrow rides in the same text node as the words: it is part of what the underline is under,
  // and one text node is one thing for the decoration to run beneath rather than three boxes.
  go.appendChild(document.createTextNode(
    `${word ? ` \u00b7 ${word}` : ""} \u00b7 live now \u2192`));
  // The card's only navigation, and a failed one must not take the render down with it: everything
  // else on this card is still true whether or not the jump lands.
  go.addEventListener("click", () => {
    try { navigateTo(live.url); } catch { /* the row stays; the card is unharmed */ }
  });
  return brow("Today's case", go);
}

/** That this case is over, and when - the one fact about an archive case the card never carried.
    Deliberately NOT the winner and NOT the headcount: the docket beside it already prints `FASTEST`
    and `YOUR PLACE n of m`, and restating either 40px away is the duplication dec. 80 struck off
    the result sheet. */
function closedRow(p: PreviewResp): HTMLElement | null {
  if (p.case.closedMinAgo !== null) return brow("Case closed", fig(agoPhrase(p.case.closedMinAgo)));
  // Archive with its 24 h not yet up - which happens when a second case goes out the same day. The
  // clock is still a true thing to say, so it is said forwards instead of not at all.
  if (p.case.closesInMin !== null) return brow("Case closes", "in ", fig(opensIn(p.case.closesInMin)));
  return null;
}

function render(p: PreviewResp) {
  $("case-no").textContent = p.case.number === null ? "Today's case" : `Case #${p.case.number}`;
  // The difficulty mark is a stamp: since dec. 86 it carries a word anyone can rank (EASY /
  // MEDIUM / HARD) over the denominator the old ordinal never had. The sentence that says what
  // the case will ask of you moves down here, where there is room to be a sentence.
  paintTier($("tier"), p.case.tier);
  $("case-title").textContent = p.case.title;

  // ── the brief: two lines, and which two depends on what the reader still has to do ───────────
  //
  // Before you have closed the case, the question is "what is this one about" - and until now the
  // answer was the RULE OF THE GAME, identical on all 160 cases. It said nothing about the case in
  // front of you, and it duplicated the sentence printed under the board itself, where the rule is
  // actually applied. The hook takes the first line instead: it is the one thing on this card that
  // changes from day to day, which is the exact complaint behind plans/07-variety.md - six themes
  // exist and a player who never sees them has no way to know it. The rule keeps its place on the
  // wide layout, where there is room for both.
  //
  // Once you have closed it the case is spent, and the two questions left are forward-looking: when
  // is the next one and how hard, and - the only line anywhere on this card about a PERSON - who
  // took the last one. Both go in the one line the phone gets; the tally follows on the wide one.
  if (p.you.state === "solved") {
    // Labelled facts rather than a paragraph. `LAST CASE` used to lead this block and is gone
    // entirely: it was a live re-read of the PREVIOUS case's board, so the name it printed changed
    // the moment somebody beat that record, and there was then nowhere in the app that said the
    // old holder had ever held it. That belongs in a comment on the post, where it is permanent and
    // where the mention notifies the winner - see src/server/herald.ts. The card keeps the live
    // figure, which is the thing a card is actually good at.
    const rules = $("rules");
    rules.textContent = "";
    rules.classList.add("rows");
    const tl = $("tier-line");
    tl.textContent = "";
    tl.classList.add("rows");
    // WHICH pair of rows depends on whether this post is still the live one. On the live case the
    // block looks forward - the next case, and what the vote is doing to its level - and those are
    // precisely the two things an archive case has no honest version of, which is how this state
    // came to hold a lone countdown about a case that is not next. `next.live` is the server
    // saying "you are not the live one", and it names the one that is.
    const live = p.next.live;
    const second = live ? closedRow(p) : voteRow(p);
    // The phone draws `.rules` and not `.tierline`, so the row that can be acted on goes first.
    rules.appendChild(live ? liveRow(live) : nextRow(p));
    if (second) tl.appendChild(second);
  } else {
    const h = hook(p.case.legend);
    $("rules").textContent = h || RULE;
    // The four items, once, under the brief - each glyph over the word for it. The glyphs alone
    // read as decoration, and at this size several of them are not guessable: a kitchen timer is a
    // clock, a wheat sheaf is a houseplant. The word is what makes the row the evidence list it is.
    // `?? []` because this field is younger than some deployed servers and than every fixture
    // written before it: iterating `undefined` would throw inside render() and take the whole card
    // down to its neutral state, which is a much worse failure than a missing row of glyphs.
    const items = $("items");
    items.textContent = "";
    for (const o of p.case.objects ?? []) {
      const box = el("span", "item");
      box.appendChild(el("span", "ig", o.emoji));
      box.appendChild(el("span", "il", o.label));
      items.appendChild(box);
    }
    // Never the same sentence twice: with no legend to show, the rule has already taken the line
    // above and the wide layout falls back to what this tier asks of you.
    $("tier-line").textContent = h ? RULE : tierTechnique(p.case.tier);
  }

  // The sub-label carries what the docket does not (dec. 99). It used to print `SOLVED IN 04:59`
  // 40px under `YOUR TIME 04:59`, and `5 OF 12 CELLS DEDUCED` under the same fraction - the
  // duplication dec. 80 struck off the result sheet, on a smaller screen, and now on a button
  // that shares its row with a second one. The estimate stays: nothing else on the card says how
  // long this takes, and it is the one thing a stranger is deciding on.
  if (p.you.state === "solved") {
    setCta("See results");
  } else if (p.you.state === "playing") {
    setCta("Continue");
  } else {
    // "~3 min" - a context-free reader took the tilde for a "<" and read it as a promise that
    // the case takes under three minutes. It is an estimate, so it says so in a word.
    setCta("Open the case file", "about 3 min");
  }

  renderDocket(p);
}

(async () => {
  try {
    const res = await fetch("/api/preview");
    if (!res.ok) return;                       // neutral state stays - never invent social proof
    render((await res.json()) as PreviewResp);
  } catch { /* offline: the Play button still works */ }
})();
