// packages/lib/src/dedup/name-match.ts
//
// The structured name comparator and the name-alone rule. Pure — no db, no I/O.
//
// 🔴 **Compare `firstName` and `lastName`, never `displayName`.** Measured on
// the dev database with `pg_trgm` (re-verified 2026-08-14):
//
//   | pair                                | same person? | similarity() |
//   | ----------------------------------- | ------------ | ------------ |
//   | `john smith` / `jane smith`         | **NO**       | **0.4666667** |
//   | `william klooth` / `bill klooth`    | yes          | 0.4210526    |
//   | `bob smith` / `robert smith`        | yes          | 0.3529412    |
//   | `peggy klooth` / `margaret klooth`  | yes          | 0.3181818    |
//
// A different person scores HIGHER than every true nickname pair, because the
// shared surname carries almost the whole score. Ranking by full-name similarity
// therefore puts the worst false positives at the top of the review queue. That
// is not a threshold to tune — it is the wrong measurement. Contacts carry
// `firstName` and `lastName` as separate fields (`contact-fields.ts:39-79`), so
// the surname and the given name get the comparators each actually needs:
//
//  - **surname** → exact, trigram ≥ {@link SURNAME_TRIGRAM_THRESHOLD} for typos
//    (`klooth`/`kloth` = 0.625), or name-order-reversed (CSV imports and several
//    locales swap the two columns).
//  - **given name** → `nicknames.ts`, which is the only thing that can recover
//    `bob`/`robert` and `peggy`/`margaret` (zero shared trigrams, both of them).

import { SURNAME_TRIGRAM_THRESHOLD } from './config'
import { type GivenNameMatchKind, givenNameEquivalence } from './nicknames'
import type { Signal } from './types'

/** The two name parts the comparator reads. Either may be missing. */
export interface StructuredName {
  firstName?: string | null
  lastName?: string | null
}

/** How two surnames matched. */
export interface SurnameMatch {
  /** `exact` after normalization, or `fuzzy` via trigram (a typo, not a nickname). */
  kind: 'exact' | 'fuzzy'
  /** `pg_trgm` similarity of the two surnames — 1 for an exact match. */
  similarity: number
  /** Normalized surname of the FIRST argument. */
  value: string
  /** Normalized surname of the SECOND argument. */
  otherValue: string
}

/** The outcome of {@link compareStructuredNames}. */
export interface NameComparison {
  surname: SurnameMatch | null
  givenName: GivenNameMatchKind | null
  /**
   * True when the two only line up after swapping the second record's first and
   * last name — a CSV import that mapped the columns the wrong way round, or a
   * locale that writes the family name first.
   */
  reversed: boolean
  /** Both parts matched: conditions (a) and (b) of the name-alone rule. */
  matched: boolean
}

/**
 * Fold a surname cell for comparison: NFD, diacritics dropped, lowercase,
 * every non-letter turned into a single space, trimmed.
 *
 * `"O'Brien-Smith"` → `"o brien smith"`, which is exactly how `pg_trgm`
 * tokenizes it (verified: `show_trgm('o''brien-smith')` splits on the
 * apostrophe and the hyphen), so the JS and SQL sides agree on the input as
 * well as on the metric.
 */
