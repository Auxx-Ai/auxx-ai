// apps/web/src/components/fields/index.ts

export { AddFieldRow } from './add-field-row'
export { DisplayOnlyProvider, useDisplayOnlyContext } from './display-only-provider'
// Display components
export { DisplayField, useFieldContext } from './displays/display-field'
// Main component exports
export { default as EntityFields } from './entity-fields'
export { FieldDisplay } from './field-display'
export { FieldInput } from './field-input'

// Navigation context
export {
  FieldNavigationProvider,
  useFieldNavigation,
  useFieldNavigationOptional,
} from './field-navigation-context'
export { useDynamicFieldOptions, useFieldDynamicOptions } from './hooks/use-dynamic-field-options'
// Hooks
export { useFieldPopoverCoordination } from './hooks/use-field-popover-coordination'
// Input components
export { getInputComponentForFieldType } from './inputs/get-input-component'
export { PropertyProvider, usePropertyContext } from './property-provider'
export { default as PropertyRow } from './property-row'
// Dynamic options registry and hooks
export {
  DYNAMIC_OPTIONS_REGISTRY,
  type DynamicOption,
  getDynamicOptionsEntry,
} from './registries/dynamic-options-registry'
// Row components
export { FieldEditRow } from './rows/field-edit-row'
export { FieldValueRow } from './rows/field-value-row'
export type { PanelField } from './rows/types'
export { useFieldPopoverHandlers } from './use-field-popover-handlers'
