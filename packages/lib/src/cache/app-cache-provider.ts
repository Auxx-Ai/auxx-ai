// packages/lib/src/cache/app-cache-provider.ts

import type { Database } from '@auxx/database'

/** Provider interface for computing global (non-scoped) cache values */
export interface AppCacheProvider<T> {
  compute(db: Database): Promise<T>
}
