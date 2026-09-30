// packages/lib/src/inventory/movements/delete-movements.ts

import type { Transaction } from '@auxx/database'
import { sql } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import { BadRequestError } from '../../errors'
import { deleteMovementFacts } from './fact/writes'
import { guard } from './guard'
import type { StockMovementTouched } from './types'
import { touchedBy } from './write-movements'

/** The parent documents whose movements go with them. At least one list must be non-empty. */
export interface DeleteMovementsForInput {
  partIds?: readonly string[]
  purchaseOrderLineIds?: readonly string[]
  fulfillmentLineIds?: readonly string[]
}

/** What a parent delete removed, and the surviving parts and lines to settle after the commit. */
export interface DeleteMovementsForResult {
  deletedIds: string[]
  /** Excludes the parents named in the input: they are being deleted too. */
  touched: StockMovementTouched
}

/**
 * Delete a parent's movements with their BOM children, their reversals and their facts, inside the
 * caller's transaction (plan 20 S9). The caller runs its settled-period guard first, and passes
 * `touched` to `settleStockMovements` after the commit so surviving parts and lines re-derive.
 */
export async function deleteMovementsFor(
  tx: Transaction,
  organizationId: string,
  input: DeleteMovementsForInput
): Promise<Result<DeleteMovementsForResult, Error>> {
  return guard(
    async () => {
      const partIds = [...new Set(input.partIds ?? [])]
      const poLineIds = [...new Set(input.purchaseOrderLineIds ?? [])]
      const flIds = [...new Set(input.fulfillmentLineIds ?? [])]
      if (partIds.length + poLineIds.length + flIds.length === 0) {
        throw new BadRequestError('Name at least one parent whose movements to delete')
      }

      const anyOf = (column: string, ids: string[]) =>
        ids.length === 0
          ? sql`false`
          : sql`${sql.identifier(column)} IN (${sql.join(
              ids.map((id) => sql`${id}`),
              sql`, `
            )})`

      // One statement, so the self-referencing FKs (children, reversals) are checked after every
      // row is gone; the recursive CTE collects rows that point at a doomed row, at any depth.
      const deleted = await tx.execute<{
        id: string
        partId: string
        purchaseOrderLineId: string | null
        fulfillmentLineId: string | null
        buildId: string | null
      }>(sql`
        WITH RECURSIVE doomed(id) AS (
          SELECT id FROM "StockMovement"
          WHERE "organizationId" = ${organizationId}
            AND (${anyOf('partId', partIds)} OR ${anyOf('purchaseOrderLineId', poLineIds)}
              OR ${anyOf('fulfillmentLineId', flIds)})
          UNION
          SELECT m.id FROM "StockMovement" m
          JOIN doomed d ON m."parentMovementId" = d.id OR m."reversesMovementId" = d.id
        )
        DELETE FROM "StockMovement"
        WHERE id IN (SELECT id FROM doomed)
        RETURNING id, "partId", "purchaseOrderLineId", "fulfillmentLineId", "buildId"
      `)
      const rows = deleted.rows
      const deletedIds = rows.map((row) => row.id)
      await deleteMovementFacts(tx, deletedIds)

      const all = touchedBy(rows)
      const without = (ids: string[], gone: string[]) => ids.filter((id) => !gone.includes(id))
      return {
        deletedIds,
        touched: {
          partIds: without(all.partIds, partIds),
          purchaseOrderLineIds: without(all.purchaseOrderLineIds, poLineIds),
          fulfillmentLineIds: without(all.fulfillmentLineIds, flIds),
          buildIds: all.buildIds,
        },
      }
    },
    'Failed to delete stock movements',
    { organizationId }
  )
}
