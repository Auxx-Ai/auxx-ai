// packages/lib/src/receiving/receive-stock.ts

/**
 * The single-line receipt write (plans/purchasing/01-build-plan.md section 3.2).
 *
 * One receipt is one `stock_movement` row: `type: 'receive'`, a positive
 * quantity, and a frozen landed cost. Nothing else happens here — quantity on
 * hand is maintained by the existing `mfg-stock-movements-created` rule
 * (`recalculatePartQoH` in `field-hooks/post/inventory-triggers.ts`), and adding
 * a second writer for it would give the same number two owners.
 *
 * No permission checks: `receiving.receiveStock` asserts write access on the
 * `stock_movement` def before calling (build plan section 3.3).
 */

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { Result } from 'neverthrow'
import { ensureStandardCost } from '../builds/ensure-standard-cost'
import { getCachedEntityDefId, requireCachedEntityDefId } from '../cache'
import { BadRequestError, NotFoundError, UnprocessableEntityError } from '../errors'
import { UnifiedCrudHandler } from '../resources/crud/unified-handler'
import { toRecordId } from '../resources/resource-id'
import {
  computeExtendedCost,
  computeReceiptLandedCost,
  type ReceiptCostInputs,
  resolveInventoryRoleForPartKind,
  roundMinorUnits,
} from './client'
import { assertCostFieldsMaterialized } from './cost-fields'
import { guard } from './guard'
import { readPartKind, readVendorPartCostInputs } from './receipt-queries'
import type { MovementRecord, ReceiveStockInput } from './types'

const logger = createScopedLogger('receiving')

/**
 * Receive stock against a part.
 *
 * The order of the steps is the contract, not an implementation detail:
 *
 * 1. `quantity > 0`, or `BadRequestError`. A negative receipt is a vendor return
 *    and has to carry the ORIGINAL receipt's cost, so it cannot be expressed
 *    here without silently valuing the return at today's price.
 * 2. Resolve the price. See {@link resolveReceiptPrice} — the base is the price
 *    the caller sent, and the supplier row contributes only the landed adders.
 * 3. Round both money values ONCE, at the point of storage.
 * 4. Give the part a standard cost if, and only if, it has none. See
 *    {@link setFirstStandardCostFromReceipt}.
 * 5. Write one movement.
 *
 * 🛑 **A receipt is never written at zero cost.** If neither a supplied price nor
 * the supplier row yields a positive number this fails with
 * `UnprocessableEntityError` and no row is created. A zero-cost receipt is worse
 * than a missing one because it looks like data: it sums into the inventory
 * balance as nothing, it makes the part's average cost collapse toward zero, and
 * nothing downstream can tell it apart from a genuinely free sample. The rule
 * generalises to every movement writer — stamp a cost, or write something
 * explicitly and permanently non-postable; there is no third state.
 */
export async function receiveStock(
  db: Database,
  organizationId: string,
  userId: string,
  input: ReceiveStockInput
): Promise<Result<MovementRecord, Error>> {
  return guard(
    async () => {
      assertReceivableQuantity(input.quantity)

      const partDefId = await requireCachedEntityDefId(organizationId, 'part')
      const movementDefId = await getCachedEntityDefId(organizationId, 'stock_movement')
      if (!movementDefId) {
        throw new NotFoundError('This organization has no stock_movement entity definition')
      }
      await assertCostFieldsMaterialized(organizationId)

      const priced = await resolveReceiptPrice(db, organizationId, input)
      const partKind = await unwrap(readPartKind(db, organizationId, input.partId))

      await setFirstStandardCostFromReceipt(db, organizationId, input.partId, priced.unitCost)

      const written = await writeReceiveMovement(db, organizationId, userId, {
        movementDefId,
        partDefId,
        input,
        unitCost: priced.unitCost,
        vendorUnitPrice: priced.vendorUnitPrice,
        glAccount: resolveInventoryRoleForPartKind(partKind),
        occurredAt: input.occurredAt ?? new Date(),
      })
      return written
    },
    'Failed to receive stock',
    { organizationId, partId: input.partId, quantity: input.quantity }
  )
}

