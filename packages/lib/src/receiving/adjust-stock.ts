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
import { readPartKind, readPartStandardCost } from './receipt-queries'
import type { AdjustStockInput, MovementRecord } from './types'

/** What every adjustment stamps beyond the bare count change. */
interface AdjustmentCost {
  /** The part's frozen `part_standard_cost`, rounded. Whole minor units, strictly positive. */
  unitCost: number
  /** The inventory account ROLE ('inventory_raw_materials'), never a code and never a provider id. */
  glAccount: string
}

/**
 * Correct a part's on-hand count by a signed delta.
 *
 * The order of the steps is the contract, not an implementation detail:
 *
 * 1. `quantity` is a finite, non-zero number, or `BadRequestError`.
 * 2. Resolve the part's STANDARD cost — in both directions — or
 *    `UnprocessableEntityError` naming the part. Nothing is written when this
 *    fails.
 * 3. Write one movement, `type: 'adjust'`, `cost_basis: standard`, with
 *    `unit_cost`, `extended_cost` and `gl_account` stamped whichever way the
 *    count went.
 *
 * 🛑 **Both directions carry a cost, and it is the SERVER's number.** This is
 * decision `G12` and it reverses two earlier behaviours that were both wrong:
 *
 * - A **positive** adjustment used to demand a user-entered `unitCost` and
 *   stamp `cost_basis: actual`. But an adjustment has no supplier row, no
 *   purchase order and no packing slip — there is no ACTUAL to record. What the
 *   found units are worth is what the system says a unit of that part is worth,
 *   which is `part_standard_cost`. Asking a person to type it invited a
 *   different answer every time and made the ledger's valuation depend on who
 *   was counting.
 * - A **negative** adjustment used to stamp NO cost at all — no `unit_cost`, no
 *   `extended_cost`, no `gl_account`. That is the worse of the two: a shrinkage
 *   carrying no cost is invisible to every period total that sums the ledger,
 *   so the L1 month-end assertion absorbs it into the COGS plug. `G12` exists
 *   to keep count variance separate from purchase price variance, and a
 *   valueless row cannot be separated from anything.
 *
 * 🛑 **A part with no standard cost fails CLOSED, naming the part.** It must not
 * fall back to `part_cost` — that is live replacement cost, rewritten on every
 * vendor-price change, and it must never value a movement (architecture guide
 * section 11, rule 2) — and it must not write zero, which is the exact defect
 * `receiveStock` refuses. Roll standard cost for the part first.
 *
 * ⚠️ **This is a write-path change on an append-only ledger.** Every field on
 * `stock_movement` is `updatable: false`, so movements written before this
 * carry the old costing — a positive `adjust` at a hand-typed `actual` cost, a
 * negative one at no cost at all — and they CANNOT be back-filled. That is the
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

      const partDefId = await requireCachedEntityDefId(organizationId, 'part')
      const movementDefId = await getCachedEntityDefId(organizationId, 'stock_movement')
      if (!movementDefId) {
        throw new NotFoundError('This organization has no stock_movement entity definition')
      }

      const cost = await resolveAdjustmentCost(db, organizationId, input.partId)

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
 * Step 2: read the part's frozen standard cost, or refuse naming the part.
 *
 * Rounding is applied BEFORE the positivity check so a sub-half-cent standard
 * cost is rejected here rather than stored as a zero the ledger cannot explain —
 * the same ordering `resolveReceiptPrice` uses, and for the same reason.
 *
 * Runs for a REMOVAL as well as an addition, which is why the cost-field
 * pre-flight is unconditional now: `G12` values both directions, so an org whose
 * movement cost fields are not materialised cannot adjust in either direction
 * rather than being able to adjust in the one that recorded nothing.
 */
async function resolveAdjustmentCost(
  db: Database,
  organizationId: string,
  partId: string
): Promise<AdjustmentCost> {
  await assertCostFieldsMaterialized(
    organizationId,
    'Adjusting stock is not available until the stock movement cost fields are provisioned'
  )

  const standard = await readPartStandardCost(db, organizationId, partId)
  if (standard.isErr()) throw standard.error

  const { standardCost, displayName } = standard.value
  const partLabel = displayName ? `"${displayName}"` : `part ${partId}`

  if (standardCost == null || !Number.isFinite(standardCost)) {
    throw new UnprocessableEntityError(
      `Cannot adjust ${partLabel}: it has no standard cost. An adjustment is valued at the part's standard cost, and there is nothing else it may honestly be valued at — the live part cost is a replacement price that changes with every vendor quote. Roll standard cost for this part first.`,
      { partId }
    )
  }

  const unitCost = roundMinorUnits(standardCost)
  if (unitCost <= 0) {
    throw new UnprocessableEntityError(
      `Cannot adjust ${partLabel}: its standard cost rounds to zero. A movement written at zero cost sums into the inventory balance as nothing and cannot be told apart from a genuinely free part. Roll standard cost for this part first.`,
      { partId }
    )
  }

  const kind = await readPartKind(db, organizationId, partId)
  if (kind.isErr()) throw kind.error

  return { unitCost, glAccount: resolveInventoryRoleForPartKind(kind.value) }
}

interface WriteAdjustMovementArgs {
  movementDefId: string
  partDefId: string
  input: AdjustStockInput
  /** Never null — `G12` values a removal exactly as it values an addition. */
  cost: AdjustmentCost
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
 * Every cost field is stamped unconditionally: `resolveAdjustmentCost` has
 * already refused the write if the part has no standard cost, so there is no
 * branch here in which one is missing.
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
  // Signed like `quantity`, so a removal's extended cost is NEGATIVE and a
  // period total that sums the ledger nets correctly without a sign convention
  // living anywhere else.
  const extendedCost = computeExtendedCost(cost.unitCost, quantity)

  const values: Record<string, unknown> = {
    stock_movement_part: toRecordId(partDefId, input.partId),
    stock_movement_type: StockMovementType.ADJUST,
    stock_movement_quantity: quantity,
    // See the JSDoc above. Never true on an adjustment.
    stock_movement_adjust_subparts: false,
    stock_movement_occurred_at: occurredAt.toISOString(),
    // `standard`, not `actual`: this is the part's frozen `part_standard_cost`,
    // read by the server. An adjustment has no supplier and no invoice, so there
    // is no ACTUAL for it to record (`G12`).
    stock_movement_cost_basis: StockMovementCostBasis.STANDARD,
    stock_movement_unit_cost: cost.unitCost,
    stock_movement_extended_cost: extendedCost,
    stock_movement_gl_account: cost.glAccount,
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
    unitCost: cost.unitCost,
    extendedCost,
    // An adjustment has no supplier and no purchase order: it is a count
    // correction, not a purchase. Nothing here is withheld — there is nothing
    // to state.
    vendorUnitPrice: null,
    vendorPartId: null,
    glAccount: cost.glAccount,
    occurredAt,
    purchaseOrderLineId: null,
  }
}
