// packages/lib/src/cache/providers/overages-provider.ts

import { type Overage, OverageDetectionService } from '../../permissions/overage-detection-service'
import type { CacheProvider } from '../org-cache-provider'

/** Computes current overages for an organization */
export const overagesProvider: CacheProvider<Overage[]> = {
  async compute(orgId, db) {
    const overageService = new OverageDetectionService(db)
    try {
      return await overageService.detectCurrentOverages(orgId)
    } catch {
      return []
    }
  },
}
