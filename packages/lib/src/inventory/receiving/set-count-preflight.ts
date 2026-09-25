// packages/lib/src/inventory/receiving/set-count-preflight.ts

import { type Database, schema } from '@auxx/database'
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import { getOrgCache } from '../../cache'
import { readEarliestMovementAt, readPartNetThrough } from '../costing/dated-reads'
import { readPartInitials } from '../movements/initial-queries'
import { guard } from './guard'

/** What the Set count dialog needs before it writes (111 Q25): the anchor state and the backflush signal. */
export interface SetCountPreflight {
  partId: string
  hasInitial: boolean
  /** Net quantity of every movement to now. */
  netToday: number
  earliest: Date | null
  hasBom: boolean
  /** BOM parts only: the negative replay a backflush would cover, `max(0, −netToday)`. */
  unbuiltSales: number
}

export async function readSetCountPreflight(
  db: Database,
  organizationId: string,
  partIds: readonly string[]
): Promise<Result<SetCountPreflight[], Error>> {
  return guard(
    async () => {
      const unique = [...new Set(partIds.filter(Boolean))]
      if (unique.length === 0) return []
      const [nets, earliests, initials, boms] = await Promise.all([
        readPartNetThrough(organizationId, unique, new Date()),
        readEarliestMovementAt(organizationId, unique),
        readPartInitials(db, organizationId, unique),
        readPartsWithBom(db, organizationId, unique),
      ])
      return unique.map((partId) => {
        const netToday = nets.get(partId) ?? 0
        const hasBom = boms.has(partId)
        return {
          partId,
          hasInitial: initials.has(partId),
          netToday,
          earliest: earliests.get(partId) ?? null,
          hasBom,
          unbuiltSales: hasBom ? Math.max(0, -netToday) : 0,
        }
      })
    },
    'Failed to read the set count preflight',
    { organizationId, partIds: partIds.length }
  )
}

/** Every named part that is the parent of at least one live `subpart` line. */
async function readPartsWithBom(
  db: Database,
  organizationId: string,
  partIds: readonly string[]
): Promise<Set<string>> {
  const parents = new Set<string>()
  const fields = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes(['subpart_parent_part'] as const)
  const parentField = fields.subpart_parent_part
  if (!parentField) return parents

  const rows = await db
    .selectDistinct({ partId: schema.FieldValue.relatedEntityId })
    .from(schema.FieldValue)
    .innerJoin(schema.EntityInstance, eq(schema.EntityInstance.id, schema.FieldValue.entityId))
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.fieldId, parentField.id),
        inArray(schema.FieldValue.relatedEntityId, [...partIds]),
        isNotNull(schema.FieldValue.relatedEntityId),
        isNull(schema.EntityInstance.archivedAt)
      )
    )
  for (const row of rows) if (row.partId) parents.add(row.partId)
  return parents
}
