// packages/lib/src/field-values/search-text.ts

import type { Database, Transaction } from '@auxx/database'
import type { FieldType } from '@auxx/database/types'
import { sql } from 'drizzle-orm'

/**
 * `EntityInstance.searchText` — the corpus behind the Records-page ranked search.
 *
 * Until this module existed the column was only
 * `TRIM(CONCAT_WS(' ', displayName, secondaryDisplayValue))`, so the ranked
 * search (tsvector + trigram, indexed by
 * `packages/database/drizzle/0058_add_index_entity_instance.sql`) delivered typo
 * tolerance and relevance over *display fields only*. "The contact at Acme in
 * Berlin" could never match, because the company relationship and the city field
 * value were never in the corpus.
 *
 * This module widens the corpus to a bounded, explicitly allowlisted set of
 * field values, and is the single definition of that corpus — the per-write
 * refresh, the per-definition recalculation and the one-time backfill
 * (`data-migrations/migrations/068-widen-entity-search-text.ts`) all compose
 * {@link searchTextExpressionSql}.
 *
 * No new infrastructure: the GIN indexes already exist and benefit immediately.
 */

// =============================================================================
// FIELD-TYPE POLICY
// =============================================================================

/**
 * Types whose value lives in `FieldValue.valueText` and reads as natural
 * language. Verified against the dev DB: these are exactly the `CustomField.type`
 * values with a non-null `valueText` (TEXT 8428 rows, EMAIL 1552, RICH_TEXT 1538,
 * URL 879, PHONE_INTL 267; `ADDRESS` has no rows yet but is the same
 * `textConverter` family — see `converters/index.ts`).
 */
export const SEARCH_TEXT_TEXT_FIELD_TYPES = [
  'TEXT',
  'RICH_TEXT',
  'ADDRESS',
  'EMAIL',
  'URL',
  'PHONE_INTL',
] as const satisfies readonly FieldType[]

/**
 * Option-backed types. The value row only carries `optionId` (which stores the
 * option's `value`, e.g. `WAITING_FOR_THIRD_PARTY`); the human label lives in
 * `CustomField.options->'options'[].label`. We index the **label** and fall back
 * to the raw `optionId` when no option matches, so a renamed option is searchable
 * under its current wording.
 */
export const SEARCH_TEXT_OPTION_FIELD_TYPES = [
  'SINGLE_SELECT',
  'MULTI_SELECT',
  'TAGS',
] as const satisfies readonly FieldType[]

/**
 * `valueJson` types with a **closed, known shape**, indexed by an explicit key
 * allowlist — never by dumping the whole document (see the denylist note on
 * `JSON` below for why that distinction is load-bearing).
 *
 * - `NAME` → `{ firstName, lastName }`
 * - `ADDRESS_STRUCT` → `{ street1, street2, city, state, zipCode, country }`,
 *   deliberately excluding `lat` / `lng` / `geocodedAt` (machine data, pure noise
 *   in a tsvector).
 */
export const SEARCH_TEXT_JSON_FIELD_TYPES = [
  'NAME',
  'ADDRESS_STRUCT',
] as const satisfies readonly FieldType[]

/** Keys read out of a `NAME` value. */
export const SEARCH_TEXT_NAME_KEYS = ['firstName', 'lastName'] as const

/** Keys read out of an `ADDRESS_STRUCT` value. Geo coordinates are excluded. */
export const SEARCH_TEXT_ADDRESS_KEYS = [
  'street1',
  'street2',
  'city',
  'state',
  'zipCode',
  'country',
] as const

