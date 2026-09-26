// packages/lib/src/inventory/movements/write-movements-batch.ts

/**
 * `writeStockMovementsBatch` - `writeStockMovements` for many legs through `createEntitiesBatch`, on
 * the quiet lane only, so the stored rows match the per-row CRUD path
 * (plans/mrp/10-batched-build-writes.md §2).
 */

import type { Result } from 'neverthrow'
import { UnprocessableEntityError } from '../../errors'
import { createEntitiesBatch } from '../../resources/crud/create-entities-batch'
import type { WriteSession } from '../../resources/crud/write-origin'
import { toRecordId } from '../../resources/resource-id'
import { movementFactFromInput } from './fact/live'
import { insertMovementFacts } from './fact/writes'
import { guard } from './guard'
import type {
  StockMovementInput,
  StockMovementsCtx,
  WriteStockMovementsResult,
  WrittenStockMovement,
} from './types'
import { assertNoServiceParts, movementValues } from './write-movements'

/**
 * Write `stock_movement` rows for every input in one pass, inside the caller's transaction.
 *
 * Refuses what it does not replicate - a non-quiet lane, reversals, parent links,
 * `adjustSubparts: true` - rather than writing it differently; use `writeStockMovements` for those.
 * Unlike a CRUD create, a field that fails to convert fails the whole batch instead of being dropped.
 */
export async function writeStockMovementsBatch(
  ctx: StockMovementsCtx,
  inputs: StockMovementInput[]
): Promise<Result<WriteStockMovementsResult, Error>> {
  return guard(
    async () => {
      if (inputs.length === 0) return { records: [], affectedPartIds: [] }
      const session = requireQuietSession(ctx)
      assertBatchableInputs(inputs)
      await assertNoServiceParts(ctx, inputs)

      const bags: Record<string, unknown>[] = []
      for (const input of inputs) bags.push(await movementValues(ctx, input))

      const batch = await createEntitiesBatch(
        {
          db: ctx.db,
          organizationId: ctx.organizationId,
          userId: ctx.userId,
          session,
          bypassFieldGuards: ctx.lane.kind === 'quiet' ? ctx.lane.bypassFieldGuards : undefined,
        },
        ctx.movementDefId,
        bags
      )
      if (batch.isErr()) throw batch.error
      const created = batch.value

      await insertMovementFacts(
        ctx.db,
        ctx.organizationId,
        inputs.map((input, index) =>
          movementFactFromInput(created[index]!.id, created[index]!.createdAt, input, new Map())
        )
      )

      const records: WrittenStockMovement[] = inputs.map((input, index) => ({
        movementId: created[index]!.id,
        recordId: toRecordId(ctx.movementDefId, created[index]!.id),
        partInstanceId: input.partInstanceId,
        quantity: input.quantity,
        unitCost: input.unitCost,
        extendedCost: (bags[index]!.stock_movement_extended_cost as number | undefined) ?? null,
        glAccount: input.glAccount ?? null,
        occurredAt: input.occurredAt,
      }))
      return {
        records,
        affectedPartIds: [...new Set(inputs.map((input) => input.partInstanceId))],
      }
    },
    'Failed to write stock movements',
    { organizationId: ctx.organizationId, count: inputs.length }
  )
}

/** A quiet, non-sync session: the lane whose create publishes nothing this writer must replay. */
function requireQuietSession(ctx: StockMovementsCtx): WriteSession {
  const session = ctx.lane.kind === 'quiet' ? ctx.lane.session : null
  if (!session || session.mode?.kind !== 'quiet' || session.origin.kind === 'sync') {
    throw new UnprocessableEntityError('The batched movement writer runs on a quiet session only')
  }
  return session
}

function assertBatchableInputs(inputs: readonly StockMovementInput[]): void {
  for (const input of inputs) {
    if (input.links?.reversesMovementId || input.links?.parentMovementId) {
      throw new UnprocessableEntityError(
        'The batched movement writer does not write reversals or exploded child movements'
      )
    }
    if (input.adjustSubparts) {
      throw new UnprocessableEntityError(
        'The batched movement writer does not write movements that adjust subparts'
      )
    }
  }
}
