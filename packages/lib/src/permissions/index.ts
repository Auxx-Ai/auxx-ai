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
  INSTANCE_ACCESS_KEYS,
  INSTANCE_ACCESS_RESOURCES,
  type InstanceAccessKey,
  type InstanceAccessResourceConfig,
  isInstanceAccessKey,
} from './capabilities/instance-access'
export { resolveLinkedRecordIds } from './capabilities/record-view-scope'
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
  AgentAccessLevel,
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
