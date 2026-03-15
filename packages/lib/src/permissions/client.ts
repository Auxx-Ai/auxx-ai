// packages/lib/src/permissions/client.ts
/**
 * Client-safe exports for the permissions module.
 * Does not pull in server-only dependencies.
 */
export type { Overage } from './overage-detection-service'
export type {
  FeatureDefinition,
  FeatureLimit,
  FeatureMapObject,
  FeatureMetadata,
  FeatureType,
} from './types'
export { FEATURE_REGISTRY, FEATURE_REGISTRY_MAP, FeatureKey, USAGE_METRICS } from './types'