/**
 * Every `CustomField.type` that contributes to the corpus.
 *
 * **This is an allowlist, not a denylist, on purpose: it fails closed.** A field
 * type added to `ContactFieldType` tomorrow contributes nothing until someone
 * adds it here deliberately. Getting a denylist wrong leaks; getting an
 * allowlist wrong only costs recall.
 *
 * **Excluded, and why:**
 * | Type | Why not |
 * |---|---|
 * | `NUMBER`, `CURRENCY` | Bare numerals carry no `idf` signal and dilute ranking. Filter on them, don't search them. |
 * | `CHECKBOX` | Boolean. |
 * | `DATE`, `DATETIME`, `TIME` | Rendering is locale/timezone dependent; dates are a filter, not free text. |
 * | `CALC` | Derived at read time — nothing stable is stored to index. |
 * | `ACTOR` | A reference (`actorId` → `User.id`, or `relatedEntityId` + marker for non-user kinds). Indexing it copies member PII onto every record they touch, for a question ("assigned to X") that is already a filter. |
 * | `FILE` | `{ ref: 'asset:…' }` — an opaque id. |
 * | `JSON` | Arbitrary app/connector payload. Also note `FieldValue.valueJson` doubles as the **AI-metadata piggyback** for otherwise-text fields (model, jobId, inputHash, token counts — see the `aiStatus` comment in `packages/database/src/db/schema/field-value.ts`); 36 `TEXT` rows in dev already carry one. Blanket-indexing `valueJson` would put that internal metadata into a user-facing search corpus. |
 *
 * **`BaseType.SECRET` is unreachable by construction, twice over.** There is no
 * `SECRET` member in the `ContactFieldType` pg enum
 * (`packages/database/src/db/schema/_shared.ts`), so no `CustomField` row can
 * have that type, and `mapFieldTypeToBaseType`
 * (`workflow-engine/utils/field-type-mapper.ts`) has no branch that returns it —
 * `SECRET` is a workflow-variable type only. On top of that, this positive list
 * would still have to name it. `search-text.test.ts` asserts all three.
 */
export const SEARCH_TEXT_INDEXED_FIELD_TYPES = [
  ...SEARCH_TEXT_TEXT_FIELD_TYPES,
  ...SEARCH_TEXT_OPTION_FIELD_TYPES,
  ...SEARCH_TEXT_JSON_FIELD_TYPES,
  // The related record's `displayName` — this is the "contact at **Acme**" half
  // of the motivating query, and the second-largest value population in the dev
  // DB (7,546 rows). Caveat: renaming the *related* record leaves referencing
  // records' `searchText` stale until their next field write or a backfill
  // re-run. A search corpus tolerates that; a source of truth would not.
  'RELATIONSHIP',
] as const satisfies readonly FieldType[]

/** Legacy `ContactFieldType` member with no `FieldType` counterpart (commented
 *  out in `@auxx/database/enums`) but still present in the pg enum. Treated as
 *  text so pre-existing rows are not silently dropped from the corpus. */
const LEGACY_TEXT_DB_ONLY_TYPES = ['PHONE'] as const

// =============================================================================
// BOUNDS
// =============================================================================

/**
 * Max characters kept from a single field value.
 *
 * The longest stored `valueText` in the dev DB is 633 chars (a `TEXT` "Notes"
 * field); p99 is 41. 500 keeps ~80 words — a paragraph of a long-form note — and
 * is the point past which extra prose stops adding retrievable signal and starts
 * adding index bloat.
 */
export const SEARCH_TEXT_VALUE_LIMIT = 500

/**
 * Max distinct values folded into one record's corpus.
 *
 * The widest entity definition in the dev DB has 27 active fields, 12 of them
 * text-bearing; the widest *record* holds 9 text values. 32 is ~2.7× that
 * headroom and also bounds multi-value fields (which store one row per value).
 * Values are taken shortest-first, so names, emails, cities and option labels
 * always survive and only long-form prose is dropped.
 */
export const SEARCH_TEXT_MAX_VALUES = 32

/**
 * Hard cap on the whole column.
 *
 * **This is the bound that matters.** Without it the column is unbounded in
 * `fields × value length`, and Postgres's `to_tsvector` refuses inputs past
 * 1 MB ("string is too long for tsvector") — which would make the GIN index in
 * migration 0058 fail on write, not degrade. 2000 chars sits ~500× under that
 * ceiling.
 *
 * Measured on the dev DB with this expression: 4,289 instances, mean length
 * 136 chars (up from 32), p99 367, max 1,022 — **zero rows hit the cap**. So the
 * cap only ever binds on a record that pairs many fields with long-form text,
 * and even then it truncates the tail of the longest value. `displayName` and
 * `secondaryDisplayValue` are concatenated first, so truncation can never eat
 * the display fields the corpus used to consist of.
 */
