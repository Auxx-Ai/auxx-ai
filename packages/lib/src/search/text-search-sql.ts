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

import { asc, bindIfParam, desc, type SQL, sql } from 'drizzle-orm'
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
 *
 * Exported so a domain that composes its own rank out of these parts —
 * `mail-query/thread-search-sql.ts` does — weights the trigram arm with the same
 * number rather than retyping `2`.
 */
export const TRIGRAM_WEIGHT = sql.raw('2')

/**
 * `ts_rank_cd`'s normalization flag `32`: "divide the rank by itself + 1".
 *
 * 🔴 **This is the only thing that makes a cover-density score comparable across
 * two columns of different length.** Unnormalized `ts_rank_cd` is ~0.1 per cover
 * and is NOT divided by document length, so it grows without bound in a long
 * document: measured on the dev org, `ts_rank_cd` over `Thread."searchText"`
 * reaches **9.3** for `order` and 3.1 for `invoice`, while the same expression
 * over `Thread."subject"` caps at **0.3** — a 30x scale gap that has nothing to
 * do with relevance and everything to do with the corpus being longer. Any fixed
 * weight blending those two raw numbers is a guess that the longer column wins.
 *
 * Flag 32 maps `r` to `r / (r + 1)`, which is strictly increasing (so it never
 * reorders rows within one arm) and bounded on `[0, 1)` (so a weight on ANOTHER
 * arm can be derived against a known supremum instead of guessed). Verified
 * against the database: `ts_rank_cd(…, 32)` returns exactly `r / (r + 1)`
 * (`0.1 → 0.09090909`, `0.3 → 0.23076923`).
 */
export const TS_RANK_SATURATING = sql.raw('32')

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

/**
 * The full-text half of the score: `ts_rank_cd(document, query)`.
 *
 * @param normalization - an optional `ts_rank_cd` normalization flag, e.g.
 *   {@link TS_RANK_SATURATING}. Omitted by default, and deliberately so: the
 *   record binding's score is projected raw to the picker and pinned by test, and
 *   a domain with a single document column has nothing to make it comparable
 *   *to*. Pass one only when two differently-sized corpora are being blended.
 */
export function textSearchDocumentScore(
  query: string,
  cols: TextSearchColumns,
  normalization?: SQL
): SQL<number> {
  const document = textSearchDocument(cols)
  const parsed = textSearchQuery(query)
  if (!normalization) {
    return sql<number>`ts_rank_cd(${document}, ${parsed})`
  }
  return sql<number>`ts_rank_cd(${document}, ${parsed}, ${normalization})`
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
 * mirrors — identical. Any future change that touches the score must touch both,
 * which is why the rank is built by one function and the comparison by another
 * ({@link textSearchKeyset}); neither is restated anywhere.
 *
 * ⚠️ "Identical" means *identical modulo placeholder ordinals*, which is the only
 * form achievable: the rank appears twice, so Drizzle numbers the first copy's
 * parameters `$1…` and the second's from wherever the score left off. The
 * expressions are the same and each slot receives the same term — the tests
 * normalize `$\d+` before comparing and pin the params array separately. Do not
 * "fix" a rendered-SQL test by making the two copies share ordinals.
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
  return textSearchKeyset(textSearchRank(query, cols), cols.id, score, id)
}

/**
 * The keyset filter for an ARBITRARY rank expression — the shape
 * {@link textSearchCursor} is made of, exposed so a domain that composes its own
 * score can reuse the shape without restating the comparison.
 *
 * 🔴 **Pass the expression the `ORDER BY` uses, from the same function call.**
 * The whole hazard this module exists to prevent is a cursor and an `ORDER BY`
 * that disagree — which does not error, it skips and duplicates rows on page 2.
 * Taking the rank as a *parameter* rather than rebuilding it from columns is what
 * lets `mail-query/thread-search-sql.ts` bind a rank this module knows nothing
 * about (it carries a subject arm records have no equivalent for) and still be
 * structurally incapable of drifting from its own ordering: `threadSearchCursor`
 * calls `threadSearchRank`, the same function `ORDER BY` calls.
 *
 * It is the two-part specialization of {@link keysetAfter} — `(rank DESC, id DESC)`
 * — and nothing more. A domain whose `ORDER BY` has a third tier (records keep
 * `updatedAt DESC` under the rank, because most rows score 0 on trigram and an
 * unbroken tie pages erratically) must NOT reach for this: pairing a two-part
 * cursor with a three-part ordering is the silent skip/duplicate this whole module
 * is written to prevent. Build a {@link KeysetTerm} list instead and render both
 * halves from it.
 *
 * @param rank - the ordering expression, rendered twice (a `WHERE` cannot see a
 *   `SELECT` alias, so the recomputation is unavoidable)
 * @param id - the tie-break column
 * @param score - the last row's score, from the previous page's cursor
 * @param cursorId - the last row's id
 */
