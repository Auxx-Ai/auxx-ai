// packages/lib/src/mail-query/thread-search-sql.ts
//
// The MAIL binding of the shared ranked-search builder (`search/text-search-sql.ts`).
// It names `Thread` columns and nothing else — the ranking formula, the OR-block
// predicate and the keyset cursor all come from the shared module, so mail and
// records (`resources/search/record-search-sql.ts`) cannot drift apart.
//
// 🔴 **No lens, no visibility predicate lives here.** Mail narrows with the
// §5.3 search scopes from `visibility-scope.ts`, AND-ed around each block by
// `condition-query-builder.ts`'s `withScope`. Records narrow with per-record
// grants. Those are different authorization models; the shared module carries
// neither, and neither does this file.
//
// **Two bindings, not one, and that is the whole point.** The mail lens grants
// subject visibility (`identity`) and body visibility (`read`) as separate
// tiers, so a subject match and a body match must be scoped separately. Each gets
// its own `TextSearchColumns` and its own `withScope` wrapper; a single blended
// binding would collapse the gradation and let a subject-only viewer match on
// body text.

import { schema } from '@auxx/database'
import type { SQL } from 'drizzle-orm'
import {
  type TextSearchColumns,
  textSearchCursor,
  textSearchPredicate,
  textSearchRank,
} from '../search/text-search-sql'

/**
 * The **subject** arm: `Thread.subject`, the short human-facing column.
 *
 * Backed by `Thread_org_subject_gin_idx` (stemming) and
 * `Thread_org_subject_trgm_idx` (typo tolerance), both org-scoped composite GIN
 * indexes from migration `0320_thread_search_text.sql`.
 *
 * A function, not a module-level const, for the reason spelled out in
 * `resources/search/record-search-sql.ts`: under this package's Vitest setup
 * `@auxx/database`'s `schema` is a Proxy whose columns read as `undefined`, so
 * evaluating the binding at import time would bake `undefined` chunks into every
 * consumer's module graph.
 */
export function threadSubjectSearchColumns(): TextSearchColumns {
  return {
    document: schema.Thread.subject,
    rank: schema.Thread.subject,
    // The ILIKE fallback is what makes a sub-3-character query work at all:
    // `to_tsvector` produces no usable lexeme for `xu`, and no full trigram is
    // extractable from `%xu%` either, so both other arms return nothing.
    //
    // It is safe here *because the column is trigram-indexed*:
    // `Thread_org_subject_trgm_idx` (`gin_trgm_ops`) serves `~~*` exactly as it
    // serves `%`, so this arm joins the `BitmapOr` instead of collapsing it.
    // An ILIKE over a column WITHOUT that index costs the other arms their
    // indexes too — measured on the dev org, the same two-term query ran in
    // 458 ms with an unindexed fallback and 14 ms without it. Never add a
    // fallback naming a column that has no trigram index.
    fallbacks: [schema.Thread.subject],
    id: schema.Thread.id,
  }
}

/**
 * The **body** arm: `Thread.searchText`, the maintained message-body corpus
 * (`thread-search-text.ts`). Backed by `Thread_org_searchText_gin_idx`.
 *
 * `rank` names `Thread.subject` rather than the corpus deliberately. Trigram
 * similarity between a 6-character query and a 40 KB document is ~0 by
 * construction, and a `gin_trgm_ops` index over that column would be enormous —
 * so there is no body column worth ranking fuzzily. Pointing `rank` at the
 * subject keeps the binding to honest `Thread` columns, and the arm it produces
 * is *redundant rather than wrong*: it can only match rows the subject block
 * already matched, under the strictly narrower `read` scope, so it never widens
 * the result set and never widens visibility.
 *
 * **Measured cost of that redundancy**, so the next reader doesn't have to guess:
 * one extra `Bitmap Index Scan on Thread_org_subject_trgm_idx` per term inside
 * the `BitmapOr` — 27 shared buffers, ~0.1 ms on the dev org, and no change in
 * execution time (42.5 ms with it, 44.5 ms with the arm folded away by a
 * constant `rank` — inside the noise). The alternative is a synthetic
 * `sql\`''::text\`` here, which the planner does fold out entirely; it was
 * rejected because a literal in a *columns* binding is the kind of thing a later
 * reader deletes as a mistake, and the win is unmeasurable at current volume.
 * Revisit if trigram probes ever show up in a mail-search profile.
 */
export function threadBodySearchColumns(): TextSearchColumns {
  return {
    document: schema.Thread.searchText,
    rank: schema.Thread.subject,
    // 🔴 Empty on purpose, and NOT for the same reason the subject binding is
    // not. `Thread.searchText` averages ~2 KB and is capped at 40 KB; a
    // `gin_trgm_ops` index over it would be enormous, so an `ILIKE` arm on it
    // has no index to use and would drop the whole block to a sequential scan
    // that detoasts and re-tsvectors every thread in the mailbox. Adding a
    // fallback here means adding a trigram index on the corpus first, which is
    // the trade this binding declines.
    fallbacks: [],
    id: schema.Thread.id,
  }
}

/**
 * The subject match predicate for one term — a parenthesized OR block, ready to
 * be wrapped in the caller's `identity`-tier scope and AND-ed into a `WHERE`
 * that already filters `organizationId`.
 */
export function threadSubjectSearchPredicate(query: string): SQL {
  return textSearchPredicate(query, threadSubjectSearchColumns())
}

/** The body-corpus match predicate for one term, for the `read`-tier scope. */
export function threadBodySearchPredicate(query: string): SQL {
  return textSearchPredicate(query, threadBodySearchColumns())
}

/**
 * The thread relevance score over the body corpus.
 *
 * Exported ahead of its consumer: the mail list still orders by
 * `lastMessageAt DESC, id DESC` (`threads/thread-query.service.ts`), whose keyset
 * cursor is built from those two columns and cannot be reordered without
 * reworking pagination. When that wiring lands it must call this rather than
 * restate the formula — the reason the shared module exists at all is that the
 * expression was written out six times on the records side before it did.
 */
export function threadSearchRank(query: string): SQL<number> {
  return textSearchRank(query, threadBodySearchColumns())
}

/** The keyset filter for a `score|id` cursor over ranked thread results. */
export function threadSearchCursor(query: string, score: number, id: string): SQL {
  return textSearchCursor(query, threadBodySearchColumns(), score, id)
}
