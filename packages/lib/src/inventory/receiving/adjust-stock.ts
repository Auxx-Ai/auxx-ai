// packages/lib/src/inventory/receiving/adjust-stock.ts

/**
 * The hand-keyed count correction - the THIRD movement writer
 * (plans/purchasing/05-receiving-cost-and-corrections.md section 1.5).
 *
 * Receiving was designed around two doors, both of which go through
 * `receiveStock` and its zero-cost guard. The Adjust Stock popover was a third,
 * and it went through the generic `record.create` instead: `type: 'adjust'`, a
 * quantity, and nothing else. No `unit_cost`, no `extended_cost`, no
 * `gl_account`, no `cost_basis`, and no guard - so a positive adjustment added
 * stock valued at nothing, which understates COGS and drags the part's average
 * cost toward zero.
 *
 * `receive-stock.ts` argues a zero-cost row is worse than a missing one
 * "because it looks like data", and claims the rule "generalises to every
 * movement writer". This file is what makes that claim true.
 *
 * No permission checks: `purchasing.adjustStock` asserts edit on the part
 * before calling, the same contract the sibling writers state.
 */

import type { Database, Transaction } from '@auxx/database'
import { roundMinorUnits } from '@auxx/utils/currency'
import type { Result } from 'neverthrow'
import { postInventoryDocumentInTx } from '../../accounting/ledger/post/post-inventory-document'
import { exportInventoryMovement } from '../../accounting/ledger/post/post-inventory-movement'
import { upsertWorkItem } from '../../accounting/work-items/write'
import { BadRequestError, UnprocessableEntityError } from '../../errors'
import { StockMovementCostBasis, StockMovementType } from '../../resources/registry/enum-values'
import { settleStockMovements, writeStockMovements } from '../movements'
import { resolveInventoryRoleForPartKind } from '../movements/client'
import type { MovementRecord, StockMovementTouched } from '../movements/types'
import { guard } from './guard'
import { readPartKind, readPartStandardCost } from './receipt-queries'
import type { AdjustStockInput } from './types'

/** What every adjustment stamps beyond the bare count change. */
interface AdjustmentCost {
  /** The part's frozen `part_standard_cost`, rounded, minor units; `null` when it has none (pending, 111 Q18). */
  unitCost: number | null
  /** The inventory account ROLE ('inventory_raw_materials'), never a code and never a provider id. */
  glRole: string
  /** For the work item a pending adjustment parks. */
  displayName: string | null
}

/**
 * Correct a part's on-hand count by a signed delta.
 *
 * The order of the steps is the contract, not an implementation detail:
 *
 * 1. `quantity` is a finite, non-zero number, or `BadRequestError`.
 * 2. Resolve the part's STANDARD cost - in both directions. A part with none
 *    is not refused: the movement is written `pending` (111 Q18).
 * 3. Write one movement, `type: 'adjust'`, `cost_basis: standard`, with
 *    `unit_cost`, `extended_cost` and `gl_account` stamped whichever way the
 *    count went - or `cost_basis: pending` with no cost keys and the account,
 *    parked at stage `price` until the pricer fills it.
 *
 * 🛑 **Both directions carry a cost, and it is the SERVER's number.** This is
 * decision `G12` and it reverses two earlier behaviours that were both wrong:
 *
 * - A **positive** adjustment used to demand a user-entered `unitCost` and
 *   stamp `cost_basis: actual`. But an adjustment has no supplier row, no
 *   purchase order and no packing slip - there is no ACTUAL to record. What the
 *   found units are worth is what the system says a unit of that part is worth,
 *   which is `part_standard_cost`. Asking a person to type it invited a
 *   different answer every time and made the ledger's valuation depend on who
 *   was counting.
 * - A **negative** adjustment used to stamp NO cost at all - no `unit_cost`, no
 *   `extended_cost`, no `gl_account`. That is the worse of the two: a shrinkage
 *   carrying no cost is invisible to every period total that sums the ledger,
 *   so the L1 month-end assertion absorbs it into the COGS plug. `G12` exists
 *   to keep count variance separate from purchase price variance, and a
 *   valueless row cannot be separated from anything.
 *
 * 🛑 **A part with no standard cost writes a PENDING row, never a zero and never
 * `part_cost`.** The live part cost is a replacement price, rewritten on every
 * vendor-price change, and must never value a movement (architecture guide
 * section 11, rule 2); a zero is the exact defect `receiveStock` refuses. The
 * count moves now, the cost lands once on the same row when the standard does.
 *
 * ⚠️ **This is a write-path change on an append-only ledger.** A
 * `StockMovement` row is never updated, so movements written before this
 * carry the old costing - a positive `adjust` at a hand-typed `actual` cost, a
 * negative one at no cost at all - and they CANNOT be back-filled. That is the
 * price of the append-only rule, and reversing them would change quantities
 * that are correct. Read a period that spans the change knowing the earlier
 * rows are shaped differently.
 */
