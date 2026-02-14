// apps/web/src/components/conditions/types.ts

// Import from shared conditions module - single source of truth
import type { ConditionGroup as BaseConditionGroup, Condition } from '@auxx/lib/conditions/client'
import type { BaseType } from '@auxx/lib/workflow-engine/types'
import type { SelectOption } from '@auxx/types/custom-field'
import type { ReactNode } from 'react'

// Re-export core types from lib
// Re-export Operator type from conditions module
export type { Condition, Operator } from '@auxx/lib/conditions/client'

// Import operators for re-export from conditions module
import {
  getOperatorDefinition,
  getOperatorsForFieldType,
  OPERATOR_DEFINITIONS,
  type Operator,
  type OperatorDefinition,
  operatorRequiresValue,
} from '@auxx/lib/conditions/client'

// Re-export operator utilities
export {
  OPERATOR_DEFINITIONS as STANDARD_OPERATORS,
  operatorRequiresValue,
  getOperatorsForFieldType,
  getOperatorDefinition,
  type OperatorDefinition,
}

import type { FieldType } from '@auxx/database/types'
import type { PickerTriggerOptions } from '~/components/ui/picker-trigger'
import type { UnifiedVariable } from '~/components/workflow/types/variable-types'

/**
 * Group metadata for naming, descriptions, and UI state
 */
export interface ConditionGroupMetadata {
  name?: string
  description?: string
  subtext?: string
  collapsed?: boolean
  case_id?: string
  case_name?: string
}

/**
 * Enhanced group of conditions with metadata
 * Extends the base ConditionGroup from @auxx/lib/conditions
 */
export interface ConditionGroup extends Omit<BaseConditionGroup, 'metadata'> {
  metadata?: ConditionGroupMetadata
  isValid?: boolean
  validationErrors?: string[]
}

/**
 * Field definition for condition system
 */
export interface FieldDefinition {
  id: string
  label: string
  type: BaseType
  fieldType?: FieldType
  operators?: Operator[]
  options?: SelectOption[]
  subFields?: FieldDefinition[]
  placeholder?: string
  description?: string
  unit?: string
  variable?: UnifiedVariable
  fieldReference?: string
  targetTable?: string
  displayType?: string
  resourceType?: string
  fieldKey?: string
}

/**
 * Configuration for condition system behavior
 */
export interface ConditionSystemConfig {
  mode: 'variable' | 'resource' | 'hybrid'
  fields: FieldDefinition[] | 'dynamic'
  allowNesting?: boolean
  allowReordering?: boolean
  showLogicalOperators?: boolean
  showGrouping?: boolean
  compactMode?: boolean
  readOnly?: boolean
  allowGroupNaming?: boolean
  allowGroupCollapse?: boolean
  allowGroupReordering?: boolean
  showGroupDescription?: boolean
  showGroupSubtext?: boolean
  defaultGroupName?: string
  groupNamePlaceholder?: string
  addGroupButtonText?: string
  allowVarEditor?: boolean
  allowConstantToggle?: boolean
  className?: string
  itemClassName?: string
  groupClassName?: string
  validateCondition?: (condition: Condition) => boolean
  validateGroup?: (group: ConditionGroup) => boolean
  onGroupNameChange?: (groupId: string, name: string) => void
  onGroupCollapse?: (groupId: string, collapsed: boolean) => void
  onGroupReorder?: (groupIds: string[]) => void
}

/**
 * Context value for condition management
 */
export interface ConditionContextValue {
  conditions: Condition[]
  groups: ConditionGroup[]
  config: ConditionSystemConfig
  readOnly: boolean
  addCondition: (fieldId: string, groupId?: string) => void
  updateCondition: (id: string, updates: Partial<Condition>, groupId?: string) => void
  removeCondition: (id: string, groupId?: string) => void
  addGroup?: () => void
  removeGroup?: (groupId: string) => void
  updateGroup?: (groupId: string, updates: Partial<ConditionGroup>) => void
  toggleGroupLogicalOperator?: (groupId: string) => void
  updateGroupMetadata?: (groupId: string, metadata: Partial<ConditionGroupMetadata>) => void
  toggleGroupCollapse?: (groupId: string) => void
  reorderGroups?: (groupIds: string[]) => void
  validateGroup?: (group: ConditionGroup) => boolean
  getFieldDefinition: (fieldId: string) => FieldDefinition | undefined
  getAvailableFields: () => FieldDefinition[]
  getAvailableOperators: (fieldId: string) => OperatorDefinition[]
  validateCondition: (condition: Condition) => boolean
  validateAllConditions: () => boolean
  nodeId?: string
  availableVariables?: UnifiedVariable[]
  onConditionsChange?: (conditions: Condition[]) => void
}

/**
 * Props for condition item component
 */
export interface ConditionItemProps {
  condition: Condition
  groupId?: string
  showRemoveButton?: boolean
  compactMode?: boolean
  className?: string
  onUpdate?: (updates: Partial<Condition>) => void
  onRemove?: () => void
}

/**
 * Props for condition group component
 */
export interface ConditionGroupProps {
  group: ConditionGroup
  showDragHandle?: boolean
  showRemoveButton?: boolean
  // showLogicalOperator?: boolean
  showNameInput?: boolean
  showSubtext?: boolean
  allowCollapse?: boolean
  isDragging?: boolean
  className?: string
  // onUpdate?: (updates: Partial<ConditionGroup>) => void
  onRemove?: () => void
  dragHandleAttributes?: any
  dragHandleListeners?: any
}

/**
 * Props for condition add component
 */
export interface ConditionAddProps {
  groupId?: string
  disabled?: boolean
  className?: string
  buttonText?: string
  buttonIcon?: ReactNode
}

/**
 * Props for value input component
 */
export interface ValueInputProps {
  condition: Condition
  field: FieldDefinition
  value: any
  onChange: (value: any, isConstantMode?: boolean) => void
  disabled?: boolean
  placeholder?: string
  className?: string
  nodeId?: string
}

/**
 * Props for operator selector
 */
export interface OperatorSelectorProps {
  fieldId: string
  value: string
  onChange: (operator: Operator) => void
  disabled?: boolean
  className?: string
  /** Trigger customization options */
  triggerProps?: PickerTriggerOptions
  /** Controlled open state */
  open?: boolean
  /** Callback when open state changes */
  onOpenChange?: (open: boolean) => void
}

/**
 * Props for field selector
 */
export interface FieldSelectorProps {
  value: string
  onChange: (fieldId: string) => void
  disabled?: boolean
  placeholder?: string
  className?: string
  popoverWidth?: number
  popoverHeight?: number
}