/**
 * A receipt quantity must be a finite number strictly greater than zero.
 *
 * `Number.isFinite` is checked as well as the sign because `NaN > 0` is false but
 * so is `NaN <= 0`, and an `Infinity` quantity would multiply into an
 * `extendedCost` of `Infinity` that `Math.round` happily preserves — a value the
 * `doublePrecision` column accepts and every later `SUM` is then poisoned by.
 */
function assertReceivableQuantity(quantity: number): void {
  if (!Number.isFinite(quantity)) {
    throw new BadRequestError('Receipt quantity must be a finite number')
  }
  if (quantity <= 0) {
    throw new BadRequestError(
      'Receipt quantity must be greater than zero. A negative receipt is a vendor return.'
    )
  }
}

interface ResolvedPrice {
  /** Whole minor units, strictly positive. */
  unitCost: number
  /** Whole minor units, or `null` when the raw supplier price is not known. */
  vendorUnitPrice: number | null
}

/**
 * Step 2 and step 3 of the contract: settle on a landed unit cost, then round it.
 *
 * The precedence, in order:
 *
 * 1. **A supplied `unitCost` is used as-is.** This is the internal seam between
 *    the two lib entry points, not a browser field:
 *    {@link import('./receive-purchase-order').receivePurchaseOrder} reads the
 *    purchase order line's agreed price server-side and passes the resolved cost
 *    down. No vendor terms are applied on top of it.
 * 2. **A supplied `vendorUnitPrice` is the BASE**, and the `vendor_part` row —
 *    when one is named — contributes ONLY the adders (freight, tariff, other).
 * 3. **`vendorPartId` alone** prices the whole receipt from the supplier row:
 *    its `unitPrice` is the base and its adders sit on top.
 * 4. Otherwise there is no price at all, and the receipt is refused.
 *
 * 🛑 **Why the SENT price is the base and the STORED one is not.** The Receive
 * form shows the supplier's terms and lets the person keying the receipt replace
 * the price with what the packing slip in front of them actually says. Reading
 * `vendor_part.unitPrice` as the base after that would value the stock from the
 * number the user just *replaced* — and because every field on `stock_movement`
 * is `updatable: false`, the wrong cost is frozen forever with nothing thrown.
 * `apps/web/src/components/manufacturing/parts/receipt-input.ts` documents that
 * hazard, and compensated for it client-side by sending a pre-computed
 * `unitCost`. That compensation existed because of this function; taking the
 * sent price as the base removes the reason for it, and lets the router stop
 * accepting a cost from the browser at all.
 *
 * The landed arithmetic itself is always the EXISTING `computeLandedCost`, never
 * a local copy: a receipt valued by a second implementation of the formula could
 * disagree with the part cost the same supplier row produces, and reconciling two
 * numbers that are both "the landed cost" is exactly the confusion this subsystem
 * exists to remove.
 *
 * `vendorUnitPrice` is resolved independently of `unitCost` and is allowed to
 * stay `null`: it is provenance for the three-way match, not an input to the
 * valuation, so a resolved landed cost with no known invoice price is a
 * perfectly coherent receipt.
 */
