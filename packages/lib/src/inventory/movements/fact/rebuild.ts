// packages/lib/src/inventory/movements/fact/rebuild.ts

import { type Database, schema } from '@auxx/database'
import { asc, eq } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import { guard } from '../guard'
import { type ConsumptionClass, classifyMovement } from './classify'
import {
  deleteOrganizationMovementFacts,
  insertMovementFacts,
  type MovementFactInput,
} from './writes'

/** A mirror row before its class is known, since a reversal's class is its original's. */
type UnclassifiedFact = Omit<MovementFactInput, 'consumptionClass'>

/** Second pass: classify every row, a reversal through its original's class (chains walked, cycles cut). */
export function classifyFacts(rows: readonly UnclassifiedFact[]): MovementFactInput[] {
  const byId = new Map(rows.map((row) => [row.id, row]))
  const classes = new Map<string, ConsumptionClass>()
  const resolve = (row: UnclassifiedFact, seen: Set<string>): ConsumptionClass => {
    const known = classes.get(row.id)
    if (known) return known
    seen.add(row.id)
    const original = row.reversesMovementId ? byId.get(row.reversesMovementId) : undefined
    const reversesClass = original && !seen.has(original.id) ? resolve(original, seen) : undefined
    const result = classifyMovement(row.type, {
      reversesClass,
      parentMovementId: row.parentMovementId,
      isSalvage: !row.reversesMovementId,
    })
    classes.set(row.id, result)
    return result
  }
  return rows.map((row) => ({ ...row, consumptionClass: resolve(row, new Set()) }))
}

/** Replace an org's mirror with a replay of every `StockMovement` row. */
export async function rebuildMovementFacts(
  db: Database,
  organizationId: string
): Promise<Result<{ inserted: number }, Error>> {
  return guard(
    async () =>
      db.transaction(async (tx) => {
        await deleteOrganizationMovementFacts(tx, organizationId)
        const t = schema.StockMovement
        const unclassified: UnclassifiedFact[] = await tx
          .select({
            id: t.id,
            partId: t.partId,
            type: t.type,
            quantity: t.quantity,
            occurredAt: t.occurredAt,
            createdAt: t.createdAt,
            reversesMovementId: t.reversesMovementId,
            parentMovementId: t.parentMovementId,
            buildId: t.buildId,
            fulfillmentLineId: t.fulfillmentLineId,
            purchaseOrderLineId: t.purchaseOrderLineId,
          })
          .from(t)
          .where(eq(t.organizationId, organizationId))
          .orderBy(asc(t.effectiveAt), asc(t.id))
        const inserted = await insertMovementFacts(tx, organizationId, classifyFacts(unclassified))
        return { inserted }
      }),
    'Failed to rebuild the movement mirror',
    { organizationId }
  )
}
