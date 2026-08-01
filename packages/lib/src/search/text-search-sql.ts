// packages/lib/src/search/text-search-sql.ts
//
// The ranked free-text search expression, written ONCE.
//
// This module is deliberately **domain-neutral**: no `db`, no IO, no table
// names, nothing about records or mail. Every column it touches arrives as a
// parameter ({@link TextSearchColumns}), so records
// (`resources/search/record-search-sql.ts`) and mail
// (`mail-query/thread-search-sql.ts`) can bind the SAME formula to different
// tables instead of forking it. Anything you are tempted to add here that
// mentions `EntityInstance`, `Thread`, a lens, or a visibility predicate
// belongs in a binding, not here.
//
// 🔴 **Visibility does NOT belong in this module.** Records narrow with
// `recordSearchVisibilitySql` / `recordUnionVisibilitySql` (per-record grants);
// mail narrows with its `baseScope` lens. They are different authorization
// models and merging them is how a permissions bug gets written. What is shared
// is the ranking formula, the OR-block predicate, the keyset cursor, and the
// index strategy — nothing that decides who may read a row.

import { type SQL, sql } from 'drizzle-orm'
import type { PgColumn } from 'drizzle-orm/pg-core'

/**
 * A column reference a binding hands to this builder.
 *
 * 🔴 **Which of the two forms you pass is load-bearing, and the choice is the
 * caller's, not this module's.**
 *
 * - A `PgColumn` renders **table-qualified** — `"EntityInstance"."displayName"`
 *   (drizzle-orm `sql/sql.js:118-127`). Correct inside a Drizzle-composed
 *   `select().from(EntityInstance)`, and a syntax error inside a hand-written
 *   `FROM "EntityInstance" ei`, because a Postgres alias *replaces* the table
 *   name in the rest of the query.
 * - A raw `SQL` identifier — `sql.raw('ei."displayName"')` — is correct under an
 *   alias, and is also the only form that survives Drizzle's projection
 *   rewrite: `buildSelection` walks into nested `sql` fragments and rewrites a
 *   `Column` chunk to a bare `sql.identifier(name)` when the query has a single
 *   table in its `FROM`. See the same hazard written up at length in
 *   `permissions/capabilities/record-visibility-scope.ts` (`DEFAULT_INSTANCE_ID_COLUMN`),
 *   where it silently mis-bound a correlated subquery.
 *
 * So one *fragment* cannot serve both an aliased raw query and a Drizzle
 * composition — but one *builder* can, which is the entire reason these are
 * parameters.
 */
export type TextSearchRef = SQL | PgColumn

/** The columns one domain offers to the shared search formula. */
export interface TextSearchColumns {
  /**
   * The maintained corpus the `tsvector` is built over — `EntityInstance.searchText`
   * for records. Must be the column the domain's GIN index was created on, or the
   * index cannot serve the predicate.
   */
  document: TextSearchRef
  /**
   * The short, human-facing column trigram similarity runs on (and that the
   * relevance score weights most heavily) — `EntityInstance.displayName` for
   * records. Backed by a `gin_trgm_ops` index.
   */
  rank: TextSearchRef
  /**
   * Substring (`ILIKE '%q%'`) fallbacks, for queries too short to stem or to
   * clear the trigram threshold.
   *
   * 🔴 **Every column listed here MUST carry a `gin_trgm_ops` index** (composite
   * with the scoping column, like the two in migration 0058). `gin_trgm_ops`
   * serves `~~*` as well as `%`, so an indexed `ILIKE '%q%'` joins the `BitmapOr`
   * like any other arm — but an **un**indexed one collapses the whole block:
   * Postgres cannot bitmap-OR an arm it has no index for, so it abandons every
   * other index too and filters the entire scope sequentially. An OR block is
   * only as indexable as its worst arm.
   *
   * Measured on a 400k-row / 100k-per-slice copy of `EntityInstance`:
   * `secondaryDisplayValue` unindexed → 125 ms and `Rows Removed by Filter:
   * 32740` per worker; the same query with the trigram index in place → 32 ms
   * and a four-way `BitmapOr`, identical result set.
   *
   * Two further limits worth knowing before adding one: a pattern shorter than
   * three characters yields no full trigram, so it degrades to a scan no matter
   * what is indexed; and each entry is a separate index probe, so keep the list
   * short.
   */
  fallbacks: TextSearchRef[]
  /**
   * The keyset tie-break column, used only by {@link textSearchCursor}.
   *
   * Required rather than optional on purpose: the cursor is part of the shared
   * contract, and two domains that tie-break differently page differently for
   * the same score — a bug that only shows up on page 2 of a result set with
   * many zero-score rows, which is *most* result sets here.
   */
  id: TextSearchRef
}

