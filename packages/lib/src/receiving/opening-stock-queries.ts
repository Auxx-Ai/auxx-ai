// packages/lib/src/receiving/opening-stock-queries.ts

/**
 * The read behind the Parts > Settings > Costing opening-stock checklist
 * (plans/money/tasks/52-parts-costing-page.md §5).
 *
 * One answer per part, for every part in the org, assembled from four BULK
 * reads and no loop.
 *
 * 🛑 **A per-part loop is the bug, not the implementation.** The single-part
 * door (`open-stock-balance.ts`) asks five questions of one part; 495 parts
 * through the same shape is roughly 2,500 queries. Every question here is asked
 * once, of the whole set, and joined in memory.
 *
 * Reads only. The write is `bulk-opening-stock.ts`, because a file that both
 * queries and mutates is the first step back toward a service class
 * (`docs/lib-module-guide.md` §5).
 *
 * No permission checks: the router asserts (`docs/lib-module-guide.md` §6).
 */

import { type Database, schema } from '@auxx/database'
import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { Result } from 'neverthrow'
import { getCachedEntityDefId, getOrgCache, requireCachedEntityDefId } from '../cache'
import { StockMovementType } from '../resources/registry/enum-values'
import { guard } from './guard'
import type { OpeningStockCandidate } from './types'

/** Every part-side attribute a candidate row is assembled from. */
const PART_ATTRIBUTES = [
  'part_sku',
  'part_kind',
  'part_standard_cost',
  'part_product',
  'subpart_child_part',
] as const

/** The movement-side attributes the "has it ever moved?" probe needs. */
const MOVEMENT_ATTRIBUTES = ['stock_movement_part', 'stock_movement_type'] as const

/**
 * Every part in the org, with the five facts the opening-stock checklist and
 * the `finished_good` suggestion are decided from.
 *
 * The five row states of §4 are all derivable from what comes back:
 * *Not opened* is `!hasMovements`, *Opened* is `hasInitialMovement`, *Blocked*
 * is `hasMovements && !hasInitialMovement` (the state
 * `assertPartHasNoMovements` refuses), *Unclassified* is
 * `isPartKindUnclassified(partKind)`, and *Cost override* is a typed cost that
 * differs from {@link OpeningStockCandidate.standardCost}.
 *
 * 🛑 **`hasMovements` counts ARCHIVED movements too**, exactly like the
 * single-part guard it previews: a soft-deleted movement is a movement that
 * happened, and letting an archive re-open the door would make the guard
 * bypassable by anybody who could archive a row. A candidate this read calls
 * openable and the write then refuses would be worse than no preview at all.
 *
 * ⚠️ **The answer is a PREVIEW, never an authority.** `bulkOpenStockBalance`
 * re-reads `hasMovements` inside its own pass (§6.2) rather than trusting a
 * list the browser was handed some seconds ago.
 *
 * Archived PARTS are excluded: they are not a checklist item.
 *
 * Returns an empty list rather than an error for an org with no `part`
 * definition materialised yet — there is nothing to open, which is a fact, not
 * a failure.
 */
export async function listOpeningStockCandidates(
  db: Database,
  organizationId: string
): Promise<Result<OpeningStockCandidate[], Error>> {
  return guard(
    async () => {
      const partDefId = await requireCachedEntityDefId(organizationId, 'part')
      const fields = await getOrgCache()
        .from(organizationId, 'customFields')
        .bySystemAttributes([...PART_ATTRIBUTES])

      // A field the org has not materialised joins on a sentinel that matches
      // nothing, so its column comes back NULL rather than the query failing.
      // The same shape `batchRecalculateQoH` uses for its optional flag field.
      const skuValue = alias(schema.FieldValue, 'osc_sku')
      const kindValue = alias(schema.FieldValue, 'osc_kind')
      const standardValue = alias(schema.FieldValue, 'osc_standard')
      const productValue = alias(schema.FieldValue, 'osc_product')

      const rows = await db
        .select({
          partId: schema.EntityInstance.id,
          title: schema.EntityInstance.displayName,
          sku: skuValue.valueText,
          partKind: kindValue.optionId,
          standardCost: standardValue.valueNumber,
          productId: productValue.relatedEntityId,
        })
        .from(schema.EntityInstance)
        .leftJoin(skuValue, joinValue(skuValue, fields.part_sku?.id))
        .leftJoin(kindValue, joinValue(kindValue, fields.part_kind?.id))
        .leftJoin(standardValue, joinValue(standardValue, fields.part_standard_cost?.id))
        .leftJoin(productValue, joinValue(productValue, fields.part_product?.id))
        .where(
          and(
            eq(schema.EntityInstance.organizationId, organizationId),
            eq(schema.EntityInstance.entityDefinitionId, partDefId),
            isNull(schema.EntityInstance.archivedAt)
          )
        )

      const movements = await readMovementCoverage(db, organizationId)
      const subpartChildren = await readSubpartChildPartIds(
        db,
        organizationId,
        fields.subpart_child_part?.id
      )

      return rows.map((row) => {
        const coverage = movements.get(row.partId)
        return {
          partId: row.partId,
          title: row.title ?? '',
          sku: row.sku,
          partKind: row.partKind,
          standardCost: row.standardCost,
          hasMovements: coverage != null,
          hasInitialMovement: coverage?.hasInitial ?? false,
          hasProduct: row.productId != null,
          isSubpartOfAssembly: subpartChildren.has(row.partId),
        }
      })
    },
    'Failed to list opening stock candidates',
    { organizationId }
  )
}

