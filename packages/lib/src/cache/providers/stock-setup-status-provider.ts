// packages/lib/src/cache/providers/stock-setup-status-provider.ts

import type { StockSetupStatus } from '../../inventory/receiving/stock-setup-status'
import type { CacheProvider } from '../org-cache-provider'

/** Where the Stock setup steps stand (plans/mrp/17 §5); throws so a failed read is never cached. */
export const stockSetupStatusProvider: CacheProvider<StockSetupStatus> = {
  async compute(orgId, db) {
    // Lazy: the receiving module imports the cache barrel.
    const { readStockSetupStatus } = await import('../../inventory/receiving/stock-setup-status')
    const result = await readStockSetupStatus(db, orgId)
    if (result.isErr()) throw result.error
    return result.value
  },
}
