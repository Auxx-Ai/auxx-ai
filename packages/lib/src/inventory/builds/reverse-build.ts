// packages/lib/src/inventory/builds/reverse-build.ts

/**
 * `reverseBuild` - the inverse of {@link completeBuild}. plans/products/build/01-build-plan.md
 * section 3.4, README B6.
 *
 * A completed build is never edited or deleted; a second build negates its movements at the
 * ORIGINAL's frozen costs. Not `reverseMovement`: that re-types build legs to `adjust`, carries no
 * `buildId` or `qtyPerUnit`, and writes one row outside any transaction. Each negation points its
 * `reversesMovementId` at the row it undoes, so the unique index refuses a second correction.
 * No permission checks (`docs/lib-module-guide.md` section 6).
 */

import type { Database, Transaction } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { Result } from 'neverthrow'
import {
  linkMovementsToPosting,
  reverseInventoryMovementPosting,
} from '../../accounting/ledger/post/post-inventory-movement'
import { BadRequestError, ConflictError, UnprocessableEntityError } from '../../errors'
import { UnifiedCrudHandler } from '../../resources/crud/unified-handler'
import { BuildStatus, StockMovementCostBasis } from '../../resources/registry/enum-values'
import { toRecordId } from '../../resources/resource-id'
import {
  type StockMovementInput,
  type StockMovementTouched,
  settleStockMovements,
  writeStockMovements,
} from '../movements'
import { BUILD_STATUS_BYPASS, requireDefId } from './build-mutations'
import {
  assertBuildStatus,
  type BuildContext,
  hasBuildReversal,
  lockBuild,
  readBuildMovements,
  requireBuildContext,
} from './build-queries'
import { canReverseBuild } from './client'
import { guard } from './guard'
import type { BuildRecord, ReverseBuildInput, ReverseBuildResult } from './types'
import { buildWriteSession, publishQuietBuildWrites } from './write-lane'

const logger = createScopedLogger('builds:reverse')

/**
 * Undo a completed build by writing its negation.
 *
 * The order of the steps is the contract:
 *
 * 1. Re-read the original `FOR UPDATE`; refuse unless it is `completed`. A
 *    `planned` build has written nothing (B2) - cancel it instead.
 * 2. Refuse a build that is ALREADY reversed (`ConflictError`). A second
 *    reversal would double the negation, and because every roll-up downstream
 *    re-SUMs rather than increments, the wrong number would look exactly as
 *    authoritative as the right one.
 * 3. Refuse to reverse a reversal (`BadRequestError`). The correction of an
 *    over-correction is a fresh build, not a chain of undos - a chain makes "is
 *    this build live?" a graph walk instead of a lookup.
 * 4. Write ONE new build plus one negated movement per original movement, in a
 *    single transaction, carrying the originals' frozen costs verbatim.
 *
 * Then, after the commit, `settleStockMovements`, as `completeBuild` does.
 */
