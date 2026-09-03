// packages/utils/src/name-case.ts
//
// `toDisplayCase` — repair the casing of a person's name, and ONLY when the input
// proves it needs repairing.
//
// Measured on 14,824 contacts: 510 were ALL CAPS and 1,112 were all lowercase, ~11%
// of the book. See plans/records/contact-name-casing-plan.md.
//
// ── The one rule everything else hangs off ───────────────────────────────────
// A value is rewritten ONLY when it is entirely upper-case or entirely lower-case.
// Mixed case means a human (or a source that already got it right) made a casing
// decision, and this function must not overrule it — so `MacIver`, `d'Artagnan`,
// `van der Berg`, `DeAngelo`, `eBay` and `JP` are all returned untouched with no
// flag, setting or per-field opt-out needed. That is why there is no `force` option
// and why one must never be added: the moment this can rewrite mixed-case input it
// needs an escape hatch, and the escape hatch is the feature.
//
// The corollary is that this is NOT a general title-caser. It cannot fix `Mcdonald`
// typed by a human, and it should not try — it has no evidence anything is wrong.

/** Vowels, for the initials test below. `Y` counts — `AMY`/`RAY`/`GUY` are names. */
const VOWELS = /[AEIOUY]/

/**
 * Latin nobiliary/toponymic particles, lower-cased when they sit between other
 * words. `der`/`den` are in the list because `VAN DER BERG` -> `van der Berg` needs
 * the middle token lowered too, not just the leading one.
 *
 * ⚠️ Deliberately EXCLUDES `al`, `af`, `av`, `zu`, `do` and `les`, every one of
 * which is a real given name or set of initials far more often than it is a
 * particle here. Including `al` would turn `AL SMITH` into `al Smith`. The list is
 * only ever consulted for a word that has something after it, so a lone `AL`/`VAN`
 * is capitalized normally either way.
 *
 * The measured benefit of this rule is small and honest: across the whole sample
 * exactly ONE value is fixed by it (`van ruler` -> `van Ruler`). Every other
 * particle name in the data — `de Alejo`, `van Dyck`, `von Disterlo`, `del Junco` —
 * is already correct mixed case and is never touched at all.
 */
const PARTICLES: ReadonlySet<string> = new Set([
  'van',
  'von',
  'der',
  'den',
  'de',
  'del',
  'della',
  'di',
  'da',
  'dos',
  'das',
  'du',
  'la',
  'le',
  'ter',
  'ten',
  'bin',
  'ibn',
])

/** Generational suffixes that stay upper-case. */
const ROMAN_SUFFIXES: ReadonlySet<string> = new Set([
  'I',
  'II',
  'III',
  'IV',
  'V',
  'VI',
  'VII',
  'VIII',
  'IX',
  'X',
  'XI',
  'XII',
])

/**
 * Surnames where the `MacX` spelling is the established one.
 *
 * An ALLOWLIST, never a rule — and that is the whole point. `MACHADO`, `MACK`,
 * `MACON` and `MACKAY` are not `MacHado` / `MacK` / `MacOn` / `MacKay`, so a
 * `Mac` + capitalize rule invents a capital that appears in no source, which is
 * strictly worse than leaving `Machado`. Anything not on this list falls through to
 * plain capitalization.
 *
 * `Mc` needs no allowlist: `Mc` is a contraction of `Mac` and effectively always
 * takes a following capital (verified against every `MC…` surname in the sample —
 * McAllister, McBryde, McCandless, McCormick, McCoy, McDaniel, McElhany, McGarry).
 */
const MAC_NAMES: ReadonlySet<string> = new Set([
  'macallister',
  'macarthur',
  'macaulay',
  'macbride',
  'maccarthy',
  'macdonald',
  'macdougall',
  'macfarlane',
  'macgregor',
  'macintosh',
  'macintyre',
  'maciver',
  'mackenzie',
  'mackinnon',
  'maclachlan',
  'maclean',
  'macleod',
  'macmillan',
  'macnamara',
  'macneil',
  'macpherson',
  'macquarie',
])

/** Upper-case the first cased letter, leave the rest of the (already lowered) segment. */
function upperFirst(segment: string): string {
  return segment.replace(/\p{Ll}/u, (ch) => ch.toLocaleUpperCase())
}

/**
 * Case one hyphen/apostrophe/period-delimited run: `o'brien` -> `O'Brien`,
 * `creighton-taylor` -> `Creighton-Taylor`, `l.` -> `L.`.
 *
 * Splits with a capturing group so the delimiters are preserved and re-joined
 * verbatim. `formatComplexName` (deleted with this change) split on `[\s-']` and
 * joined on `' '`, which DELETED every hyphen and apostrophe it touched — that bug
 * is the reason this function exists rather than being a two-line reuse.
 */
