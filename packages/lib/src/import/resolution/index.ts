// packages/lib/src/import/resolution/index.ts

export { batchCacheResolutions } from './cache/batch-cache-resolutions'
export { type CacheResolutionInput, cacheResolution } from './cache/cache-resolution'
export { getAllJobResolutions } from './cache/get-all-job-resolutions'
// Re-export cache functions
export { getCachedResolutions } from './cache/get-cached-resolutions'
// Resolution status utilities. The status derivation and the option-label
// rendering are PURE and shared with the review UI through
// `@auxx/lib/import/client` — a second copy of either drifts from this one.
export {
  deriveEffectiveStatus,
  type EffectiveStatus,
  effectiveOptionKeys,
  type ResolutionStatus,
} from './effective-status'
// Pending lookup query
export { getPendingRelationLookups } from './get-pending-relation-lookups'
// Relation auto-create (03 §3.2)
export {
  getRelationCreateCounts,
  type PendingCreateRow,
  type RelationCreateColumnCount,
  type RelationCreateCounts,
} from './get-relation-create-counts'
export { getResolutionProgress, type ResolutionProgress } from './get-resolution-progress'
// Select-option auto-create (`select:create`)
export {
  getSelectCreateCounts,
  groupSelectCreates,
  loadPendingSelectCreates,
  type PendingSelectCreateRow,
  type RejectedSelectCreates,
  type SelectCreateColumnCount,
  type SelectCreateCounts,
  type SelectCreateFieldCount,
  type SelectCreateGroup,
  type SelectCreateGrouping,
} from './get-select-create-counts'
export {
  getUniqueValuesWithResolution,
  type UniqueValuesWithFieldConfig,
  type UniqueValueWithResolution,
} from './get-unique-values-with-status'
// Per-target import authority, shared by the plan-time and execution-time gates
export { buildImportAuthority, type ImportAuthorityOptions } from './import-authority'
export {
  createRelationTargetWriter,
  type MaterializeRelationCreatesOptions,
  type MaterializeRelationCreatesResult,
  materializeRelationCreates,
  type RelationTargetWriter,
  type RelationTargetWriterOptions,
} from './materialize-relation-creates'
export {
  type MaterializeSelectCreatesOptions,
  type MaterializeSelectCreatesResult,
  materializeSelectCreates,
  type SelectCreateFailure,
} from './materialize-select-creates'
export { isOptionResolutionType, resolveOptionLabel } from './option-labels'
export { type ProcessColumnValuesOptions, processColumnValues } from './process-column-values'
export { relationCreateKey } from './relation-create-key'
// Relation match-field type gate (03 §5.4), technical limit, NOT the identifier gate
export {
  isRelationMatchableType,
  RELATION_MATCH_ARRAY_TYPES,
  RELATION_MATCH_ENUM_TYPES,
  RELATION_MATCH_NUMERIC_TYPES,
  RELATION_MATCH_TEXT_TYPES,
  RELATION_MATCHABLE_BASE_TYPES,
} from './relation-match-types'
// Relation policy (pure, shared with the mapping wizard)
export {
  buildRelationColumnPolicy,
  canCreateOnNoMatch,
  defaultOnNoMatch,
  defaultRelationLinkMode,
  deriveRelationResolutionType,
  effectiveOnNoMatch,
  explainCreateUnavailable,
  matchesDisplayField,
  type RelationColumnPolicy,
  type RelationConfig,
  relationFieldWriteMode,
  resolveDisplayFieldKey,
  resolveMatchFieldKey,
} from './relation-policy'
// Live option lists for `select:*` / `multiselect:*` columns, resolved at RUN time
export { type ResolveColumnOptionsInput, resolveColumnOptions } from './resolve-column-options'
// CURRENCY denomination for `currency:*` columns, resolved at RUN time
export {
  type ResolveColumnCurrencyCodesInput,
  resolveColumnCurrencyCodes,
} from './resolve-currency-code'
// Relation lookup resolution
export {
  type PendingRelationLookup,
  type RelationLookupOutcome,
  type RelationLookupResult,
  type ResolveRelationLookupsOptions,
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
  type CurrencyParseFailure,
  type CurrencyParseOptions,
  type CurrencyParseResult,
  type CurrencyParseSuccess,
  isDirectIdRelationLookup,
  isPendingRelationLookup,
  type PendingRelationLookupValue,
  parseCurrencyMajorToMinor,
  resolveArraySplit,
  resolveBoolean,
  resolveCurrencyMajor,
  resolveDateCustom,
  resolveDateIso,
  resolveDatetimeCustom,
  resolveDatetimeIso,
  resolveDecimal,
  resolveDomain,
  resolveEmail,
  resolveEmailSplit,
  resolveInteger,
  resolveMultiselectSplit,
  resolvePhone,
  resolvePhoneSplit,
  resolveRelationCreate,
  resolveRelationMatch,
  resolveSelectCreate,
  resolveSelectValue,
  resolveTextCuid,
  resolveTextValue,
  resolveUrlSplit,
  splitMultiValueCell,
} from './resolvers'
export { type UpdateResolutionInput, updateValueResolution } from './update-value-resolution'
// Batched ImportValueResolution write-back, shared by the lookup and mint paths
export {
  RESOLUTION_WRITE_CHUNK_SIZE,
  type ResolutionRowWrite,
  type ResolutionRowWriteByHash,
  type ResolutionRowWriteById,
  updateResolutionsByHash,
  updateResolutionsById,
} from './write-resolution-rows'
