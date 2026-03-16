// packages/lib/src/cache/index.ts

export type { CacheEntry, CacheOptions } from './base-cache-service'
export { BaseCacheService } from './base-cache-service'
export { flushOrganization, onCacheEvent } from './invalidate'
export type { CacheEvent } from './invalidation-graph'
// ── Organization Cache Service ──
export type { OrgCacheDataMap, OrgCacheKeyName } from './org-cache-keys'
export type { CacheProvider } from './org-cache-provider'
export { OrganizationCacheService } from './org-cache-service'
export { PromiseMemoizer } from './promise-memoizer'
export type { UserCacheDataMap, UserCacheKeyName } from './user-cache-keys'
export { UserCacheService } from './user-cache-service'

import { OrganizationCacheService } from './org-cache-service'
import { registerAllProviders } from './register-providers'
import { UserCacheService } from './user-cache-service'

let orgCacheInstance: OrganizationCacheService | undefined
let userCacheInstance: UserCacheService | undefined

/** Get the singleton org cache service (lazily initialized with all providers) */
export function getOrgCache(): OrganizationCacheService {
  if (!orgCacheInstance) {
    orgCacheInstance = new OrganizationCacheService()
    userCacheInstance = new UserCacheService()
    registerAllProviders(orgCacheInstance, userCacheInstance)
  }
  return orgCacheInstance
}

/** Get the singleton user cache service (lazily initialized with all providers) */
export function getUserCache(): UserCacheService {
  if (!userCacheInstance) getOrgCache() // triggers init
  return userCacheInstance!
}
