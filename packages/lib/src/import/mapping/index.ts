// packages/lib/src/import/mapping/index.ts

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
export {
  type AutoMapStrategy,
  type RunAutoMapInput,
  type RunAutoMapResult,
  runAutoMap,
} from './run-auto-map'
export {
  type AutoMapUpdateInput,
  batchUpdateMappingsFromAutoMap,
  type RelationConfig,
  type SaveMappingInput,
  saveMappingProperty,
} from './save-mapping-property'
export { type UpdateMappingTitleInput, updateMappingTitle } from './update-mapping'
