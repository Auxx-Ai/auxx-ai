// packages/lib/src/permissions/profiles/index.ts

export {
  AGENT_LEVEL_RANK,
  agentLevelToAreaLevel,
  agentLevelToPermission,
  areaLevelToAgentLevel,
  authorizationOnlyPolicy,
  emptyAgentPolicy,
  legacyFullAgentPolicy,
  lookupExactPolicy,
  minAgentLevel,
  parseAgentAccessLevel,
  parsePublishedAgentPolicy,
  permissionToAgentLevel,
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
  emitPermissionProfileChanged,
  fanOutCapabilityChange,
  type ProfileAudience,
  resolveProfileAudience,
} from './profile-invalidation'
export {
  type CreatePermissionProfileInput,
  createPermissionProfile,
  type UpdatePermissionProfileInput,
  updatePermissionProfile,
} from './profile-mutations'
export { parseProfileCeiling, projectPermissionProfile } from './profile-projection'
export { type ResolvedBaseProfile, resolveBaseProfile } from './profile-resolution'
export {
  ensureSystemProfiles,
  SYSTEM_PROFILE_SEEDS,
  systemProfileFor,
  systemProfileForAgentKind,
  systemProfileSeed,
} from './system-profiles'
export type {
  AgentAccessLevel,
  AgentPermissionPolicy,
  AgentPolicyClampEntry,
  CachedPermissionProfile,
  ProfileAppliesTo,
  ProfileCeiling,
  ProfileDefCeiling,
  PublishedAgentPermissionPolicy,
  SystemProfileSlug,
} from './types'
export { SYSTEM_PROFILE_SLUGS } from './types'
