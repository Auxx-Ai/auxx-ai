// packages/lib/src/cache/providers/backflush-preview-provider.ts

import type { BackflushPlanSummary } from '../../inventory/builds/backflush-types'
import type { CacheProvider } from '../org-cache-provider'

/** The default-range backflush preview (plans/mrp/17 D1); throws so a failed read is never cached. */
export const backflushPreviewProvider: CacheProvider<BackflushPlanSummary> = {
  async compute(orgId, db) {
    // Lazy: the builds module imports the cache barrel.
    const { previewBackflush, summarizeBackflushPlan } = await import(
      '../../inventory/builds/backflush-preview'
    )
    const result = await previewBackflush(db, orgId, {})
    if (result.isErr()) throw result.error
    return summarizeBackflushPlan(result.value)
  },
}
