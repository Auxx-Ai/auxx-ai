// packages/lib/src/inventory/builds/price-build.ts
//
// The last leg of a pending build was just priced: stamp what `completeBuild`
// skipped and post the build's one entry (111 Q18). Called by the pricer only.

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { postInventoryDocument } from '../../accounting/ledger/post/post-inventory-document'
import type { PostResult } from '../../accounting/ledger/types'
import { getOrgCache } from '../../cache'
import { UnprocessableEntityError } from '../../errors'
import { UnifiedCrudHandler } from '../../resources/crud/unified-handler'
import { StockMovementType } from '../../resources/registry/enum-values'
import type { RecordId } from '../../resources/resource-id'
import { loadPartAbsorptionRates } from '../costing/standard-cost-queries'
import {
  getBuild,
  readBuildMovements,
  requireBuildContext,
  requireBuildMovementContext,
} from './build-queries'
import { summarizeBuildCompletion } from './client'
import { publishBuildUpdate } from './complete-build'
import { buildWriteSession } from './write-lane'

const logger = createScopedLogger('builds:price')

export interface FinishPricedBuildResult {
  /** `false` when a leg is still pending: nothing was stamped or posted. */
  finished: boolean
  post: PostResult | null
}

/**
 * Summarise a build whose legs are all valued, stamp material / produced value / variance onto
 * it, and post kind `build`. A build with any pending leg is left alone. Labour and overhead were
 * stamped at completion (they never depended on a standard) and are read back, not recomputed.
 */
export async function finishPricedBuild(
  db: Database,
  organizationId: string,
  buildId: string
): Promise<FinishPricedBuildResult> {
  const [ctx, movementCtx] = await Promise.all([
    requireBuildContext(organizationId),
    requireBuildMovementContext(organizationId),
  ])
  const legs = await readBuildMovements(db, organizationId, movementCtx, buildId)
  if (legs.length === 0 || legs.some((leg) => leg.extendedCost == null)) {
    return { finished: false, post: null }
  }
  const build = await getBuild(db, organizationId, buildId)
  if (build.isErr()) throw build.error
  if (!build.value?.partId) {
    throw new UnprocessableEntityError(`Build ${buildId} was not found or names no part`, {
      buildId,
    })
  }
  const record = build.value
  const partId = record.partId as string
  const produce = legs.find((leg) => leg.type === StockMovementType.BUILD_PRODUCE)
  if (!produce || produce.unitCost == null) {
    throw new UnprocessableEntityError(`Build ${buildId} has no valued produce leg`, { buildId })
  }

  const rates = await loadPartAbsorptionRates(db, organizationId, partId)
  const summary = summarizeBuildCompletion({
    // Consume rows store the negated cost; the plan's lines are positive.
    components: legs
      .filter((leg) => leg.type === StockMovementType.BUILD_CONSUME)
      .map((leg) => ({ extendedCost: -(leg.extendedCost as number) })),
    producedUnitCost: produce.unitCost,
    quantityProduced: record.quantityProduced ?? produce.quantity,
    quantityScrapped: record.quantityScrapped ?? 0,
    laborCost: record.laborCost,
    overheadCost: record.overheadCost,
    rates,
  })

  const userId = await getOrgCache().get(organizationId, 'systemUser')
  const crud = new UnifiedCrudHandler(organizationId, userId, db, undefined, {
    session: buildWriteSession(),
  })
  await crud.update(record.recordId as RecordId, {
    build_material_cost: summary.materialCost,
    build_labor_cost: summary.laborCost,
    build_overhead_cost: summary.overheadCost,
    build_produced_value: summary.producedValue,
    build_variance_amount: summary.varianceAmount,
  })
  publishBuildUpdate(
    organizationId,
    ctx,
    {
      buildId,
      recordId: record.recordId,
      quantityProduced: record.quantityProduced ?? produce.quantity,
      quantityScrapped: record.quantityScrapped ?? 0,
      ...summary,
      pendingPartIds: [],
      movementIds: legs.map((leg) => leg.movementId),
      recalculatedPartIds: [],
    },
    record.completedAt ?? new Date()
  )

  // The poster reads the build back, so the stamps above are what its `absorbed` carries.
  const post = await postInventoryDocument(
    db,
    organizationId,
    legs.map((leg) => ({
      movementId: leg.movementId,
      partInstanceId: leg.partId,
      type: leg.type,
      quantity: leg.quantity,
      extendedCost: leg.extendedCost as number,
      glAccount: leg.glAccount,
      occurredAt: record.completedAt ?? new Date(),
      buildId,
    })),
    { actorUserId: userId }
  )
  logger.info('Priced a pending build', {
    organizationId,
    buildId,
    varianceAmount: summary.varianceAmount,
    posted: post?.status ?? null,
  })
  return { finished: true, post }
}
