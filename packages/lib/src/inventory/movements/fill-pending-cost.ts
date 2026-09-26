// packages/lib/src/inventory/movements/fill-pending-cost.ts

// The ONE lane that writes a cost onto a `pending` stock movement, once (111 Q18; inventory guide §7.4).
// Rows are claimed `FOR UPDATE` in the same transaction as the write, so two concurrent pricers never fill one row twice.

import type { Database, Transaction } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { roundMinorUnits } from '@auxx/utils/currency'
import type { Result } from 'neverthrow'
import { getOrgCache, requireCachedEntityDefId } from '../../cache'
import { BadRequestError, NotFoundError, UnprocessableEntityError } from '../../errors'
import { UnifiedCrudHandler } from '../../resources/crud/unified-handler'
import { quietSession } from '../../resources/crud/write-origin'
import { StockMovementCostBasis } from '../../resources/registry/enum-values'
import { type RecordId, toRecordId } from '../../resources/resource-id'
import { readSystemRecords, systemFieldMap } from '../../resources/system-records'
import { claimPendingMovements } from './claim-pending'
import { computeExtendedCost } from './client'
import { guard } from './guard'

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
  glAccount: string | null
  occurredAt: Date | null
}

const FILL_ATTRIBUTES = [
  'stock_movement_part',
  'stock_movement_quantity',
  'stock_movement_cost_basis',
  'stock_movement_unit_cost',
  'stock_movement_extended_cost',
  'stock_movement_gl_account',
  'stock_movement_occurred_at',
] as const

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

      const movementDefId = await requireCachedEntityDefId(organizationId, 'stock_movement')
      const fields = await systemFieldMap(db, organizationId, [...FILL_ATTRIBUTES])
      if (
        !fields.stock_movement_quantity ||
        !fields.stock_movement_cost_basis ||
        !fields.stock_movement_unit_cost ||
        !fields.stock_movement_extended_cost
      ) {
        throw new UnprocessableEntityError(
          'Pricing is not available until the stock movement cost fields are provisioned'
        )
      }

      const records = await readSystemRecords(
        db,
        organizationId,
        { defId: movementDefId, fields },
        { ids: [...costByMovement.keys()] }
      )
      const byId = new Map(records.map((record) => [record.id, record]))
      const missing = [...costByMovement.keys()].filter((id) => !byId.has(id))
      if (missing.length > 0) {
        throw new NotFoundError('Stock movements not found', { movementIds: missing })
      }
      const userId = await getOrgCache().get(organizationId, 'systemUser')
      const basisFieldId = fields.stock_movement_cost_basis.id
      return db.transaction(async (tx: Transaction) => {
        const claimed = await claimPendingMovements(
          tx,
          organizationId,
          basisFieldId,
          records.map((record) => record.id)
        )
        if (claimed.size < records.length) {
          logger.info('Skipped stock movements no longer pending', {
            organizationId,
            skipped: records.length - claimed.size,
          })
        }
        const crud = new UnifiedCrudHandler(
          organizationId,
          userId,
          tx as unknown as Database,
          undefined,
          {
            session: quietSession(FILL_PENDING_COST_REASON),
          }
        )

        const filled: FilledStockMovement[] = []
        for (const record of records) {
          if (!claimed.has(record.id)) continue
          const quantity = record.number('stock_movement_quantity')
          if (quantity == null || !Number.isFinite(quantity)) {
            throw new UnprocessableEntityError(
              `Stock movement ${record.id} has no quantity and cannot be priced`
            )
          }
          const unitCost = costByMovement.get(record.id)!
          // `|| 0`: a $0 standard on a negative quantity rounds to `-0`.
          const extendedCost = computeExtendedCost(unitCost, quantity) || 0
          await crud.update(toRecordId(movementDefId, record.id) as RecordId, {
            stock_movement_unit_cost: unitCost,
            stock_movement_extended_cost: extendedCost,
            stock_movement_cost_basis: StockMovementCostBasis.STANDARD,
          })
          const occurredAt = record.date('stock_movement_occurred_at')
          filled.push({
            movementId: record.id,
            partInstanceId: record.related('stock_movement_part') ?? '',
            quantity,
            unitCost,
            extendedCost,
            glAccount: record.text('stock_movement_gl_account'),
            occurredAt: occurredAt ? new Date(occurredAt) : null,
          })
        }
        return filled
      })
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
