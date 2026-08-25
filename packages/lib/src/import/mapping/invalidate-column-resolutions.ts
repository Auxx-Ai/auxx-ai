// packages/lib/src/import/mapping/invalidate-column-resolutions.ts

import type { Transaction } from '@auxx/database'
import { schema } from '@auxx/database'
import { inArray } from 'drizzle-orm'

/**
 * Drop the cached value resolutions for one or more mapped columns.
 *
 * 🛑 **This is what makes a mapping change take effect.** `processColumnValues`
 * looks every distinct value up in `ImportValueResolution` by
 * `(importJobPropertyId, hashedValue)` FIRST and only resolves the misses, so a
 * column whose rows already exist is skipped wholesale on the next run. The row
 * carries the resolved value, not the type that produced it — switching a
 * Category column from `select:value` to `select:create` therefore re-ran the
 * job, hit the cache for every value, and left the stored
 * `error: No matching option` exactly where it was. The picker looks broken
 * while being wired correctly; the stale rows are the whole reason.
 *
 * `resolveValuesJob` is re-triggered on its own — every mapping write resets
 * `ImportJob.allowPlanGeneration`, and the review step re-queues the job when it
 * sees that — so clearing the cache is the only missing half.
 *
 * The column's `ImportJobProperty` row is KEPT (its `(jobId, mappingPropertyId)`
 * pair is unique and the job re-uses it) with its tallies zeroed, so the review
 * sidebar reads "0 unique values" rather than the pre-change counts until the
 * re-run lands.
 *
 * Any user override on those values goes with them. That is correct rather than
 * unfortunate: an override is a correction of one *interpretation* of the cell,
 * and the interpretation is what just changed.
 *
 * @param tx - Open transaction (this always runs with the mapping row locked)
 * @param mappingPropertyIds - `ImportMappingProperty.id`s whose columns changed
 */
export async function invalidateColumnResolutions(
  tx: Transaction,
  mappingPropertyIds: Array<string | undefined | null>
): Promise<void> {
  const propertyIds = mappingPropertyIds.filter((id): id is string => !!id)
  if (propertyIds.length === 0) return

  const jobProperties = await tx
    .select({ id: schema.ImportJobProperty.id })
    .from(schema.ImportJobProperty)
    .where(inArray(schema.ImportJobProperty.importMappingPropertyId, propertyIds))

  const jobPropertyIds = jobProperties.map((row) => row.id).filter((id): id is string => !!id)
  if (jobPropertyIds.length === 0) return

  await tx
    .delete(schema.ImportValueResolution)
    .where(inArray(schema.ImportValueResolution.importJobPropertyId, jobPropertyIds))

  await tx
    .update(schema.ImportJobProperty)
    .set({ uniqueValueCount: 0, resolvedCount: 0, errorCount: 0, updatedAt: new Date() })
    .where(inArray(schema.ImportJobProperty.id, jobPropertyIds))
}
