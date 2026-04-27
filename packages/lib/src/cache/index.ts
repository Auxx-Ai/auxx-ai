// packages/lib/src/cache/index.ts

// ── Accessor types ──
export type {
  CustomFieldAccessor,
  CustomFieldGroupAccessor,
  OrgCacheAccessorMap,
  ResourceAccessor,
  WorkflowAppsAccessor,
} from './accessor-map'
export { ArrayAccessor, NestedRecordAccessor, RecordAccessor, ScalarAccessor } from './accessors'
export { getCachedAppBySlug, getCachedPublishedApps, resolveAppSlug } from './app-cache-helpers'
// ── App Cache Service ──
export type {
  AppCacheDataMap,
  AppCacheKeyName,
  CachedApp,
  CachedPlan,
  CachedPublishedApp,
  CachedWorkflowTemplate,
} from './app-cache-keys'
export type { AppCacheProvider } from './app-cache-provider'
export { AppCacheService } from './app-cache-service'
// ── Organization Cache Service ──
export { invalidateOrgsByAppId, invalidateOrgsByDeploymentId } from './app-invalidation-helpers'
export type { CacheEntry, CacheOptions } from './base-cache-service'
export { BaseCacheService } from './base-cache-service'
// ── Build User Cache Service ──
export type {
  BuildCachedApp,
  BuildCachedDeveloperAccount,
  BuildCachedOrganization,
  BuildUserCacheDataMap,
  BuildUserCacheKeyName,
} from './build-user-cache-keys'
export { BuildUserCacheService } from './build-user-cache-service'
export { consumeOAuthCsrfToken, storeOAuthCsrfToken } from './csrf'
export {
  flushOrganization,
  invalidateAppCatalog,
  invalidateAppSlugMap,
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
  getCachedDefaultModel,
  getCachedEntityDefId,
  getCachedFieldMap,
  getCachedGroups,
  getCachedMembers,
  getCachedMembersByUserIds,
  getCachedResource,
  getCachedResourceFields,
  getCachedResources,
  requireCachedEntityDefId,
} from './org-cache-helpers'
export type {
  CachedGroup,
  CachedInstalledApp,
  CachedSubscription,
  CachedSystemModelDefault,
  OrgCacheDataMap,
  OrgCacheKeyName,
  OrgMemberInfo,
} from './org-cache-keys'
export type { CacheProvider } from './org-cache-provider'
export { OrganizationCacheService } from './org-cache-service'
export { PromiseMemoizer } from './promise-memoizer'
export type { CachedPublishedWorkflow, CachedWorkflowApp } from './providers/workflow-apps-provider'
// ── Singletons ──
export {
  getAppCache,
  getBuildUserCache,
  getOrgCache,
  getTokenCache,
  getUserCache,
} from './singletons'
export { TokenCacheService } from './token-cache-service'
export type {
  CachedFavorite,
  CachedTableView,
  UserCacheDataMap,
  UserCacheKeyName,
} from './user-cache-keys'
export { UserCacheService } from './user-cache-service'
export {
  getCachedWorkflowApp,
  getCachedWorkflowAppsByAppTrigger,
  getCachedWorkflowAppsByTrigger,
} from './workflow-app-queries'
