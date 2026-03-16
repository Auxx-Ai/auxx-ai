// packages/lib/src/cache/org-cache-provider.ts

import type { Database } from '@auxx/database'

/** Provider interface for computing cache values from the database */
export interface CacheProvider<T> {
  compute(orgId: string, db: Database): Promise<T>

  /** Optional: factory to create the fluent accessor for this key's data */
  createAccessor?: (dataFn: () => Promise<T>) => any
}