export function normalizeSurname(raw: string | null | undefined): string {
  if (!raw) return ''
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** The `pg_trgm` trigram set of a string: words padded `"  word "`, unioned. */
function trigrams(value: string): Set<string> {
  const out = new Set<string>()
  for (const word of value.split(' ')) {
    if (!word) continue
    const padded = `  ${word} `
    for (let i = 0; i + 3 <= padded.length; i++) out.add(padded.slice(i, i + 3))
  }
  return out
}

/**
 * `pg_trgm`'s `similarity()`, in JS: `|A ∩ B| / |A ∪ B|` over the padded
 * trigram SETS.
 *
 * Reimplemented rather than called through SQL because the comparison happens
 * per candidate pair inside a scan job that has already fetched both names — a
 * round-trip per pair to compute a number this cheap would be absurd. The
 * implementation is pinned to Postgres by test: it reproduces `klooth`/`kloth`
 * = 0.625, `john smith`/`jane smith` = 0.4666667 and `bob`/`robert` = 0 exactly.
 *
 * @returns `[0, 1]`; `0` when either side is empty.
 */
export function trigramSimilarity(a: string, b: string): number {
  const left = trigrams(a)
  const right = trigrams(b)
  if (left.size === 0 || right.size === 0) return 0

  let shared = 0
  for (const gram of left) if (right.has(gram)) shared++
  const union = left.size + right.size - shared
  return union === 0 ? 0 : shared / union
}

/** Surname arm: exact after normalization, else trigram above the threshold. */
function compareSurnames(a: string | null | undefined, b: string | null | undefined) {
  const left = normalizeSurname(a)
  const right = normalizeSurname(b)
  // A missing surname is an absence of evidence, never a match: treating blanks
  // as equal would pair every surname-less record in the definition.
  if (!left || !right) return null

  if (left === right) {
    return { kind: 'exact' as const, similarity: 1, value: left, otherValue: right }
  }

  const similarity = trigramSimilarity(left, right)
  if (similarity < SURNAME_TRIGRAM_THRESHOLD) return null
  return { kind: 'fuzzy' as const, similarity, value: left, otherValue: right }
}

/** One orientation of the comparison — direct, or with `b`'s parts swapped. */
function compareOriented(a: StructuredName, b: StructuredName, reversed: boolean): NameComparison {
  const bSurname = reversed ? b.firstName : b.lastName
  const bGiven = reversed ? b.lastName : b.firstName

  const surname = compareSurnames(a.lastName, bSurname)
  const givenName = givenNameEquivalence(a.firstName, bGiven)
  return { surname, givenName, reversed, matched: surname !== null && givenName !== null }
}

/**
 * Compare two records' structured names.
 *
 * Tries the direct orientation first and falls back to the reversed one, so a
 * record whose importer put the family name in `firstName` still matches the
 * same human entered correctly. The reversed attempt only runs when the direct
 * one failed, so a genuine direct match is never relabelled.
 *
 * @example
 * ```typescript
 * compareStructuredNames({ firstName: 'Bill', lastName: 'Klooth' },
 *                        { firstName: 'William', lastName: 'Klooth' })
 * // → { surname: { kind: 'exact', … }, givenName: 'nickname', reversed: false, matched: true }
 *
 * compareStructuredNames({ firstName: 'John', lastName: 'Smith' },
 *                        { firstName: 'Jane', lastName: 'Smith' })
 * // → { surname: { kind: 'exact', … }, givenName: null, reversed: false, matched: false }
 * ```
 */
export function compareStructuredNames(a: StructuredName, b: StructuredName): NameComparison {
  const direct = compareOriented(a, b, false)
  if (direct.matched) return direct

  const reversed = compareOriented(a, b, true)
  return reversed.matched ? reversed : direct
}

/** Why the name rule did or did not emit a signal. Logged, never persisted. */
export type NameRuleReason =
  | 'no-name-match'
  | 'rare-surname'
  | 'corroborated'
  | 'needs-corroboration'

/** The name rule's verdict for one pair. */
export interface NameRuleOutcome {
  signal: Signal | null
  reason: NameRuleReason
}

/** Parameters for {@link decideNameSignal}. */
export interface NameRuleParams {
  comparison: NameComparison
  /** Condition (c) — `surnameIdf(...).rare` for the matched surname. */
  surnameRare: boolean
  /** Whether `corroborate.ts` found at least one corroborating signal. */
  hasCorroboration: boolean
}

/**
 * The **name-alone rule** — whether a `name` signal is warranted at all.
 *
 * This replaces v1/v2's blanket "name alone never suggests". Per the genesis
 * map, the two highest-volume live duplicate generators — the email↔phone twin
 * (one `Participant` carries ONE identifier, so a customer who emails and later
 * texts becomes two contacts deterministically) and the chat visitor keyed on an
 * opaque cookie — produce pairs with **no shared key and no corroboration
 * available**. A blanket ban means never surfacing precisely the class users
 * care about most.
 *
 * So a `name` signal is emitted when the names match AND either:
 *
 *  - **(c) the surname is rare in this org** — `surnameIdf`. `Bill Klooth` /
 *    `William Klooth` passes; two of a hundred Smiths do not. This is the only
 *    place inverse frequency is used in the feature, and it is what makes the
 *    no-corroboration case safe; **or**
 *  - **at least one corroborating signal is present** — shared employer, shared
 *    address, complementary identity sources, the email-domain↔employer-domain
 *    link, or a same-second `firstInteractionAt`. `Bob Smith` / `Robert Smith`
 *    reaches medium this way and only this way.
 *
 * 🔴 **The decision lives here, at the PRODUCER, and never inside `scorePair`.**
 * `scorePair` stays a pure weighted sum over distinct signal types; if the rule
 * leaked into it, "medium" would become a threshold to tune rather than a
 * statement about evidence. A `name` signal alone weighs exactly the medium
 * floor, so emitting one IS the decision to suggest.
 */
export function decideNameSignal(params: NameRuleParams): NameRuleOutcome {
  const { comparison, surnameRare, hasCorroboration } = params
  if (!comparison.matched || !comparison.surname) {
    return { signal: null, reason: 'no-name-match' }
  }
  if (!surnameRare && !hasCorroboration) {
    return { signal: null, reason: 'needs-corroboration' }
  }

  const { value, otherValue } = comparison.surname
  return {
    signal: {
      type: 'name',
      strength: 'fuzzy',
      value,
      ...(otherValue === value ? {} : { otherValue }),
    },
    reason: surnameRare ? 'rare-surname' : 'corroborated',
  }
}
