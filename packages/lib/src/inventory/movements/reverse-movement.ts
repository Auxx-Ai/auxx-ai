// packages/lib/src/inventory/movements/reverse-movement.ts

/**
 * The correction path for a stock movement
 * (plans/purchasing/05-receiving-cost-and-corrections.md section 5.1).
 *
 * A reversal is a NEW, opposite row pointing at the original through
 * `reversesMovementId`, never an edit. The PO-line roll-up re-SUMs every movement
 * pointing at the line, so the negative row decrements `quantityReceived` for free.
 *
 * No permission checks: the router asserts edit on the part before calling.
 */

import type { Database } from '@auxx/database'
import type { Result } from 'neverthrow'
import {
  linkMovementsToPosting,
  reversePostingForMovement,
} from '../../accounting/ledger/post/post-inventory-movement'
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
  UnprocessableEntityError,
} from '../../errors'
import { StockMovementCostBasis, StockMovementType } from '../../resources/registry/enum-values'
import { guard } from './guard'
import { readMovementById } from './reads'
import type { MovementRecord, StockMovementTouched } from './types'
import { settleStockMovements, writeStockMovements } from './write-movements'

/** Which movement to undo, and why. */
export interface ReverseMovementInput {
  /** The `StockMovement.id` being undone. */
  movementId: string
  /** Free text stamped onto the reversal only; the original is never touched. */
  reason?: string
}

/**
 * What the reversal row is TYPED as, per the type of the row it undoes.
 *
 * The sign is what the arithmetic runs on - QoH and the purchase-order roll-up
 * both plain-`SUM` the quantity with no regard for the type - so this map is a LABEL, chosen to describe the direction
 * the goods actually moved:
 *
 * - `receive` -> `return_out`: the goods go back out the door. This is the case
 *   section 5.1 names, and the enum already had the value waiting for it.
 * - `return_in` -> `return_out`, `return_out` -> `return_in`: the two return
 *   directions undo each other exactly.
 * - `ship` / `sale` -> `return_in`: goods that left come back.
 * - everything else -> `adjust`. Deliberately NOT a per-type mirror: undoing a
 *   `build_consume` is not a production run and calling it `build_produce` would
 *   put a manufacturing event in the ledger that never happened, and there is no
 *   "unscrap". `adjust` is the honest label for "the number on the shelf was
 *   wrong", and unlike a hand-keyed adjustment this one carries the original's
 *   frozen cost, so it is postable.
 *
 * An unrecognised type falls through to `adjust` for the same reason.
 */
const REVERSAL_TYPE_BY_ORIGINAL: Record<string, string> = {
  [StockMovementType.RECEIVE]: StockMovementType.RETURN_OUT,
  [StockMovementType.RETURN_IN]: StockMovementType.RETURN_OUT,
  [StockMovementType.RETURN_OUT]: StockMovementType.RETURN_IN,
  [StockMovementType.SHIP]: StockMovementType.RETURN_IN,
  [StockMovementType.SALE]: StockMovementType.RETURN_IN,
}

/** The frozen facts a reversal is built from. */
interface OriginalMovement {
  partId: string
  type: string
  quantity: number
  costBasis: string | null
  /** `null` only on a `pending` row (111 Q18). */
  unitCost: number | null
  glRole: string
  vendorUnitPrice: number | null
  vendorPartId: string | null
  purchaseOrderLineId: string | null
  /** Set when the original is ITSELF a reversal. */
  reversesMovementId: string | null
  buildId: string | null
  fulfillmentLineId: string | null
  parentMovementId: string | null
}

/**
 * Undo one stock movement by writing its negation.
 *
 * The order of the steps is the contract:
 *
 * 1. Read the original, or `NotFoundError`. Rows of another org read as absent.
 * 2. Refuse a movement that is ALREADY reversed, with `ConflictError`: a second
 *    reversal would decrement `quantityReceived` twice off one mistake. The unique
 *    index on `reversesMovementId` enforces it, concurrent requests included.
 * 3. Refuse to reverse a reversal, with `BadRequestError`. The correction of an
 *    over-correction is a fresh receipt or adjustment, not a chain of undos -
 *    a chain makes "is this movement live?" a graph walk instead of a lookup.
 * 4. Write ONE new movement: the negated quantity, the ORIGINAL's frozen unit
 *    cost verbatim, its `glRole` and `vendorUnitPrice`, and every link it
 *    carried (`StockMovementLinks`).
 *
 * 🛑 **The reversal is never re-priced.** It carries the unit cost the original
 * froze, whatever today's supplier terms say. A reversal valued at the current
 * price nets a receipt and its undo to a non-zero amount of inventory value out
 * of nothing, which is the exact costing bug this subsystem exists to avoid.
 * `extendedCost` IS recomputed - from that same frozen unit cost against the
 * negated quantity - so it stays signed like the quantity and the subledger
 * still sums to the inventory balance.
 *
 * ⚠️ **A COSTED or a PENDING movement can be reversed here; a pre-regime null
 * row cannot.** A `pending` row (111 Q18) reverses into a pending row - negated
 * quantity, same part, no cost, basis `pending` - and the pricer fills both when
 * the standard lands. A row with no cost and no `pending` basis (a pre-migration
 * row, a BOM-explode child) has no cost to preserve and no lane that will ever
 * price it, and writing its negation at zero would be the thing
 * `receive-stock.ts` refuses. Those are corrected with a second adjustment.
 */