export const SEARCH_TEXT_TOTAL_LIMIT = 2000

// =============================================================================
// SQL
// =============================================================================

/** `'A','B','C'` — for an `IN (…)` list of enum literals. */
function quoteList(values: readonly string[]): string {
  return values.map((v) => `'${v}'`).join(', ')
}

/** `x->>'a', x->>'b'` — for `CONCAT_WS` over a closed jsonb shape. */
function jsonKeyList(column: string, keys: readonly string[]): string {
  return keys.map((k) => `${column}->>'${k}'`).join(', ')
}

/**
 * The searchable text of ONE field-value row, as SQL.
 *
 * Returns `NULL` for any row the policy doesn't index — the caller filters those
 * out. Every branch is driven by {@link SEARCH_TEXT_INDEXED_FIELD_TYPES}, so the
 * allowlist and the extraction can't drift apart.
 */
function fieldValueTextSql(): string {
  return `
        CASE
          WHEN cf."type" IN (${quoteList([
            ...SEARCH_TEXT_TEXT_FIELD_TYPES.filter((t) => t !== 'RICH_TEXT'),
            ...LEGACY_TEXT_DB_ONLY_TYPES,
          ])}) THEN fv."valueText"
          /* Rich text may be stored as HTML; strip tags so element and
             attribute names don't become lexemes. */
          WHEN cf."type" = 'RICH_TEXT'
            THEN regexp_replace(COALESCE(fv."valueText", ''), '<[^>]*>', ' ', 'g')
          WHEN cf."type" IN (${quoteList(SEARCH_TEXT_OPTION_FIELD_TYPES)}) THEN COALESCE(
            (SELECT o->>'label'
               FROM jsonb_array_elements(
                      CASE WHEN jsonb_typeof(cf."options"->'options') = 'array'
                           THEN cf."options"->'options'
                           ELSE '[]'::jsonb END) AS o
              WHERE o->>'value' = fv."optionId" OR o->>'id' = fv."optionId"
              LIMIT 1),
            fv."optionId")
          WHEN cf."type" = 'RELATIONSHIP' THEN rel."displayName"
          WHEN cf."type" = 'NAME'
            THEN CONCAT_WS(' ', ${jsonKeyList('fv."valueJson"', SEARCH_TEXT_NAME_KEYS)})
          WHEN cf."type" = 'ADDRESS_STRUCT'
            THEN CONCAT_WS(' ', ${jsonKeyList('fv."valueJson"', SEARCH_TEXT_ADDRESS_KEYS)})
        END`
}

/**
 * The full `searchText` value for one `EntityInstance`, as a SQL expression
 * correlated to `alias`.
 *
 * Shape: `displayName`, `secondaryDisplayValue`, then up to
 * {@link SEARCH_TEXT_MAX_VALUES} distinct allowlisted field values ordered
 * shortest-first, each clipped to {@link SEARCH_TEXT_VALUE_LIMIT}, with the whole
 * result clipped to {@link SEARCH_TEXT_TOTAL_LIMIT} and `NULL` when empty.
 *
 * Written as a raw string rather than composed Drizzle columns on purpose: a
 * `PgColumn` in a correlated subquery loses its table qualifier when Drizzle
 * flattens a single-table projection, which would silently self-join `ei` here.
 * Nothing in this string is caller-supplied, so `sql.raw` is safe.
 *
 * @param alias table alias of the `EntityInstance` row being computed
 */
