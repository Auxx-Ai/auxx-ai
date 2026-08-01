// packages/lib/src/mail-query/thread-search-sql.ts
//
// The MAIL binding of the shared ranked-search builder (`search/text-search-sql.ts`).
// It names `Thread` columns and nothing else — the OR-block predicate, every
// scoring primitive and the keyset shape all come from the shared module, so mail
// and records (`resources/search/record-search-sql.ts`) cannot drift apart.
//
// The one thing mail does NOT take from the shared module is the assembled
// ranking formula. `textSearchRank` blends ONE document score with ONE trigram
// score, and mail has two documents: a subject and a body corpus, deliberately
// kept apart (see below). {@link threadSearchRank} therefore composes the shared
// *parts* — `textSearchTrigramScore`, `textSearchDocumentScore` — into a
// three-arm score with a subject `ts_rank_cd` weighted above the body one,
// because people search mail by what they remember of the subject line. That arm
// has no meaning on the records side, where there is no second corpus and no
// tier split to reflect, which is why it lives here and not there.
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
import { type SQL, sql } from 'drizzle-orm'
import {
  type TextSearchColumns,
  TRIGRAM_WEIGHT,
  TS_RANK_SATURATING,
  textSearchDocumentScore,
  textSearchKeyset,
  textSearchPredicate,
  textSearchTrigramScore,
} from '../search/text-search-sql'

/**
 * How much a subject `ts_rank_cd` hit outweighs a body one, in
 * {@link threadSearchRank}.
 *
 * 🔴 **`11` is derived, not tuned.** Both `ts_rank_cd` arms of the thread rank
 * are saturated with {@link TS_RANK_SATURATING} (`r / (r + 1)`), which bounds the
 * BODY arm on `[0, 1)` — supremum 1, never attained. The weakest possible SUBJECT
 * hit is a single cover of a single lexeme, which unnormalized `ts_rank_cd`
 * scores at exactly `0.1` (measured, and it is length-independent), saturating to
 * `0.1 / 1.1 = 1/11`. So `11 × 1/11 = 1.0 >` every attainable body score:
 *
 * > **no amount of body text can outweigh a single subject hit.**
 *
 * That is the property the constant buys, and it is checkable rather than a
 * matter of taste. Raise it and nothing changes qualitatively; lower it below 11
 * and the guarantee silently becomes "…outweighs *most* body text", failing first
 * on the longest threads — the ones a mailbox has fewest of and a test fixture
 * never contains.
 *
 * ⚠️ **Stated precisely, because the tempting stronger claim is false.** The
 * guarantee is arm-to-arm, not row-to-row: the trigram arm is shared, so a
 * body-only row whose subject merely *resembles* the query still collects up to
 * `2 × similarity` and can in principle total above a weak subject hit's `1.0`.
 * That is not body text winning — the trigram arm scores the SUBJECT, so such a
 * row is one whose subject nearly is the query without stemming to it, which is a
 * subject signal too. And above `similarity ≥ 0.3` the row matches the subject
 * predicate outright. Measured across six real terms on the dev org the crossover
 * never occurred (weakest subject hit `1.10`–`1.19`, strongest body-only
 * `0.72`–`1.06`), but the window exists and is deliberate rather than overlooked.
 *
 * **Why saturation was needed to state a weight at all.** Unnormalized
 * `ts_rank_cd` is ~0.1 per cover with no length division, so on the dev org the
 * body arm reaches `9.3` for `order` and `3.1` for `invoice` while the subject
 * arm — capped by how short subjects are — never exceeds `0.3`. Blending those
 * raw numbers, a weight below ~30 leaves long bodies winning and a weight above
 * it is an unfalsifiable guess. Saturating first replaces the guess with the
 * arithmetic above; because `r / (r + 1)` is strictly increasing it does not
 * reorder rows *within* either arm, so nothing is lost but the scale gap.
 *
 * **What it does NOT do:** it does not let subject covers outrank an exact
 * subject match. Exact scores `2 × similarity = 2.0` from the trigram arm plus
 * `1.0` from its own subject cover — `3.0` — while a 3-cover subject arm reaches
 * `11 × 0.3/1.3 = 2.54`, so the trigram arm still decides the top of the list.
 */
