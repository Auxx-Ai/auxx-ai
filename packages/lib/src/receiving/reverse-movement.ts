// packages/lib/src/receiving/reverse-movement.ts

/**
 * The correction path for a stock movement
 * (plans/purchasing/05-receiving-cost-and-corrections.md section 5.1).
 *
 * Until this existed there was no way to undo a receipt at all: the ledger is
 * append-only by construction, `receiveStock` refuses a non-positive quantity by
 * design ("A negative receipt is a vendor return"), and Adjust Stock writes no
 * `purchase_order_line` — so using it to fix a keying mistake moves the part's
 * on-hand count and leaves `purchase_order_line_quantity_received` permanently
 * wrong.
 *
 * A reversal is therefore a NEW, opposite row, never an edit — which is what
 * `stock_movement_reverses_movement` was built for in entity migration 108 and
 * never wired up. The roll-up needs no change: it re-SUMs every movement
 * pointing at the line, so the negative row decrements `quantityReceived` for
 * free, and `mfg-stock-movements-created` already fires on the create.
 *
 * No permission checks: the router asserts write access on the `stock_movement`
 * def before calling, the same contract `receive-stock.ts` states.
 */

import { type Database, schema } from '@auxx/database'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import { getCachedEntityDefId, getOrgCache } from '../cache'
import { BadRequestError, ConflictError, NotFoundError, UnprocessableEntityError } from '../errors'
import { UnifiedCrudHandler } from '../resources/crud/unified-handler'
import { StockMovementType } from '../resources/registry/enum-values'
import { toRecordId } from '../resources/resource-id'
import { computeExtendedCost } from './client'
import { guard } from './guard'
import type { MovementRecord } from './types'

/** Which movement to undo, and why. */
export interface ReverseMovementInput {
  /** `EntityInstance.id` of the `stock_movement` being undone. */
  movementId: string
  /**
   * Free text stamped onto the reversal only. The original is never touched —
   * every field on `stock_movement` is `updatable: false`, which is the only
   * reason a cost frozen onto a movement can be trusted years later.
   */
  reason?: string
}

/**
 * Every attribute the reversal reads off the original.
 *
 * All of them are treated as optional below because they are only materialised
 * once entity migration 108 has run for the org — but the four the write cannot
 * be expressed without are asserted explicitly.
 */
const REVERSAL_ATTRIBUTES = [
  'stock_movement_part',
  'stock_movement_type',
  'stock_movement_quantity',
  'stock_movement_cost_basis',
  'stock_movement_unit_cost',
  'stock_movement_gl_account',
  'stock_movement_vendor_unit_price',
  'stock_movement_vendor_part',
  'stock_movement_purchase_order_line',
  'stock_movement_reverses_movement',
] as const

type ReversalAttribute = (typeof REVERSAL_ATTRIBUTES)[number]

/** `systemAttribute` -> the materialised `CustomField`, or `null`. */
type ReversalFields = Record<ReversalAttribute, { id: string } | null>

/**
 * What the reversal row is TYPED as, per the type of the row it undoes.
 *
 * The sign is what the arithmetic runs on — `recalculatePartQoH` and the
 * purchase-order roll-up both plain-`SUM` `stock_movement_quantity` with no
 * regard for the type — so this map is a LABEL, chosen to describe the direction
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
  unitCost: number
  glAccount: string
  vendorUnitPrice: number | null
  vendorPartId: string | null
  purchaseOrderLineId: string | null
  /** Set when the original is ITSELF a reversal. */
  reversesMovementId: string | null
}

