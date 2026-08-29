// packages/lib/src/receiving/open-stock-balance.ts

/**
 * `openStockBalance` — a part's opening balance: quantity and cost, once.
 *
 * plans/money/tasks/15-costing-usability.md §2.2.
 *
 * Writes one `stock_movement` of type **`initial`** ("Initial Stock"), a value
 * that has existed in `StockMovementType` since the ledger was built and that
 * nothing has ever written.
 *
 * 🛑 **This is beside `adjustStock`, never part of it.** `G12` removed
 * `adjustStock`'s unit-cost input because *"an adjustment has no supplier row,
 * no purchase order and no packing slip — there is no ACTUAL to record."* An
 * opening balance is the one case where there IS one: what was paid for the
 * stock being held on day one. That is why `initial` is its own movement type,
 * and why the cost here is typed by a person while an adjustment's never is.
 *
 * **`adjustStock` still takes no unit cost. Do not add one.**
 *
 * The order of the steps is the contract:
 *
 * 1. `quantity > 0` and `unitCost > 0`, or refuse. The same hard refusal
 *    `receiveStock` gives at zero cost, and for the same reason: a zero frozen
 *    onto an append-only row is a number the ledger can never explain.
 * 2. 🛑 Refuse if the part already has ANY `stock_movement`. Opening is once,
 *    and this guard is what stops the create form becoming a back door into
 *    hand-valuing an adjustment.
 * 3. `ensureStandardCost` with `kind: 'opening-stock'` and this `unitCost`.
 * 4. Write the movement at that standard, `cost_basis: standard`, with
 *    `gl_account` from `resolveInventoryRoleForPartKind`.
 * 5. `recalculatePartQoH`.
 *
 * No permission checks: the router asserts (`docs/lib-module-guide.md` §6).
 */

import { type Database, schema } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import { ensureStandardCost } from '../builds/ensure-standard-cost'
import { getCachedEntityDefId, getOrgCache, requireCachedEntityDefId } from '../cache'
import { BadRequestError, NotFoundError, UnprocessableEntityError } from '../errors'
import { UnifiedCrudHandler } from '../resources/crud/unified-handler'
import { StockMovementCostBasis, StockMovementType } from '../resources/registry/enum-values'
import { toRecordId } from '../resources/resource-id'
import { computeExtendedCost, resolveInventoryRoleForPartKind } from './client'
import { assertCostFieldsMaterialized } from './cost-fields'
import { guard } from './guard'
import { readPartKind, readPartStandardCost } from './receipt-queries'
import type { MovementRecord, OpenStockBalanceInput } from './types'

export type { OpenStockBalanceInput } from './types'

/**
 * Set a part's opening balance.
 *
 * @throws UnprocessableEntityError when the quantity or cost is not strictly
 * positive, or when the part already has movements.
 */
export async function openStockBalance(
  db: Database,
  organizationId: string,
  userId: string,
  input: OpenStockBalanceInput
): Promise<Result<MovementRecord, Error>> {
  return guard(
    async () => {
      assertOpeningQuantity(input.quantity)
      assertOpeningUnitCost(input.unitCost)

      const partDefId = await requireCachedEntityDefId(organizationId, 'part')
      const movementDefId = await getCachedEntityDefId(organizationId, 'stock_movement')
      if (!movementDefId) {
        throw new NotFoundError('This organization has no stock_movement entity definition')
      }
      await assertCostFieldsMaterialized(
        organizationId,
        'Opening stock is not available until the stock movement cost fields are provisioned'
      )

      await assertPartHasNoMovements(db, organizationId, movementDefId, input.partId)

      const kind = await readPartKind(db, organizationId, input.partId)
      if (kind.isErr()) throw kind.error
      const glAccount = resolveInventoryRoleForPartKind(kind.value)

      await setFirstStandardCost(db, organizationId, input)

      return writeInitialMovement(db, organizationId, userId, {
        movementDefId,
        partDefId,
        input,
        glAccount,
        occurredAt: input.occurredAt ?? new Date(),
      })
    },
    'Failed to set opening stock balance',
    { organizationId, partId: input.partId, quantity: input.quantity }
  )
}

/**
 * Step 1a: the opening quantity must be a finite number strictly above zero.
 *
 * `Number.isFinite` is checked as well as the sign for the reason
 * `assertReceivableQuantity` states: `NaN > 0` is false but so is `NaN <= 0`,
 * and an `Infinity` quantity multiplies into an `extendedCost` of `Infinity`
 * that `Math.round` preserves and every later `SUM` is then poisoned by.
 *
 * A negative opening balance is refused rather than reinterpreted. Starting life
 * owing stock is not an opening balance, it is a count correction, and that door
 * is `adjustStock`.
 */