export async function adjustStock(
  db: Database,
  organizationId: string,
  userId: string,
  input: AdjustStockInput
): Promise<Result<MovementRecord, Error>> {
  return guard(
    async () => {
      assertAdjustableQuantity(input.quantity)

      const cost = await resolveAdjustmentCost(db, organizationId, input.partId)

      // The movement and its entry commit together: an adjustment whose row
      // landed and whose entry did not is a count variance nobody can see.
      const { written, touched, post } = await db.transaction(async (tx) => {
        const { record, touched } = await writeAdjustMovement(tx, organizationId, userId, {
          input,
          cost,
          occurredAt: input.occurredAt ?? new Date(),
        })
        return {
          written: record,
          touched,
          // The adjustment movement IS the document (`G12`: its counter-leg is count variance,
          // never purchase price variance). A pending row posts nothing; the pricer posts it.
          post:
            record.extendedCost != null
              ? await postInventoryDocumentInTx(
                  tx,
                  organizationId,
                  [
                    {
                      id: record.id,
                      partInstanceId: record.partInstanceId,
                      type: StockMovementType.ADJUST,
                      quantity: record.quantity,
                      extendedCost: record.extendedCost,
                      glRole: record.glRole,
                      occurredAt: record.occurredAt,
                    },
                  ],
                  { actorUserId: userId, memo: input.reason }
                )
              : null,
        }
      })

      await settleStockMovements(organizationId, touched)
      await exportInventoryMovement(db, post)
      if (written.unitCost == null) await parkPendingAdjustment(db, organizationId, written, cost)
      return written
    },
    'Failed to adjust stock',
    { organizationId, partId: input.partId, quantity: input.quantity }
  )
}

/**
 * Step 1: the delta must be a finite, non-zero number.
 *
 * `Number.isFinite` is checked as well as the sign for the same reason
 * `assertReceivableQuantity` checks it: `NaN !== 0` is true, and an `Infinity`
 * quantity multiplies into an `extendedCost` of `Infinity` that `Math.round`
 * happily preserves - a value the `doublePrecision` column accepts and every
 * later `SUM` is then poisoned by.
 *
 * Zero is refused rather than silently ignored. An adjustment of zero is a row
 * in an append-only ledger that corrects nothing, and a caller that sent one is
 * either mis-wired or asking a question ("set to the count it already has") the
 * answer to which is "nothing to do" - which the caller, not the ledger, should
 * record.
 */
function assertAdjustableQuantity(quantity: number): void {
  if (!Number.isFinite(quantity)) {
    throw new BadRequestError('Adjustment quantity must be a finite number')
  }
  if (quantity === 0) {
    throw new BadRequestError(
      'An adjustment of zero changes nothing. Enter the difference between the count and the system.'
    )
  }
}

/**
 * Step 2: read the part's frozen standard cost; `null` when it has none.
 *
 * Rounding is applied BEFORE the zero check so a sub-half-cent standard
 * cost is rejected here rather than stored as a zero the ledger cannot explain -
 * the same ordering `resolveReceiptPrice` uses, and for the same reason.
 *
 * Runs for a REMOVAL as well as an addition: `G12` values both directions.
 */