/**
 * The text-search configuration. Must match the one baked into the expression
 * indexes (`0058_add_index_entity_instance.sql` uses `'english'::regconfig`) —
 * a different config here silently disables the index.
 */
const TS_CONFIG = sql.raw(`'english'`)

/**
 * Trigram similarity floor for the fuzzy arm. Below this, typo tolerance turns
 * into noise.
 *
 * Deliberately the same number as Postgres' default
 * `pg_trgm.similarity_threshold` — see {@link textSearchTrigramMatch} for why
 * the fuzzy arm states it *and* uses the `%` operator that reads the GUC.
 */
const TRIGRAM_THRESHOLD = sql.raw('0.3')

/**
 * How much a name hit outweighs a document hit. `ts_rank_cd` returns small
 * fractions, so this is what keeps "the record actually called Acme" above "a
 * record whose blob mentions Acme".
 */
const TRIGRAM_WEIGHT = sql.raw('2')

/**
 * `to_tsvector(config, COALESCE(document, ''))` — the indexed expression.
 *
 * The `COALESCE` is not defensive style: the index in migration 0058 is created
 * on `COALESCE("searchText", '')`, so dropping it here would make the query
 * expression stop matching the index expression and force a sequential scan.
 */
export function textSearchDocument(cols: TextSearchColumns): SQL {
  return sql`to_tsvector(${TS_CONFIG}, COALESCE(${cols.document}, ''))`
}

/** `plainto_tsquery(config, q)` — the parsed user query. */
export function textSearchQuery(query: string): SQL {
  return sql`plainto_tsquery(${TS_CONFIG}, ${query})`
}

/** The full-text half of the score: `ts_rank_cd(document, query)`. */
export function textSearchDocumentScore(query: string, cols: TextSearchColumns): SQL<number> {
  return sql<number>`ts_rank_cd(${textSearchDocument(cols)}, ${textSearchQuery(query)})`
}

/** The fuzzy half of the score: `similarity(rank, q)`, `pg_trgm`. */
export function textSearchTrigramScore(query: string, cols: TextSearchColumns): SQL<number> {
  return sql<number>`similarity(${cols.rank}, ${query})`
}

/**
 * The fuzzy **match** arm: `rank % q AND similarity(rank, q) > 0.3`.
 *
 * 🔴 **The two halves say the same thing on purpose, and neither one alone is
 * correct here.**
 *
 * - `similarity(rank, q) > 0.3` is a plain function call. `gin_trgm_ops` indexes
 *   only the *operators* (`%`, `<->`, `~~*`), so an operator-free comparison can
 *   never be an index condition — Postgres has to compute `similarity()` for
 *   every row in scope. Because this arm sits inside an `OR` block, that one
 *   unindexable arm forfeits the indexes the *other* arms would have used, and
 *   the whole predicate becomes a sequential filter. Measured: 125 ms over a
 *   100k-row org+def slice, versus 32 ms once every arm is index-servable.
 * - `rank % q` is index-servable, but its threshold comes from the
 *   `pg_trgm.similarity_threshold` GUC (default `0.3`), not from this file. Ship
 *   it alone and search recall silently becomes a property of the database's
 *   configuration.
 *
 * ANDed, the index serves `%` as a pre-filter and the explicit comparison pins
 * the semantics: **no row below {@link TRIGRAM_THRESHOLD} can ever match,
 * whatever the GUC says.** Verified against the bench table — at a GUC of `0.1`
 * the ANDed arm returns exactly the 30,958 rows `similarity(...) > 0.3` returns
 * on its own.
 *
 * ⚠️ **The one residual coupling, stated out loud:** the dependency is
 * one-directional. Lowering the GUC below `0.3` changes nothing (the comparison
 * clamps it back). *Raising* it above `0.3` narrows this arm — at a GUC of `0.6`
 * the same query returned 795 rows instead of 30,958. That direction costs
 * fuzzy *recall* only; it can never admit a row the formula says should not
 * match, and exact-substring hits stay covered by the
 * {@link TextSearchColumns.fallbacks} `ILIKE` arms. If anything ever sets that
 * GUC above `0.3` — nothing in this repo or its infra config does today, and the
 * dev database reports `source = 'default'` — this arm quietly stops finding
 * typos. Prefer changing {@link TRIGRAM_THRESHOLD} here over touching the GUC.
 */