export function searchTextExpressionSql(alias = 'ei'): string {
  return `LEFT(NULLIF(TRIM(CONCAT_WS(' ',
    ${alias}."displayName",
    ${alias}."secondaryDisplayValue",
    (
      SELECT string_agg(t.txt, ' ' ORDER BY length(t.txt), t.txt)
      FROM (
        SELECT d.txt FROM (
          SELECT DISTINCT LEFT(btrim(v.val), ${SEARCH_TEXT_VALUE_LIMIT}) AS txt
          FROM (
            SELECT ${fieldValueTextSql()} AS val
            FROM "FieldValue" fv
            JOIN "CustomField" cf ON cf.id = fv."fieldId"
            LEFT JOIN "EntityInstance" rel
              ON rel.id = fv."relatedEntityId"
             AND rel."organizationId" = fv."organizationId"
            WHERE fv."entityId" = ${alias}.id
              AND fv."organizationId" = ${alias}."organizationId"
              /* Definition-level exclusions, independent of type:
                   active=false   retired field
                   isHidden       invisible in every user-facing surface, so it
                                  has no business surfacing through search
                   isIdentity     external-system ids (e.g. Shopify customerId):
                                  high-cardinality, one distinct lexeme per row,
                                  zero natural-language value. Exact-id lookup
                                  belongs on the RecordIdentity index instead. */
              AND cf."active" AND NOT cf."isHidden" AND NOT cf."isIdentity"
              AND cf."type" IN (${quoteList([
                ...SEARCH_TEXT_INDEXED_FIELD_TYPES,
                ...LEGACY_TEXT_DB_ONLY_TYPES,
              ])})
          ) v
          WHERE btrim(COALESCE(v.val, '')) <> ''
        ) d
        ORDER BY length(d.txt), d.txt
        LIMIT ${SEARCH_TEXT_MAX_VALUES}
      ) t
    )
  )), ''), ${SEARCH_TEXT_TOTAL_LIMIT})`
}

// =============================================================================
// WRITE PATHS
// =============================================================================

/**
 * Recompute `searchText` for one record.
 *
 * Called from the field-value write path whenever a display column *or* an
 * allowlisted field value changes. Deliberately `Promise<void>` (not a `Result`)
 * — it matches the helper it replaces, and every caller treats a search-corpus
 * refresh as part of the write it already committed.
 *
 * Cost note: a bulk write that touches N indexed fields on one record runs this
 * N times. Each run is a single-row UPDATE whose subquery is served by
 * `FieldValue_entityId_idx`, so the constant is small; coalescing would mean
 * threading mutable state through `FieldValueContext` and risking a forgotten
 * flush, which is a worse trade at this volume.
 */
export async function updateSearchText(
  db: Database | Transaction,
  entityInstanceId: string,
  organizationId: string
): Promise<void> {
  await db.execute(sql`
    UPDATE "EntityInstance" ei
    SET "searchText" = ${sql.raw(searchTextExpressionSql('ei'))}
    WHERE ei.id = ${entityInstanceId}
      AND ei."organizationId" = ${organizationId}
  `)
}

/**
 * Recompute `searchText` for a set of records in one statement.
 *
 * Used by the display-field cascade, which can touch many dependent records when
 * one related record is renamed.
 */
export async function updateSearchTextForInstances(
  db: Database | Transaction,
  organizationId: string,
  entityInstanceIds: readonly string[]
): Promise<void> {
  if (entityInstanceIds.length === 0) return
  await db.execute(sql`
    UPDATE "EntityInstance" ei
    SET "searchText" = ${sql.raw(searchTextExpressionSql('ei'))}
    WHERE ei.id IN (${sql.join(
      entityInstanceIds.map((id) => sql`${id}`),
      sql`, `
    )})
      AND ei."organizationId" = ${organizationId}
  `)
}

/**
 * Recompute `searchText` for every record of one entity definition.
 *
 * Used after a display-field pointer changes, which rewrites `displayName` /
 * `secondaryDisplayValue` in bulk.
 */
export async function updateSearchTextForEntityDefinition(
  db: Database | Transaction,
  organizationId: string,
  entityDefinitionId: string
): Promise<void> {
  await db.execute(sql`
    UPDATE "EntityInstance" ei
    SET "searchText" = ${sql.raw(searchTextExpressionSql('ei'))}
    WHERE ei."entityDefinitionId" = ${entityDefinitionId}
      AND ei."organizationId" = ${organizationId}
  `)
}

/**
 * True when a write to this field type should refresh the corpus.
 *
 * The write path calls this before spending an UPDATE: a `NUMBER` or `DATE`
 * write changes nothing the corpus contains.
 */
export function isSearchTextIndexedFieldType(fieldType: string | null | undefined): boolean {
  if (!fieldType) return false
  return (
    (SEARCH_TEXT_INDEXED_FIELD_TYPES as readonly string[]).includes(fieldType) ||
    (LEGACY_TEXT_DB_ONLY_TYPES as readonly string[]).includes(fieldType)
  )
}