function assertOpeningQuantity(quantity: number): void {
  if (!Number.isFinite(quantity)) {
    throw new BadRequestError('Opening quantity must be a finite number')
  }
  if (quantity <= 0) {
    throw new BadRequestError(
      'Opening quantity must be greater than zero. A part with no stock needs no opening balance.'
    )
  }
}

/**
 * Step 1b: the opening unit cost must be a finite whole number above zero.
 *
 * The same hard refusal `receiveStock` gives at zero, and for the same reason: a
 * zero frozen onto an append-only row sums into the inventory balance as
 * nothing and cannot be told apart from a genuinely free part.
 *
 * Unlike a receipt this does NOT round a fractional input down into a legal
 * value. A receipt derives its cost from supplier terms and rounds the result;
 * an opening balance is typed, in whole minor units, by a person looking at what
 * was paid, so a fraction arriving here means the caller is working in the wrong
 * units and silently rounding it would freeze that mistake forever.
 */
function assertOpeningUnitCost(unitCost: number): void {
  if (!Number.isFinite(unitCost) || !Number.isInteger(unitCost)) {
    throw new BadRequestError('Opening unit cost must be a whole number of minor units')
  }
  if (unitCost <= 0) {
    throw new UnprocessableEntityError(
      'Refusing to open a stock balance at zero cost. Enter what a unit actually cost.'
    )
  }
}

/**
 * Step 2: the load-bearing guard. Opening is once.
 *
 * 🛑 Without it the create form becomes a back door into hand-valuing an
 * adjustment: `initial` is the only movement type that accepts a caller's cost,
 * so a second one against a part that already has a ledger would let anybody
 * state any value for any quantity, at any date, on an append-only row nobody
 * can edit afterwards.
 *
 * ⚠️ Read-then-write with no DB constraint behind it, exactly like
 * `reverseMovement`'s double-reversal guard, and best-effort for the same
 * reason: there is no uniqueness a `FieldValue` row can express. Two opening
 * balances raced through at the same instant would both pass. That is a far
 * narrower window than the one this closes, and the create form is the only
 * caller.
 *
 * The query lives here rather than in `receipt-queries.ts` because it is not a
 * receipt read: it is this writer's own precondition and has no other caller.
 *
 * Archived movements still count. A soft-deleted movement is a movement that
 * happened, and letting an archive re-open the door would make the guard
 * bypassable by anybody who could archive a row.
 */
async function assertPartHasNoMovements(
  db: Database,
  organizationId: string,
  movementDefId: string,
  partId: string
): Promise<void> {
  const fields = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes(['stock_movement_part'])
  const partField = fields.stock_movement_part
  if (!partField) {
    throw new UnprocessableEntityError(
      'This organization has no stock_movement part field, so an opening balance cannot be linked to a part'
    )
  }

  const [existing] = await db
    .select({ id: schema.EntityInstance.id })
    .from(schema.EntityInstance)
    .innerJoin(
      schema.FieldValue,
      and(
        eq(schema.FieldValue.entityId, schema.EntityInstance.id),
        eq(schema.FieldValue.organizationId, schema.EntityInstance.organizationId),
        eq(schema.FieldValue.fieldId, partField.id)
      )
    )
    .where(
      and(
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityInstance.entityDefinitionId, movementDefId),
        eq(schema.FieldValue.relatedEntityId, partId)
      )
    )
    .limit(1)

  if (existing) {
    throw new UnprocessableEntityError(
      'This part already has stock movements, so it cannot be given an opening balance. An opening balance is the first thing that ever happens to a part; correct a count with an adjustment instead.',
      { partId }
    )
  }
}

/**
 * Step 3: the part must come out of this holding a standard cost.
 *
 * `ensureStandardCost` writes only where `part_standard_cost IS NULL`, so a part
 * somebody already rolled keeps the standard it has and this is a no-op.
 *
 * 🛑 **An error here fails the whole write.** `ensureStandardCost` is documented
 * as never throwing on an unvaluable part, because its other callers are
 * post-commit hooks; a genuine failure returned here is different. Writing the
 * movement anyway would produce the one state the whole subsystem is built to
 * exclude: a part holding stock with no standard to value it at, which then
 * refuses every later adjustment and build.
 *
 * The post-condition is verified rather than assumed, for the same reason: the
 * caller supplied a cost, so "no standard afterwards" can only mean something
 * upstream declined to write, and finding that out before the ledger row exists
 * is the difference between a refusal and a mess.
 */
