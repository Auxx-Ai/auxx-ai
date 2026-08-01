// packages/lib/src/threads/thread-search-term.ts
//
// "Is a free-text search active on this thread query, and what is being
// searched for?" — the one question that decides whether the mail list orders
// by relevance or by date.
//
// It is answered by reading the caller's `ConditionGroup[]` rather than by a
// separate `search` parameter on purpose: the mail searchbar, the ⌘K palette,
// the thread picker and the `find_threads` tool all express free text as a
// `freeText` condition inside the same filter (`context-to-conditions.ts`
// emits it as its own `search` group), and the ordering layer must agree with
// the predicate layer about whether a search happened. A second parameter would
// be a second source of truth, and the two would drift the first time someone
// added a caller.

import type { ConditionGroup } from '../conditions/types'
import { tokenizeFreeText } from '../mail-query/free-text-terms'

/**
 * The free-text term a thread query is searching for, or `null` when it isn't.
 *
 * Kept deliberately in lockstep with `condition-query-builder.ts`'s
 * `buildFreeTextQuery`:
 *
 * - **Any operator counts.** That builder ignores the operator entirely and
 *   emits the same positive match clause for `contains` as for `not contains`.
 *   Filtering on `contains` here would mean a query whose rows were narrowed by
 *   a free-text predicate got ordered as though no search had happened.
 * - **Tokenization decides emptiness.** `'   '` and `'""'` tokenize to `[]`, so
 *   the predicate builds no clause and nothing was actually searched — those
 *   must not flip the list into relevance order over a rank of nothing.
 * - **The returned string is the tokens re-joined**, not the raw value. That is
 *   what was actually matched (quotes stripped, capped at `MAX_FREE_TEXT_TERMS`),
 *   and `plainto_tsquery` ANDs those same words, so the score ranks on the same
 *   query the `WHERE` filtered on.
 *
 * Multiple `freeText` conditions are concatenated because the builder ANDs their
 * clauses — a row surviving all of them matched every term, so every term
 * belongs in the score.
 */
export function extractFreeTextSearchTerm(groups: ConditionGroup[]): string | null {
  const values: string[] = []

  for (const group of groups) {
    for (const condition of group.conditions) {
      if (condition.fieldId !== 'freeText') continue
      const { value } = condition
      if (typeof value !== 'string') continue
      const trimmed = value.trim()
      if (trimmed) values.push(trimmed)
    }
  }

  if (values.length === 0) return null

  const terms = tokenizeFreeText(values.join(' '))
  if (terms.length === 0) return null

  return terms.join(' ')
}
