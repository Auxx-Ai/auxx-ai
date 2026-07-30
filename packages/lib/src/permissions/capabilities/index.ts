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
  type BlobLaneConfig,
  INSTANCE_ACCESS_KEYS,
  INSTANCE_ACCESS_READ_KEYS,
  INSTANCE_ACCESS_RESOURCES,
  type InstanceAccessKey,
  type InstanceAccessResourceConfig,
  isInstanceAccessKey,
  type QueryLaneConfig,
  RECORD_DEF_RUNGS,
} from './instance-access'
// Plan v3/03 P5 — the record lane's cascade cap (§13.1) and its ONE scope
// authoring point (§5.1).
export {
  deriveThreadRungFromRecordGrant,
  recordThreadDerivationCap,
  TICKET_LIKE_ENTITY_TYPES,
} from './record-thread-derivation'
export { resolveLinkedRecordIds } from './record-view-scope'
export {
  assertRequestScoped,
  type RecordScopeArm,
  type RecordVisibilityScope,
  type ResolvedRecordScope,
  recordAccessRankSql,
  recordScopeArm,
  recordScopeArmFor,
  recordSearchVisibilitySql,
  recordVisibilityScope,
  resolveRecordVisibilityScope,
  rungsAtOrAbove,
} from './record-visibility-scope'
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
  ALL_RUNGS,
  foldRecordAccess,
  maxRung,
  RUNG_ORDER,
  type Rung,
  rankToRung,
  rungRank,
  satisfiesRung,
} from './rung'
export {
  ALL_KEYS,
  ENTITY_BASE_AREAS,
  ENTITY_WRITE_KEYS,
  ROLE_DEFAULTS,
  SEAT_CEILINGS,
  WORKER_SEAT_KEYS,
} from './seat-policy'