/** The `entityId`/`organizationId`/`fieldId` triple every value join is keyed on. */
function joinValue(
  value: ReturnType<typeof alias<typeof schema.FieldValue, string>>,
  fieldId?: string
) {
  return and(
    eq(value.entityId, schema.EntityInstance.id),
    eq(value.organizationId, schema.EntityInstance.organizationId),
    eq(value.fieldId, fieldId ?? '')
  )
}

/** What the ledger already says about one part. */
interface MovementCoverage {
  /** At least one movement of type `initial` exists, so the part is already opened. */
  hasInitial: boolean
}

/**
 * Every part that has ANY `stock_movement`, and whether one of them is
 * `initial`, in one grouped read.
 *
 * `bool_or` rather than a second query: the two facts are answered by the same
 * scan, and asking twice invites them to disagree about which movements were
 * visible.
 *
 * No `archivedAt` filter, deliberately. See {@link listOpeningStockCandidates}.
 */
async function readMovementCoverage(
  db: Database,
  organizationId: string
): Promise<Map<string, MovementCoverage>> {
  const coverage = new Map<string, MovementCoverage>()

  const movementDefId = await getCachedEntityDefId(organizationId, 'stock_movement')
  if (!movementDefId) return coverage

  const fields = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes([...MOVEMENT_ATTRIBUTES])
  const partField = fields.stock_movement_part
  // Without the part link a movement cannot be attributed to anything, so there
  // is no coverage to report and every part reads as never moved.
  if (!partField) return coverage

  const partValue = alias(schema.FieldValue, 'osc_mv_part')
  const typeValue = alias(schema.FieldValue, 'osc_mv_type')

  const rows = await db
    .select({
      partId: partValue.relatedEntityId,
      // A SINGLE_SELECT stores its chosen value in `optionId`; for a
      // system-seeded enum that id IS the value ('initial').
      hasInitial: sql<boolean>`BOOL_OR(${typeValue.optionId} = ${StockMovementType.INITIAL})`,
    })
    .from(schema.EntityInstance)
    .innerJoin(
      partValue,
      and(
        eq(partValue.entityId, schema.EntityInstance.id),
        eq(partValue.organizationId, schema.EntityInstance.organizationId),
        eq(partValue.fieldId, partField.id)
      )
    )
    .leftJoin(
      typeValue,
      and(
        eq(typeValue.entityId, schema.EntityInstance.id),
        eq(typeValue.organizationId, schema.EntityInstance.organizationId),
        eq(typeValue.fieldId, fields.stock_movement_type?.id ?? '')
      )
    )
    .where(
      and(
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityInstance.entityDefinitionId, movementDefId),
        isNotNull(partValue.relatedEntityId)
      )
    )
    .groupBy(partValue.relatedEntityId)

  for (const row of rows) {
    if (!row.partId) continue
    coverage.set(row.partId, { hasInitial: row.hasInitial === true })
  }
  return coverage
}

/**
 * Every part that is somebody's `subpart_child_part`.
 *
 * Condition (b) of `shouldSuggestFinishedGood`. Whether the part has its own
 * bill of materials is deliberately NOT read: a spare sold as-is is also a
 * finished good.
 *
 * Archived `subpart` rows are excluded — a BOM line somebody removed must not
 * keep suppressing the suggestion forever.
 */
async function readSubpartChildPartIds(
  db: Database,
  organizationId: string,
  fieldId: string | undefined
): Promise<Set<string>> {
  const children = new Set<string>()
  if (!fieldId) return children

  const rows = await db
    .selectDistinct({ partId: schema.FieldValue.relatedEntityId })
    .from(schema.FieldValue)
    .innerJoin(
      schema.EntityInstance,
      and(
        eq(schema.EntityInstance.id, schema.FieldValue.entityId),
        eq(schema.EntityInstance.organizationId, schema.FieldValue.organizationId)
      )
    )
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.fieldId, fieldId),
        isNotNull(schema.FieldValue.relatedEntityId),
        isNull(schema.EntityInstance.archivedAt)
      )
    )

  for (const row of rows) {
    if (row.partId) children.add(row.partId)
  }
  return children
}