async function resolveReceiptPrice(
  db: Database,
  organizationId: string,
  input: ReceiveStockInput
): Promise<ResolvedPrice> {
  const supplied = input.unitCost
  const sentBase = input.vendorUnitPrice
  let vendorUnitPrice = sentBase != null && Number.isFinite(sentBase) ? sentBase : null

  let landed: number | null = supplied != null && Number.isFinite(supplied) ? supplied : null

  // The supplier row is read when it can still contribute something: the adders
  // for an unresolved cost, or the raw price when none was sent. When both are
  // already known it is not read at all.
  let terms: ReceiptCostInputs | null = null
  if ((landed == null || vendorUnitPrice == null) && input.vendorPartId) {
    // Resolved at the receipt's accounting date, not at now: a back-dated receipt
    // takes the duty rate that was in force on the day (29 §5.1, 30 §5).
    terms = await unwrap(
      readVendorPartCostInputs(
        db,
        organizationId,
        input.vendorPartId,
        input.occurredAt ?? new Date()
      )
    )
    if (!terms) {
      throw new NotFoundError(`Vendor part ${input.vendorPartId} not found`)
    }
    if (vendorUnitPrice == null) vendorUnitPrice = terms.unitPrice
  }

  if (landed == null) {
    // `vendorUnitPrice` is the base here whether it was sent or read: when it was
    // sent, `terms.unitPrice` is deliberately discarded and only the adders are
    // taken. With no supplier row the adders resolve empty and the landed cost is
    // the sent base unchanged.
    landed = computeReceiptLandedCost({
      unitPrice: vendorUnitPrice,
      shippingCost: terms?.shippingCost,
      tariffRate: terms?.tariffRate,
      otherCost: terms?.otherCost,
    })
  }

  if (landed == null || !Number.isFinite(landed)) {
    throw new UnprocessableEntityError(
      'Cannot receive stock without a unit cost: supply a price, or price the supplier part first'
    )
  }

  if (landed <= 0) {
    // The hard failure the plan asks for, and deliberately NOT a default of any
    // kind. Checked on the UNROUNDED landed cost, before it is rounded to a
    // RATE's five places - a sub-cent price such as $0.004 is real money, not
    // zero, and must not be refused just because it rounds toward zero at
    // whole-cent precision. Only a genuinely non-positive landed cost is
    // refused here.
    throw new UnprocessableEntityError(
      'Refusing to write a receipt at zero cost. Enter the price actually paid.'
    )
  }

  const unitCost = roundMinorUnits(landed)

  return {
    unitCost,
    vendorUnitPrice:
      vendorUnitPrice != null && Number.isFinite(vendorUnitPrice)
        ? roundMinorUnits(vendorUnitPrice)
        : null,
  }
}

interface WriteReceiveMovementArgs {
  movementDefId: string
  partDefId: string
  input: ReceiveStockInput
  unitCost: number
  vendorUnitPrice: number | null
  glAccount: string
  occurredAt: Date
}

/**
 * Step 4: a part's FIRST receipt gives it a standard cost
 * (plans/money/tasks/15-costing-usability.md §2c).
 *
 * `ensureStandardCost` writes only where `part_standard_cost IS NULL`, so this
 * is a no-op on every receipt after the first, and on any part somebody already
 * rolled. It is not gated on a setting: a receipt carries a landed cost off an
 * invoice, which is a fact, not an inference from a price list.
 *
 * 🛑 **This does NOT change what the receipt is valued at.** The movement below
 * still stamps `cost_basis: 'actual'` at the landed cost, exactly as before.
 * Receiving AT standard and posting the difference to `5090` is a books change
 * and lives in `plans/money/design/ppv-treatment.md`; all this does is make the
 * part HAVE a standard afterwards, so the adjust, build and close paths that
 * refuse without one stop refusing.
 *
 * 🛑 **A receipt never MOVES an existing standard.** That is the same file's §5:
 * a standard that follows the last purchase is a moving average wearing a
 * standard's name. A later receipt at a different price varies against the
 * standard; it does not become it.
 *
 * Failures are swallowed. The receipt is the fact being recorded and it is
 * already priced; refusing to record it because a derived convenience could not
 * be written would lose the arrival. The part simply stays unrolled, which is
 * the state it was in a moment ago.
 */
async function setFirstStandardCostFromReceipt(
  db: Database,
  organizationId: string,
  partId: string,
  unitCost: number
): Promise<void> {
  const ensured = await ensureStandardCost(db, organizationId, [partId], {
    kind: 'receipt',
    unitCost,
  })
  if (ensured.isErr()) {
    logger.warn('Could not set a first standard cost from a receipt', {
      organizationId,
      partId,
      error: ensured.error,
    })
  }
}

