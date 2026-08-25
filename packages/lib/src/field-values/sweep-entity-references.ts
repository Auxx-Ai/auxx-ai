// packages/lib/src/field-values/sweep-entity-references.ts

import { type Database, schema, type Transaction } from '@auxx/database'
import { and, eq, inArray } from 'drizzle-orm'
import { cascadeDependentDisplayNames, getDisplayFieldDeps } from './display-field-deps'
import { updateSearchTextForInstances } from './search-text'

/**
 * `updateSearchTextForInstances` inlines every id into one `IN (…)` list, so the
 * rebuild is chunked rather than handed an unbounded set. A single dead contact
 * can hold hundreds of mirror rows (`contact_work_orders`: 475 from 5 records).
 */
const SEARCH_TEXT_BATCH = 500

/** Input for {@link sweepEntityFieldValues}. */
export interface SweepEntityFieldValuesParams {
  organizationId: string
  /** Ids of the records being hard-deleted. Duplicates are tolerated. */
  entityIds: readonly string[]
  /**
   * `EntityDefinition.entityType` of the records being deleted, when known.
   *
   * Only drives the dependent display-name cascade — a record whose
   * `displayName` is *derived* from a relationship to one of `entityIds` keeps
   * showing the dead record's name otherwise. Omit to skip the cascade; the
   * sweep itself never depends on it.
   */
  entityType?: string | null
  /**
   * Also delete the deleted records' OWN values (`entityId IN entityIds`).
   * Default `true`. Pass `false` only when the caller has already removed them.
   */
  includeOutbound?: boolean
}

/** What {@link sweepEntityFieldValues} removed. */
export interface SweepEntityFieldValuesResult {
  /** Rows removed on the deleted records' own side. */
  outboundDeleted: number
  /** Mirror rows removed from still-living records. */
  inboundDeleted: number
  /** Distinct surviving records that had held a reference to a deleted record. */
  holderIds: string[]
}

/**
 * Remove BOTH halves of every relation touching a set of records that are being
 * hard-deleted, and repair the surviving side.
 *
 * **Why this exists.** A relation is two mirror `FieldValue` rows, one on each
 * end, and `FieldValue.relatedEntityId` is a bare `text()` column with no
 * foreign key (`packages/database/src/db/schema/field-value.ts:93`) — same for
 * `entityId`. Nothing cascades. Every delete path that removed only the dead
 * record's own values left the mirror row sitting on a live record, pointing at
 * an id that no longer resolves: 1,619 such rows in the dev database, 15.5% of
 * all relation values, every one of them on a page a user can open today.
 *
 * **Why a shared function and not a hook.** This exact defect was already
 * diagnosed and fixed once — for `'tags'` only, via
 * `registerEntityPreDeleteHooks('tags', …)` — which left ~40 other entity types
 * leaking. The fix has to be keyed off the mechanism (a record is going away),
 * not off a registration list, or it drifts the same way again.
 *
 * **Sweep, not guard.** The tag fix *refuses* the delete while references
 * exist. That is right for tags and wrong as a general rule: refusing to delete
 * a contact because a ticket points at it makes deletion impossible in normal
 * use. Here the delete succeeds and the references are pruned. Unlike a merge
 * (`resources/merge/merge-service.ts`, which repoints `relatedEntityId` to the
 * winner) there is no winner to repoint to.
 *
 * Every statement is org-scoped. Run it inside the caller's transaction,
 * alongside the row deletion it belongs to.
 *
 * Order matters: the display cascade runs FIRST because it locates dependents
 * through the very rows the sweep then deletes.
 */
export async function sweepEntityFieldValues(
  db: Database | Transaction,
  params: SweepEntityFieldValuesParams
): Promise<SweepEntityFieldValuesResult> {
  const { organizationId, entityType, includeOutbound = true } = params
  const entityIds = [...new Set(params.entityIds)]
  if (entityIds.length === 0) {
    return { outboundDeleted: 0, inboundDeleted: 0, holderIds: [] }
  }

  // 1. Dependent display columns. A record whose displayName is projected from
  //    a relationship to a deleted record holds a stale copy of that record's
  //    name in a plain column; nothing else ever clears it.
  if (entityType) {
    const deps = await getDisplayFieldDeps(organizationId, entityType)
    if (deps.length > 0) {
      for (const entityId of entityIds) {
        await cascadeDependentDisplayNames({ db, organizationId }, entityId, null, deps)
      }
    }
  }

  // 2. The mirror half — the rows this whole function exists for. Served by
  //    `FieldValue_relatedEntityId_idx`.
  const inbound = await db
    .delete(schema.FieldValue)
    .where(
      and(
        inArray(schema.FieldValue.relatedEntityId, entityIds),
        eq(schema.FieldValue.organizationId, organizationId)
      )
    )
    .returning({ entityId: schema.FieldValue.entityId })

  // 3. The dead records' own values.
  let outboundDeleted = 0
  if (includeOutbound) {
    const outbound = await db
      .delete(schema.FieldValue)
      .where(
        and(
          inArray(schema.FieldValue.entityId, entityIds),
          eq(schema.FieldValue.organizationId, organizationId)
        )
      )
      .returning({ id: schema.FieldValue.id })
    outboundDeleted = outbound.length
  }

  // 4. `EntityInstance.searchText` is materialized and recomputed only on
  //    write, and it folds in the related record's `displayName`. Without this
  //    the deleted record's name stays in every referencing record's search
  //    corpus forever.
  const dead = new Set(entityIds)
  const holderIds = [...new Set(inbound.map((row) => row.entityId))].filter((id) => !dead.has(id))
  for (let i = 0; i < holderIds.length; i += SEARCH_TEXT_BATCH) {
    await updateSearchTextForInstances(
      db,
      organizationId,
      holderIds.slice(i, i + SEARCH_TEXT_BATCH)
    )
  }

  return { outboundDeleted, inboundDeleted: inbound.length, holderIds }
}
