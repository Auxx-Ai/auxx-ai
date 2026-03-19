// apps/web/src/components/conditions/index.ts

// Core types from shared lib
export type { Condition, ConditionGroup as BaseConditionGroup } from '@auxx/lib/conditions/client'
// Utilities
export { type InputConfig, InputMode, resolveInputConfig } from '@auxx/lib/workflow-engine/client'
// Components
export { default as ConditionAdd } from './components/condition-add'
export { default as ConditionGroupComponent } from './components/condition-group'
export { default as ConditionItem } from './components/condition-item'
export { default as ConditionList } from './components/condition-list'
export { default as ConditionOperator } from './components/condition-operator'
export { default as ConditionValue } from './components/condition-value'
export { NavigableFieldSelector } from './components/navigable-field-selector'
export {
  default as ResourceFieldSelector,
  type ResourceFieldSelectorProps,
} from './components/resource-field-selector'
export { default as SortableConditionGroup } from './components/sortable-condition-group'
export {
  default as VariableFieldSelector,
  type VariableFieldSelectorProps,
} from './components/variable-field-selector'
// Main container
export { default as ConditionContainer } from './condition-container'
// Context
export {
  ConditionProvider,
  useConditionActions,
  useConditionContext,
  useConditionState,
} from './condition-context'
export { ResourceInput } from './inputs/resource-input'

// Inputs
export { default as ValueInput } from './inputs/value-input'
export { VariableInput } from './inputs/variable-input'
// UI types
export type {
  ConditionAddProps,
  ConditionContextValue,
  ConditionGroup,
  ConditionGroupMetadata,
  ConditionGroupProps,
  ConditionItemProps,
  ConditionSystemConfig,
  FieldDefinition,
  FieldSelectorProps,
  Operator,
  OperatorDefinition,
  OperatorSelectorProps,
  ValueInputProps,
} from './types'
// Operator utilities
export {
  getOperatorDefinition,
  getOperatorsForFieldType,
  operatorRequiresValue,
  STANDARD_OPERATORS,
} from './types'
export * from './utils'