async function resolveAdjustmentCost(
  db: Database,
  organizationId: string,
  partId: string
): Promise<AdjustmentCost> {
  // First, so a service refuses as a service rather than as a part missing a standard.
  const kind = await readPartKind(db, organizationId, partId)
  if (kind.isErr()) throw kind.error
  const glRole = resolveInventoryRoleForPartKind(kind.value)

  const standard = await readPartStandardCost(db, organizationId, partId)
  if (standard.isErr()) throw standard.error

  const { standardCost, displayName } = standard.value
  const partLabel = displayName ? `"${displayName}"` : `part ${partId}`

  // No standard yet: the row goes pending, and the pricer values it when one lands (111 Q18).
  if (standardCost == null) return { unitCost: null, glRole, displayName }
  if (!Number.isFinite(standardCost)) {
    throw new UnprocessableEntityError(
      `Cannot adjust ${partLabel}: its standard cost is not a number. Roll standard cost for this part first.`,
      { partId }
    )
  }

  const unitCost = roundMinorUnits(standardCost)
  // A stored $0 is a real standard and adjusts at $0 (103 §5a); a positive one must not round to it.
  if (unitCost < 0 || (unitCost === 0 && standardCost !== 0)) {
    throw new UnprocessableEntityError(
      `Cannot adjust ${partLabel}: its standard cost rounds to zero. A movement written at zero cost sums into the inventory balance as nothing and cannot be told apart from a genuinely free part. Roll standard cost for this part first.`,
      { partId }
    )
  }

  return { unitCost, glRole, displayName }
}

/** The Blocked surface for a pending adjustment: one `price` item on the movement, grouped by its part. */
async function parkPendingAdjustment(
  db: Database,
  organizationId: string,
  written: MovementRecord,
  cost: AdjustmentCost
): Promise<void> {
  await upsertWorkItem(db, organizationId, {
    sourceKind: 'stock_movement',
    sourceId: written.id,
    stage: 'price',
    reasonCode: 'STANDARD_COST_MISSING',
    externalRef: written.partInstanceId,
    detail: {
      partIds: [written.partInstanceId],
      pendingMovementIds: [written.id],
      ...(cost.displayName ? { partName: cost.displayName } : {}),
    },
  })
}

interface WriteAdjustMovementArgs {
  input: AdjustStockInput
  /** `G12` values a removal exactly as it values an addition; a null cost is pending in both directions. */
  cost: AdjustmentCost
  occurredAt: Date
}

/**
 * Step 3: write the one movement. The cost fields are stamped together or not at all: a part with no standard
 * writes `cost_basis: pending` and no cost keys (111 Q18), never a zero.
 *
 * 🛑 **`adjustSubparts` is never set here.** The BOM explosion inherits the
 * parent movement's type AND its sign, so an adjustment with the flag set would cascade the correction through the bill of
 * materials: "add 10" of a finished good would increase every component's stock
 * as well, so the assembly and the parts it consumed both go up - the opposite
 * of what building one does. An adjustment is a count correction and must never
 * cascade; explosion belongs to a movement that knows its own direction
 * (plans/products/11-costing-and-stock-improvements.md section 5.3).
 */
async function writeAdjustMovement(
  tx: Transaction,
  organizationId: string,
  userId: string,
  args: WriteAdjustMovementArgs
): Promise<{ record: MovementRecord; touched: StockMovementTouched }> {
  const { input, cost, occurredAt } = args
  const quantity = input.quantity

  const written = await writeStockMovements({ db: tx, organizationId, userId }, [
    {
      partInstanceId: input.partId,
      type: StockMovementType.ADJUST,
      quantity,
      unitCost: cost.unitCost,
      // `standard`, not `actual`: this is the part's frozen
      // `part_standard_cost`, read by the server. An adjustment has no
      // supplier and no invoice, so there is no ACTUAL for it to record
      // (`G12`).
      costBasis:
        cost.unitCost == null ? StockMovementCostBasis.PENDING : StockMovementCostBasis.STANDARD,
      glRole: cost.glRole,
      occurredAt,
      reason: input.reason,
      reference: input.reference,
    },
  ])
  if (written.isErr()) throw written.error
  const record = written.value.records[0]!

  return {
    record: {
      id: record.id,
      partInstanceId: input.partId,
      quantity,
      unitCost: cost.unitCost,
      extendedCost: record.extendedCost,
      // A count correction, not a purchase: no supplier, no order.
      vendorUnitPrice: null,
      vendorPartId: null,
      glRole: cost.glRole,
      occurredAt,
      purchaseOrderLineId: null,
    },
    touched: written.value.touched,
  }
}
