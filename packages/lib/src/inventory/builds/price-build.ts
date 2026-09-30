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
import { StockMovementType } from '../../resources/registry/enum-values'
import { loadPartAbsorptionRates } from '../costing/standard-cost-queries'
import { getBuild, readBuildMovements } from './build-queries'
import { publishBuildsChanged } from './build-realtime'
import { updateBuild } from './build-writes'
import { summarizeBuildCompletion } from './client'

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
  const legs = await readBuildMovements(db, organizationId, buildId)
  if (legs.length === 0 || legs.some((leg) => leg.extendedCost == null)) {
    return { finished: false, post: null }
  }
  const build = await getBuild(db, organizationId, buildId)
  if (build.isErr()) throw build.error
  if (!build.value) {
    throw new UnprocessableEntityError(`Build ${buildId} was not found`, { buildId })
  }
  const record = build.value
  const partId = record.partId
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
  const priced = await db.transaction((tx) =>
    updateBuild(tx, organizationId, buildId, {
      materialCost: summary.materialCost,
      laborCost: summary.laborCost,
      overheadCost: summary.overheadCost,
      producedValue: summary.producedValue,
      varianceAmount: summary.varianceAmount,
    })
  )
  await publishBuildsChanged(organizationId, [priced])

  // The poster reads the build back, so the stamps above are what its `absorbed` carries.
  const post = await postInventoryDocument(
    db,
    organizationId,
    legs.map((leg) => ({
      id: leg.movementId,
      partInstanceId: leg.partId,
      type: leg.type,
      quantity: leg.quantity,
      extendedCost: leg.extendedCost as number,
      glRole: leg.glRole,
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
