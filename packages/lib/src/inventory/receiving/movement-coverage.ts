// packages/lib/src/inventory/receiving/movement-coverage.ts
// Which parts have ever moved, and which carry an `initial`, without scanning every movement.

import { type Database, schema } from '@auxx/database'
import { and, eq, exists } from 'drizzle-orm'
import { getCachedEntityDefId } from '../../cache'
import { StockMovementType } from '../../resources/registry/enum-values'

/** Every part with at least one stock movement. */
export async function readPartsWithMovements(
  db: Database,
  organizationId: string
): Promise<Set<string>> {
  const partDefId = await getCachedEntityDefId(organizationId, 'part')
  if (!partDefId) return new Set()

  // Driven from the parts: one `(partId, effectiveAt)` probe each, instead of every movement row.
  const part = schema.EntityInstance
  const t = schema.StockMovement
  const rows = await db
    .select({ id: part.id })
    .from(part)
    .where(
      and(
        eq(part.organizationId, organizationId),
        eq(part.entityDefinitionId, partDefId),
        exists(
          db
            .select({ id: t.id })
            .from(t)
            .where(and(eq(t.partId, part.id), eq(t.organizationId, organizationId)))
        )
      )
    )
  return new Set(rows.map((row) => row.id))
}

/** Every part with at least one `initial` movement. */
export async function readPartsWithInitialMovement(
  db: Database,
  organizationId: string
): Promise<Set<string>> {
  const t = schema.StockMovement
  const rows = await db
    .selectDistinct({ partId: t.partId })
    .from(t)
    .where(and(eq(t.organizationId, organizationId), eq(t.type, StockMovementType.INITIAL)))
  return new Set(rows.map((row) => row.partId))
}
