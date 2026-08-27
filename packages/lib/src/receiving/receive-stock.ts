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
import type { Result } from 'neverthrow'
import { getCachedEntityDefId, getOrgCache, requireCachedEntityDefId } from '../cache'
import { BadRequestError, NotFoundError, UnprocessableEntityError } from '../errors'
import { UnifiedCrudHandler } from '../resources/crud/unified-handler'
import { toRecordId } from '../resources/resource-id'
import {
  computeExtendedCost,
  computeReceiptLandedCost,
  resolveGlAccountForPartKind,
  roundMinorUnits,
} from './client'
import { guard } from './guard'
import { readPartKind, readVendorPartCostInputs } from './receipt-queries'
import type { MovementRecord, ReceiveStockInput } from './types'

/**
 * Receive stock against a part.
 *
 * The order of the steps is the contract, not an implementation detail:
 *
 * 1. `quantity > 0`, or `BadRequestError`. A negative receipt is a vendor return
 *    and has to carry the ORIGINAL receipt's cost, so it cannot be expressed
 *    here without silently valuing the return at today's price.
 * 2. Resolve the price. A supplied `unitCost` wins over the supplier row —
 *    the vendor's actual invoice beats their standing terms, which is why the
 *    Receive form's price input is editable at all.
 * 3. Round both money values ONCE, at the point of storage.
 * 4. Write one movement.
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

      const written = await writeReceiveMovement(db, organizationId, userId, {
        movementDefId,
        partDefId,
        input,
        unitCost: priced.unitCost,
        vendorUnitPrice: priced.vendorUnitPrice,
        glAccount: resolveGlAccountForPartKind(partKind),
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

/**
 * Fail early when entity migration 108 has not run for this org.
 *
 * Without `stock_movement_unit_cost` the write below would still succeed and
 * would produce exactly the thing step 2 forbids: a movement that looks like a
 * receipt and carries no cost. Refusing here means the org sees "receiving is not
 * set up" instead of silently accumulating unpostable rows.
 */
async function assertCostFieldsMaterialized(organizationId: string): Promise<void> {
  const fields = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes(['stock_movement_unit_cost', 'stock_movement_cost_basis'])
  if (!fields.stock_movement_unit_cost || !fields.stock_movement_cost_basis) {
    throw new UnprocessableEntityError(
      'Receiving is not available until the stock movement cost fields are provisioned'
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
 * The supplied `unitCost` wins outright. Only when it is absent is the
 * `vendor_part` row read and the EXISTING `computeLandedCost` run against it —
 * existing, not a local copy, because a receipt valued by a second implementation
 * of the landed formula could disagree with the part cost the same supplier row
 * produces, and reconciling two numbers that are both "the landed cost" is
 * exactly the confusion this subsystem is meant to remove.
 *
 * `vendorUnitPrice` is resolved independently of `unitCost` and is allowed to
 * stay `null`: it is provenance for the three-way match, not an input to the
 * valuation, so a hand-keyed landed cost with no known invoice price is a
 * perfectly coherent receipt.
 */
async function resolveReceiptPrice(
  db: Database,
  organizationId: string,
  input: ReceiveStockInput
): Promise<ResolvedPrice> {
  const supplied = input.unitCost
  let vendorUnitPrice = input.vendorUnitPrice ?? null

  let landed: number | null = supplied != null && Number.isFinite(supplied) ? supplied : null

  if (landed == null || vendorUnitPrice == null) {
    if (input.vendorPartId) {
      const terms = await unwrap(readVendorPartCostInputs(db, organizationId, input.vendorPartId))
      if (!terms) {
        throw new NotFoundError(`Vendor part ${input.vendorPartId} not found`)
      }
      if (vendorUnitPrice == null) vendorUnitPrice = terms.unitPrice
      if (landed == null) landed = computeReceiptLandedCost(terms)
    }
  }

  if (landed == null || !Number.isFinite(landed)) {
    throw new UnprocessableEntityError(
      'Cannot receive stock without a unit cost: supply a price, or price the supplier part first'
    )
  }

  const unitCost = roundMinorUnits(landed)
  if (unitCost <= 0) {
    // The hard failure the plan asks for, and deliberately NOT a default of any
    // kind. Rounding is applied before the check so a sub-half-cent price is
    // rejected here rather than stored as a zero the ledger cannot explain.
    throw new UnprocessableEntityError(
      'Refusing to write a receipt at zero cost. Enter the price actually paid.'
    )
  }

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
 * Step 4: write the one movement.
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
