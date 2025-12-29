// packages/lib/src/import/resolution/index.ts

export { resolveValue } from './resolve-value'
export { getResolver, isValidResolutionType, getAvailableResolutionTypes } from './resolver-registry'
export { processColumnValues, type ProcessColumnValuesOptions } from './process-column-values'

// Resolution status utilities
export {
  getUniqueValuesWithResolution,
  type UniqueValueWithResolution,
  type UniqueValuesWithFieldConfig,
  type ResolutionStatus,
  type EffectiveStatus,
} from './get-unique-values-with-status'
export { updateValueResolution, type UpdateResolutionInput } from './update-value-resolution'
export { getResolutionProgress, type ResolutionProgress } from './get-resolution-progress'

// Re-export resolvers
export {
  resolveTextValue,
  resolveTextCuid,
  resolveInteger,
  resolveDecimal,
  resolveDateIso,
  resolveDateCustom,
  resolveDatetimeIso,
  resolveDatetimeCustom,
  resolveBoolean,
  resolveEmail,
  resolvePhone,
  resolveSelectValue,
  resolveSelectCreate,
  resolveMultiselectSplit,
  resolveDomain,
  resolveArraySplit,
  resolveRelationMatch,
  resolveRelationCreate,
  isPendingRelationLookup,
  type PendingRelationLookupValue,
} from './resolvers'

// Re-export cache functions
export { getCachedResolutions } from './cache/get-cached-resolutions'
export { getAllJobResolutions } from './cache/get-all-job-resolutions'
export { cacheResolution, type CacheResolutionInput } from './cache/cache-resolution'
export { batchCacheResolutions } from './cache/batch-cache-resolutions'

// Relation lookup resolution
export {
  resolveRelationLookups,
  updateResolutionsWithLookupResults,
  type PendingRelationLookup,
  type RelationLookupResult,
} from './resolve-relation-lookups'

// Pending lookup query
export { getPendingRelationLookups } from './get-pending-relation-lookups'