/**
 * Undo one stock movement by writing its negation.
 *
 * The order of the steps is the contract:
 *
 * 1. Read the original, or `NotFoundError`. Archived rows and rows belonging to
 *    another org read as absent.
 * 2. Refuse a movement that is ALREADY reversed, with `ConflictError`. This is
 *    the sharpest correctness rule in the function: a second reversal would
 *    decrement `purchase_order_line_quantity_received` twice off one mistake, and
 *    because the roll-up re-SUMs rather than increments, the wrong number would
 *    look exactly as authoritative as the right one.
 * 3. Refuse to reverse a reversal, with `BadRequestError`. The correction of an
 *    over-correction is a fresh receipt or adjustment, not a chain of undos —
 *    a chain makes "is this movement live?" a graph walk instead of a lookup.
 * 4. Write ONE new movement: the negated quantity, the ORIGINAL's frozen unit
 *    cost verbatim, and the original's `purchaseOrderLine`, `glAccount`,
 *    `vendorUnitPrice` and `vendorPart`.
 *
 * 🛑 **The reversal is never re-priced.** It carries the unit cost the original
 * froze, whatever today's supplier terms say. A reversal valued at the current
 * price nets a receipt and its undo to a non-zero amount of inventory value out
 * of nothing, which is the exact costing bug this subsystem exists to avoid.
 * `extendedCost` IS recomputed — from that same frozen unit cost against the
 * negated quantity — so it stays signed like the quantity and the subledger
 * still sums to the inventory balance.
 *
 * ⚠️ **Only a COSTED movement can be reversed here.** A movement with no frozen
 * `unitCost` (a pre-migration row, or a hand-keyed stock adjustment — see
 * section 1.5 of the plan) has no cost to preserve, and writing its negation at
 * zero would be the thing `receive-stock.ts` refuses: a row that looks like data
 * and values inventory at nothing. Those are corrected with a second adjustment;
 * they carry no `purchaseOrderLine` either, so no roll-up is left wrong by that.
 *
 * ⚠️ Step 2 is a read-then-write check, not a database constraint — there is no
 * unique index available on a `FieldValue` relationship — so two reversals
 * issued concurrently for the same movement could both pass it. The window is a
 * single request and the surface is one row action, so this is accepted rather
 * than serialised.
 */
export async function reverseMovement(
  db: Database,
  organizationId: string,
  userId: string,
  input: ReverseMovementInput
): Promise<Result<MovementRecord, Error>> {
  return guard(
    async () => {
      const movementDefId = await getCachedEntityDefId(organizationId, 'stock_movement')
      if (!movementDefId) {
        throw new NotFoundError('This organization has no stock_movement entity definition')
      }

      const fields = (await getOrgCache()
        .from(organizationId, 'customFields')
        .bySystemAttributes([...REVERSAL_ATTRIBUTES])) as ReversalFields

      const reversesField = fields.stock_movement_reverses_movement
      if (!reversesField || !fields.stock_movement_unit_cost || !fields.stock_movement_quantity) {
        // Without `reversesMovement` there is no way to record WHAT this row
        // undoes, and therefore no way to refuse the second reversal in step 2.
        throw new UnprocessableEntityError(
          'Reversing a movement is not available until the stock movement correction fields are provisioned'
        )
      }

      const original = await readOriginalMovement(
        db,
        organizationId,
        movementDefId,
        fields,
        input.movementId
      )

      if (await hasReversal(db, organizationId, reversesField.id, input.movementId)) {
        throw new ConflictError(
          'This movement has already been reversed. Reversing it again would decrement the received quantity twice.'
        )
      }

      if (original.reversesMovementId) {
        throw new BadRequestError(
          'This movement is itself a reversal and cannot be reversed. Receive or adjust the stock again instead.'
        )
      }

      return writeReversal(db, organizationId, userId, {
        movementDefId,
        originalMovementId: input.movementId,
        original,
        reason: input.reason,
        occurredAt: new Date(),
      })
    },
    'Failed to reverse stock movement',
    { organizationId, movementId: input.movementId }
  )
}

/**
 * Step 1: the original's frozen facts, or `NotFoundError`.
 *
 * Two queries rather than one join: the instance probe is what distinguishes
 * "no such movement" from "a movement with no values", and collapsing them would
 * report a data problem as a missing row.
 */
