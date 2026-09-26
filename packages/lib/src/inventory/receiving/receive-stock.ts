// packages/lib/src/inventory/receiving/receive-stock.ts

/**
 * The single-line receipt write (plans/purchasing/01-build-plan.md section 3.2).
 *
 * One receipt is one `stock_movement` row: `type: 'receive'`, a positive
 * quantity, and a frozen landed cost. Nothing else happens here - quantity on
 * hand is maintained by the existing `mfg-stock-movements-created` rule
 * (`recalculatePartQoH` in `field-hooks/post/inventory-triggers.ts`), and adding
 * a second writer for it would give the same number two owners.
 *
 * No permission checks: `receiving.receiveStock` asserts write access on the
 * `stock_movement` def before calling (build plan section 3.3).
 */

import type { Database, Transaction } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { roundMinorUnits } from '@auxx/utils/currency'
import type { Result } from 'neverthrow'
import type { ReceiveAccrualInput } from '../../accounting/ledger/builders/inventory-movement'
import type { InTxPostResult } from '../../accounting/ledger/post/post-entry'
import {
  exportInventoryMovement,
  postInventoryMovementInTx,
} from '../../accounting/ledger/post/post-inventory-movement'
import { getOrgCache, requireCachedEntityDefId } from '../../cache'
import { BadRequestError, NotFoundError, UnprocessableEntityError } from '../../errors'
import { systemDefId } from '../../resources/system-records'
import { ensureStandardCost } from '../costing/ensure-standard-cost'
import { replaceProvisionalStandard } from '../costing/provisional-standard'
import { batchRecalculateQoH } from '../costing/qoh'
import { rollUnvaluedAncestors } from '../costing/roll-unvalued-ancestors'
import { readStandardCost } from '../costing/standard-cost-queries'
import { writeStockMovements } from '../movements'
import { resolveInventoryRoleForPartKind } from '../movements/client'
import { assertCostFieldsMaterialized } from '../movements/cost-fields'
import type { MovementRecord } from '../movements/types'
import { computeReceiptAccrual } from './accruals'
import { computeReceiptLandedCost, type ReceiptCostInputs } from './client'
import { guard } from './guard'
import { readPartKind, readVendorPartCostInputs } from './receipt-queries'
import type { ReceiveStockInput } from './types'

const logger = createScopedLogger('receiving')

/**
 * Receive stock against a part.
 *
 * The order of the steps is the contract, not an implementation detail:
 *
 * 1. `quantity > 0`, or `BadRequestError`. A negative receipt is a vendor return
 *    and has to carry the ORIGINAL receipt's cost, so it cannot be expressed
 *    here without silently valuing the return at today's price.
 * 2. Resolve the price. See {@link resolveReceiptPrice} - the base is the price
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
 * generalises to every movement writer - stamp a cost, or write something
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
      const movementDefId = await systemDefId(db, organizationId, 'stock_movement')
      if (!movementDefId) {
        throw new NotFoundError('This organization has no stock_movement entity definition')
      }
      await assertCostFieldsMaterialized(organizationId)

      // Resolved before any write: a service has no inventory role and refuses here.
      const glAccount = resolveInventoryRoleForPartKind(
        await unwrap(readPartKind(db, organizationId, input.partId))
      )
      const priced = await resolveReceiptPrice(db, organizationId, input)

      // `priced.unitCost` IS the landed estimate — base plus every adder — which
      // is what §6.4 replaces a provisional guess with, not the base alone.
      await setFirstStandardCostFromReceipt(
        db,
        organizationId,
        input.partId,
        priced.unitCost,
        userId
      )

      // 73 §6.2 rule 1: valued at the STANDARD, read after the line above. The
      // landed estimate is the fallback for a part with no readable standard.
      const standards = await readStandardCost(db, organizationId, [input.partId])
      const unitValue =
        (standards.isOk() ? standards.value.get(input.partId)?.standardCost : null) ??
        priced.unitCost

      // What the receipt owes the carrier and the broker (§7.2). The agreed
      // price is the base `grni` is credited at; with no supplier row and no
      // known base there is nothing to split and `grni` takes the whole cost.
      const accrual =
        priced.vendorUnitPrice == null
          ? undefined
          : computeReceiptAccrual(
              {
                agreedUnitPrice: priced.vendorUnitPrice,
                shippingCost: priced.terms?.shippingCost,
                otherCost: priced.terms?.otherCost,
                tariffRate: priced.terms?.tariffRate,
              },
              input.quantity
            )

      // The movement and its entry commit together (MIGRATION step 5): a
      // receipt whose row landed and whose entry did not is exactly the state
      // the close's `inventory_unposted` blocker exists to catch, and it should
      // be unreachable rather than merely detectable.
      const { written, post } = await db.transaction(async (tx) => {
        const txDb = tx as unknown as Database
        const record = await writeReceiveMovement(txDb, organizationId, userId, {
          movementDefId,
          partDefId,
          input,
          unitCost: unitValue,
          vendorUnitPrice: priced.vendorUnitPrice,
          tariffRate: priced.terms?.tariffRate ?? undefined,
          accrual,
          glAccount,
          occurredAt: input.occurredAt ?? new Date(),
        })
        return {
          written: record,
          post: await postReceipt(tx, organizationId, userId, record, accrual),
        }
      })

      // Belt on the plain lane's own recalculation, which fired against a
      // pre-commit snapshot from inside the transaction above.
      await batchRecalculateQoH(organizationId, [written.partInstanceId])
      await exportInventoryMovement(db, post)
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
 * `extendedCost` of `Infinity` that `Math.round` happily preserves - a value the
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
  /** The LANDED estimate per unit, whole minor units, strictly positive. */
  unitCost: number
  /** Whole minor units, or `null` when the raw supplier price is not known. */
  vendorUnitPrice: number | null
  /**
   * The supplier row's adders, when one was named (73 §7.2). `null` means
   * nothing is accrued and `grni` takes the receipt's whole cost.
   */
  terms: ReceiptCostInputs | null
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
 * 2. **A supplied `vendorUnitPrice` is the BASE**, and the `vendor_part` row -
 *    when one is named - contributes ONLY the adders (freight, tariff, other).
 * 3. **`vendorPartId` alone** prices the whole receipt from the supplier row:
 *    its `unitPrice` is the base and its adders sit on top.
 * 4. Otherwise there is no price at all, and the receipt is refused.
 *
 * 🛑 **Why the SENT price is the base and the STORED one is not.** The Receive
 * form shows the supplier's terms and lets the person keying the receipt replace
 * the price with what the packing slip in front of them actually says. Reading
 * `vendor_part.unitPrice` as the base after that would value the stock from the
 * number the user just *replaced* - and because every field on `stock_movement`
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

  // The supplier row is read whenever one is named. It used to be skipped when
  // the price was already settled; since 73 §7.2 its adders are also what the
  // receipt ACCRUES, so they are needed even when they contribute nothing to
  // the valuation.
  let terms: ReceiptCostInputs | null = null
  if (input.vendorPartId) {
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
      // Only a refusal when the valuation NEEDED the row. When the caller
      // already settled both numbers the row was read for its adders alone, and
      // a receipt whose price nobody disputes must not fail over a supplier row
      // somebody archived: it simply accrues nothing.
      if (landed == null || vendorUnitPrice == null) {
        throw new NotFoundError(`Vendor part ${input.vendorPartId} not found`)
      }
    } else if (vendorUnitPrice == null) {
      vendorUnitPrice = terms.unitPrice
    }
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
    terms,
  }
}

