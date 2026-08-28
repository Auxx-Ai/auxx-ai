// packages/lib/src/builds/reverse-build.ts

/**
 * `reverseBuild` — the inverse of {@link completeBuild}.
 *
 * plans/products/build/01-build-plan.md section 3.4, README B6.
 *
 * 🛑 **A completed build is never edited or deleted. It is reversed** by a
 * second build whose movements are the originals' with the sign flipped,
 * carrying the **ORIGINAL's** frozen costs and not today's. A period that has
 * been posted must never change shape, and every field on `stock_movement` is
 * `updatable: false` precisely so that a cost frozen years ago can still be
 * trusted.
 *
 * ## Why this does not reuse `receiving/reverse-movement.ts`
 *
 * That function exists, it is good, and it is the wrong shape here — four ways,
 * each of which would be a silent defect rather than a compile error:
 *
 * 1. **It re-types the row.** Its `REVERSAL_TYPE_BY_ORIGINAL` map deliberately
 *    sends `build_consume` and `build_produce` to `adjust`, with the reasoning
 *    written out in place: undoing a `build_consume` standalone is not a
 *    production run, and labelling it `build_produce` would put a manufacturing
 *    event in the ledger that never happened. That reasoning is right for one
 *    movement corrected on its own and wrong for B6, where the negation belongs
 *    to a reversing BUILD and the pair must be recognisable as one.
 * 2. **It cannot set `stock_movement_build`.** The reversing rows would be
 *    orphaned from the reversing build, `build_movements` would be empty, and
 *    a second reversal would have nothing to read back.
 * 3. **It does not copy `qty_per_unit`**, so the as-built BOM snapshot — the
 *    whole point of that column — is lost on the negation.
 * 4. **It is one movement, on the inline lane, outside any transaction.** A
 *    51-row build would become 51 independently-refusable operations and 51 full
 *    quantity-on-hand re-SUMs, and a failure half way through would leave a
 *    ledger that is neither the build nor its reversal.
 *
 * What IS reused is its two refusals, verbatim in spirit — a build is reversed
 * at most once, and a reversal is never itself reversed — plus
 * `computeExtendedCost`, so a reversal is identical in magnitude to the run it
 * undoes. Every reversing movement also points its
 * `stock_movement_reverses_movement` at the row it negates, which is what makes
 * `reverseMovement`'s own already-reversed guard refuse to correct a movement
 * that this function has already undone.
 *
 * No permission checks. The router asserts (`docs/lib-module-guide.md`
 * section 6).
 */

import type { Database, Transaction } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { Result } from 'neverthrow'
import { BadRequestError, ConflictError, UnprocessableEntityError } from '../errors'
import { computeExtendedCost } from '../receiving/client'
import { UnifiedCrudHandler } from '../resources/crud/unified-handler'
import { BuildStatus, StockMovementCostBasis } from '../resources/registry/enum-values'
import { toRecordId } from '../resources/resource-id'
import { BUILD_STATUS_BYPASS, requireDefId } from './build-mutations'
import {
  assertBuildStatus,
  type BuildFieldContext,
  type BuildMovementFieldContext,
  hasBuildReversal,
  lockBuild,
  readBuildMovements,
  requireBuildFieldContext,
  requireBuildMovementFieldContext,
} from './build-queries'
import { canReverseBuild } from './client'
import { recalculateAfterCommit } from './complete-build'
import { guard } from './guard'
import type { BuildRecord, ReverseBuildInput, ReverseBuildResult } from './types'
import { buildWriteSession } from './write-lane'

const logger = createScopedLogger('builds:reverse')

/**
 * Undo a completed build by writing its negation.
 *
 * The order of the steps is the contract:
 *
 * 1. Re-read the original `FOR UPDATE`; refuse unless it is `completed`. A
 *    `planned` build has written nothing (B2) — cancel it instead.
 * 2. Refuse a build that is ALREADY reversed (`ConflictError`). A second
 *    reversal would double the negation, and because every roll-up downstream
 *    re-SUMs rather than increments, the wrong number would look exactly as
 *    authoritative as the right one.
 * 3. Refuse to reverse a reversal (`BadRequestError`). The correction of an
 *    over-correction is a fresh build, not a chain of undos — a chain makes "is
 *    this build live?" a graph walk instead of a lookup.
 * 4. Write ONE new build plus one negated movement per original movement, in a
 *    single transaction, carrying the originals' frozen costs verbatim.
 *
 * Then, after the commit, one batched quantity-on-hand recalculation — the same
 * rule, and the same reason, as `completeBuild`.
 */
