// packages/lib/src/permissions/client.ts
/**
 * Client-safe exports for the permissions module.
 * Does not pull in server-only dependencies.
 */

// Type-only re-exports (erased at runtime — no server deps pulled in).
// ── Shared client-safe entity-access resolver (most-specific-wins core, used by
//    the client capabilities provider to mirror server enforcement).
export {
  type ClientCapabilities,
  canAdministerRecord,
  canEditRecord,
  canViewRecord,
  effectiveRecordLevel,
  NON_RECORD_DEF_SLUGS,
  type ResolvedRecordAccess,
  toResolvedRecordAccess,
} from './capabilities/entity-access'
export type { GranteeGrant, GrantGranteeType } from './capabilities/grant-service'
// ── Capability registry (Layer 2) — client-safe: registry.ts only imports
//    `FeatureKey` from `./types`, which is already client-exported above.
export type { AreaMetadata, PermissionMetadata } from './capabilities/registry'
export {
  AREA_ORDER,
  Area,
  buildAreaLevels,
  expandLevelsToKeys,
  isPermissionKey,
  Level,
  PERMISSION_AREAS,
  PERMISSION_REGISTRY,
  PERMISSION_REGISTRY_MAP,
  PermissionKey,
  parseAreaLevels,
} from './capabilities/registry'
export type { Overage } from './overage-detection-service'
export type {
  FeatureDefinition,
  FeatureLimit,
  FeatureMapObject,
  FeatureMetadata,
  FeatureType,
} from './types'
export { FEATURE_REGISTRY, FEATURE_REGISTRY_MAP, FeatureKey, USAGE_METRICS } from './types'
