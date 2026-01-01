// apps/web/src/components/conditions/index.ts

// Core types from shared lib
export type { Condition, ConditionGroup as BaseConditionGroup } from '@auxx/lib/conditions/client'

// UI types
export type {
  ConditionGroup,
  ConditionGroupMetadata,
  ConditionSystemConfig,
  ConditionContextValue,
  FieldDefinition,
  ConditionItemProps,
  ConditionGroupProps,
  ConditionAddProps,
  ValueInputProps,
  OperatorSelectorProps,
  FieldSelectorProps,
  OperatorDefinition,
  Operator,
} from './types'

// Operator utilities
export {
  STANDARD_OPERATORS,
  operatorRequiresValue,
  getOperatorsForFieldType,
  getOperatorDefinition,
} from './types'

// Context
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
export { default as ConditionGroupComponent } from './components/condition-group'
export { default as SortableConditionGroup } from './components/sortable-condition-group'
export { default as ConditionOperator } from './components/condition-operator'
export { default as ConditionValue } from './components/condition-value'
export { default as FieldSelector } from './components/field-selector'

// Inputs
export { default as ValueInput } from './inputs/value-input'
export { default as MultipleValueInput } from './inputs/multiple-value-input'

// Utilities
export { InputMode, resolveInputConfig, type InputConfig } from '@auxx/lib/workflow-engine/client'
export * from './utils'