export async function reverseMovement(
  db: Database,
  organizationId: string,
  userId: string,
  input: ReverseMovementInput
): Promise<Result<MovementRecord, Error>> {
  return guard(
    async () => {
      const original = await readOriginalMovement(db, organizationId, input.movementId)

      if (original.reversesMovementId) {
        throw new BadRequestError(
          'This movement is itself a reversal and cannot be reversed. Receive or adjust the stock again instead.'
        )
      }

      const { record, touched } = await writeReversal(db, organizationId, userId, {
        originalMovementId: input.movementId,
        original,
        reason: input.reason,
        occurredAt: new Date(),
      })
      await settleStockMovements(organizationId, touched)

      // The correction is a REVERSAL of the entry the original was booked in,
      // never a fresh opposite entry: a period that has been posted never
      // changes shape, and `reverseEntry` frees the original's claim so the
      // document can post again. The negating movement is linked onto the
      // reversal so the close does not read it as work still outstanding.
      const reversed = await reversePostingForMovement(db, {
        organizationId,
        movementId: input.movementId,
        actorUserId: userId,
        memo: input.reason,
      })
      if (reversed?.glPostingId) {
        await linkMovementsToPosting(db, {
          organizationId,
          glPostingId: reversed.glPostingId,
          movementIds: [record.id],
        })
      }
      return record
    },
    'Failed to reverse stock movement',
    { organizationId, movementId: input.movementId }
  )
}

/** Step 1: the original's frozen facts, or `NotFoundError`. */
async function readOriginalMovement(
  db: Database,
  organizationId: string,
  movementId: string
): Promise<OriginalMovement> {
  const row = await readMovementById(db, organizationId, movementId)
  if (!row) throw new NotFoundError(`Stock movement ${movementId} not found`)

  const { quantity, unitCostMinor: unitCost, glRole, costBasis } = row
  if (!Number.isFinite(quantity) || quantity === 0) {
    throw new UnprocessableEntityError(`Stock movement ${movementId} has no quantity to reverse`)
  }
  const pending = costBasis === StockMovementCostBasis.PENDING
  if (!glRole || (!pending && (unitCost == null || !Number.isFinite(unitCost) || unitCost <= 0))) {
    // An uncosted movement has no frozen cost to carry, and a reversal valued at
    // zero is worse than no row at all.
    throw new UnprocessableEntityError(
      `Stock movement ${movementId} carries no frozen unit cost and is not pending a price, so it cannot be reversed. Adjust the stock instead.`
    )
  }

  return {
    partId: row.partId,
    type: row.type,
    quantity,
    costBasis,
    unitCost,
    glRole,
    vendorUnitPrice: row.vendorUnitPriceMinor,
    vendorPartId: row.vendorPartId,
    purchaseOrderLineId: row.purchaseOrderLineId,
    reversesMovementId: row.reversesMovementId,
    buildId: row.buildId,
    fulfillmentLineId: row.fulfillmentLineId,
    parentMovementId: row.parentMovementId,
  }
}

interface WriteReversalArgs {
  originalMovementId: string
  original: OriginalMovement
  reason: string | undefined
  occurredAt: Date
}

/**
 * Step 4: write the one opposite movement. `adjustSubparts` is never set: undoing a
 * purchase moves the purchased item and nothing else, exactly as the receipt did.
 * `extendedCost` is recomputed from the frozen unit cost, never negated from a stored total.
 */
async function writeReversal(
  db: Database,
  organizationId: string,
  userId: string,
  args: WriteReversalArgs
): Promise<{ record: MovementRecord; touched: StockMovementTouched }> {
  const { originalMovementId, original, reason, occurredAt } = args
  const quantity = -original.quantity
  const unitCost = original.unitCost

  const written = await writeStockMovements({ db, organizationId, userId }, [
    {
      partInstanceId: original.partId,
      type: reversalTypeFor(original.type),
      quantity,
      unitCost,
      // The basis follows the cost. A row carrying the original's frozen
      // `actual` cost is still an `actual`, a `pending` original makes a
      // pending reversal, and re-deciding it here would let a reversal
      // disagree with the movement it is a copy of. Omitted entirely (not
      // defaulted) when the original never carried one.
      costBasis: original.costBasis ?? undefined,
      glRole: original.glRole,
      occurredAt,
      vendorUnitPrice: original.vendorUnitPrice ?? undefined,
      reason,
      // Every link the original carried, so the reversal is found wherever the
      // original is; the PO line is what rolls `quantityReceived` back.
      links: {
        reversesMovementId: originalMovementId,
        vendorPartId: original.vendorPartId ?? undefined,
        purchaseOrderLineId: original.purchaseOrderLineId ?? undefined,
        buildId: original.buildId ?? undefined,
        fulfillmentLineId: original.fulfillmentLineId ?? undefined,
        parentMovementId: original.parentMovementId ?? undefined,
      },
    },
  ])
  if (written.isErr()) {
    if (written.error instanceof ConflictError) {
      throw new ConflictError(
        'This movement has already been reversed. Reversing it again would decrement the received quantity twice.'
      )
    }
    throw written.error
  }
  const record = written.value.records[0]!

  return {
    record: {
      id: record.id,
      partInstanceId: original.partId,
      quantity,
      unitCost,
      extendedCost: record.extendedCost,
      vendorUnitPrice: original.vendorUnitPrice,
      vendorPartId: original.vendorPartId,
      glRole: original.glRole,
      occurredAt,
      purchaseOrderLineId: original.purchaseOrderLineId,
    },
    touched: written.value.touched,
  }
}

/** See {@link REVERSAL_TYPE_BY_ORIGINAL} for why an unmapped type is an `adjust`. */
function reversalTypeFor(originalType: string): string {
  return REVERSAL_TYPE_BY_ORIGINAL[originalType] ?? StockMovementType.ADJUST
}
