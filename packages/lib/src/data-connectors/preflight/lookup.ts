// packages/lib/src/data-connectors/preflight/lookup.ts
// Item 2's other half — the one SKU lookup per distinct non-blank SKU the
// design (§6.1) calls for, against EXISTING parts (including archived ones,
// since `classify.ts` must be able to tell `matched` from `matched_archived`).
// Reads `part_sku` through the cached field map + `FieldValue` table, the same
// way `import/planning/batch-identifier-lookup.ts` reads a batched identifier
// field — chunked so a large SKU list never builds one giant IN clause.

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { and, eq, inArray } from 'drizzle-orm'
import { getCachedCustomFields, getCachedEntityDefId } from '../../cache'
import type { ExistingPart } from './classify'

/** Values per `IN (...)` list — mirrors `batch-identifier-lookup.ts`'s CHUNK_SIZE. */
const CHUNK_SIZE = 1000

/**
 * Look up existing `part` records (including archived ones) whose `part_sku`
 * exactly matches one of `skus`, after trimming.
 *
 * Resolves the `part` entity definition and its `part_sku` `CustomField` via
 * the org cache (`getCachedEntityDefId` / `getCachedCustomFields`) rather than
 * querying `EntityDefinition`/`CustomField` directly — org-scoped field lookups
 * always go through the cache first (CLAUDE.md "Org Cache"). Delegates the
 * actual `FieldValue` read to {@link findPartsBySkusForField}, split out so the
 * chunked-query logic is testable with a hand-written db double, independent
 * of the (Redis-backed) org cache.
 *
 * Deliberately does NOT filter `archivedAt IS NULL` — the pre-flight's whole
 * reason for reading archived parts is `classify.ts`'s `matched_archived`
 * class, which must never silently disappear into `create`.
 *
 * @param db - Database handle.
 * @param organizationId - Org scope.
 * @param skus - Candidate SKUs, as the connector projected them (untrimmed is fine).
 * @returns Every matching part, archived or not. Empty when the org has no
 *   `part` def, no `part_sku` field, or no SKU matched.
 */
export async function findPartsBySkus(
  db: Database,
  organizationId: string,
  skus: string[]
): Promise<ExistingPart[]> {
  const entityDefinitionId = await getCachedEntityDefId(organizationId, 'part')
  if (!entityDefinitionId) return []

  const customFields = await getCachedCustomFields(organizationId, entityDefinitionId)
  const skuField = customFields.find((field) => field.systemAttribute === 'part_sku')
  if (!skuField) return []

  return findPartsBySkusForField(db, organizationId, entityDefinitionId, skuField.id, skus)
}

/**
 * The `FieldValue` read behind {@link findPartsBySkus}, taking the `part` def
 * and `part_sku` field ids already resolved so it never touches the org cache
 * — the seam a unit test drives directly with a hand-written db double.
 *
 * Matches `valueText` with a bare, case-sensitive `eq` (via `inArray`), the
 * same comparison `migration 097-part-sku-unique`'s uniqueness guard uses —
 * see `classify.ts`'s JSDoc for why this module does not lowercase. Trims each
 * candidate SKU before binding it; a stored SKU that itself carries stray
 * whitespace (which the unique constraint would have allowed, since it does
 * not trim either) will not match here. That is a known, narrow gap — flagged
 * for whoever wires this into a router, not fixed here, because wrapping the
 * column in `trim()` would turn an indexed `IN (...)` into a functional scan.
 */
export async function findPartsBySkusForField(
  db: Database,
  organizationId: string,
  entityDefinitionId: string,
  fieldId: string,
  skus: string[]
): Promise<ExistingPart[]> {
  const distinctSkus = [...new Set(skus.map((sku) => sku.trim()).filter((sku) => sku.length > 0))]
  if (distinctSkus.length === 0) return []

  const parts: ExistingPart[] = []

  for (const chunk of chunked(distinctSkus)) {
    const rows = await db
      .select({
        id: schema.EntityInstance.id,
        sku: schema.FieldValue.valueText,
        archivedAt: schema.EntityInstance.archivedAt,
        displayName: schema.EntityInstance.displayName,
      })
      .from(schema.FieldValue)
      .innerJoin(
        schema.EntityInstance,
        and(
          eq(schema.EntityInstance.id, schema.FieldValue.entityId),
          eq(schema.EntityInstance.organizationId, organizationId),
          eq(schema.EntityInstance.entityDefinitionId, entityDefinitionId)
        )
      )
      .where(
        and(
          eq(schema.FieldValue.fieldId, fieldId),
          eq(schema.FieldValue.organizationId, organizationId),
          inArray(schema.FieldValue.valueText, chunk)
        )
      )

    for (const row of rows) {
      if (row.sku === null) continue
      parts.push({
        id: row.id,
        sku: row.sku,
        archivedAt: row.archivedAt,
        displayName: row.displayName ?? row.id,
      })
    }
  }

  return parts
}

/** Split a value list into {@link CHUNK_SIZE} statements. */
function* chunked<T>(values: T[]): Generator<T[]> {
  for (let i = 0; i < values.length; i += CHUNK_SIZE) {
    yield values.slice(i, i + CHUNK_SIZE)
  }
}