interface WriteReceiveMovementArgs {
  movementDefId: string
  partDefId: string
  input: ReceiveStockInput
  /** The part's frozen standard, or the landed estimate when it has none. */
  unitCost: number
  vendorUnitPrice: number | null
  /** The resolved duty PERCENTAGE, frozen with the accrual it produced. */
  tariffRate?: number
  accrual?: ReceiveAccrualInput
  glAccount: string
  occurredAt: Date
}

/**
 * Step 4: a part's FIRST receipt gives it a standard cost
 * (plans/money/tasks/15-costing-usability.md §2c).
 *
 * `ensureStandardCost` writes only where `part_standard_cost IS NULL`, so this
 * is a no-op on every receipt after the first. A first standard then rolls the
 * parents it completes (D-SC7).
 *
 * 🛑 **`unitCost` is the LANDED estimate, not the agreed price** (73 §7.2): the
 * standard is landed, so a first standard set from the base alone would post the
 * whole freight-and-duty estimate to `ppv` on the very receipt that set it.
 *
 * 🛑 **A receipt never MOVES an existing standard, with ONE exception.** That is
 * the same file's §5: a standard that follows the last purchase is a moving
 * average wearing a standard's name. The exception is 73 §6.4 — a standard
 * somebody TYPED before any purchase existed, which the first receipt replaces
 * rather than varies against. `replaceProvisionalStandard` gates on the stored
 * source and is a no-op for every other part.
 *
 * Failures are swallowed. The receipt is the fact being recorded and it is
 * already priced; refusing to record it because a derived convenience could not
 * be written would lose the arrival. The part simply stays unrolled, which is
 * the state it was in a moment ago.
 *
 * Exported: `receive-purchase-order.ts` calls this once per line too, before
 * its own shared transaction opens.
 */
export async function setFirstStandardCostFromReceipt(
  db: Database,
  organizationId: string,
  partId: string,
  unitCost: number,
  userId?: string
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
    return
  }
  const actorId = userId ?? (await getOrgCache().get(organizationId, 'systemUser'))

  // A first standard can complete a parent's BOM (D-SC7).
  if (ensured.value.writtenPartIds.length > 0) {
    const rolled = await rollUnvaluedAncestors(db, organizationId, actorId, [partId])
    if (rolled.isErr()) {
      logger.warn('Could not roll the parents of a first receipt', {
        organizationId,
        partId,
        error: rolled.error,
      })
    }
  }

  // 73 §6.4. A no-op unless the part carries a stored `provisional` standard,
  // in which case this replaces it and revalues whatever is on the shelf at the
  // guess. Swallowed for the same reason the line above is: the arrival is the
  // fact being recorded.
  const replaced = await replaceProvisionalStandard(db, organizationId, actorId, partId, unitCost)
  if (replaced.isErr()) {
    logger.warn('Could not replace a provisional standard from a receipt', {
      organizationId,
      partId,
      error: replaced.error,
    })
  }
}

