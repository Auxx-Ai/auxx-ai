// apps/web/src/components/workflow/ui/conditions/index.ts

// Core types and context
export type * from './types'
export {
  ConditionProvider,
  useConditionContext,
  useConditionActions,
  useConditionState,
} from './condition-context'

// Main container
export { default as ConditionContainer } from './condition-container'

// Components
export { default as ConditionAdd } from './components/condition-add'
export { default as ConditionItem } from './components/condition-item'
export { default as ConditionList } from './components/condition-list'
export { default as ConditionGroup } from './components/condition-group'
export { default as SortableConditionGroup } from './components/sortable-condition-group'
export { default as ConditionOperator } from './components/condition-operator'
export { default as ConditionValue } from './components/condition-value'
export { default as FieldSelector } from './components/field-selector'

// Inputs
export { default as ValueInput } from './inputs/value-input'
export { default as MultipleValueInput } from './inputs/multiple-value-input'

// Utilities
export { STANDARD_OPERATORS, operatorRequiresValue, getOperatorsForFieldType } from './types'
export { InputMode, resolveInputConfig, type InputConfig } from '@auxx/lib/workflow-engine/client'
export * from './utils'

// Adapters
// Note: find-adapter removed as part of schema migration

// Wrappers
// Note: find-condition-wrapper removed as part of schema migration