function caseSegments(lowered: string): string {
  return lowered
    .split(/([-'’.])/)
    .map((part, index) => {
      // Odd indices are the captured delimiters — pass them through untouched.
      if (index % 2 === 1) return part
      if (part.startsWith('mc') && part.length >= 4) return `Mc${upperFirst(part.slice(2))}`
      if (part.startsWith('mac') && MAC_NAMES.has(part)) return `Mac${upperFirst(part.slice(3))}`
      return upperFirst(part)
    })
    .join('')
}

/** Letters only, for the initials test — `(OSV)` should be judged on `OSV`. */
function lettersOf(word: string): string {
  return word.replace(/[^\p{L}]/gu, '')
}

/**
 * Is this ALL-CAPS word a set of initials or an acronym rather than a name?
 *
 * Two signals, both measured against the 510 all-caps values in the sample:
 *
 * - **No vowel.** A perfect discriminator at length 3: every acronym there
 *   (`BBH` `CSH` `CSJ` `HHH` `RMR` `SVR` `VPT` `LLC`) lacks one and every real name
 *   (`ALI` `AMY` `BEN` `COX` `GUY` `JAY` `KEN` `LEE` `PAT` `RAY` `TIM` `TOM` …) has one.
 * - **Exactly two letters.** Initials outnumber names 22:5 there (`AJ` `CJ` `DJ` `JP`
 *   `TJ` `JC` `JD` `JF` `JJ` `JM` `JT` `JW` `LK` `MJ` `OJ` `PJ` `RR` `TS` `VJ` `CR`
 *   `GB` `MC` against `ED` `ER` `HE` `JU` `LI`), and no vowel test separates `AJ`
 *   from `ED`.
 *
 * The five two-letter names this leaves shouting are the accepted cost: an
 * un-improved `ED` is a cosmetic miss, whereas `JP` -> `Jp` is visibly broken and
 * invents a lowercase letter that was in no source.
 */
function looksLikeInitials(word: string): boolean {
  const letters = lettersOf(word)
  if (letters.length === 0) return false
  return letters.length <= 2 || !VOWELS.test(letters)
}

/**
 * Repair the casing of a name that is entirely upper-case or entirely lower-case.
 *
 * Returns the input **unchanged** — the same string, so callers can compare by
 * value — for mixed-case input, empty/nullish input, script without case (`李`),
 * and anything containing `@` (an email address parked in a name field is a
 * different problem, and title-casing it would only disguise it).
 *
 * @example
 * toDisplayCase('BRUCE')            // 'Bruce'
 * toDisplayCase('regina')           // 'Regina'
 * toDisplayCase('MACIVER')          // 'MacIver'
 * toDisplayCase('MACHADO')          // 'Machado'  (allowlist miss — not MacHado)
 * toDisplayCase('MCDONALD')         // 'McDonald'
 * toDisplayCase('O\'BRIEN')         // 'O\'Brien'
 * toDisplayCase('CREIGHTON-TAYLOR') // 'Creighton-Taylor'
 * toDisplayCase('VAN DER BERG')     // 'van der Berg'
 * toDisplayCase('JP')               // 'JP'       (initials — untouched)
 * toDisplayCase('MacIver')          // 'MacIver'  (mixed case — untouched)
 */
export function toDisplayCase(value: string | null | undefined): string | null | undefined {
  if (!value) return value
  if (value.includes('@')) return value

  const hasUpper = /\p{Lu}/u.test(value)
  const hasLower = /\p{Ll}/u.test(value)
  // Uncased script (CJK, Hebrew, Arabic) matches neither — nothing to repair.
  if (hasUpper === hasLower) return value
  const fromUpper = hasUpper

  // Split on whitespace runs, capturing them so the original spacing survives.
  const parts = value.split(/(\s+)/)
  const wordIndices = parts.reduce<number[]>((acc, part, i) => {
    if (i % 2 === 0 && part.length > 0) acc.push(i)
    return acc
  }, [])
  const lastWordIndex = wordIndices[wordIndices.length - 1]
  const isSingleWord = wordIndices.length === 1

  const recased = parts.map((part, index) => {
    if (index % 2 === 1 || part.length === 0) return part

    const letters = lettersOf(part)
    const isLast = index === lastWordIndex

    // Generational suffix — `FRIENDS II` -> `Friends II`, `TAULMAN JR` -> `Taulman Jr`.
    // Never on the first word, where `IV`/`V` are far more likely to be an initial.
    if (index !== wordIndices[0]) {
      const upper = letters.toLocaleUpperCase()
      if (ROMAN_SUFFIXES.has(upper)) return part.toLocaleUpperCase()
      if (upper === 'JR' || upper === 'SR') return caseSegments(part.toLocaleLowerCase())
    }

    const lowered = part.toLocaleLowerCase()

    // A particle is lowered only when something follows it. `VAN` on its own is
    // somebody's whole name and gets capitalized; `VAN DER BERG` does not.
    //
    // Ordered BEFORE the initials test on purpose: `DE` and `LA` are two letters, so
    // the initials test would otherwise claim them and `DE LA CRUZ` would come back
    // as `DE LA Cruz`. Particles are a closed known set, initials are a heuristic —
    // the closed set wins.
    if (!isSingleWord && !isLast && PARTICLES.has(lettersOf(lowered))) return lowered

    // Initials/acronyms keep the shape they came in with, but only when that shape
    // was upper-case to begin with — a lower-case `jp` carries no such evidence.
    if (fromUpper && looksLikeInitials(part)) return part

    return caseSegments(lowered)
  })

  const next = recased.join('')
  // Return the ORIGINAL string when nothing moved, so callers can compare by identity.
  return next === value ? value : next
}
