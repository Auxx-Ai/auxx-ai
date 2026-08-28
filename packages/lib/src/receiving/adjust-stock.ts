// packages/lib/src/receiving/adjust-stock.ts

/**
 * The hand-keyed count correction — the THIRD movement writer
 * (plans/purchasing/05-receiving-cost-and-corrections.md section 1.5).
 *
 * Receiving was designed around two doors, both of which go through
 * `receiveStock` and its zero-cost guard. The Adjust Stock popover was a third,
 * and it went through the generic `record.create` instead: `type: 'adjust'`, a
 * quantity, and nothing else. No `unit_cost`, no `extended_cost`, no
 * `gl_account`, no `cost_basis`, and no guard — so a positive adjustment added
 * stock valued at nothing, which understates COGS and drags the part's average
 * cost toward zero.
 *
 * `receive-stock.ts` argues a zero-cost row is worse than a missing one
 * "because it looks like data", and claims the rule "generalises to every
 * movement writer". This file is what makes that claim true.
 *
 * Nothing else happens here — quantity on hand is maintained by the existing
 * `mfg-stock-movements-created` rule (`recalculatePartQoH` in
 * `field-hooks/post/inventory-triggers.ts`), and a second writer for it would
 * give the same number two owners.
 *
 * No permission checks: `purchasing.adjustStock` asserts write access on the
 * `stock_movement` def before calling, the same contract the sibling writers
 * state.
 */

import type { Database } from '@auxx/database'
import type { Result } from 'neverthrow'
import { getCachedEntityDefId, requireCachedEntityDefId } from '../cache'
import { BadRequestError, NotFoundError, UnprocessableEntityError } from '../errors'
import { UnifiedCrudHandler } from '../resources/crud/unified-handler'
import { StockMovementCostBasis, StockMovementType } from '../resources/registry/enum-values'
import { toRecordId } from '../resources/resource-id'
import { computeExtendedCost, resolveInventoryRoleForPartKind, roundMinorUnits } from './client'
import { assertCostFieldsMaterialized } from './cost-fields'
import { guard } from './guard'
import { readPartKind } from './receipt-queries'
import type { AdjustStockInput, MovementRecord } from './types'

/** What a costed adjustment stamps beyond the bare count change. */
interface AdjustmentCost {
  /** Whole minor units, strictly positive. */
  unitCost: number
  /** The inventory account CODE ('1310'), never a provider id. */
  glAccount: string
}

/**
 * Correct a part's on-hand count by a signed delta.
 *
 * The order of the steps is the contract, not an implementation detail:
 *
 * 1. `quantity` is a finite, non-zero number, or `BadRequestError`.
 * 2. If it is POSITIVE, resolve and round a strictly positive `unitCost`, or
 *    `UnprocessableEntityError`. Nothing is written when this fails.
 * 3. Write one movement, `type: 'adjust'`, with the cost fields stamped only on
 *    the positive branch.
 *
 * 🛑 **Positive adjustments must carry a cost; negative ones must not.** The
 * asymmetry is deliberate and it is the whole design of this function:
 *
 * - A POSITIVE adjustment creates inventory value out of nothing. Something has
 *   to say what the new units are worth, and the only honest source is the
 *   person keying the count. Writing them at zero is the exact defect
 *   `receiveStock` refuses — a row that sums into the inventory balance as
 *   nothing and that nothing downstream can tell apart from a genuinely free
 *   sample.
 * - A NEGATIVE adjustment consumes value the ledger ALREADY carries. Answering
 *   "at what cost" properly requires a costing method — FIFO, moving average,
 *   specific identification — and this system does not have one yet: nothing
 *   values inventory from the ledger today, and there is no layer table to draw
 *   a consumption cost from. Inventing a method here would freeze a guess onto
 *   a row whose every field is `updatable: false`, and a wrong cost that looks
 *   considered is worse than a missing one that is visibly absent.
 *
 * ⚠️ **This is a known gap, not a finished answer.** When a costing method
 * lands, the removal branch below is where it attaches, and the negative rows
 * written before then will carry no cost that can be back-filled. Until then a
 * removal is a count correction and explicitly not a valuation event.
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

      const partDefId = await requireCachedEntityDefId(organizationId, 'part')
      const movementDefId = await getCachedEntityDefId(organizationId, 'stock_movement')
      if (!movementDefId) {
        throw new NotFoundError('This organization has no stock_movement entity definition')
      }

      const cost =
        input.quantity > 0 ? await resolveAdjustmentCost(db, organizationId, input) : null

      return writeAdjustMovement(db, organizationId, userId, {
        movementDefId,
        partDefId,
        input,
        cost,
        occurredAt: input.occurredAt ?? new Date(),
      })
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
 * happily preserves — a value the `doublePrecision` column accepts and every
 * later `SUM` is then poisoned by.
 *
 * Zero is refused rather than silently ignored. An adjustment of zero is a row
 * in an append-only ledger that corrects nothing, and a caller that sent one is
 * either mis-wired or asking a question ("set to the count it already has") the
 * answer to which is "nothing to do" — which the caller, not the ledger, should
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
 * Step 2: settle a strictly positive unit cost for an ADDITION, then round it.
 *
 * Only ever called on the positive branch — see the asymmetry note on
 * {@link adjustStock}. The cost-field pre-flight runs here rather than at the
 * top of the write for the same reason: a removal stamps no cost fields, so
 * requiring them to be materialised would block a correction that does not need
 * them.
 *
 * Rounding is applied BEFORE the positivity check so a sub-half-cent value is
 * rejected here rather than stored as a zero the ledger cannot explain — the
 * same ordering `resolveReceiptPrice` uses, and for the same reason.
 */
