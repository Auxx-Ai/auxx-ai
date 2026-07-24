// packages/lib/src/cache/index.ts

export type { UserCapabilities } from '../permissions/capabilities/compose-user-capabilities'
// ── Accessor types ──
export type {
  CustomFieldAccessor,
  CustomFieldGroupAccessor,
  OrgCacheAccessorMap,
  ResourceAccessor,
  WorkflowAppsAccessor,
} from './accessor-map'
export { ArrayAccessor, NestedRecordAccessor, RecordAccessor, ScalarAccessor } from './accessors'
export type { CachedAggregate } from './aggregate-cache-service'
export { AggregateCacheService } from './aggregate-cache-service'
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
export type { CounterHash } from './counter-cache'
export { counterHash } from './counter-cache'
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
  getAllCachedAgents,
  getAllCachedCustomFields,
  getCachedAgentById,
  getCachedAgents,
  getCachedAgentsByIds,
  getCachedAgentsByUserIds,
  getCachedCustomFields,
  getCachedDefaultModel,
  getCachedEntityDefId,
  getCachedFieldMap,
  getCachedGroups,
  getCachedHasPermissionGrants,
  getCachedInstalledApps,
  getCachedKbCatalog,
  getCachedMembers,
  getCachedMembersByUserIds,
  getCachedOrgHasActiveChat,
  getCachedOrgProfile,
  getCachedRecordRules,
  getCachedResource,
  getCachedResourceFields,
  getCachedResources,
  getCachedRestrictedEntityDefIds,
  getCachedRestrictedInstanceIds,
  getCachedUserGroupIds,
  getEntityDefIdResolver,
  isAgentUser,
  isOrgMember,
  requireCachedEntityDefId,
} from './org-cache-helpers'
export type {
  CachedAgent,
  CachedAgentTool,
  CachedAgentTrigger,
  CachedGroup,
  CachedInstalledApp,
  CachedMcpServer,
  CachedSubscription,
  CachedSystemModelDefault,
  DehydratedOrgProfile,
  OrgCacheDataMap,
  OrgCacheKeyName,
  OrgMemberInfo,
} from './org-cache-keys'
export type { CacheProvider } from './org-cache-provider'
export { OrganizationCacheService } from './org-cache-service'
export { PromiseMemoizer } from './promise-memoizer'
export type { MailGrantEntry, MailGrantIndex } from './providers/mail-grant-index-provider'
export type { CachedPublishedWorkflow, CachedWorkflowApp } from './providers/workflow-apps-provider'
// ── Singletons ──
export {
  getAggregateCache,
  getAppCache,
  getBuildUserCache,
  getOrgCache,
  getTokenCache,
  getUserCache,
} from './singletons'
export { TokenCacheService } from './token-cache-service'
export { getCachedUserCapabilities, getCachedUserMailVisibility } from './user-cache-helpers'
export type {
  CachedFavorite,
  CachedTableView,
  UserCacheDataMap,
  UserCacheKeyName,
} from './user-cache-keys'
export { UserCacheService } from './user-cache-service'
export {
  getCachedWorkflowApp,
  getCachedWorkflowAppCount,
  getCachedWorkflowAppsByAppTrigger,
  getCachedWorkflowAppsByTrigger,
} from './workflow-app-queries'
