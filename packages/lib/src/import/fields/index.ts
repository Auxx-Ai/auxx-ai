// packages/lib/src/import/fields/index.ts

export {
  getImportableFields,
  getRequiredFields,
  type ImportableField,
  type FieldGroup,
  type GetImportableFieldsOptions,
} from './get-importable-fields'
export { getIdentifiableFields } from './get-identifiable-fields'
export { getIdentifierOptions, type IdentifierOption } from './get-identifier-options'
export {
  autoMapColumns,
  type ColumnHeader,
  type ColumnAutoMapping,
} from './auto-map-columns'
export { suggestResolutionType, getValidResolutionTypes } from './suggest-resolution-type'

// AI-powered mapping
export {
  orchestrateAutoMap,
  type ColumnHeaderWithSamples,
  type AutoMapOptions,
} from './auto-map-orchestrator'
