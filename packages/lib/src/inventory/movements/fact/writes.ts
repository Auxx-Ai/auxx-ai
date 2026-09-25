// packages/lib/src/inventory/movements/fact/writes.ts

import { type Database, schema, type Transaction } from '@auxx/database'
import { eq, inArray } from 'drizzle-orm'
import { chunkArray } from '../../../import/utils/chunk-array'
import type { ConsumptionClass } from './classify'

const INSERT_CHUNK = 500

type Db = Database | Transaction

/** One mirror row, keyed by the `stock_movement` instance id; link ids are bare instance ids. */
export interface MovementFactInput {
  id: string
  partId: string
  type: string
  quantity: number
  /** `stock_movement_occurred_at`; `null` falls back to `createdAt`. */
  occurredAt: Date | null
  /** The movement instance's `createdAt`. */
  createdAt: Date
  consumptionClass: ConsumptionClass
  reversesMovementId?: string | null
  parentMovementId?: string | null
  buildId?: string | null
  fulfillmentLineId?: string | null
  purchaseOrderLineId?: string | null
}

/** Insert mirror rows on the caller's connection; a row already present is left alone. Returns how many landed. */
export async function insertMovementFacts(
  tx: Db,
  organizationId: string,
  rows: readonly MovementFactInput[]
): Promise<number> {
  let inserted = 0
  for (const chunk of chunkArray([...rows], INSERT_CHUNK)) {
    const written = await tx
      .insert(schema.InventoryMovementFact)
      .values(
        chunk.map((row) => ({
          id: row.id,
          organizationId,
          partId: row.partId,
          type: row.type,
          quantity: row.quantity,
          occurredAt: row.occurredAt ?? row.createdAt,
          consumptionClass: row.consumptionClass,
          reversesMovementId: row.reversesMovementId ?? null,
          parentMovementId: row.parentMovementId ?? null,
          buildId: row.buildId ?? null,
          fulfillmentLineId: row.fulfillmentLineId ?? null,
          purchaseOrderLineId: row.purchaseOrderLineId ?? null,
        }))
      )
      .onConflictDoNothing({ target: schema.InventoryMovementFact.id })
      .returning({ id: schema.InventoryMovementFact.id })
    inserted += written.length
  }
  return inserted
}

/** Remove the mirror rows of deleted `stock_movement` instances. */
export async function deleteMovementFacts(tx: Db, ids: readonly string[]): Promise<void> {
  for (const chunk of chunkArray([...new Set(ids)], INSERT_CHUNK)) {
    await tx
      .delete(schema.InventoryMovementFact)
      .where(inArray(schema.InventoryMovementFact.id, chunk))
  }
}

/** Remove every mirror row of one organization, ahead of a rebuild. */
export async function deleteOrganizationMovementFacts(
  tx: Db,
  organizationId: string
): Promise<void> {
  await tx
    .delete(schema.InventoryMovementFact)
    .where(eq(schema.InventoryMovementFact.organizationId, organizationId))
}

/** Move a re-anchored `initial` row (accounting/111 Q26), the one update the mirror takes. */
export async function updateMovementFactAnchor(
  tx: Db,
  id: string,
  anchor: { occurredAt: Date; quantity: number }
): Promise<void> {
  await tx
    .update(schema.InventoryMovementFact)
    .set({ occurredAt: anchor.occurredAt, quantity: anchor.quantity })
    .where(eq(schema.InventoryMovementFact.id, id))
}
