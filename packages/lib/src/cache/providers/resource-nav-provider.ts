// packages/lib/src/cache/providers/resource-nav-provider.ts

import { toResourceNav } from '../../sidebar-layout/resource-nav'
import type { ResourceNavEntry } from '../../sidebar-layout/types'
import type { CacheProvider } from '../org-cache-provider'
import { getOrgCache } from '../singletons'

/** Derived from `resources`; `OrgCacheService` recomputes it after every `resources` invalidation. */
export const resourceNavProvider: CacheProvider<ResourceNavEntry[]> = {
  async compute(orgId) {
    return toResourceNav(await getOrgCache().get(orgId, 'resources'))
  },
}
