// packages/lib/src/resources/search/article-search-sql.ts
//
// The KB-ARTICLE binding of the shared ranked-search builder
// (`search/text-search-sql.ts`). It names `Article` columns and nothing else —
// the ranking formula, the OR-block predicate and the keyset cursor all come
// from the shared module, so articles, records
// (`resources/search/record-search-sql.ts`) and mail
// (`mail-query/thread-search-sql.ts`) cannot drift apart.
//
// **Why articles need a binding at all.** `article` is not in
// `ENTITY_DEFINITION_TYPES`, so it resolves as a *system* resource against the
// `Article` table (`RESOURCE_TABLE_REGISTRY`) and its `EntityDefinition` row is
// filtered out of the registry. `UnifiedCrudHandler.listFiltered` therefore
// branches into `querySystemResourceIdsPaged`, not the `EntityInstance` path —
// which is why the ranked search records got "for free" never reached the KB.
//
// 🔴 **No visibility predicate lives here**, for the same reason it lives in
// neither sibling binding: records narrow with per-record grants, mail with its
// lens, and merging authorization into a search expression is how a permissions
// bug gets written. The system-resource list query applies its own scope
// alongside — never inside — this predicate.
//
// 🔴 **Two indexes, three arms — and the block is only as fast as its worst
// arm.** `Article_org_searchText_gin_idx` serves the tsvector arm;
// `Article_org_title_trgm_idx` serves *both* the `title % q` arm and the
// `title ILIKE '%q%'` fallback. Both are org-scoped composites, so every query
// binding this must already filter `organizationId` — the system-resource list
// query does.

import { schema } from '@auxx/database'
import type { SQL } from 'drizzle-orm'
import {
  type TextSearchColumns,
  textSearchCursor,
  textSearchPredicate,
  textSearchRank,
} from '../../search/text-search-sql'

/**
 * `Article` as **Drizzle column refs**.
 *
 * A function, not a module-level const, for the reason spelled out in
 * `resources/search/record-search-sql.ts`: under this package's Vitest setup
 * `@auxx/database`'s `schema` is a Proxy whose columns read as `undefined`, so
 * evaluating the binding at import time would bake `undefined` chunks into every
 * consumer's module graph.
 *
 * **No aliased twin is provided, and that is a statement about the call site,
 * not an omission.** A `PgColumn` renders table-qualified
 * (`"Article"."title"`), which Postgres rejects once the table carries an alias
 * — so `record-search-sql.ts` ships `recordSearchColumnsAliased` for the
 * hand-written `FROM "EntityInstance" ei` in the picker. Articles have no such
 * query: the only consumer is `querySystemResourceIdsPaged`, which composes
 * `select().from(schema.Article)` with no alias. Add an aliased binding when a
 * hand-written article query exists, not before.
 */
export function articleSearchColumns(): TextSearchColumns {
  return {
    // Title + excerpt + the draft revision's body text, maintained by
    // `kb/article-search-text.ts`. Backed by `Article_org_searchText_gin_idx`.
    document: schema.Article.searchText,
    // The short human-facing column trigram similarity runs on. Title, not the
    // corpus: similarity between a 6-character query and a 19 KB document is ~0
    // by construction, and a `gin_trgm_ops` index over the corpus would be
    // enormous.
    rank: schema.Article.title,
    // 🔴 `title` ONLY. It is what makes a sub-3-character query work at all —
    // `to_tsvector` produces no usable lexeme for `xu`, and no full trigram is
    // extractable from `%xu%` either — and it is safe *because the column is
    // trigram-indexed* (`Article_org_title_trgm_idx`, `gin_trgm_ops`, which
    // serves `~~*` exactly as it serves `%`), so this arm joins the `BitmapOr`
    // instead of collapsing it.
    //
    // `excerpt` is deliberately NOT here despite being in the corpus: it has no
    // trigram index, and one unindexable arm costs the other two their indexes.
    // Measured at 100k synthetic rows, the fully-indexed three-arm block runs in
    // 12 ms; the same query with the body arm moved off `Article` (so one arm
    // has no usable index) seq-scans two tables at 381 ms.
    fallbacks: [schema.Article.title],
    id: schema.Article.id,
  }
}

/**
 * The article match predicate — a parenthesized `OR` block, ready to `AND` into
 * any `WHERE` that already scopes `organizationId` (which is what lets the
 * composite GIN indexes serve it).
 */
export function articleSearchPredicate(
  query: string,
  cols: TextSearchColumns = articleSearchColumns()
): SQL {
  return textSearchPredicate(query, cols)
}

/**
 * The article relevance score. Use as `desc(articleSearchRank(q))`, with the
 * caller's `id` tie-break under it — rows that match only the `ILIKE` fallback
 * score 0, so ties are the common case rather than the exception.
 */
export function articleSearchRank(
  query: string,
  cols: TextSearchColumns = articleSearchColumns()
): SQL<number> {
  return textSearchRank(query, cols)
}

/**
 * The keyset filter for a `score|id` cursor over ranked article results.
 *
 * Exported ahead of its consumer: the system-resource list still pages with
 * `LIMIT/OFFSET` (the same known limitation the records list has), which
 * recomputes the rank over the whole matched set on every page. When that is
 * reworked it must call this rather than restate the formula — the reason the
 * shared module exists at all is that the expression had been written out six
 * times before it did.
 */
export function articleSearchCursor(
  query: string,
  score: number,
  id: string,
  cols: TextSearchColumns = articleSearchColumns()
): SQL {
  return textSearchCursor(query, cols, score, id)
}
