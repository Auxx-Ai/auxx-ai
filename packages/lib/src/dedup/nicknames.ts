// packages/lib/src/dedup/nicknames.ts
//
// Given-name equivalence. Pure — no db, no I/O, no extension.
//
// 🔴 **This is the only mechanism in the engine that can recover Bob/Robert and
// Peggy/Margaret.** Measured on the dev database with `pg_trgm`:
// `similarity('bob','robert') = 0` and `similarity('peggy','margaret') = 0` —
// they share ZERO trigrams. The relation is lexical convention, not spelling, so
// no string metric can ever recover it and no threshold can be tuned into it.
// v1's "a nickname table is out of scope because trigram won't catch it" was
// exactly backwards: trigram not catching it is the argument FOR the table.
//
// ── Sourcing and exclusion policy (read before editing `nicknames.json`) ─────
//
// The dictionary is the standard published English hypocorism corpus — the short
// forms, pet forms and spelling variants that appear consistently across
// genealogical nickname lists (the "Bill → William", "Peggy → Margaret" family)
// — restricted to names common in English-language records.
//
// **A wrong equivalence is the worst failure this feature can have**: it merges
// two different people. So the list is deliberately NOT padded to hit a size
// target, and four classes are excluded on purpose:
//
//  1. **Cross-language cognates.** `sean`/`juan`/`jean`/`ian` are not nicknames
//     for `john`, they are different names that happen to share an etymology.
//     Same for `luis`/`louis`, `lorenz`/`lawrence`, `moshe`/`moses`.
//  2. **Hypocorisms that have become dominant standalone names.** `liam` is
//     historically short for `william`, but a modern `Liam` is overwhelmingly
//     his own person — and "Liam Klooth / William Klooth" is far more likely to
//     be son and father than one duplicated contact. `lisa` (Elizabeth) and
//     `rita` (Margarita) are excluded for the same reason.
//  3. **Regional slang and one-off coinages** (`tel` for Terence, `kaz` for
//     Karen). Real, but too thin to justify a merge prompt.
//  4. **Surnames that look like variants** (`hughes`, `daniels`).
//
// Ambiguity itself is fine and is modelled, not avoided: `bert` legitimately
// resolves to albert, gilbert, herbert, robert and roberta. That is why
// {@link canonicalGivenNames} returns a SET and equivalence is set intersection
// — `bert`/`robert` matches, while `albert`/`robert` does not.

import nicknames from './nicknames.json'

/** How two given names were found equivalent. Carried for signal provenance. */
export type GivenNameMatchKind = 'exact' | 'nickname' | 'initial' | 'prefix' | 'fuzzy'

/**
 * Shortest prefix accepted by the prefix rule.
 *
 * Three, because `jon`/`jonathan` is a real duplicate shape and two would make
 * every `jo` collapse onto joseph, joanna, john and josephine at once.
 */
const MIN_PREFIX_LENGTH = 3

/**
 * The edit-distance arm only applies once the longer name reaches this length.
 *
 * 🔴 **Short names are where edit distance goes wrong**: `bob`/`rob`,
 * `dan`/`don`, `jon`/`ron` are all distance 1 and all different people. At five
 * characters and up the arm does what it is for — `sara`/`sarah`,
 * `micheal`/`michael`, `katherine`/`katharine` — and the short-name traps are
 * out of range.
 */
const MIN_FUZZY_LENGTH = 5

/**
 * `canonical name → variants`, straight from the JSON asset.
 *
 * @see `nicknames.json`
 */
const CANONICAL: Record<string, string[]> = nicknames.canonical

/**
 * `any name → the canonical names it can stand for`, built once at module load.
 *
 * Bidirectional by construction: a canonical name maps to itself plus every
 * canonical name that lists it as a variant (`christine` → christine, christina),
 * and a variant maps to every canonical name that claims it (`bert` → albert,
 * gilbert, herbert, robert, roberta).
 */
const ROOTS: Map<string, Set<string>> = (() => {
  const map = new Map<string, Set<string>>()
  const add = (name: string, root: string) => {
    const bucket = map.get(name) ?? new Set<string>()
    bucket.add(root)
    map.set(name, bucket)
  }
  for (const [canonical, variants] of Object.entries(CANONICAL)) {
    add(canonical, canonical)
    for (const variant of variants) add(variant, canonical)
  }
  return map
})()

/** How many canonical names the dictionary defines. Reported by the tests. */
export const NICKNAME_CANONICAL_COUNT = Object.keys(CANONICAL).length

/** How many distinct name strings the dictionary can resolve. */
export const NICKNAME_NAME_COUNT = ROOTS.size

/**
 * Fold a raw name cell onto the comparable form: lowercase, diacritics
 * stripped, everything that is not a letter removed.
 *
 * `'  Bill '` → `'bill'`, `'W.'` → `'w'`, `'José'` → `'jose'`,
 * `'Mary-Anne'` → `'maryanne'`. Hyphens and apostrophes go rather than split,
 * because a name cell holds ONE given name — splitting it would compare
 * `mary` against `anne` and call two different people equivalent.
 */
