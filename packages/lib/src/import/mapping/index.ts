// packages/lib/src/import/mapping/index.ts

export {
  getMappablePropertiesWithSamples,
  getColumnSamples,
  type MappablePropertyWithSamples,
} from './get-mappable-properties'

export {
  saveMappingProperty,
  batchUpdateMappingsFromAutoMap,
  type SaveMappingInput,
  type RelationConfig,
  type AutoMapUpdateInput,
} from './save-mapping-property'

export {
  getMappedColumnsWithStats,
  type GetMappedColumnsInput,
  type MappedColumnWithStats,
} from './get-mapped-columns'

export { updateMappingTitle, type UpdateMappingTitleInput } from './update-mapping'

export {
  runAutoMap,
  type RunAutoMapInput,
  type RunAutoMapResult,
  type AutoMapStrategy,
} from './run-auto-map'
