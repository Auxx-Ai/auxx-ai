// packages/lib/src/resources/search/record-search-sql.ts
//
// The RECORD binding of the shared ranked-search builder (`search/text-search-sql.ts`).
// It names `EntityInstance` columns and nothing else — the formula, the OR-block
// and the keyset cursor all come from the shared module so records and mail
// cannot drift apart.
//
// 🔴 **No visibility predicate lives here.** Records narrow with
// `recordSearchVisibilitySql` / `recordUnionVisibilitySql`
// (`permissions/capabilities/record-visibility-scope.ts`), applied by the caller
// alongside — never inside — the search predicate. Keeping the two apart is what
// stops "search" and "authorization" from being edited as one expression.
//
// Recall here is capped by the corpus, not by the formula: `searchText` is
// maintained as `TRIM(CONCAT_WS(' ', "displayName", "secondaryDisplayValue"))`
// (`field-values/field-value-helpers.ts`, `field-values/display-field-service.ts`),
// so this delivers stemming, typo tolerance and relevance over *display fields*
// — not over a record's field values.
//
// 🔴 **Three indexes, one per arm — and the block is only as fast as its worst
// arm.** `EntityInstance_org_searchText_gin_idx` serves the tsvector arm,
// `EntityInstance_org_displayName_trgm_idx` serves both the `%` arm and the
// `displayName ILIKE` arm, `EntityInstance_org_secondaryDisplayValue_trgm_idx`
// serves the `secondaryDisplayValue ILIKE` arm. All three are org-scoped
// composites, so every query binding this must already filter `organizationId`.
// Measured on a 400k-row copy with a 100k-row org+def slice: with the
// `secondaryDisplayValue` index missing, Postgres abandons the other two as
// well and filters the slice sequentially — 125 ms instead of 32 ms, for a
// byte-identical result set.
//
// That is also the answer to "should `secondaryDisplayValue` stay a fallback at
// all, given `searchText` already concatenates it?" It should: `searchText` is
// tokenized, and `to_tsvector` turns `ada@acme-supply.io` into one `email`
// token, so the tsvector arm cannot match `acme` inside it. On the dev database
// 1543 of 3376 non-null `secondaryDisplayValue`s are email addresses. Dropping
// the arm would have been a real recall loss; indexing it is not.

import { schema } from '@auxx/database'
import { type SQL, sql } from 'drizzle-orm'
import {
  type TextSearchColumns,
  textSearchCursor,
  textSearchDocumentScore,
  textSearchPredicate,
  textSearchRank,
  textSearchTrigramScore,
} from '../../search/text-search-sql'

/**
 * `EntityInstance` as **Drizzle column refs** — for queries composed with
 * `select().from(EntityInstance)` (the records list query).
 *
 * A function, not a module-level const, for two reasons: under this package's
 * Vitest setup `@auxx/database`'s `schema` is a Proxy whose columns are
 * `undefined`, so evaluating it at import time would bake `undefined` chunks
 * into every consumer's module graph; and it keeps the binding cheap to shadow
 * in a test.
 */
export function recordSearchColumns(): TextSearchColumns {
  return {
    document: schema.EntityInstance.searchText,
    rank: schema.EntityInstance.displayName,
    fallbacks: [schema.EntityInstance.displayName, schema.EntityInstance.secondaryDisplayValue],
    id: schema.EntityInstance.id,
  }
}

/**
 * The same four columns as **raw aliased identifiers**, for hand-written SQL of
 * the shape `FROM "EntityInstance" ei`.
 *
 * Not interchangeable with {@link recordSearchColumns}: a `PgColumn` renders as
 * `"EntityInstance"."displayName"`, which Postgres rejects once the table
 * carries an alias. See the `TextSearchRef` note in `search/text-search-sql.ts`
 * for the full story.
 */
export function recordSearchColumnsAliased(alias: string): TextSearchColumns {
  const col = (name: string) => sql.raw(`${alias}."${name}"`)
  return {
    document: col('searchText'),
    rank: col('displayName'),
    fallbacks: [col('displayName'), col('secondaryDisplayValue')],
    id: col('id'),
  }
}

/**
 * The `ei` binding used by `record-picker-service.ts`. Safe as a const —
 * `sql.raw` never touches `schema`.
 */
export const RECORD_SEARCH_COLUMNS_EI = recordSearchColumnsAliased('ei')

/**
 * The record match predicate — a parenthesized `OR` block, ready to `AND` into
 * any `WHERE` that already scopes `organizationId` (which is what lets the
 * composite GIN indexes from migration 0058 serve it).
 */
export function recordSearchPredicate(
  query: string,
  cols: TextSearchColumns = recordSearchColumns()
): SQL {
  return textSearchPredicate(query, cols)
}

/**
 * The record relevance score. Use as `desc(recordSearchRank(q))` — and keep
 * `updatedAt DESC, id DESC` under it, because most rows score 0 on trigram and
 * an unbroken tie pages erratically.
 */
export function recordSearchRank(
  query: string,
  cols: TextSearchColumns = recordSearchColumns()
): SQL<number> {
  return textSearchRank(query, cols)
}

/** The keyset filter for a `score|id` cursor over ranked record results. */
export function recordSearchCursor(
  query: string,
  score: number,
  id: string,
  cols: TextSearchColumns = recordSearchColumns()
): SQL {
  return textSearchCursor(query, cols, score, id)
}

/** The full-text component of the score, projected as `text_score` by the picker. */
export function recordSearchTextScore(
  query: string,
  cols: TextSearchColumns = recordSearchColumns()
): SQL<number> {
  return textSearchDocumentScore(query, cols)
}

/** The trigram component of the score, projected as `name_score` by the picker. */
export function recordSearchNameScore(
  query: string,
  cols: TextSearchColumns = recordSearchColumns()
): SQL<number> {
  return textSearchTrigramScore(query, cols)
}
