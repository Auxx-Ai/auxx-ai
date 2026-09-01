// packages/lib/src/field-hooks/pre/related-rows.ts

import { database, schema } from '@auxx/database'
import { and, eq, inArray } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { getCachedEntityDefId, getOrgCache } from '../../cache'

/**
 * Every row of `childType` whose `relationAttribute` names one of
 * `parentInstanceIds` — **archived rows included**.
 *
 * 🛑 **Included, and that is the entire point of this function.** Every delete
 * guard previously asked this question through `UnifiedCrudHandler.listFiltered`,
 * whose paged query hardcodes `isNull(archivedAt)` in the `baseWhere` it shares
 * with its `COUNT(*)` (`unified-handler-queries.ts:692`). So an archived child
 * was invisible to a guard, and that broke the guards in two different
 * directions at once:
 *
 *   - **A refusal under-refused.** `guardPurchaseOrderDelete` asks "does a vendor
 *     bill name this order?". Driven against dev on 2026-08-31 it deleted
 *     `PO-0002` while an ARCHIVED bill still named it — and
 *     `sweepEntityFieldValues` then removed **both halves** of the relation, so
 *     the bill kept an empty Purchase Order cell with no trace an order ever
 *     existed. That is the exact harm
 *     `plans/money/tasks/21-money-parent-delete-safety.md` §0.1 opens with, and
 *     it was caught only by an orphan count moving 1 → 2 in the §8 audit; a
 *     query run afterwards cannot see it, because the evidence is what got
 *     swept.
 *   - **A cascade under-cascaded.** The same blindness leaves an archived
 *     subpart, vendor-part, purchase-order line or bill line behind when its
 *     parent goes — stranding exactly the row the cascade exists to collect.
 *
 * ⚠️ **Archived is not deleted.** `archivedAt` is a soft delete: the row is
 * still in the table, still referenced by the three-way match, and a vendor's
 * bill is still a document the vendor really sent. A guard asking "does
 * anything still depend on this record?" must count it. The guards' own
 * refusal messages say *"archive it instead"* — archiving is the sanctioned way
 * to retire a record, which is precisely why an archived child cannot also mean
 * "nothing depends on this any more".
 *
 * Modelled on {@link import('./guarded-movements').readMovementsByRelation},
 * which reads `EntityInstance ⋈ FieldValue` directly for the same reason. Going
 * through the shared list path instead would mean threading a flag into a query
 * every dashboard, picker and record table also reads.
 *
 * @param childType entity type of the rows to find (e.g. `vendor_bill`)
 * @param relationAttribute the child's systemAttribute holding the relation
 * @param parentInstanceIds entity instance ids of the parents being deleted
 * @returns matching child entity instance ids, de-duplicated. Empty when the
 *   org has no such definition or field, which an org mid-provisioning reaches.
 */
export async function findRelatedInstanceIds(
  organizationId: string,
  childType: string,
  relationAttribute: string,
  parentInstanceIds: readonly string[]
): Promise<string[]> {
  if (parentInstanceIds.length === 0) return []

  const childDefId = await getCachedEntityDefId(organizationId, childType)
  if (!childDefId) return []

  const fields = (await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes([relationAttribute])) as Record<string, { id: string } | null>

  const relationField = fields[relationAttribute]
  if (!relationField) return []

  const relationValue = alias(schema.FieldValue, 'guard_rel')

  const rows = await database
    .select({ id: schema.EntityInstance.id })
    .from(schema.EntityInstance)
    .innerJoin(
      relationValue,
      and(
        eq(relationValue.entityId, schema.EntityInstance.id),
        eq(relationValue.organizationId, schema.EntityInstance.organizationId),
        eq(relationValue.fieldId, relationField.id),
        inArray(relationValue.relatedEntityId, [...parentInstanceIds])
      )
    )
    .where(
      and(
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityInstance.entityDefinitionId, childDefId)
        // NO isNull(archivedAt) — see the docblock. Deliberate.
      )
    )

  return [...new Set(rows.map((row) => row.id))]
}
