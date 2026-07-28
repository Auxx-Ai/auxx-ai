// packages/lib/src/permissions/capabilities/index.ts

export { CapabilitySet, type DefIdToSlug } from './capability-set'
export {
  type CapabilityView,
  intersectCapabilities,
  MinCapabilitySet,
} from './capability-view'
export {
  composeUserCapabilities,
  type UserCapabilities,
} from './compose-user-capabilities'
export { computeUserCapabilities } from './compute-user-capabilities'
export { getCapabilities } from './get-capabilities'
export {
  clearGranteeLevels,
  emptyLevels,
  type GranteeRef,
  type GrantGranteeType,
  getGranteeLevels,
  setGranteeLevels,
} from './grant-service'
export {
  type AccessGranteeType,
  type GranteeAccess,
  type GranteeBaselineAccess,
  type GranteeEffectiveAccess,
  type GranteeOwnAccess,
  getGranteeAccess,
} from './grantee-access'
export {
  INSTANCE_ACCESS_KEYS,
  INSTANCE_ACCESS_READ_KEYS,
  INSTANCE_ACCESS_RESOURCES,
  type InstanceAccessKey,
  type InstanceAccessResourceConfig,
  isInstanceAccessKey,
} from './instance-access'
export { resolveLinkedRecordIds } from './record-view-scope'
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
} from './registry'
export { requirePermission } from './require'
export {
  buildDefIdToDefinitionId,
  buildDefIdToSlug,
  type ResolvedCapabilityInputs,
  resolveCapabilityInputs,
} from './resolve-capability-inputs'
export {
  ALL_KEYS,
  ENTITY_BASE_AREAS,
  ENTITY_WRITE_KEYS,
  ROLE_DEFAULTS,
  SEAT_CEILINGS,
  WORKER_SEAT_KEYS,
} from './seat-policy'