/**
 * Step 5: write the one movement.
 *
 * Values are keyed by `systemAttribute` and go through `UnifiedCrudHandler`
 * rather than a hand-built `EntityInstance` + `FieldValue` insert. That is the
 * same mechanism `data-connectors/inventory-bridge-linking.ts` uses to create
 * movements, and it is what makes the post-commit triggers (QoH, timeline,
 * realtime) fire at all — a direct insert writes rows the rest of the system
 * never hears about.
 *
 * 🛑 **`adjustSubparts: false` is load-bearing, not a default.**
 * `explodeBomMovement` inherits the parent movement's type AND its sign, so a
 * receipt with the flag set would create a `receive` movement for every
 * descendant in the BOM — receiving 10 motors would ADD 10 of every screw,
 * bracket and wire harness inside them. Receiving 10 motors adds 10 motors and
 * consumes nothing: a purchase brings a finished item through the door, it does
 * not manufacture its own components. `baselineSeed` in
 * `inventory-bridge-linking.ts` sets it false for the identical reason.
 */
async function writeReceiveMovement(
  db: Database,
  organizationId: string,
  userId: string,
  args: WriteReceiveMovementArgs
): Promise<MovementRecord> {
  const { movementDefId, partDefId, input, unitCost, vendorUnitPrice, glAccount, occurredAt } = args
  const quantity = input.quantity
  const extendedCost = computeExtendedCost(unitCost, quantity)

  const values: Record<string, unknown> = {
    stock_movement_part: toRecordId(partDefId, input.partId),
    stock_movement_type: 'receive',
    stock_movement_quantity: quantity,
    // See the JSDoc above. Never true on a receipt.
    stock_movement_adjust_subparts: false,
    // A receipt is the first writer of `actual`: this cost is what was paid,
    // not what the standard cost roll-up expects it to have been.
    stock_movement_cost_basis: 'actual',
    stock_movement_unit_cost: unitCost,
    stock_movement_extended_cost: extendedCost,
    stock_movement_gl_account: glAccount,
    stock_movement_occurred_at: occurredAt.toISOString(),
  }

  if (vendorUnitPrice != null) values.stock_movement_vendor_unit_price = vendorUnitPrice
  if (input.reference) values.stock_movement_reference = input.reference
  if (input.reason) values.stock_movement_reason = input.reason

  if (input.vendorPartId) {
    const vendorPartDefId = await requireDefId(organizationId, 'vendor_part')
    values.stock_movement_vendor_part = toRecordId(vendorPartDefId, input.vendorPartId)
  }

  if (input.purchaseOrderLineId) {
    const lineDefId = await requireDefId(organizationId, 'purchase_order_line')
    values.stock_movement_purchase_order_line = toRecordId(lineDefId, input.purchaseOrderLineId)
  }

  const crud = new UnifiedCrudHandler(organizationId, userId, db)
  const created = await crud.create(movementDefId, values)

  return {
    movementId: created.instance.id,
    recordId: toRecordId(movementDefId, created.instance.id),
    partInstanceId: input.partId,
    quantity,
    unitCost,
    extendedCost,
    vendorUnitPrice,
    vendorPartId: input.vendorPartId ?? null,
    glAccount,
    occurredAt,
    purchaseOrderLineId: input.purchaseOrderLineId ?? null,
  }
}

/**
 * Resolve a def id the caller's input already committed us to, as an
 * `UnprocessableEntityError` rather than the bare `Error` the cache helper
 * throws — "you referenced a purchase order line and this org has no purchase
 * orders yet" is a 422 the UI can act on, not a 500.
 */
async function requireDefId(organizationId: string, entityType: string): Promise<string> {
  const defId = await getCachedEntityDefId(organizationId, entityType)
  if (!defId) {
    throw new UnprocessableEntityError(
      `This organization has no ${entityType} entity definition yet`
    )
  }
  return defId
}

/** Unwrap a neverthrow `Result` back into the imperative style `guard()` expects. */
async function unwrap<T>(promise: Promise<Result<T, Error>>): Promise<T> {
  const result = await promise
  if (result.isErr()) throw result.error
  return result.value
}