async function readOriginalMovement(
  db: Database,
  organizationId: string,
  movementDefId: string,
  fields: ReversalFields,
  movementId: string
): Promise<OriginalMovement> {
  const [instance] = await db
    .select({ id: schema.EntityInstance.id })
    .from(schema.EntityInstance)
    .where(
      and(
        eq(schema.EntityInstance.id, movementId),
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityInstance.entityDefinitionId, movementDefId),
        isNull(schema.EntityInstance.archivedAt)
      )
    )
    .limit(1)

  if (!instance) {
    throw new NotFoundError(`Stock movement ${movementId} not found`)
  }

  const fieldIds = REVERSAL_ATTRIBUTES.map((attr) => fields[attr]?.id).filter((id): id is string =>
    Boolean(id)
  )

  const rows = await db
    .select({
      fieldId: schema.FieldValue.fieldId,
      valueText: schema.FieldValue.valueText,
      valueNumber: schema.FieldValue.valueNumber,
      optionId: schema.FieldValue.optionId,
      relatedEntityId: schema.FieldValue.relatedEntityId,
    })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.entityId, movementId),
        inArray(schema.FieldValue.fieldId, fieldIds)
      )
    )

  const byFieldId = new Map(rows.map((row) => [row.fieldId, row]))
  const read = (attr: ReversalAttribute) => {
    const id = fields[attr]?.id
    return id ? (byFieldId.get(id) ?? null) : null
  }

  const partId = read('stock_movement_part')?.relatedEntityId ?? null
  const type = read('stock_movement_type')?.optionId ?? null
  const quantity = read('stock_movement_quantity')?.valueNumber ?? null
  const unitCost = read('stock_movement_unit_cost')?.valueNumber ?? null
  const glAccount = read('stock_movement_gl_account')?.valueText ?? null

  if (!partId || !type) {
    throw new UnprocessableEntityError(
      `Stock movement ${movementId} has no part or no type and cannot be reversed`
    )
  }
  if (quantity == null || !Number.isFinite(quantity) || quantity === 0) {
    throw new UnprocessableEntityError(`Stock movement ${movementId} has no quantity to reverse`)
  }
  if (unitCost == null || !Number.isFinite(unitCost) || unitCost <= 0 || !glAccount) {
    // See the JSDoc on `reverseMovement`: an uncosted movement has no frozen
    // cost to carry, and the alternative — a reversal valued at zero — is worse
    // than no row at all. `receiveStock` is the only writer of `unitCost` and it
    // stamps `glAccount` in the same breath, so the two travel together.
    throw new UnprocessableEntityError(
      `Stock movement ${movementId} carries no frozen unit cost and cannot be reversed. Adjust the stock instead.`
    )
  }

  return {
    partId,
    type,
    quantity,
    costBasis: read('stock_movement_cost_basis')?.optionId ?? null,
    unitCost,
    glAccount,
    vendorUnitPrice: read('stock_movement_vendor_unit_price')?.valueNumber ?? null,
    vendorPartId: read('stock_movement_vendor_part')?.relatedEntityId ?? null,
    purchaseOrderLineId: read('stock_movement_purchase_order_line')?.relatedEntityId ?? null,
    reversesMovementId: read('stock_movement_reverses_movement')?.relatedEntityId ?? null,
  }
}

/**
 * Step 2: does a live movement already point its `reversesMovement` at this one?
 *
 * Joins `EntityInstance` so an archived reversal does not block a legitimate
 * second attempt — an archived row contributes nothing to either roll-up, so
 * treating it as a standing reversal would leave the mistake uncorrectable.
 */
async function hasReversal(
  db: Database,
  organizationId: string,
  reversesFieldId: string,
  movementId: string
): Promise<boolean> {
  const [existing] = await db
    .select({ id: schema.EntityInstance.id })
    .from(schema.FieldValue)
    .innerJoin(
      schema.EntityInstance,
      and(
        eq(schema.EntityInstance.id, schema.FieldValue.entityId),
        eq(schema.EntityInstance.organizationId, schema.FieldValue.organizationId)
      )
    )
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.fieldId, reversesFieldId),
        eq(schema.FieldValue.relatedEntityId, movementId),
        isNull(schema.EntityInstance.archivedAt)
      )
    )
    .limit(1)

  return Boolean(existing)
}

interface WriteReversalArgs {
  movementDefId: string
  originalMovementId: string
  original: OriginalMovement
  reason: string | undefined
  occurredAt: Date
}

