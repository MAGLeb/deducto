// The difficulty ladder, in one place, because the splash and the board must never disagree about
// what a mark means. Four rungs since plan 02 added `tutorial` (dec. 43): it sits BELOW green and
// only ever appears in the warm-up lane, never as a daily.
//
// D3 removed emoji from the chrome, so the mark is no longer a traffic light - it is the text of a
// `.stamp`, the one component the system reserves for marks made ON the file.
//
// What the stamp says has now been through three attempts and the first two failed on the same
// player, twice (dec. 86). "TIER II" is an ordinal with no denominator: a scale is named and never
// shown, so a reader who has not seen TIER I or TIER III has nothing to place it against. Adding
// "LINK TWO CLUES" under it did not fix that - it is an imperative, so it reads as an instruction
// for the next tap rather than as a description of the case.
//
// So the stamp now carries the two things a first-time reader can actually use:
//   `mark`  - a plain English word that is already ordered without any comparison. EASY / MEDIUM
//             / HARD, and not a more characterful triple, precisely because this is the third
//             attempt: it is the most conventional difficulty ladder there is, so it costs a
//             reader nothing. The flavour is carried by `technique`, which has room for it.
//   `scale` - the denominator the ordinal never had: LEVEL 2 OF 3. Deliberately redundant with
//             the word - two channels for one fact is what this system asks for everywhere else.
// Never a hue - colour belongs to the evidence grid, and it is the channel that dies first in
// greyscale and under CVD. The ladder's second non-colour channel is still the stamp's own weight
// (`rank`): outlined light, outlined dark, double-ruled.
//
// `technique` is the sentence the old gloss was trying to be. It is a full sentence in the
// indicative, not a 14-character imperative, and it is shown where a screen has room for a
// sentence (the splash's cover page) rather than crammed into a 30px casebar.
//
// Anything unknown gets no mark rather than a guessed one: a badge that quietly calls an unseen
// tier "green" is worse than a badge that says nothing.
interface TierBadge {
  mark: string;       // the word: WARM-UP / EASY / MEDIUM / HARD
  scale: string;      // LEVEL n OF 3 - empty for the warm-up, which is not on the daily ladder
  label: string;      // prose name, used where a stamp does not fit
  technique: string;  // what the case asks of you, as a sentence
  hint: string;       // the title attribute: word, place on the ladder, and the reason behind it
  rank: 0 | 1 | 2 | 3;
}

const TIERS: Record<string, TierBadge> = {
  // The warm-up is deliberately off the numbered ladder: dec. 43 keeps `tutorial` out of
  // DAILY_TIERS, so no vote can land the daily on it and "level 0 of 3" would be a rung that
  // does not exist. It gets the word and nothing else.
  tutorial: {
    mark: "Warm-up", scale: "", label: "Warm-up", rank: 0,
    technique: "Over-clued on purpose: every move follows straight from a single clue.",
    hint: "Warm-up - over-clued practice, not one of the three daily levels",
  },
  green: {
    mark: "Easy", scale: "Level 1 of 3", label: "Easy", rank: 1,
    technique: "Every move follows from one clue and what you have already marked.",
    hint: "Easy - level 1 of 3: every move follows from one clue and your own marks",
  },
  yellow: {
    mark: "Medium", scale: "Level 2 of 3", label: "Medium", rank: 2,
    technique: "Some steps need two clues linked through a value they share.",
    hint: "Medium - level 2 of 3: some steps need two clues linked through a shared value",
  },
  red: {
    mark: "Hard", scale: "Level 3 of 3", label: "Hard", rank: 3,
    technique: "The clues may not force every cell - a guess can be needed.",
    hint: "Hard - level 3 of 3: the clues may not force every cell, so a guess can be needed",
  },
};

function tierBadge(tier: string): TierBadge {
  return TIERS[tier]
    ?? { mark: "", scale: "", label: tier, technique: "", hint: `Difficulty: ${tier}`, rank: 0 };
}

/** The sentence describing what this case asks of you, or "" for an unknown tier. */
export function tierTechnique(tier: string): string {
  return tierBadge(tier).technique;
}

/** The one-word difficulty (EASY / MEDIUM / HARD), for prose that names a tier the stamp is not
    drawing - the splash's line about what the vote is doing to the NEXT case. Same word as the
    stamp, from the same table: two screens describing one ladder must not invent two vocabularies. */
export function tierWord(tier: string): string {
  return tierBadge(tier).mark;
}

/** Paint a `.stamp` element as the tier mark: the word, the place on the ladder, weight, title. */
export function paintTier(el: HTMLElement, tier: string): void {
  const b = tierBadge(tier);
  el.textContent = "";
  el.title = b.hint;
  el.dataset.rank = b.mark ? String(b.rank) : "";
  if (!b.mark) return;
  const word = document.createElement("span");
  word.className = "t-word";
  word.textContent = b.mark;
  el.appendChild(word);
  if (!b.scale) return;
  const scale = document.createElement("span");
  scale.className = "t-scale";
  scale.textContent = b.scale;
  el.appendChild(scale);
}