async function resolveAdjustmentCost(
  db: Database,
  organizationId: string,
  input: AdjustStockInput
): Promise<AdjustmentCost> {
  await assertCostFieldsMaterialized(
    organizationId,
    'Adjusting stock is not available until the stock movement cost fields are provisioned'
  )

  const supplied = input.unitCost
  if (supplied == null || !Number.isFinite(supplied)) {
    throw new UnprocessableEntityError(
      'Cannot add stock without a unit cost. Enter what the added units are worth.'
    )
  }

  const unitCost = roundMinorUnits(supplied)
  if (unitCost <= 0) {
    throw new UnprocessableEntityError(
      'Refusing to add stock at zero cost. Enter the price actually paid.'
    )
  }

  const kind = await readPartKind(db, organizationId, input.partId)
  if (kind.isErr()) throw kind.error

  return { unitCost, glAccount: resolveInventoryRoleForPartKind(kind.value) }
}

interface WriteAdjustMovementArgs {
  movementDefId: string
  partDefId: string
  input: AdjustStockInput
  /** `null` on a removal — see the asymmetry note on {@link adjustStock}. */
  cost: AdjustmentCost | null
  occurredAt: Date
}

/**
 * Step 3: write the one movement.
 *
 * Values are keyed by `systemAttribute` and go through `UnifiedCrudHandler`
 * rather than a hand-built `EntityInstance` + `FieldValue` insert — the same
 * mechanism `writeReceiveMovement` and `writeReversal` use, and what makes the
 * post-commit triggers (QoH recalculation, timeline, realtime) fire at all. A
 * direct insert writes rows the rest of the system never hears about, which is
 * precisely how the popover this replaces got away with writing no cost.
 *
 * 🛑 **`adjustSubparts: false` is load-bearing, not a default.**
 * `explodeBomMovement` inherits the parent movement's type AND its sign, so an
 * adjustment with the flag set would cascade the correction through the bill of
 * materials: "add 10" of a finished good would increase every component's stock
 * as well, so the assembly and the parts it consumed both go up — the opposite
 * of what building one does. An adjustment is a count correction and must never
 * cascade; explosion belongs to a movement that knows its own direction
 * (plans/products/11-costing-and-stock-improvements.md section 5.3).
 */
async function writeAdjustMovement(
  db: Database,
  organizationId: string,
  userId: string,
  args: WriteAdjustMovementArgs
): Promise<MovementRecord> {
  const { movementDefId, partDefId, input, cost, occurredAt } = args
  const quantity = input.quantity
  const extendedCost = cost ? computeExtendedCost(cost.unitCost, quantity) : null

  const values: Record<string, unknown> = {
    stock_movement_part: toRecordId(partDefId, input.partId),
    stock_movement_type: StockMovementType.ADJUST,
    stock_movement_quantity: quantity,
    // See the JSDoc above. Never true on an adjustment.
    stock_movement_adjust_subparts: false,
    stock_movement_occurred_at: occurredAt.toISOString(),
  }

  if (cost) {
    // `actual`, not `standard`: this cost is what the person keying the count
    // says the units are worth, not what a standard-cost roll-up expects.
    values.stock_movement_cost_basis = StockMovementCostBasis.ACTUAL
    values.stock_movement_unit_cost = cost.unitCost
    values.stock_movement_extended_cost = extendedCost
    values.stock_movement_gl_account = cost.glAccount
  }

  if (input.reason) values.stock_movement_reason = input.reason
  if (input.reference) values.stock_movement_reference = input.reference

  const crud = new UnifiedCrudHandler(organizationId, userId, db)
  const created = await crud.create(movementDefId, values)

  return {
    movementId: created.instance.id,
    recordId: toRecordId(movementDefId, created.instance.id),
    partInstanceId: input.partId,
    quantity,
    unitCost: cost?.unitCost ?? null,
    extendedCost,
    // An adjustment has no supplier and no purchase order: it is a count
    // correction, not a purchase. Nothing here is withheld — there is nothing
    // to state.
    vendorUnitPrice: null,
    vendorPartId: null,
    glAccount: cost?.glAccount ?? null,
    occurredAt,
    purchaseOrderLineId: null,
  }
}
