// packages/lib/src/import/fields/index.ts

export {
  autoMapColumns,
  type ColumnAutoMapping,
  type ColumnHeader,
} from './auto-map-columns'
// AI-powered mapping
export {
  type AutoMapOptions,
  type ColumnHeaderWithSamples,
  orchestrateAutoMap,
} from './auto-map-orchestrator'
export { getIdentifiableFields } from './get-identifiable-fields'
export { getIdentifierOptions, type IdentifierOption } from './get-identifier-options'
export {
  type FieldGroup,
  type GetImportableFieldsOptions,
  getImportableFields,
  getRequiredFields,
  type ImportableField,
} from './get-importable-fields'
export { getValidResolutionTypes, suggestResolutionType } from './suggest-resolution-type'