async function setFirstStandardCost(
  db: Database,
  organizationId: string,
  input: OpenStockBalanceInput
): Promise<void> {
  const ensured = await ensureStandardCost(db, organizationId, [input.partId], {
    kind: 'opening-stock',
    unitCost: input.unitCost,
  })
  if (ensured.isErr()) throw ensured.error

  const standard = await readPartStandardCost(db, organizationId, input.partId)
  if (standard.isErr()) throw standard.error

  const { standardCost, displayName } = standard.value
  if (standardCost == null || !Number.isFinite(standardCost)) {
    const partLabel = displayName ? `"${displayName}"` : `part ${input.partId}`
    throw new UnprocessableEntityError(
      `Could not set a standard cost for ${partLabel}, so its opening stock was not recorded. Stock that carries no standard cost cannot be adjusted, built or closed.`,
      { partId: input.partId }
    )
  }
}

interface WriteInitialMovementArgs {
  movementDefId: string
  partDefId: string
  input: OpenStockBalanceInput
  /** The inventory account ROLE, resolved from `partKind` at write time. */
  glAccount: string
  occurredAt: Date
}

/**
 * Step 4: write the one movement, and let step 5 happen on its own.
 *
 * Values are keyed by `systemAttribute` and go through `UnifiedCrudHandler`
 * rather than a hand-built `EntityInstance` + `FieldValue` insert, the same
 * mechanism `writeAdjustMovement` and `writeReceiveMovement` use. That is what
 * makes the post-commit triggers fire, and `recalculatePartQoH` (step 5) is one
 * of them: quantity on hand has exactly one owner, the
 * `mfg-stock-movements-created` rule, and a second writer here would give the
 * same number two.
 *
 * 🛑 **The `unit_cost` is the CALLER's number, and this is the only movement
 * writer where that is true.** Everywhere else a caller-supplied cost is a
 * defect: `adjustStock` reads the standard because a count has no invoice
 * (`G12`), and `receiveStock`'s `unitCost` seam is internal to lib and rejected
 * by the router's input schema. Here the number IS the fact being recorded, and
 * step 3 has just made the part's standard agree with it, so the opening balance
 * carries no variance by construction.
 *
 * 🛑 **`adjustSubparts: false` is load-bearing, not a default.**
 * `explodeBomMovement` inherits the parent movement's type AND its sign, so an
 * opening balance with the flag set would open a balance for every component in
 * the bill of materials as well: ten assemblies on the shelf would claim ten of
 * every screw inside them, on top of whatever opening balance those screws were
 * given in their own right. An opening count counts what is on the shelf, and
 * the assemblies and their loose components are counted separately.
 */
async function writeInitialMovement(
  db: Database,
  organizationId: string,
  userId: string,
  args: WriteInitialMovementArgs
): Promise<MovementRecord> {
  const { movementDefId, partDefId, input, glAccount, occurredAt } = args
  const { quantity, unitCost } = input
  const extendedCost = computeExtendedCost(unitCost, quantity)

  const values: Record<string, unknown> = {
    stock_movement_part: toRecordId(partDefId, input.partId),
    stock_movement_type: StockMovementType.INITIAL,
    stock_movement_quantity: quantity,
    // See the JSDoc above. Never true on an opening balance.
    stock_movement_adjust_subparts: false,
    stock_movement_occurred_at: occurredAt.toISOString(),
    // `standard`, not `actual`. There is no vendor row, no purchase order and no
    // packing slip behind an opening balance, and step 3 has just made this cost
    // BE the part's standard, so `standard` is the honest description of it.
    stock_movement_cost_basis: StockMovementCostBasis.STANDARD,
    stock_movement_unit_cost: unitCost,
    stock_movement_extended_cost: extendedCost,
    stock_movement_gl_account: glAccount,
  }

  // `stock_movement` has no notes attribute; `reason` is the free-text field on
  // the row and 'Opening count 2026-01-01' is exactly what it is for.
  if (input.notes) values.stock_movement_reason = input.notes

  const crud = new UnifiedCrudHandler(organizationId, userId, db)
  const created = await crud.create(movementDefId, values)

  return {
    movementId: created.instance.id,
    recordId: toRecordId(movementDefId, created.instance.id),
    partInstanceId: input.partId,
    quantity,
    unitCost,
    extendedCost,
    // An opening balance is not a purchase: nothing was bought and nobody sold
    // it to us on this date. There is no supplier to state.
    vendorUnitPrice: null,
    vendorPartId: null,
    glAccount,
    occurredAt,
    purchaseOrderLineId: null,
  }
}
