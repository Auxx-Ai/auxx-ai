// packages/lib/src/mail-query/free-text-terms.ts
//
// How a mail free-text query is split into the terms that must all match.
//
// Shared by the thread builder (`condition-query-builder.ts`, which feeds the
// terms to the ranked/indexed predicate) and the draft builder
// (`draft-condition-builder.ts`, which still ILIKEs them against jsonb paths).
// The two differ in how they *match* a term and must not differ in what counts
// as a term — a quoted phrase that holds together in thread search and falls
// apart in draft search is a bug nobody would think to look for.

/**
 * Upper bound on free-text terms. A query past this is not a search, it's a
 * paste. Extra terms are ignored, which *widens* the result set rather than
 * narrowing it, so the cap can never hide a row the user asked for.
 */
export const MAX_FREE_TEXT_TERMS = 16

/**
 * Split a free-text query into the terms that must all match.
 *
 * - `"quoted phrases"` stay one term, spaces and all, so `"order number"`
 *   matches the phrase rather than the two words independently.
 * - Everything else splits on whitespace.
 * - An unterminated quote degrades to plain words (the stray `"` is stripped)
 *   instead of swallowing the rest of the query.
 * - Whitespace-only input yields `[]`, which callers turn into "no clause"
 *   rather than a `%%` pattern that matches everything.
 */
export function tokenizeFreeText(raw: string): string[] {
  const terms: string[] = []
  for (const match of raw.matchAll(/"([^"]+)"|(\S+)/g)) {
    const term = (match[1] ?? match[2] ?? '').replace(/"/g, '').trim()
    if (term) terms.push(term)
  }
  return terms.slice(0, MAX_FREE_TEXT_TERMS)
}

/**
 * Escape the LIKE metacharacters so a term is matched literally.
 *
 * Postgres' default LIKE escape character is `\`, so no `ESCAPE` clause is
 * needed. Without this, `50%` searches for "50" followed by anything and `a_b`
 * matches `axb` — wildcards the user never typed.
 *
 * Only the ILIKE-based consumers need this. The thread builder matches through
 * `to_tsvector` / `plainto_tsquery` / `%`, where `%` and `_` carry no special
 * meaning.
 */
export function escapeLikePattern(term: string): string {
  return term.replace(/[\\%_]/g, (char) => `\\${char}`)
}
