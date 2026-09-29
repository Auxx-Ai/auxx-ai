// packages/lib/src/inventory/movements/fill-pending-cost.ts

// The ONE lane that writes a cost onto a `pending` stock movement, once (111 Q18; inventory guide §7.4).
// The `costBasis = 'pending'` predicate on the UPDATE is the claim, so two concurrent pricers never fill one row twice.

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { roundMinorUnits } from '@auxx/utils/currency'
import type { Result } from 'neverthrow'
import { BadRequestError, NotFoundError } from '../../errors'
import { guard } from './guard'
import { readMovementsByIds } from './reads'
import { fillPendingMovementCosts } from './update-movements'

const logger = createScopedLogger('inventory-movements:fill-pending')

/** The prose recorded on every silent fill. Greppable, and the audit trail. */
export const FILL_PENDING_COST_REASON =
  'pricing fills the cost onto a pending stock movement once its part has a standard'

/** One pending row and the standard it is priced at, minor units at `RATE_DECIMALS`. */
export interface PendingCostFill {
  movementId: string
  unitCost: number
}

/** One row as it now stands: every money field is the value stored. */
export interface FilledStockMovement {
  movementId: string
  partInstanceId: string
  quantity: number
  unitCost: number
  /** `round(unitCost x quantity)`, signed like `quantity`. */
  extendedCost: number
  glRole: string | null
  occurredAt: Date | null
}

/**
 * Price the rows still `pending` and return only those; a row another pass already priced is skipped.
 * Refuses the whole batch when a row is missing or named twice. A `unitCost` of 0 is a real cost (103 §5a).
 */
export async function fillPendingCost(
  db: Database,
  organizationId: string,
  rows: readonly PendingCostFill[]
): Promise<Result<FilledStockMovement[], Error>> {
  return guard(
    async () => {
      if (rows.length === 0) return []
      const costByMovement = resolveCosts(rows)

      const ids = [...costByMovement.keys()]
      const found = new Set(
        (await readMovementsByIds(db, organizationId, ids)).map((row) => row.id)
      )
      const missing = ids.filter((id) => !found.has(id))
      if (missing.length > 0) {
        throw new NotFoundError('Stock movements not found', { movementIds: missing })
      }

      const filled = await db.transaction((tx) =>
        fillPendingMovementCosts(
          tx,
          organizationId,
          ids.map((id) => ({ id, unitCostMinor: costByMovement.get(id)! }))
        )
      )
      if (filled.length < ids.length) {
        logger.info('Skipped stock movements no longer pending', {
          organizationId,
          skipped: ids.length - filled.length,
        })
      }
      return filled.map((row) => ({
        movementId: row.id,
        partInstanceId: row.partId,
        quantity: row.quantity,
        unitCost: row.unitCostMinor,
        extendedCost: row.extendedCostMinor,
        glRole: row.glRole,
        occurredAt: row.occurredAt,
      }))
    },
    'Failed to price pending stock movements',
    { organizationId, count: rows.length }
  )
}

/** Each row's cost at rate precision, keyed by movement; a duplicate or an unusable cost refuses the batch. */
function resolveCosts(rows: readonly PendingCostFill[]): Map<string, number> {
  const costs = new Map<string, number>()
  for (const row of rows) {
    if (costs.has(row.movementId)) {
      throw new BadRequestError(
        `Stock movement ${row.movementId} is named twice in one pricing pass`
      )
    }
    if (!Number.isFinite(row.unitCost) || row.unitCost < 0) {
      throw new BadRequestError(
        'A standard cost must be zero or a positive amount in minor units',
        {
          movementId: row.movementId,
        }
      )
    }
    costs.set(row.movementId, roundMinorUnits(row.unitCost))
  }
  return costs
}
