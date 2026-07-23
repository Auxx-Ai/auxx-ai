// packages/lib/src/permissions/capabilities/index.ts

export { CapabilitySet, type DefIdToSlug } from './capability-set'
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
  ALL_KEYS,
  ENTITY_WRITE_KEYS,
  effectiveDefault,
  ROLE_DEFAULTS,
  SEAT_CEILINGS,
  WORKER_SEAT_KEYS,
} from './seat-policy'
