// packages/lib/src/import/mapping/index.ts

export {
  deriveIdentifierFieldKeys,
  type MappingIdentityState,
  syncMappingIdentity,
} from './derive-identifier-keys'
export {
  getColumnSamples,
  getMappablePropertiesWithSamples,
  type MappablePropertyWithSamples,
} from './get-mappable-properties'
export {
  type GetMappedColumnsInput,
  getMappedColumnsWithStats,
  type MappedColumnWithStats,
} from './get-mapped-columns'
export { invalidateColumnResolutions } from './invalidate-column-resolutions'
export { getNaturalKeyFieldKeys } from './natural-key'
export {
  isMatchRole,
  parseResolutionConfig,
  sanitizeIdentityRole,
  serializeResolutionConfig,
} from './resolution-config'
export {
  type AutoMapStrategy,
  type RunAutoMapInput,
  type RunAutoMapResult,
  runAutoMap,
} from './run-auto-map'
export {
  type AutoMapUpdateInput,
  assertNoDuplicateTargetMapping,
  batchUpdateMappingsFromAutoMap,
  type MappedColumnRef,
  type RelationConfig,
  type SaveMappingInput,
  saveMappingProperty,
} from './save-mapping-property'
export {
  IMPORT_STRATEGY_MODES,
  isImportStrategyMode,
  toImportStrategyMode,
} from './strategy-mode'
export {
  type UpdateImportStrategyInput,
  type UpdateMappingTitleInput,
  updateImportStrategy,
  updateMappingTitle,
} from './update-mapping'
