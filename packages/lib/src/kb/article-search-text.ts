// packages/lib/src/kb/article-search-text.ts
//
// `Article.searchText` — the corpus behind ranked KB article search.
//
// This module is the SINGLE definition of that corpus. The denormalization hook
// every revision-write path already calls (`sync-article-denormalized-fields.ts`)
// and the one-time backfill
// (`data-migrations/migrations/070-backfill-article-search-text.ts`) both compose
// {@link articleSearchTextExpressionSql} rather than restating it — a corpus that
// two writers disagree about is worse than no corpus, because the disagreement is
// invisible until someone can't find an article they can see.
//
// **Title IS part of this corpus, unlike `Thread.searchText`.** Mail excludes the
// subject because the mail lens grants subject visibility (`identity`) and body
// visibility (`read`) as separate tiers, so a blended column would be a
// permissions bug. Articles have no such gradation — one row, one visibility —
// and folding the title in is what makes a query spanning both halves
// ("MCP Attio", where one word is in the title and the other in the body) match
// on the single `tsvector` arm instead of needing a cross-arm AND the builder
// cannot express.

import type { Database, Transaction } from '@auxx/database'
import { sql } from 'drizzle-orm'

// =============================================================================
// BOUNDS
// =============================================================================
//
// Measured on the dev DB (2026-07-31): 90 articles / 151 revisions. Body HTML
// averages 1,039 chars (max 32,968); reduced to plain text it averages 517
// (p50 28, p90 908, p99 18,985, max 18,985).

/**
 * Hard cap on the whole column.
 *
 * **This is the bound that matters.** `to_tsvector` does not degrade past 1 MB
 * of input — it raises `string is too long for tsvector`, which would make the
 * GIN index fail the *write* (an article edit that cannot be saved), not the
 * search. 40,000 characters is 26× under that ceiling; the ceiling is in *bytes*,
 * so even at the 4-bytes-per-character worst case this is still 6× under.
 *
 * Deliberately the same number as {@link import('../mail-query/thread-search-text').THREAD_SEARCH_TOTAL_LIMIT}
 * so the two corpora can't drift into different failure modes for no reason.
 * It is far past anything present: the longest article in dev reduces to 18,985
 * characters, so today the cap binds on **zero** rows. Measured at 100k
 * synthetic rows, recall on five multi-word queries was byte-identical at 8,000 /
 * 16,000 / 40,000 / unbounded, and query time differed by under 4% (400 / 414 /
 * 405 ms) — the cap is a ceiling against a pathological import, not a tuning
 * knob, so it is set where it cannot cost recall.
 */
export const ARTICLE_SEARCH_TOTAL_LIMIT = 40000

// =============================================================================
// SQL
// =============================================================================

/**
 * The `searchText` value for one `Article`, as a SQL expression correlated to
 * `alias`.
 *
 * Shape: the row's own `title` and `excerpt`, then the article's **draft
 * revision** body reduced to plain text, joined by spaces and clipped as a whole
 * to {@link ARTICLE_SEARCH_TOTAL_LIMIT}. `NULL` when there is no text at all.
 *
 * Title and excerpt are read off the `Article` row rather than off a revision,
 * so they carry whatever `syncArticleDenormalizedFields` just wrote there
 * (`published ?? draft`, per field) — which is also what
 * `resources/search/article-search-sql.ts` ranks and ILIKE-matches on. One
 * source, so the score and the corpus can't disagree.
 *
 * **The body comes from the draft revision, not the published one — deliberately
 * the opposite of the rule its sibling columns use.** Those describe what readers
 * see. This corpus backs the *internal* articles table at `/app/kb`, whose rows
 * are the things authors are working on, and `Article.draftRevisionId` is
 * documented as the single source of truth for content. On the dev DB 38 of the
 * 59 published articles carry a draft that differs from their published revision,
 * and 31 of 90 articles have never been published at all — indexing the published
 * side would make a third of the KB body-unsearchable and the rest searchable
 * only as of its last publish.
 *
 * Body reduction, in order:
 * 1. `<script>` / `<style>` elements are removed **with their content**. Not
 *    cosmetic: Postgres' text parser classifies `<…>` as `tag` tokens the
 *    `english` config never indexes, so raw markup contributes no lexemes — but
 *    naive tag-stripping *promotes* CSS to plain text. Verified:
 *    `to_tsvector('english', '<style>table{border-collapse:collapse}</style><div>hello</div>')`
 *    yields `'hello'`, while the tag-stripped form yields
 *    `'border-collaps' 'collaps' 'tabl' 'hello'`. Stripping tags without this
 *    step is how mail search learned to match `border-collapse`.
 * 2. HTML entities (`&amp;`, `&#8212;`) collapse to a space — the parser has an
 *    `entity` token type that skips them in raw HTML, so stripping tags without
 *    this would introduce an `amp` lexeme that isn't in the article (17 of 151
 *    dev revisions contain `&amp;`).
 * 3. Remaining tags become spaces, so `a</b>b` doesn't fuse into one word.
 * 4. Whitespace collapses, so a formatted document doesn't spend its character
 *    budget on newlines. Measured on the largest dev article: 32,968 chars of
 *    HTML reduce to 18,985 of prose, so a capped corpus covers 1.7× more text
 *    than the raw form would.
 *
 * Written as a raw string rather than composed Drizzle columns on purpose — a
 * `PgColumn` inside a correlated subquery loses its table qualifier when Drizzle
 * flattens a single-table projection, which would silently self-join the alias.
 * Nothing in this string is caller-supplied, so `sql.raw` is safe.
 *
 * @param alias table alias of the `Article` row being computed
 */
