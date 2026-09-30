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
import { BuildStatus, StockMovementCostBasis } from '../../resources/registry/enum-values'
import {
  type StockMovementInput,
  type StockMovementTouched,
  settleStockMovements,
  writeStockMovements,
} from '../movements'
import { assertBuildStatus, hasBuildReversal, lockBuild, readBuildMovements } from './build-queries'
import { publishBuildsChanged } from './build-realtime'
import { insertBuild, type NewBuild } from './build-writes'
import { canReverseBuild } from './client'
import { guard } from './guard'
import type { BuildRecord, ReverseBuildInput, ReverseBuildResult } from './types'

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
 *    single transaction, carrying the originals' frozen costs verbatim. The build goes first:
 *    `Build_reversalOfBuildId_key` refuses a racing second reversal before any movement.
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
      const occurredAt = input.occurredAt ?? new Date()
      const { result, reversal, touched } = await db.transaction(async (tx) =>
        writeReversal(tx, organizationId, userId, { input, occurredAt })
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
      await publishBuildsChanged(organizationId, [reversal])

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
  input: ReverseBuildInput
  occurredAt: Date
}

async function writeReversal(
  tx: Transaction,
  organizationId: string,
  userId: string,
  args: WriteReversalArgs
): Promise<{ result: ReverseBuildResult; reversal: BuildRecord; touched: StockMovementTouched }> {
  const { input, occurredAt } = args

  // Step 1.
  const original = await lockBuild(tx, organizationId, input.buildId)
  assertBuildStatus(
    original,
    canReverseBuild,
    'Only a completed build can be reversed. Cancel a planned or in-progress run instead.'
  )

  // Step 2.
  if (await hasBuildReversal(tx, organizationId, original.buildId)) {
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

  // Step 4.
  const reversal = await insertBuild(
    tx,
    organizationId,
    userId,
    reversalBuildValues(original, input, occurredAt)
  )

  // One negated movement per original, in one batch.
  const movementInputs: StockMovementInput[] = movements.map((movement) => {
    const quantity = -movement.quantity
    return {
      partInstanceId: movement.partId,
      // Carried verbatim: a negated consume is still a consume, so SUM(build_consume) stays "issued".
      type: movement.type,
      quantity,
      // The original's frozen cost, never today's, so the pair nets to zero.
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
        buildId: reversal.buildId,
        reversesMovementId: movement.movementId,
      },
    }
  })

  const written = await writeStockMovements({ db: tx, organizationId, userId }, movementInputs)
  if (written.isErr()) throw written.error

  return {
    reversal,
    result: {
      buildId: reversal.buildId,
      reversalOfBuildId: original.buildId,
      movementIds: written.value.records.map((record) => record.id),
      recalculatedPartIds: written.value.touched.partIds,
    },
    touched: written.value.touched,
  }
}

/**
 * The reversing build's row: every quantity and cost the original's, negated, so a sum over the
 * pair nets to zero. It lands `completed`, dated at the reversal, so the correction falls in the
 * period it was made. `source` and `orderId` are carried; run, period and order stamp are not.
 */
function reversalBuildValues(
  original: BuildRecord,
  input: ReverseBuildInput,
  occurredAt: Date
): NewBuild {
  const negate = (value: number | null): number | null => (value == null ? null : -value)
  return {
    partId: original.partId,
    status: BuildStatus.COMPLETED,
    source: original.source,
    reversalOfBuildId: original.buildId,
    quantityPlanned: null,
    quantityProduced: negate(original.quantityProduced),
    quantityScrapped: negate(original.quantityScrapped),
    materialCost: negate(original.materialCost),
    laborCost: negate(original.laborCost),
    overheadCost: negate(original.overheadCost),
    producedValue: negate(original.producedValue),
    varianceAmount: negate(original.varianceAmount),
    completedAt: occurredAt,
    orderId: original.orderId,
    notes: input.reason || null,
  }
}
