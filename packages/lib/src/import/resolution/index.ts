// packages/lib/src/import/resolution/index.ts

export { batchCacheResolutions } from './cache/batch-cache-resolutions'
export { type CacheResolutionInput, cacheResolution } from './cache/cache-resolution'
export { getAllJobResolutions } from './cache/get-all-job-resolutions'
// Re-export cache functions
export { getCachedResolutions } from './cache/get-cached-resolutions'
// Pending lookup query
export { getPendingRelationLookups } from './get-pending-relation-lookups'
export { getResolutionProgress, type ResolutionProgress } from './get-resolution-progress'
// Resolution status utilities
export {
  type EffectiveStatus,
  getUniqueValuesWithResolution,
  type ResolutionStatus,
  type UniqueValuesWithFieldConfig,
  type UniqueValueWithResolution,
} from './get-unique-values-with-status'
export { type ProcessColumnValuesOptions, processColumnValues } from './process-column-values'
// Relation lookup resolution
export {
  type PendingRelationLookup,
  type RelationLookupResult,
  resolveRelationLookups,
  updateResolutionsWithLookupResults,
} from './resolve-relation-lookups'
export { resolveValue } from './resolve-value'
export {
  getAvailableResolutionTypes,
  getResolver,
  isValidResolutionType,
} from './resolver-registry'
// Re-export resolvers
export {
  isPendingRelationLookup,
  type PendingRelationLookupValue,
  resolveArraySplit,
  resolveBoolean,
  resolveDateCustom,
  resolveDateIso,
  resolveDatetimeCustom,
  resolveDatetimeIso,
  resolveDecimal,
  resolveDomain,
  resolveEmail,
  resolveInteger,
  resolveMultiselectSplit,
  resolvePhone,
  resolveRelationCreate,
  resolveRelationMatch,
  resolveSelectCreate,
  resolveSelectValue,
  resolveTextCuid,
  resolveTextValue,
} from './resolvers'
export { type UpdateResolutionInput, updateValueResolution } from './update-value-resolution'
