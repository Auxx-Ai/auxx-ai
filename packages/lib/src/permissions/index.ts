// Plan v3/06 — articles inherit their KB's grants (see `capabilities/index.ts`).

export {
  type ArticleReadInput,
  type ArticleReadScope,
  canReadArticle,
  canReadKnowledgeBase,
  resolveArticleReadScope,
} from './capabilities/article-read-access'
export {
  articleAccessRung,
  articleRowAccess,
  articleVisibilitySql,
  articleWriteRung,
  knowledgeBaseScopeFingerprint,
  systemTableVisibilityScope,
  viewableKnowledgeBaseIds,
} from './capabilities/article-visibility-scope'
export { CapabilitySet, type DefIdToSlug } from './capabilities/capability-set'
export {
  type CapabilityView,
  intersectCapabilities,
  MinCapabilitySet,
} from './capabilities/capability-view'
export {
  composeUserCapabilities,
  type UserCapabilities,
} from './capabilities/compose-user-capabilities'
export { ALWAYS_PER_ROW_DEF_SLUGS, NON_RECORD_DEF_SLUGS } from './capabilities/entity-access'
export { getCapabilities } from './capabilities/get-capabilities'
export type { GranteeGrant, GranteeRef, GrantGranteeType } from './capabilities/grant-service'
export {
  clearGranteeLevels,
  emptyLevels,
  getGranteeLevels,
  listGranteeGrants,
  setGranteeLevels,
} from './capabilities/grant-service'
export {
  type AccessGranteeType,
  type GranteeAccess,
  type GranteeBaselineAccess,
  type GranteeEffectiveAccess,
  type GranteeOwnAccess,
  getGranteeAccess,
} from './capabilities/grantee-access'
export {
  INSTANCE_ACCESS_KEYS,
  INSTANCE_ACCESS_READ_KEYS,
  INSTANCE_ACCESS_RESOURCES,
  type InstanceAccessKey,
  type InstanceAccessResourceConfig,
  isInstanceAccessKey,
} from './capabilities/instance-access'
// ── The instance-grant ladder (plan v3/03 §2). The type itself lives in
//    `@auxx/database/enums` (tier 1 — the Drizzle column needs it); everything
//    ordinal lives in `capabilities/rung.ts` and is re-exported here.
export {
  deriveThreadRungFromRecordGrant,
  recordThreadDerivationCap,
  TICKET_LIKE_ENTITY_TYPES,
} from './capabilities/record-thread-derivation'
export { resolveLinkedRecordIds } from './capabilities/record-view-scope'
export {
  assertRequestScoped,
  type RecordScopeArm,
  type RecordVisibilityScope,
  type ResolvedRecordScope,
  recordAccessRankSql,
  recordScopeArm,
  recordScopeArmFor,
  recordSearchVisibilitySql,
  recordUnionVisibilitySql,
  recordVisibilityScope,
  resolveRecordVisibilityScope,
  rungsAtOrAbove,
} from './capabilities/record-visibility-scope'
export {
  AREA_ORDER,
  Area,
  type AreaMetadata,
  buildAreaLevels,
  expandLevelsToKeys,
  isPermissionKey,
  Level,
  PERMISSION_AREAS,
  PERMISSION_REGISTRY,
  PERMISSION_REGISTRY_MAP,
  PermissionKey,
  type PermissionMetadata,
  parseAreaLevels,
} from './capabilities/registry'
export { requirePermission } from './capabilities/require'
export { buildDefIdToSlug } from './capabilities/resolve-capability-inputs'
export {
  ALL_RUNGS,
  foldRecordAccess,
  maxRung,
  permissionToRung,
  RUNG_ORDER,
  type Rung,
  rankToRung,
  rungRank,
  rungToPermission,
  satisfiesRung,
} from './capabilities/rung'
export {
  ALL_KEYS,
  ENTITY_WRITE_KEYS,
  ROLE_DEFAULTS,
  SEAT_CEILINGS,
  WORKER_SEAT_KEYS,
} from './capabilities/seat-policy'
export { FeaturePermissionService } from './feature-permission-service'
export type { Overage } from './overage-detection-service'
export { OverageDetectionService } from './overage-detection-service'
export { handlePlanDowngrade } from './overage-handler'
export type {
  ActorAuthority,
  AgentPermissionPolicy,
  CachedPermissionProfile,
  CreatePermissionProfileInput,
  EffectiveState,
  ListPermissionProfilesOptions,
  PermissionProfileDetail,
  PermissionProfileSummary,
  ProfileAppliesTo,
  ProfileAudience,
  ProfileAuthoredState,
  ProfileCeiling,
  ResolvedBaseProfile,
  SavePermissionProfileInput,
  SystemProfileSlug,
} from './profiles'
export {
  assertNoEscalation,
  assertProfileMapNoEscalation,
  computeEffectiveStatesUncached,
  computeEffectiveStateUncached,
  createPermissionProfile,
  emitPermissionProfileChanged,
  ensureSystemProfiles,
  findPermissionProfile,
  getPermissionProfile,
  getProfileActorsByIds,
  HOLDER_GUARD_CAP,
  listPermissionProfiles,
  listProfileActors,
  parseProfileCeiling,
  projectPermissionProfile,
  resolveBaseProfile,
  resolveProfileAudience,
  resolveProfileHolderIds,
  SYSTEM_PROFILE_SEEDS,
  SYSTEM_PROFILE_SLUGS,
  savePermissionProfile,
  systemProfileFor,
  systemProfileForAgentKind,
  toProfileActor,
  toProfileDetail,
  toProfileSummary,
} from './profiles'
export type { FeatureDefinition, FeatureLimit, FeatureMapObject } from './types'
export { FeatureKey } from './types'