/**
 * Step 4: write the one opposite movement.
 *
 * Values are keyed by `systemAttribute` and go through `UnifiedCrudHandler`, the
 * same mechanism `writeReceiveMovement` uses and for the same reason: a direct
 * `EntityInstance` + `FieldValue` insert writes rows the post-commit triggers
 * (QoH recalculation, the purchase-order roll-up, timeline, realtime) never hear
 * about — and the roll-up firing is the entire point of copying the
 * `purchaseOrderLine` across.
 *
 * 🛑 **`adjustSubparts: false` is load-bearing, not a default.**
 * `explodeBomMovement` inherits the parent movement's type AND its sign, so a
 * reversal with the flag set would explode the negation across every descendant
 * in the BOM — undoing one receipt of 10 motors would also move 10 of every
 * screw inside them. Undoing a purchase moves the purchased item and nothing
 * else, exactly as the receipt it undoes did.
 */
async function writeReversal(
  db: Database,
  organizationId: string,
  userId: string,
  args: WriteReversalArgs
): Promise<MovementRecord> {
  const { movementDefId, originalMovementId, original, reason, occurredAt } = args

  const partDefId = await requireDefId(organizationId, 'part')
  const quantity = -original.quantity
  const unitCost = original.unitCost
  // Recomputed rather than negated from the stored total: `computeExtendedCost`
  // rounds AFTER multiplying, so deriving it here keeps a reversal identical in
  // magnitude to the receipt it undoes without depending on a stored number the
  // original may never have carried.
  const extendedCost = computeExtendedCost(unitCost, quantity)

  const values: Record<string, unknown> = {
    stock_movement_part: toRecordId(partDefId, original.partId),
    stock_movement_type: reversalTypeFor(original.type),
    stock_movement_quantity: quantity,
    // See the JSDoc above. Never true on a reversal.
    stock_movement_adjust_subparts: false,
    stock_movement_unit_cost: unitCost,
    stock_movement_extended_cost: extendedCost,
    stock_movement_gl_account: original.glAccount,
    stock_movement_occurred_at: occurredAt.toISOString(),
    stock_movement_reverses_movement: toRecordId(movementDefId, originalMovementId),
  }

  // The basis follows the cost. A row carrying the original's frozen `actual`
  // cost is still an `actual`, and re-deciding it here would let a reversal
  // disagree with the movement it is a copy of.
  if (original.costBasis) values.stock_movement_cost_basis = original.costBasis
  if (original.vendorUnitPrice != null) {
    values.stock_movement_vendor_unit_price = original.vendorUnitPrice
  }
  if (reason) values.stock_movement_reason = reason

  if (original.vendorPartId) {
    const vendorPartDefId = await requireDefId(organizationId, 'vendor_part')
    values.stock_movement_vendor_part = toRecordId(vendorPartDefId, original.vendorPartId)
  }

  if (original.purchaseOrderLineId) {
    // The copy that makes `purchase_order_line_quantity_received` roll back for
    // free: the roll-up re-SUMs every movement pointing at the line, so the
    // negative quantity decrements it with no change to the roll-up itself.
    const lineDefId = await requireDefId(organizationId, 'purchase_order_line')
    values.stock_movement_purchase_order_line = toRecordId(lineDefId, original.purchaseOrderLineId)
  }

  const crud = new UnifiedCrudHandler(organizationId, userId, db)
  const created = await crud.create(movementDefId, values)

  return {
    movementId: created.instance.id,
    recordId: toRecordId(movementDefId, created.instance.id),
    partInstanceId: original.partId,
    quantity,
    unitCost,
    extendedCost,
    vendorUnitPrice: original.vendorUnitPrice,
    vendorPartId: original.vendorPartId,
    glAccount: original.glAccount,
    occurredAt,
    purchaseOrderLineId: original.purchaseOrderLineId,
  }
}

/** See {@link REVERSAL_TYPE_BY_ORIGINAL} for why an unmapped type is an `adjust`. */
function reversalTypeFor(originalType: string): string {
  return REVERSAL_TYPE_BY_ORIGINAL[originalType] ?? StockMovementType.ADJUST
}

/**
 * Resolve a def id the ORIGINAL movement already committed us to, as an
 * `UnprocessableEntityError` rather than the bare `Error` the cache helper
 * throws — "the movement you are undoing names a purchase order line and this
 * org has no purchase orders" is a 422 the UI can act on, not a 500.
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