export async function reverseBuild(
  db: Database,
  organizationId: string,
  userId: string,
  input: ReverseBuildInput
): Promise<Result<ReverseBuildResult, Error>> {
  return guard(
    async () => {
      const [ctx, partDefId] = await Promise.all([
        requireBuildContext(organizationId),
        requireDefId(organizationId, 'part'),
      ])

      if (!ctx.fields.build_reversal_of) {
        // Without it there is no way to record WHAT this build undoes, and
        // therefore no way to refuse the second reversal in step 2.
        throw new UnprocessableEntityError(
          'Reversing a build is not available until the build reversal fields are provisioned'
        )
      }

      const occurredAt = input.occurredAt ?? new Date()
      const { result, touched } = await db.transaction(async (tx) =>
        writeReversal(tx, organizationId, userId, { ctx, partDefId, input, occurredAt })
      )

      await settleStockMovements(organizationId, touched)

      // B6's undo reaches the ledger as a REVERSAL of the original build's own
      // entry, never a second opposite entry: the reversal carries the frozen
      // lines and frees the claim, and the negating movements are linked onto it
      // so the close does not read them as work still outstanding.
      const reversed = await reverseInventoryMovementPosting(db, {
        organizationId,
        subject: { sourceKind: 'build', sourceId: result.reversalOfBuildId },
        actorUserId: userId,
        memo: input.reason,
      })
      if (reversed?.glPostingId) {
        await linkMovementsToPosting(db, {
          organizationId,
          glPostingId: reversed.glPostingId,
          movementIds: result.movementIds,
        })
      }
      // A reversal CREATES a build on the quiet lane; without this no open builds list learns of it.
      publishQuietBuildWrites(organizationId, ctx.defId, [result.buildId])

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
  ctx: BuildContext
  partDefId: string
  input: ReverseBuildInput
  occurredAt: Date
}

async function writeReversal(
  tx: Transaction,
  organizationId: string,
  userId: string,
  args: WriteReversalArgs
): Promise<{ result: ReverseBuildResult; touched: StockMovementTouched }> {
  const { ctx, partDefId, input, occurredAt } = args
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

  const movements = await readBuildMovements(tx, organizationId, original.buildId)
  if (movements.length === 0) {
    throw new UnprocessableEntityError(
      'This build wrote no stock movements, so there is nothing to reverse'
    )
  }

  // Step 4. The same quiet lane the completion takes; see `write-lane.ts`.
  const reversalSession = buildWriteSession()
  const crud = new UnifiedCrudHandler(organizationId, userId, txDb, undefined, {
    session: reversalSession,
    // 🛑 The reversing build is CREATED at `completed` (there is no planned reversal), and
    // the field pre-hook chain has no `operation === 'create'` exemption - a create carrying
    // a guarded value is refused exactly like an update. Without this, B6's only correction
    // for a posted run stops working.
    bypassFieldGuards: BUILD_STATUS_BYPASS,
  })

  // Resolved only when the original names one, so an org with no orders is
  // never asked for an `order` def it does not have.
  const orderDefId = original.orderId ? await requireDefId(organizationId, 'order') : null

  const reversalBuild = await crud.create(
    ctx.defId,
    reversalBuildValues(ctx, partDefId, original, input, occurredAt, orderDefId)
  )
  const reversalRecordId = toRecordId(ctx.defId, reversalBuild.instance.id)

  // One negated movement per original, in one batch.
  const movementInputs: StockMovementInput[] = movements.map((movement) => {
    const quantity = -movement.quantity
    return {
      partInstanceId: movement.partId,
      // 🛑 The TYPE is carried verbatim. A negated `build_consume` is still the
      // consume leg of a build; re-labelling it would break the pairing that
      // makes `SUM` over `build_consume` mean "material issued to production".
      type: movement.type,
      quantity,
      // 🛑 The ORIGINAL's frozen cost, never today's. A reversal valued at the
      // current standard nets a build and its undo to a non-zero amount of
      // inventory value out of nothing.
      unitCost: movement.unitCost,
      extendedCost: movement.extendedCost != null ? -movement.extendedCost : undefined,
      // The basis follows the cost: a row carrying the original's frozen
      // `standard` cost is still a `standard`, and re-deciding it here would
      // let a reversal disagree with the movement it is a copy of.
      costBasis: movement.costBasis ?? StockMovementCostBasis.STANDARD,
      glRole: movement.glRole ?? undefined,
      occurredAt,
      // Copied, not recomputed. The as-built snapshot describes the run that
      // happened, and the reversal describes the same run.
      qtyPerUnit: movement.qtyPerUnit,
      reason: input.reason,
      links: {
        buildId: reversalBuild.instance.id,
        reversesMovementId: movement.movementId,
      },
    }
  })

  const written = await writeStockMovements({ db: tx, organizationId, userId }, movementInputs)
  if (written.isErr()) throw written.error

  return {
    result: {
      buildId: reversalBuild.instance.id,
      recordId: reversalRecordId,
      reversalOfBuildId: original.buildId,
      movementIds: written.value.records.map((record) => record.id),
      recalculatedPartIds: written.value.touched.partIds,
    },
    touched: written.value.touched,
  }
}

/**
 * The reversing build's own row.
 *
 * Every quantity and every cost is the original's, negated. It lands
 * `completed` because it IS complete the moment it is written - there is no
 * planned reversal - and its `completedAt` is the reversal's accounting date,
 * not the original's, so the correction falls in the period it was made rather
 * than reopening the period being corrected.
 *
 * Negating the quantities as well as the costs is what makes any report that
 * sums build output over a range net to zero across the pair. A reversal with a
 * positive `quantityProduced` would double-count production while its movements
 * cancelled out - two answers to "how many did we build", both from our own
 * data.
 */
function reversalBuildValues(
  ctx: BuildContext,
  partDefId: string,
  original: BuildRecord,
  input: ReverseBuildInput,
  occurredAt: Date,
  orderDefId: string | null
): Record<string, unknown> {
  const values: Record<string, unknown> = {
    build_status: BuildStatus.COMPLETED,
    build_reversal_of: toRecordId(ctx.defId, original.buildId),
  }
  if (original.partId) {
    values.build_part = toRecordId(partDefId, original.partId)
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