export function normalizeGivenName(raw: string | null | undefined): string {
  if (!raw) return ''
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '')
}

/**
 * Every canonical name a given name can stand for — itself included when it is
 * not in the dictionary at all.
 *
 * @example
 * ```typescript
 * canonicalGivenNames('bill')   // → ['william']
 * canonicalGivenNames('bert')   // → ['albert', 'gilbert', 'herbert', 'robert', 'roberta']
 * canonicalGivenNames('kwame')  // → ['kwame']  (unknown names stand for themselves)
 * ```
 */
export function canonicalGivenNames(name: string): string[] {
  const normalized = normalizeGivenName(name)
  if (!normalized) return []
  const roots = ROOTS.get(normalized)
  return roots ? [...roots].sort() : [normalized]
}

/** Levenshtein distance, early-exiting as soon as it exceeds 1. */
function isWithinOneEdit(a: string, b: string): boolean {
  if (a === b) return true
  const [short, long] = a.length <= b.length ? [a, b] : [b, a]
  if (long.length - short.length > 1) return false

  if (long.length === short.length) {
    let diffs = 0
    for (let i = 0; i < long.length; i++) {
      if (long[i] !== short[i] && ++diffs > 1) return false
    }
    return diffs === 1
  }

  // One insertion: the two must agree either side of a single skipped character.
  let i = 0
  while (i < short.length && short[i] === long[i]) i++
  return short.slice(i) === long.slice(i + 1)
}

/**
 * How two given names are equivalent, or `null` when they are not.
 *
 * Five arms, in decreasing confidence:
 *
 *  1. **exact** — same normalized string.
 *  2. **nickname** — their canonical sets intersect (`bill`/`william`,
 *     `peggy`/`margaret`, `bert`/`robert`).
 *  3. **initial** — one side is a single letter matching the other's first
 *     (`W.`/`William`). CSV imports and signature parsers produce these
 *     constantly.
 *  4. **prefix** — one is a prefix of the other, at least
 *     {@link MIN_PREFIX_LENGTH} long (`jon`/`jonathan`, `will`/`william`).
 *  5. **fuzzy** — edit distance ≤ 1, same first letter, longer name at least
 *     {@link MIN_FUZZY_LENGTH} (`micheal`/`michael`). Computed here in JS over
 *     the handful of blocked candidates, never in SQL: `fuzzystrmatch` is not
 *     installed and this feature is not worth a Postgres extension.
 *
 * The first-letter guard on the fuzzy arm is load-bearing, not tidiness:
 * without it `kevin`/`devin` and `jenny`/`kenny` are distance 1.
 *
 * An empty or missing name is never equivalent to anything — a blank cell is an
 * absence of evidence, and treating it as a match would pair every unnamed
 * record in the org.
 */
export function givenNameEquivalence(
  a: string | null | undefined,
  b: string | null | undefined
): GivenNameMatchKind | null {
  const left = normalizeGivenName(a)
  const right = normalizeGivenName(b)
  if (!left || !right) return null

  if (left === right) return 'exact'

  const leftRoots = canonicalGivenNames(left)
  const rightRoots = new Set(canonicalGivenNames(right))
  if (leftRoots.some((root) => rightRoots.has(root))) return 'nickname'

  if (left.length === 1 || right.length === 1) {
    return left[0] === right[0] ? 'initial' : null
  }

  const [short, long] = left.length <= right.length ? [left, right] : [right, left]
  if (short.length >= MIN_PREFIX_LENGTH && long.startsWith(short)) return 'prefix'

  if (long.length >= MIN_FUZZY_LENGTH && left[0] === right[0] && isWithinOneEdit(left, right)) {
    return 'fuzzy'
  }

  return null
}

/**
 * Are these two given names the same person's name?
 *
 * Condition (b) of the name-alone rule. `john`/`jane` fails it — which is the
 * whole point of comparing given names separately from the surname: full-name
 * trigram scores that pair (0.47) ABOVE `william klooth`/`bill klooth` (0.42),
 * because the shared surname carries the score.
 *
 * @example
 * ```typescript
 * areGivenNamesEquivalent('Bill', 'William')   // → true  (nickname)
 * areGivenNamesEquivalent('Peggy', 'Margaret') // → true  (nickname — zero shared trigrams)
 * areGivenNamesEquivalent('Jon', 'Jonathan')   // → true  (prefix)
 * areGivenNamesEquivalent('W.', 'William')     // → true  (initial)
 * areGivenNamesEquivalent('John', 'Jane')      // → false
 * areGivenNamesEquivalent('Bob', 'Rob')        // → false (distance 1, but too short to trust)
 * ```
 */
export function areGivenNamesEquivalent(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  return givenNameEquivalence(a, b) !== null
}