export async function reverseBuild(
  db: Database,
  organizationId: string,
  userId: string,
  input: ReverseBuildInput
): Promise<Result<ReverseBuildResult, Error>> {
  return guard(
    async () => {
      const [ctx, movementCtx] = await Promise.all([
        requireBuildFieldContext(organizationId),
        requireBuildMovementFieldContext(organizationId),
      ])

      if (!ctx.fields.build_reversal_of) {
        // Without it there is no way to record WHAT this build undoes, and
        // therefore no way to refuse the second reversal in step 2.
        throw new UnprocessableEntityError(
          'Reversing a build is not available until the build reversal fields are provisioned'
        )
      }

      const occurredAt = input.occurredAt ?? new Date()
      const result = await db.transaction(async (tx) =>
        writeReversal(tx, organizationId, userId, { ctx, movementCtx, input, occurredAt })
      )

      await recalculateAfterCommit(organizationId, result.recalculatedPartIds)

      logger.info('Reversed build', {
        organizationId,
        reversalOfBuildId: result.reversalOfBuildId,
        buildId: result.buildId,
        movements: result.movementIds.length,
      })

      return result
    },
    'Failed to reverse build',
    { organizationId, buildId: input.buildId }
  )
}

interface WriteReversalArgs {
  ctx: BuildFieldContext
  movementCtx: BuildMovementFieldContext
  input: ReverseBuildInput
  occurredAt: Date
}

async function writeReversal(
  tx: Transaction,
  organizationId: string,
  userId: string,
  args: WriteReversalArgs
): Promise<ReverseBuildResult> {
  const { ctx, movementCtx, input, occurredAt } = args
  const txDb = tx as unknown as Database

  // Step 1.
  const original = await lockBuild(tx, organizationId, ctx, input.buildId)
  assertBuildStatus(
    original,
    canReverseBuild,
    'Only a completed build can be reversed. Cancel a planned or in-progress run instead.'
  )

  // Step 2.
  if (await hasBuildReversal(txDb, organizationId, ctx, original.buildId)) {
    throw new ConflictError(
      'This build has already been reversed. Reversing it again would double the negation.'
    )
  }

  // Step 3.
  if (original.reversalOfBuildId) {
    throw new BadRequestError(
      'This build is itself a reversal and cannot be reversed. Raise a fresh build instead.'
    )
  }

  const movements = await readBuildMovements(txDb, organizationId, movementCtx, original.buildId)
  if (movements.length === 0) {
    throw new UnprocessableEntityError(
      'This build wrote no stock movements, so there is nothing to reverse'
    )
  }

  // Step 4.
  const crud = new UnifiedCrudHandler(organizationId, userId, txDb, undefined, {
    // The same quiet lane the completion takes, for the same reasons — see
    // `write-lane.ts` and `complete-build.ts`'s header.
    session: buildWriteSession(),
    // 🛑 The reversing build is CREATED at `completed` (there is no planned reversal), and
    // the field pre-hook chain has no `operation === 'create'` exemption — a create carrying
    // a guarded value is refused exactly like an update. Without this, B6's only correction
    // for a posted run stops working.
    bypassFieldGuards: BUILD_STATUS_BYPASS,
  })

  // Resolved only when the original names one, so an org with no orders is
  // never asked for an `order` def it does not have.
  const orderDefId = original.orderId ? await requireDefId(organizationId, 'order') : null

  const reversalBuild = await crud.create(
    ctx.buildDefId,
    reversalBuildValues(ctx, movementCtx, original, input, occurredAt, orderDefId)
  )
  const reversalRecordId = toRecordId(ctx.buildDefId, reversalBuild.instance.id)

  const movementIds: string[] = []
  for (const movement of movements) {
    const quantity = -movement.quantity
    const values: Record<string, unknown> = {
      stock_movement_part: toRecordId(movementCtx.partDefId, movement.partId),
      // 🛑 The TYPE is carried verbatim. A negated `build_consume` is still the
      // consume leg of a build; re-labelling it would break the pairing that
      // makes `SUM` over `build_consume` mean "material issued to production".
      stock_movement_type: movement.type,
      stock_movement_quantity: quantity,
      // The build does its own explosion on the way out and on the way back.
      stock_movement_adjust_subparts: false,
      stock_movement_build: reversalRecordId,
      // 🛑 The ORIGINAL's frozen cost, never today's. A reversal valued at the
      // current standard nets a build and its undo to a non-zero amount of
      // inventory value out of nothing.
      stock_movement_unit_cost: movement.unitCost,
      stock_movement_extended_cost:
        movement.extendedCost != null
          ? -movement.extendedCost
          : computeExtendedCost(movement.unitCost, quantity),
      // Points at the row it negates, so `reverseMovement`'s already-reversed
      // guard refuses to correct a movement this build has already undone.
      stock_movement_reverses_movement: toRecordId(movementCtx.movementDefId, movement.movementId),
      stock_movement_occurred_at: occurredAt.toISOString(),
    }
    // The basis follows the cost: a row carrying the original's frozen
    // `standard` cost is still a `standard`, and re-deciding it here would let a
    // reversal disagree with the movement it is a copy of.
    values.stock_movement_cost_basis = movement.costBasis ?? StockMovementCostBasis.STANDARD
    if (movement.glAccount) values.stock_movement_gl_account = movement.glAccount
    // Copied, not recomputed. The as-built snapshot describes the run that
    // happened, and the reversal describes the same run.
    if (movement.qtyPerUnit != null) values.stock_movement_qty_per_unit = movement.qtyPerUnit
    if (input.reason) values.stock_movement_reason = input.reason

    const created = await crud.create(movementCtx.movementDefId, values)
    movementIds.push(created.instance.id)
  }

  return {
    buildId: reversalBuild.instance.id,
    recordId: reversalRecordId,
    reversalOfBuildId: original.buildId,
    movementIds,
    recalculatedPartIds: [...new Set(movements.map((movement) => movement.partId))],
  }
}