export function textSearchKeyset(
  rank: SQL<number>,
  id: TextSearchRef,
  score: number,
  cursorId: string
): SQL {
  return keysetAfter(
    [
      { expr: rank, direction: 'desc' },
      { expr: id, direction: 'desc' },
    ],
    [score, cursorId]
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// THE GENERIC N-PART KEYSET
// ─────────────────────────────────────────────────────────────────────────────

/** A sort direction, in the two forms an ORDER BY can take. */
export type KeysetDirection = 'asc' | 'desc'

/**
 * One term of a keyset ordering: an expression and the direction it is sorted
 * in.
 *
 * 🔴 **A term list is the SINGLE definition of an ordering.** {@link keysetOrderBy}
 * renders it as the `ORDER BY` and {@link keysetAfter} renders it as the cursor
 * predicate, so the two cannot disagree — which is the entire failure mode this
 * shape exists to make unrepresentable. A cursor whose comparison does not match
 * its own `ORDER BY` does not error: it silently skips rows and repeats others,
 * and only on the pages where the leading term ties.
 *
 * Build the list once, hand the SAME array to both functions, and never restate
 * either half.
 *
 * @typeParam E - narrowed by domain bindings so a caller can also project the
 *   expression (`terms[0].expr`) into its `SELECT` without rebuilding it — the
 *   `SELECT`, the `ORDER BY` and the cursor then share one object.
 */
export interface KeysetTerm<E extends TextSearchRef = TextSearchRef> {
  /** The ordering expression. */
  expr: E
  /** Its direction in the `ORDER BY`. */
  direction: KeysetDirection
}

/**
 * The `ORDER BY` clauses for a term list, in order.
 *
 * Pair with {@link keysetAfter} over the same array. Nothing may be appended to
 * the result — an extra tie-break the cursor does not know about reintroduces
 * exactly the disagreement the shared list prevents, so the *last* term must
 * already be unique (a primary key).
 */
export function keysetOrderBy(terms: readonly KeysetTerm[]): SQL[] {
  return terms.map((term) => (term.direction === 'desc' ? desc(term.expr) : asc(term.expr)))
}

/**
 * The "strictly after the cursor row" predicate for a term list — the lexicographic
 * comparison, nested rather than flattened:
 *
 * ```sql
 * (a < a0 OR (a = a0 AND (b < b0 OR (b = b0 AND c > c0))))
 * ```
 *
 * Each term's operator follows its OWN direction (`<` for `desc`, `>` for `asc`),
 * which is why the mixed `rank DESC, updatedAt DESC, id ASC` ordering the records
 * list uses is expressible at all. A `desc`-only keyset paired with an ascending
 * tie-break skips and duplicates within every tied block.
 *
 * ⚠️ **Every term must be NOT NULL.** Postgres orders `NULL` first under `DESC`
 * and last under `ASC`, but `NULL < x` is `NULL` — so a nullable term makes the
 * comparison unsatisfiable for exactly the rows the `ORDER BY` places at the
 * boundary. The record binding's terms are a `COALESCE`d score and two `NOT NULL`
 * columns.
 *
 * 🔴 **Values are bound through Drizzle's own {@link bindIfParam}, and that is
 * not a stylistic choice — it is what keeps a `timestamp` cursor correct.** A
 * term backed by a `PgColumn` gets that column's driver encoding, exactly as
 * `eq()` would; a term backed by a raw `SQL` expression falls through to a plain
 * parameter. Interpolating the value directly (`sql`${expr} < ${value}`) skips
 * the encoder and is wrong for dates.
 *
 * The trap, measured on this repo's `EntityInstance.updatedAt`
 * (`timestamp` **without** time zone): Drizzle reads such a column as UTC
 * (`PgTimestamp.mapFromDriverValue`), while node-postgres' *default* parser reads
 * the same bytes as **local** time. Round-tripping a cursor value therefore only
 * works if it stays inside Drizzle's mapping on the way out AND the way back in.
 * A stored `05:20:16.787` comes back from Drizzle as `05:20:16.787Z` and from raw
 * `pg` as `12:20:16.787Z` — feed the second one to a keyset and the cursor lands
 * hours away from the row it names, matching nothing or everything. (Observed
 * while benchmarking: the sweep paged forever until the bench harness was made to
 * mirror Drizzle's parser.) Anything reading rows outside Drizzle — a raw
 * `db.execute`, a hand-written `pg` query — must normalize before building a
 * cursor value.
 *
 * @param terms - the SAME array handed to {@link keysetOrderBy}
 * @param values - the previous page's last row, one value per term, in term order
 */
export function keysetAfter(terms: readonly KeysetTerm[], values: readonly unknown[]): SQL {
  if (terms.length === 0 || terms.length !== values.length) {
    throw new Error(
      `keysetAfter: expected one cursor value per ordering term (got ${values.length} for ${terms.length})`
    )
  }

  const build = (index: number): SQL => {
    const term = terms[index]
    if (!term) throw new Error(`keysetAfter: missing ordering term at index ${index}`)
    const { expr, direction } = term
    const op = sql.raw(direction === 'desc' ? '<' : '>')
    const value = bindIfParam(values[index], expr)
    if (index === terms.length - 1) return sql`${expr} ${op} ${value}`
    return sql`(${expr} ${op} ${value} OR (${expr} = ${value} AND ${build(index + 1)}))`
  }

  return build(0)
}