export function textSearchTrigramMatch(query: string, cols: TextSearchColumns): SQL {
  return sql`(${cols.rank} % ${query} AND ${textSearchTrigramScore(query, cols)} > ${TRIGRAM_THRESHOLD})`
}

/**
 * The combined relevance score: `similarity * 2 + ts_rank_cd`, each `COALESCE`d
 * to 0 so a row that matches only one arm still ranks.
 *
 * **This is the single definition of the ranking formula.** It was written out
 * six times across `record-picker-service.ts` before this module existed;
 * anything that orders, cursors, or projects a relevance score must call this
 * rather than restate it.
 */
export function textSearchRank(query: string, cols: TextSearchColumns): SQL<number> {
  return sql<number>`(COALESCE(${textSearchTrigramScore(query, cols)}, 0) * ${TRIGRAM_WEIGHT} + COALESCE(${textSearchDocumentScore(query, cols)}, 0))`
}

/**
 * The match predicate — a parenthesized `OR` block, safe to `AND` into any
 * `WHERE`.
 *
 * Three kinds of arm:
 * 1. `tsvector @@ tsquery` — stemming, served by the composite GIN index;
 * 2. {@link textSearchTrigramMatch} — typo tolerance, served by the composite
 *    `gin_trgm_ops` index via the `%` operator;
 * 3. `ILIKE '%q%'` over {@link TextSearchColumns.fallbacks} — the short-query
 *    escape hatch, served by the *same* `gin_trgm_ops` indexes.
 *
 * 🔴 **Every arm must be index-servable, or none of them are.** Postgres builds
 * this block as a `BitmapOr` of one index scan per arm; a single arm it has no
 * index condition for forces it to abandon the bitmap entirely and filter the
 * whole scope row by row. That is why arm 2 carries a redundant-looking `%` and
 * why {@link TextSearchColumns.fallbacks} documents an index requirement rather
 * than calling itself unindexable. Do not add an arm here without checking
 * `EXPLAIN ANALYZE` shows it inside the `BitmapOr`.
 *
 * The block is returned already wrapped in parentheses because it is an `OR`
 * chain: `AND` -ing an unparenthesized one into a `WHERE` reassociates the whole
 * clause and quietly widens the result set past every other filter.
 */
export function textSearchPredicate(query: string, cols: TextSearchColumns): SQL {
  const like = `%${query}%`
  const arms: SQL[] = [
    sql`${textSearchDocument(cols)} @@ ${textSearchQuery(query)}`,
    textSearchTrigramMatch(query, cols),
    ...cols.fallbacks.map((fallback) => sql`${fallback} ILIKE ${like}`),
  ]
  return sql`(${sql.join(arms, sql` OR `)})`
}

/**
 * The keyset pagination filter for a `(score DESC, id DESC)` ordering:
 * strictly-worse score, or the same score and a strictly-smaller id.
 *
 * Recomputes the rank rather than referencing the `SELECT` alias because a
 * `WHERE` clause cannot see output aliases in Postgres. That recomputation is
 * exactly why the formula has to live in one place — the cursor and the
 * `ORDER BY` disagreeing by a single `COALESCE` produces skipped rows, not an
 * error.
 *
 * Note that {@link textSearchTrigramMatch} deliberately did **not** change this:
 * `%` is a *match* operator, not a score, so the fuzzy arm's indexability fix
 * left {@link textSearchRank} — and therefore this cursor and the `ORDER BY` it
 * mirrors — byte-identical. Any future change that touches the score must touch
 * both, which is why they are one function.
 *
 * @param score - the last row's combined score, from the previous page's cursor
 * @param id - the last row's id, the tie-break
 */
export function textSearchCursor(
  query: string,
  cols: TextSearchColumns,
  score: number,
  id: string
): SQL {
  const rank = textSearchRank(query, cols)
  return sql`(${rank} < ${score} OR (${rank} = ${score} AND ${cols.id} < ${id}))`
}