const SUBJECT_RANK_WEIGHT = sql.raw('11')

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
 * `rank` here feeds the PREDICATE's trigram arm only — {@link threadSearchRank}
 * takes its trigram score from the subject binding instead, so this field no
 * longer influences ordering.
 *
 * It names `Thread.subject` rather than the corpus deliberately. Trigram
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
 * The thread relevance score — three arms, subject-weighted:
 *
 * ```text
 *   2  × similarity(subject, q)                    -- exact/near-exact subject
 * + 11 × ts_rank_cd(tsv(subject),    q, 32)        -- subject stem hit
 * +  1 × ts_rank_cd(tsv(searchText), q, 32)        -- body stem hit
 * ```
 *
 * each `COALESCE`d to 0, so a row matching only one arm still ranks.
 *
 * The subject arm is the point (see {@link SUBJECT_RANK_WEIGHT} for why the
 * weight is 11 and why both `ts_rank_cd`s are saturated). Before it existed the
 * only subject signal was whole-string `similarity()`, which is ~0.15 for a short
 * query against a long subject — so on the dev org a search for `invoice`
 * returned six threads with no "invoice" in the subject at all before the first
 * one that had it.
 *
 * ⚠️ **The score reads body text; the two PREDICATES do not blend.** Subject
 * visibility (`identity`) and body visibility (`read`) are separate lens tiers,
 * scoped separately by `condition-query-builder.ts`'s `withScope`, and this
 * function does not touch that: a subject-only viewer still cannot MATCH on body
 * text, so no row enters their result set because of a body they cannot read.
 * What the body arm can do is influence the ORDER of rows they can already see.
 * That is pre-existing — the previous formula's document score was the body
 * corpus and nothing else — and the subject arm strictly reduces its reach,
 * since any subject hit now outranks any body-only contribution. Making the rank
 * lens-aware would mean two rank expressions and two cursors; it is not worth it
 * for an ordering signal, but it is a real (if narrow) inference channel and
 * should be stated rather than discovered.
 *
 * Consumed by `threads/thread-query.service.ts`, which orders by
 * `relevance DESC, id DESC` when a free-text term is present and falls back to
 * `lastMessageAt DESC, id DESC` otherwise. Its keyset cursor pairs this score
 * with the id — note the ordering is exactly `(rank, id)` with no
 * `lastMessageAt` between them, because a keyset that disagrees with its own
 * ORDER BY silently skips or duplicates rows across pages.
 *
 * Anything else needing a thread score must call this rather than restate the
 * formula — the reason the shared module exists is that the expression was
 * written out six times on the records side before it did.
 */
export function threadSearchRank(query: string): SQL<number> {
  const subject = threadSubjectSearchColumns()
  const trigramScore = textSearchTrigramScore(query, subject)
  const subjectScore = textSearchDocumentScore(query, subject, TS_RANK_SATURATING)
  const bodyScore = textSearchDocumentScore(query, threadBodySearchColumns(), TS_RANK_SATURATING)

  return sql<number>`(COALESCE(${trigramScore}, 0) * ${TRIGRAM_WEIGHT} + COALESCE(${subjectScore}, 0) * ${SUBJECT_RANK_WEIGHT} + COALESCE(${bodyScore}, 0))`
}

/**
 * The keyset filter for a `score|id` cursor over ranked thread results.
 *
 * 🔴 **Calls {@link threadSearchRank}, the same function the `ORDER BY` calls.**
 * The rank expression appears twice in the rendered SQL because a `WHERE` cannot
 * see a `SELECT` alias — but it is *generated* twice from one definition, never
 * written twice. A cursor and an `ORDER BY` that disagree by a single `COALESCE`
 * skip and duplicate rows across pages instead of erroring, and mail pages by
 * exactly this keyset (`threads/thread-query.service.ts`), where ranked ties are
 * the common case rather than the corner. `text-search-sql.test.ts` pins the two
 * as textually identical.
 */
export function threadSearchCursor(query: string, score: number, id: string): SQL {
  return textSearchKeyset(threadSearchRank(query), threadBodySearchColumns().id, score, id)
}
