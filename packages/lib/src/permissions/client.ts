// packages/lib/src/permissions/client.ts
/**
 * Client-safe exports for the permissions module.
 * Does not pull in server-only dependencies.
 */

// Type-only re-exports (erased at runtime — no server deps pulled in).
// ── Permission rank — the single source of truth for "which ResourceAccess
//    permission outranks which", now defined once in `@auxx/types/permissions`
//    (plan v3/03 P3a §3). Re-exported here because ~7 client files import it
//    from this module.
export { PERMISSION_RANK } from '@auxx/types/permissions'
// ── Shared client-safe entity-access resolver (most-specific-wins core, used by
//    the client capabilities provider to mirror server enforcement).
export {
  ALWAYS_PER_ROW_DEF_SLUGS,
  administersAnyDef,
  type ClientCapabilities,
  canAdminInstance,
  canAdministerRecord,
  canDeleteRecord,
  canDeleteRecordAtRung,
  canEditInstance,
  canEditRecord,
  canEditRecordAtRung,
  canImportRecord,
  canRecordVerbAtRung,
  canViewInstance,
  canViewRecord,
  effectiveRecordLevel,
  type GrantedDefIds,
  hasDefPresence,
  levelToRecordBasePermission,
  levelToRung,
  NON_RECORD_DEF_SLUGS,
  type ResolvedRecordAccess,
  recordDefRung,
  toResolvedRecordAccess,
} from './capabilities/entity-access'
export type { GranteeGrant, GrantGranteeType } from './capabilities/grant-service'
// ── Instance-access registry (client-safe: instance-access.ts only imports
//    `Area` from registry.ts, already client-exported above).
export {
  type BlobLaneConfig,
  INSTANCE_ACCESS_KEYS,
  INSTANCE_ACCESS_RESOURCES,
  type InstanceAccessKey,
  type InstanceAccessResourceConfig,
  isInstanceAccessKey,
  type QueryLaneConfig,
  RECORD_DEF_RUNGS,
} from './capabilities/instance-access'
// ── Capability registry (Layer 2) — client-safe: registry.ts only imports
//    `FeatureKey` from `./types`, which is already client-exported above.
export type { AreaMetadata, PermissionMetadata } from './capabilities/registry'
export {
  AREA_ORDER,
  Area,
  areaCeilingLevel,
  buildAreaLevels,
  clampLevelToArea,
  expandLevelsToKeys,
  isPermissionKey,
  Level,
  PERMISSION_AREAS,
  PERMISSION_REGISTRY,
  PERMISSION_REGISTRY_MAP,
  PermissionKey,
  parseAreaLevels,
} from './capabilities/registry'
// ── The instance-grant ladder (plan v3/03 §2). Client-safe: `rung.ts` imports
//    only `@auxx/database/enums`, which `entity-access.ts` above already does.
//    The client resolvers for config-scale defs need the ordinal, so it must be
//    reachable from here.
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
export { ENTITY_BASE_AREAS } from './capabilities/seat-policy'
export type { Overage } from './overage-detection-service'
export type {
  FeatureDefinition,
  FeatureLimit,
  FeatureMapObject,
  FeatureMetadata,
  FeatureType,
} from './types'
export { FEATURE_REGISTRY, FEATURE_REGISTRY_MAP, FeatureKey, USAGE_METRICS } from './types'
