// apps/web/src/components/fields/index.ts

// Main component exports
export { default as EntityFields } from './entity-fields'
export { PropertyProvider, usePropertyContext } from './property-provider'
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
export { DisplayField, useFieldContext } from './displays/display-field'
export { FieldDisplay } from './field-display'
export { DisplayOnlyProvider, useDisplayOnlyContext } from './display-only-provider'

// Dynamic options registry and hooks
export { DYNAMIC_OPTIONS_REGISTRY, getDynamicOptionsEntry, type DynamicOption } from './registries/dynamic-options-registry'
export { useDynamicFieldOptions, useFieldDynamicOptions } from './hooks/use-dynamic-field-options'

// NOTE: model-field-configs.ts is deprecated - use ResourceField from @auxx/lib/resources/client instead
// The unified field definitions are now in the resource registry with isSystem, dynamicOptionsKey, etc.
