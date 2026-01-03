// apps/web/src/components/fields/index.ts

// Main component exports
export { default as EntityFields } from './entity-fields'
export { PropertyProvider, usePropertyContext, type StoreConfig } from './property-provider'
export { default as PropertyRow } from './property-row'
export { FieldInput } from './field-input'
export { SortablePropertyRow } from './sortable-property-row'
export { AddFieldRow } from './add-field-row'

// Navigation context
export {
  FieldNavigationProvider,
  useFieldNavigation,
  useFieldNavigationOptional,
} from './field-navigation-context'

// Hooks
export { useFieldPopoverHandlers } from './use-field-popover-handlers'

// Input components
export { getInputComponentForFieldType } from './inputs/get-input-component'

// Display components
export { DisplayField } from './displays/display-field'

// Config exports
export * from './configs/model-field-configs'
