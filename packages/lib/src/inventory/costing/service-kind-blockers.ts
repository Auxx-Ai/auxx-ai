// packages/lib/src/inventory/costing/service-kind-blockers.ts

import { type Database, schema } from '@auxx/database'
import { and, eq, inArray } from 'drizzle-orm'
import { getOrgCache } from '../../cache'

/** Relations that make a part a stocked thing, in the order their reason wins. */
const BLOCKERS = [
  ['stock_movement_part', 'it has stock movements'],
  ['build_part', 'it has builds'],
  ['subpart_parent_part', 'it has a bill of materials'],
  ['subpart_child_part', "it is a component in another part's bill of materials"],
] as const

/**
 * Why each of `partIds` cannot become a `service` (107 F3), keyed by part instance id.
 * Archived movements, builds and BOM lines count. Parts with no blocker are absent.
 */
export async function readServiceKindBlockers(
  db: Database,
  organizationId: string,
  partIds: readonly string[]
): Promise<Map<string, string>> {
  const blockers = new Map<string, string>()
  const unique = [...new Set(partIds.filter(Boolean))]
  if (unique.length === 0) return blockers

  const fields = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes(BLOCKERS.map(([attribute]) => attribute))
  const reasonByFieldId = new Map<string, string>()
  for (const [attribute, reason] of BLOCKERS) {
    const field = fields[attribute]
    if (field) reasonByFieldId.set(field.id, reason)
  }
  if (reasonByFieldId.size === 0) return blockers

  const rows = await db
    .selectDistinct({
      partId: schema.FieldValue.relatedEntityId,
      fieldId: schema.FieldValue.fieldId,
    })
    .from(schema.FieldValue)
    .innerJoin(schema.EntityInstance, eq(schema.EntityInstance.id, schema.FieldValue.entityId))
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        inArray(schema.FieldValue.fieldId, [...reasonByFieldId.keys()]),
        inArray(schema.FieldValue.relatedEntityId, unique)
      )
    )

  const found = new Map<string, Set<string>>()
  for (const row of rows) {
    if (!row.partId) continue
    const set = found.get(row.partId) ?? new Set<string>()
    set.add(row.fieldId)
    found.set(row.partId, set)
  }
  for (const [partId, fieldIds] of found) {
    const reason = [...reasonByFieldId].find(([fieldId]) => fieldIds.has(fieldId))?.[1]
    if (reason) blockers.set(partId, reason)
  }
  return blockers
}

/** The refusal sentence for one part, from a {@link readServiceKindBlockers} reason. */
export function serviceKindRefusal(reason: string): string {
  return `This part cannot become a service because ${reason}. A service is never stocked.`
}
