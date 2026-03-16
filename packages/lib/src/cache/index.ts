// packages/lib/src/cache/index.ts

// ── Accessor types ──
export type {
  CustomFieldAccessor,
  CustomFieldGroupAccessor,
  OrgCacheAccessorMap,
  ResourceAccessor,
} from './accessor-map'
export { ArrayAccessor, NestedRecordAccessor, RecordAccessor, ScalarAccessor } from './accessors'
// ── App Cache Service ──
export type {
  AppCacheDataMap,
  AppCacheKeyName,
  CachedPlan,
  CachedWorkflowTemplate,
} from './app-cache-keys'
export type { AppCacheProvider } from './app-cache-provider'
export { AppCacheService } from './app-cache-service'
export type { CacheEntry, CacheOptions } from './base-cache-service'
export { BaseCacheService } from './base-cache-service'
export {
  flushOrganization,
  invalidatePlans,
  invalidateWorkflowTemplates,
  onCacheEvent,
} from './invalidate'
export type { CacheEvent } from './invalidation-graph'
// ── Cache Helpers ──
export {
  findCachedResource,
  getAllCachedCustomFields,
  getCachedCustomFields,
  getCachedEntityDefId,
  getCachedGroups,
  getCachedMembers,
  getCachedMembersByUserIds,
  getCachedResource,
  getCachedResourceFields,
  getCachedResources,
  requireCachedEntityDefId,
} from './org-cache-helpers'
// ── Organization Cache Service ──
export type { CachedGroup, OrgCacheDataMap, OrgCacheKeyName, OrgMemberInfo } from './org-cache-keys'
export type { CacheProvider } from './org-cache-provider'
export { OrganizationCacheService } from './org-cache-service'
export { PromiseMemoizer } from './promise-memoizer'
export type { CachedTableView, UserCacheDataMap, UserCacheKeyName } from './user-cache-keys'
export { UserCacheService } from './user-cache-service'

import { AppCacheService } from './app-cache-service'
import { OrganizationCacheService } from './org-cache-service'
import { registerAllProviders } from './register-providers'
import { UserCacheService } from './user-cache-service'

let appCacheInstance: AppCacheService | undefined
let orgCacheInstance: OrganizationCacheService | undefined
let userCacheInstance: UserCacheService | undefined

/** Initialize all cache services (lazily called on first access) */
function initCaches(): void {
  orgCacheInstance = new OrganizationCacheService()
  userCacheInstance = new UserCacheService()
  appCacheInstance = new AppCacheService()
  registerAllProviders(orgCacheInstance, userCacheInstance, appCacheInstance)
}

/** Get the singleton app-wide cache service (lazily initialized with all providers) */
export function getAppCache(): AppCacheService {
  if (!appCacheInstance) initCaches()
  return appCacheInstance!
}

/** Get the singleton org cache service (lazily initialized with all providers) */
export function getOrgCache(): OrganizationCacheService {
  if (!orgCacheInstance) initCaches()
  return orgCacheInstance!
}

/** Get the singleton user cache service (lazily initialized with all providers) */
export function getUserCache(): UserCacheService {
  if (!userCacheInstance) initCaches()
  return userCacheInstance!
}
