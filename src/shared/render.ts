// Render a structured clue to English text. Flavor (names/items) from the theme; coat forms
// are universal. Phrasings stay in grammar-safe frames so any theme reads naturally.

import type { Clue, Ref } from "./types.js";
import type { Theme } from "./themes.js";
import { FLAIR, TIME_EMOJI } from "./themes.js";

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
// An item is always named glyph-first (`🌾 flour`): the board's chips are glyph-only, so the
// clue is the one place a reader learns which picture the word means (dec. 150).
const itemRef = (theme: Theme, token: string): string => {
  const o = theme.objects[token];
  return `${o.emoji} ${o.label.toLowerCase()}`;
};

// Description of a category value (as a subject phrase).
function phrase(cat: string, val: string, theme: Theme): string {
  if (cat === "s" || cat === "suspect") return val; // suspect name
  if (cat === "flair") return `the ${FLAIR[val].word} coat`;
  if (cat === "time") return `the one seen at ${val}`;
  return `the ${itemRef(theme, val)}`; // object
}

const isTime = (r: Ref) => r[0] === "time";
const isFlair = (r: Ref) => r[0] === "flair";
const isObject = (r: Ref) => r[0] === "object";

export function renderClue(c: Clue, theme: Theme): string {
  switch (c.k) {
    case "ne": {
      if (c.cat === "time") return `${c.s} wasn't seen at ${c.v}.`;
      if (c.cat === "flair") return `${c.s}'s coat isn't ${FLAIR[c.v].word}.`;
      return `${c.s} didn't carry the ${itemRef(theme, c.v)}.`; // object
    }
    case "same": {
      // one side is time → "<other> was seen at HH:MM"
      if (isTime(c.a) || isTime(c.b)) {
        const timeRef = isTime(c.a) ? c.a : c.b;
        const other = isTime(c.a) ? c.b : c.a;
        return `${cap(phrase(other[0], other[1], theme))} was seen at ${timeRef[1]}.`;
      }
      // coat + item → "The <item> was carried by the <color> coat."
      if ((isFlair(c.a) && isObject(c.b)) || (isObject(c.a) && isFlair(c.b))) {
        const coat = isFlair(c.a) ? c.a : c.b;
        const obj = isObject(c.a) ? c.a : c.b;
        return `The ${itemRef(theme, obj[1])} was carried by the ${FLAIR[coat[1]].word} coat.`;
      }
      return `${cap(phrase(c.a[0], c.a[1], theme))} and ${phrase(c.b[0], c.b[1], theme)} are the same person.`;
    }
    case "nsame":
      return `${cap(phrase(c.a[0], c.a[1], theme))} and ${phrase(c.b[0], c.b[1], theme)} are different people.`;
    case "before":
      return `${cap(phrase(c.a[0], c.a[1], theme))} was seen before ${phrase(c.b[0], c.b[1], theme)}.`;
  }
}

// Icon/label of a value for chips and the solution table.
export function valueLabel(cat: string, val: string, theme: Theme): { emoji: string; label: string } {
  if (cat === "flair") return { emoji: FLAIR[val].emoji, label: cap(FLAIR[val].word) };
  if (cat === "time") return { emoji: TIME_EMOJI[val] ?? "", label: val };
  const o = theme.objects[val];
  return { emoji: o.emoji, label: o.label };
}