/**
 * Step 5: write the one movement, through the shared
 * `inventory/movements/writeStockMovements` (plans/money/tasks/50-batch-inventory-relief.md
 * §2). That is what makes the post-commit triggers (QoH, timeline, realtime)
 * fire at all - a direct insert writes rows the rest of the system never
 * hears about - and it is also what resolves `vendorPartId` /
 * `purchaseOrderLineId` into links, refusing with `UnprocessableEntityError`
 * when this org has no such definition yet.
 *
 * 🛑 **`adjustSubparts` is never set here, which is what keeps it `false`.**
 * `explodeBomMovement` inherits the parent movement's type AND its sign, so a
 * receipt with the flag set would create a `receive` movement for every
 * descendant in the BOM - receiving 10 motors would ADD 10 of every screw,
 * bracket and wire harness inside them. Receiving 10 motors adds 10 motors and
 * consumes nothing: a purchase brings a finished item through the door, it does
 * not manufacture its own components.
 */
async function writeReceiveMovement(
  db: Database,
  organizationId: string,
  userId: string,
  args: WriteReceiveMovementArgs
): Promise<MovementRecord> {
  const { movementDefId, partDefId, input, unitCost, vendorUnitPrice, glAccount, occurredAt } = args
  const quantity = input.quantity
  const { accrual, tariffRate } = args

  const written = await writeStockMovements(
    { db, organizationId, userId, movementDefId, partDefId, lane: { kind: 'plain' } },
    [
      {
        partInstanceId: input.partId,
        type: 'receive',
        quantity,
        unitCost,
        // 73 §6.2 rule 1: a receipt freezes the STANDARD, and the difference
        // from what was paid is the receipt's `ppv`.
        costBasis: 'standard',
        glAccount,
        occurredAt,
        vendorUnitPrice: vendorUnitPrice ?? undefined,
        accrued: {
          freightMinor: accrual?.freightMinor,
          dutiesMinor: accrual?.dutiesMinor,
          tariffRate,
        },
        reference: input.reference,
        reason: input.reason,
        links: {
          vendorPartId: input.vendorPartId,
          purchaseOrderLineId: input.purchaseOrderLineId,
        },
      },
    ]
  )
  if (written.isErr()) throw written.error
  const record = written.value.records[0]!

  return {
    movementId: record.movementId,
    recordId: record.recordId,
    partInstanceId: input.partId,
    quantity,
    unitCost,
    extendedCost: record.extendedCost,
    vendorUnitPrice,
    vendorPartId: input.vendorPartId ?? null,
    glAccount,
    occurredAt,
    purchaseOrderLineId: input.purchaseOrderLineId ?? null,
  }
}

/** Unwrap a neverthrow `Result` back into the imperative style `guard()` expects. */
async function unwrap<T>(promise: Promise<Result<T, Error>>): Promise<T> {
  const result = await promise
  if (result.isErr()) throw result.error
  return result.value
}

/**
 * The receipt's own entry: `Dr <the movement's frozen inventory role> / Cr grni`.
 *
 * 🛑 **The MOVEMENT is the document, for THIS door only.** `receiveStock` is the
 * single-line ad hoc receipt, so its one movement is the whole document - which
 * is what makes `reverseMovement` exact, since a correction here undoes one line
 * and one entry. A multi-line `receivePurchaseOrder` receipt posts once for the
 * whole receipt instead, with every line's movement as a member (TARGET §5) -
 * see that file's own posting call.
 *
 * Since 73 §7.2 the entry has four credit-side legs, not one: `grni` at the
 * agreed price, `freight_accrual` and `duties_accrual` at what the supplier row
 * says the shipment costs on top of it, and `ppv` for whatever the frozen
 * standard differs from the three. With no supplier row there is nothing to
 * split and `grni` is credited at the whole extended cost, as before.
 */
async function postReceipt(
  tx: Transaction,
  organizationId: string,
  userId: string,
  record: MovementRecord,
  accrual?: ReceiveAccrualInput
): Promise<InTxPostResult | null> {
  if (record.extendedCost == null || record.glAccount == null) return null
  return postInventoryMovementInTx(tx, {
    organizationId,
    kind: 'receive',
    subject: { sourceKind: 'stock_movement', sourceId: record.movementId },
    // The PO LINE, not the order: it is what the receipt was against and what
    // the three-way match reads, and the order is one hop from it.
    ...(record.purchaseOrderLineId
      ? { parents: [{ sourceKind: 'purchase_order_line', sourceId: record.purchaseOrderLineId }] }
      : {}),
    occurredAt: record.occurredAt,
    movements: [
      {
        id: record.movementId,
        extendedCostMinor: record.extendedCost,
        glAccountRole: record.glAccount,
        ...(accrual ? { accrual } : {}),
      },
    ],
    actorUserId: userId,
  })
}
