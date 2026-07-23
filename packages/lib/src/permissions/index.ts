export { CapabilitySet, type DefIdToSlug } from './capabilities/capability-set'
export {
  composeUserCapabilities,
  type UserCapabilities,
} from './capabilities/compose-user-capabilities'
export { getCapabilities } from './capabilities/get-capabilities'
export type { GranteeRef, GrantGranteeType } from './capabilities/grant-service'
export {
  clearGranteeLevels,
  emptyLevels,
  getGranteeLevels,
  setGranteeLevels,
} from './capabilities/grant-service'
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
  effectiveDefault,
  ROLE_DEFAULTS,
  SEAT_CEILINGS,
  WORKER_SEAT_KEYS,
} from './capabilities/seat-policy'
export { FeaturePermissionService } from './feature-permission-service'
export type { Overage } from './overage-detection-service'
export { OverageDetectionService } from './overage-detection-service'
export { handlePlanDowngrade } from './overage-handler'
export type { FeatureDefinition, FeatureLimit, FeatureMapObject } from './types'
export { FeatureKey } from './types'