/**
 * The reversing build's own row.
 *
 * Every quantity and every cost is the original's, negated. It lands
 * `completed` because it IS complete the moment it is written — there is no
 * planned reversal — and its `completedAt` is the reversal's accounting date,
 * not the original's, so the correction falls in the period it was made rather
 * than reopening the period being corrected.
 *
 * Negating the quantities as well as the costs is what makes any report that
 * sums build output over a range net to zero across the pair. A reversal with a
 * positive `quantityProduced` would double-count production while its movements
 * cancelled out — two answers to "how many did we build", both from our own
 * data.
 */
function reversalBuildValues(
  ctx: BuildFieldContext,
  movementCtx: BuildMovementFieldContext,
  original: BuildRecord,
  input: ReverseBuildInput,
  occurredAt: Date,
  orderDefId: string | null
): Record<string, unknown> {
  const values: Record<string, unknown> = {
    build_status: BuildStatus.COMPLETED,
    build_reversal_of: toRecordId(ctx.buildDefId, original.buildId),
  }
  if (original.partId) {
    values.build_part = toRecordId(movementCtx.partDefId, original.partId)
  }
  const negate = (value: number | null): number | undefined => (value == null ? undefined : -value)

  assign(values, 'build_quantity_produced', negate(original.quantityProduced))
  assign(values, 'build_quantity_scrapped', negate(original.quantityScrapped))
  assign(values, 'build_material_cost', negate(original.materialCost))
  assign(values, 'build_labor_cost', negate(original.laborCost))
  assign(values, 'build_overhead_cost', negate(original.overheadCost))
  assign(values, 'build_produced_value', negate(original.producedValue))
  assign(values, 'build_variance_amount', negate(original.varianceAmount))

  if (ctx.fields.build_completed_at) values.build_completed_at = occurredAt.toISOString()
  // Carried, so "the builds this order caused" finds the correction alongside
  // the run it corrects rather than only the run (products/12 AB7).
  if (orderDefId && original.orderId && ctx.fields.build_order) {
    values.build_order = toRecordId(orderDefId, original.orderId)
  }
  if (original.source) values.build_source = original.source
  if (input.reason && ctx.fields.build_notes) values.build_notes = input.reason
  return values
}

function assign(values: Record<string, unknown>, key: string, value: number | undefined): void {
  if (value !== undefined) values[key] = value
}