export function articleSearchTextExpressionSql(alias = 'a'): string {
  return `LEFT(NULLIF(TRIM(
    CONCAT_WS(' ',
      NULLIF(${alias}."title", ''),
      NULLIF(${alias}."excerpt", ''),
      (
        SELECT NULLIF(
          btrim(
            regexp_replace(
              regexp_replace(
                regexp_replace(
                  regexp_replace(r."content", '<(script|style)[^>]*>.*?</\\1\\s*>', ' ', 'gi'),
                  '&[a-zA-Z]+;|&#[0-9]+;', ' ', 'g'
                ),
                '<[^>]*>', ' ', 'g'
              ),
              '\\s+', ' ', 'g'
            )
          ),
          ''
        )
        FROM "ArticleRevision" r
        WHERE r.id = ${alias}."draftRevisionId"
      )
    )
  ), ''), ${ARTICLE_SEARCH_TOTAL_LIMIT})`
}

/**
 * `"searchText" = <expression>` — the assignment clause, for splicing into an
 * `Article` UPDATE that is already running.
 *
 * This is the preferred maintenance hook: `syncArticleDenormalizedFields` issues
 * exactly one `UPDATE "Article" SET …` per revision write and is already called
 * by every path that can change content (create, draft update, publish, discard
 * draft, restore version), so the corpus rides along on the statement that keeps
 * `title`/`excerpt` correct. Anyone who remembers to keep those correct keeps the
 * search corpus correct for free, which is the only durable answer to a
 * denormalization's drift risk.
 *
 * Computed in SQL rather than in JS so a 33 KB document is never pulled into the
 * application and pushed back.
 *
 * @param alias table alias of the `Article` row being updated
 */
export function articleSearchTextAssignmentSql(alias = 'a'): string {
  return `"searchText" = ${articleSearchTextExpressionSql(alias)}`
}

// =============================================================================
// WRITE PATH
// =============================================================================

/**
 * Recompute `searchText` for one article as a standalone statement.
 *
 * For write paths that do **not** already run
 * `syncArticleDenormalizedFields` — prefer that hook wherever it is reachable;
 * one statement is cheaper than two and cannot half-apply.
 *
 * Accepts a `Transaction` as well as a `Database` so the refresh can commit with
 * the write that caused it.
 *
 * Deliberately `Promise<void>` rather than a `Result`: every caller treats a
 * search-corpus refresh as part of a write it has already committed, and a
 * failure here must never roll back a saved article. Callers log and continue.
 */
export async function updateArticleSearchText(
  db: Database | Transaction,
  articleId: string
): Promise<void> {
  await db.execute(
    sql`UPDATE "Article" a SET ${sql.raw(articleSearchTextAssignmentSql('a'))} WHERE a.id = ${articleId}`
  )
}
