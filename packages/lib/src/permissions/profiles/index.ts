// packages/lib/src/permissions/profiles/index.ts

export {
  areaLevelToPermission,
  authorizationOnlyPolicy,
  emptyAgentPolicy,
  legacyFullAgentPolicy,
  lookupExactPolicy,
  minPermission,
  parsePolicyPermission,
  parsePublishedAgentPolicy,
  permissionToAreaLevel,
  policyAreaLevel,
  policyDefinitionLevel,
  policyResourceLevel,
  resolveDraftAgentPolicy,
} from './agent-policy'
export {
  AgentPolicyCapabilities,
  buildDefIdToApiSlug,
  buildDefIdToEntitySlug,
  type DefIdToApiSlug,
  type PolicyResourceRef,
} from './agent-policy-capabilities'
export {
  type ClampDefinition,
  type ClampedAgentPolicy,
  clampAgentPolicyToPublisher,
} from './agent-policy-clamp'
export {
  computeEffectiveStatesUncached,
  computeEffectiveStateUncached,
  type EffectiveState,
  type QueryRunner,
} from './effective-state'
export {
  type ActorAuthority,
  assertNoEscalation,
  assertProfileMapNoEscalation,
  HOLDER_GUARD_CAP,
  type ProfileAuthoredState,
} from './escalation-guard'
export {
  type DeletePermissionProfileInput,
  deletePermissionProfile,
  type PermissionProfileDeletionPreview,
  type PermissionProfileDeletionSummary,
  type ProfileDeletionAgentDraft,
  type ProfileDeletionAreaDelta,
  type ProfileDeletionFallback,
  type ProfileDeletionPublishedVersion,
  type ProfileDeletionResourceDelta,
  previewPermissionProfileDeletion,
} from './profile-delete'
export {
  emitPermissionProfileChanged,
  fanOutCapabilityChange,
  type ProfileAudience,
  resolveProfileAudience,
  resolveProfileHolderIds,
} from './profile-invalidation'
export {
  type CreatePermissionProfileInput,
  createPermissionProfile,
} from './profile-mutations'
export { parseProfileCeiling, projectPermissionProfile } from './profile-projection'
export {
  findPermissionProfile,
  getPermissionProfile,
  getProfileActorsByIds,
  type ListPermissionProfilesOptions,
  listPermissionProfiles,
  listProfileActors,
  type PermissionProfileDetail,
  type PermissionProfileSummary,
  toProfileActor,
  toProfileDetail,
  toProfileSummary,
} from './profile-queries'
export { type ResolvedBaseProfile, resolveBaseProfile } from './profile-resolution'
export {
  type SavePermissionProfileInput,
  savePermissionProfile,
} from './profile-save'
export {
  ensureSystemProfiles,
  SYSTEM_PROFILE_SEEDS,
  systemProfileFor,
  systemProfileForAgentKind,
  systemProfileSeed,
} from './system-profiles'
export type {
  AgentPermissionPolicy,
  AgentPolicyClampEntry,
  CachedPermissionProfile,
  ProfileAppliesTo,
  ProfileCeiling,
  PublishedAgentPermissionPolicy,
  SystemProfileSlug,
} from './types'
export { SYSTEM_PROFILE_SLUGS } from './types'
