// packages/lib/src/import/client.ts
// Client-safe exports for the import module (no database or server dependencies)
//
// No `'use client'` directive here. This module is imported from server
// components too, and the directive would break those imports.

// Shared write-policy vocabulary. The wizard renders the merge-strategy picker
// from `IMPORT_MERGE_STRATEGIES` and the identity toggle from `IdentityRole`, so both
// have to be reachable from the CLIENT barrel, types + one const, no server deps.
export {
  type FieldMergeStrategy,
  type IdentityRole,
  IMPORT_MERGE_STRATEGIES,
  type ImportMergeStrategy,
  isImportMergeStrategy,
  type OnAmbiguous,
} from '../write-policy/client'
export {
  autoMapColumns,
  type ColumnAutoMapping,
  type ColumnHeader,
} from './fields/auto-map-columns'
export {
  getIdentifierOptions,
  type IdentifierOption,
} from './fields/get-identifier-options'
// Field utilities (pure functions, no server dependencies)
export {
  type FieldGroup,
  type GetImportableFieldsOptions,
  getImportableFields,
  getRequiredFields,
  type ImportableField,
} from './fields/get-importable-fields'
// Identifier eligibility, the single authority behind the identity toggle.
// `identifierTier` on an `ImportableField` is what decides whether the toggle is
// offered at all; `identifierCompositeOnly` is what stops a lone RELATION being
// the whole match key; `identifierNote` is the inline tier-2 caveat.
export {
  getIdentifierEligibility,
  type IdentifierEligibility,
  type IdentifierTier,
  sortByIdentifierPreference,
  TIER_2_IDENTIFIER_NOTE,
} from './fields/identifier-eligibility'
// Picker labels. `currency:major` and `number:integer` are both offered on a
// money field and both accept `1234`, meaning $12.34 and $1,234.00 — the hints
// are what make that difference visible before the import runs.
export {
  getResolutionTypeLabel,
  RESOLUTION_TYPE_LABELS,
  type ResolutionTypeLabel,
} from './fields/resolution-type-labels'
export { getValidResolutionTypes, suggestResolutionType } from './fields/suggest-resolution-type'
// Hashing utilities (pure functions)
export { countOccurrences, hashValue } from './hashing'
// Per-column resolution-config helpers (pure JSON parsing, no db)
export {
  isMatchRole,
  parseResolutionConfig,
  sanitizeIdentityRole,
  serializeResolutionConfig,
} from './mapping/resolution-config'
// The three job-level import modes
export {
  IMPORT_STRATEGY_MODES,
  isImportStrategyMode,
  toImportStrategyMode,
} from './mapping/strategy-mode'
// Relation match-field type gate (03 §5.4). A TECHNICAL limit, the set of
// types `queryCustomEntity` can actually query, NOT the identifier eligibility
// gate, which is policy. The picker filters its match-field list with this so it
// stops offering `Created`/`Updated`, which can never match.
export {
  isRelationMatchableType,
  RELATION_MATCH_ARRAY_TYPES,
  RELATION_MATCH_ENUM_TYPES,
  RELATION_MATCH_NUMERIC_TYPES,
  RELATION_MATCH_TEXT_TYPES,
  RELATION_MATCHABLE_BASE_TYPES,
} from './resolution/relation-match-types'
// Relation policy, pure, and deliberately the SAME functions the resolver
// calls. The wizard restating these rules is exactly how Defect E was born.
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
} from './resolution/relation-policy'
export type {
  BatchExecutionResult,
  ExecutionContext,
  ExecutionProgress,
  ExecutionResult,
  RowExecutionResult,
} from './types/execution'
// Types
export type {
  ImportJob,
  ImportJobStatus,
  ImportStatistics,
  MappableProperty,
  UniqueValueSummary,
} from './types/job'
export type {
  ColumnMapping,
  ImportJobProperty,
  ImportMapping,
  ImportMappingProperty,
  ImportStrategyMode,
  MappablePropertyWithSamples,
} from './types/mapping'
export type {
  ImportPlan,
  ImportPlanRow,
  ImportPlanStatus,
  ImportPlanStrategy,
  PlanEstimates,
  PlanningProgress,
  RowAnalysis,
  StrategyStatistics,
  StrategyStatus,
  StrategyType,
} from './types/plan'
export type {
  RelationCreateRequest,
  RelationLinkMode,
  RelationOnNoMatch,
  ResolutionConfig,
  ResolutionResult,
  ResolutionType,
  ResolvedValue,
  UniqueValue,
  ValueResolution,
} from './types/resolution'
// Utilities (pure functions)
export { chunkArray, createPercentageProgress, createThrottledProgress } from './utils'
