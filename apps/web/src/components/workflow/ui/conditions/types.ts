// apps/web/src/components/workflow/ui/conditions/types.ts

import type { TiptapJSON } from '~/components/workflow/ui/input-editor'
import type { UnifiedVariable } from '~/components/workflow/types/variable-types'
import type { ReactNode } from 'react'
import { BaseType } from '@auxx/lib/workflow-engine/types'
import type { Operator } from '@auxx/lib/workflow-engine/client'

/**
 * Base condition interface that can accommodate both if-else and find use cases
 */
export interface GenericCondition {
  id: string
  fieldId: string // Can be variableId for if-else, field key for find
  operator: Operator
  value: string | number | boolean | string[] | TiptapJSON | any
  isConstant: boolean // Track constant vs variable mode from VarEditor
  logicalOperator?: 'AND' | 'OR'

  // Extended properties for advanced use cases
  key?: string // For sub-variables in if-else
  subConditions?: GenericCondition[]
  metadata?: Record<string, any>

  // Type information for backward compatibility
  numberVarType?: 'string' | 'number'

  // Legacy support
  variableId?: string // Alias for fieldId for if-else compatibility
}

/**
 * Group metadata for naming, descriptions, and UI state
 * Keep this simple - only add fields that have clear use cases
 */
export interface ConditionGroupMetadata {
  // Display properties
  name?: string // User-editable group name
  description?: string // Optional longer description
  subtext?: string // Small helper text below name

  // UI state
  collapsed?: boolean // Whether group is collapsed

  // For if-else backward compatibility
  case_id?: string // Maps to _targetBranches[].id
  case_name?: string // Legacy field, use 'name' instead
}

/**
 * Enhanced group of conditions with metadata
 */
export interface ConditionGroup {
  id: string
  conditions: GenericCondition[]
  logicalOperator: 'AND' | 'OR'

  // Optional metadata (defaults to empty object)
  metadata?: ConditionGroupMetadata

  // Optional order for sorting
  order?: number

  // Validation state (computed, not persisted)
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
  operators: Operator[]
  enumValues?: (string | { label: string; dbValue: string })[]
  subFields?: FieldDefinition[]

  // Additional metadata
  placeholder?: string
  description?: string
  unit?: string

  // For variable-based systems
  variable?: UnifiedVariable

  // NEW: Field reference for RELATION fields
  // Format: "resourceType:fieldKey" (e.g., "ticket:contact")
  // Can be parsed to derive targetTable via registry lookup
  fieldReference?: string

  // NEW: Additional metadata from parseVariable
  targetTable?: string // The target table for RELATION/REFERENCE fields
  displayType?: string // Display type (e.g., "Contact" instead of "object")
  resourceType?: string // Parent resource type for RELATION fields
  fieldKey?: string // Field key for RELATION fields
}

/**
 * Enhanced configuration for condition system behavior
 */
export interface ConditionSystemConfig {
  mode: 'variable' | 'resource' | 'hybrid'
  fields: FieldDefinition[] | 'dynamic' // Dynamic for variable-based systems

  // Existing feature flags
  allowNesting?: boolean
  allowReordering?: boolean
  showLogicalOperators?: boolean
  showGrouping?: boolean
  compactMode?: boolean
  readOnly?: boolean

  // NEW: Group feature flags
  allowGroupNaming?: boolean // Enable inline name editing
  allowGroupCollapse?: boolean // Enable collapse/expand
  allowGroupReordering?: boolean // Enable drag-and-drop
  showGroupDescription?: boolean // Show description field
  showGroupSubtext?: boolean // Show subtext

  // NEW: Group defaults
  defaultGroupName?: string // e.g., "When", "Filter", "Group"
  groupNamePlaceholder?: string // Placeholder text for name input
  addGroupButtonText?: string // Text for "Add Group" button, e.g., "Add Case"

  // VarEditor configuration
  allowVarEditor?: boolean
  allowConstantToggle?: boolean

  // Custom components
  customValueInputs?: Record<string, React.ComponentType<any>>
  customFieldSelector?: React.ComponentType<any>

  // Styling options
  className?: string
  itemClassName?: string
  groupClassName?: string

  // Validation
  validateCondition?: (condition: GenericCondition) => boolean
  validateGroup?: (group: ConditionGroup) => boolean

  // NEW: Callbacks for metadata changes
  onGroupNameChange?: (groupId: string, name: string) => void
  onGroupCollapse?: (groupId: string, collapsed: boolean) => void
  onGroupReorder?: (groupIds: string[]) => void
}

/**
 * Available operators with their configurations
 */
export interface OperatorDefinition {
  key: string
  label: string
  requiresValue: boolean
  supportedTypes: BaseType[]
  valueType?: 'single' | 'multiple' | 'none'
  description?: string
}

/**
 * Context value for condition management
 */
export interface ConditionContextValue {
  // State
  conditions: GenericCondition[]
  groups: ConditionGroup[]
  config: ConditionSystemConfig
  readOnly: boolean

  // Core operations
  addCondition: (fieldId: string, groupId?: string) => void
  updateCondition: (id: string, updates: Partial<GenericCondition>, groupId?: string) => void
  removeCondition: (id: string, groupId?: string) => void

  // Group operations (for advanced use cases)
  addGroup?: () => void
  removeGroup?: (groupId: string) => void
  updateGroup?: (groupId: string, updates: Partial<ConditionGroup>) => void
  toggleGroupLogicalOperator?: (groupId: string) => void

  // NEW: Enhanced group operations
  updateGroupMetadata?: (groupId: string, metadata: Partial<ConditionGroupMetadata>) => void
  toggleGroupCollapse?: (groupId: string) => void
  reorderGroups?: (groupIds: string[]) => void
  validateGroup?: (group: ConditionGroup) => boolean

  // Field resolution
  getFieldDefinition: (fieldId: string) => FieldDefinition | undefined
  getAvailableFields: () => FieldDefinition[]
  getAvailableOperators: (fieldId: string) => OperatorDefinition[]

  // Validation
  validateCondition: (condition: GenericCondition) => boolean
  validateAllConditions: () => boolean

  // Additional context data
  nodeId?: string
  availableVariables?: UnifiedVariable[]

  // For adapter compatibility - allows direct state management
  onConditionsChange?: (conditions: GenericCondition[]) => void
}

/**
 * Props for condition components
 */
export interface ConditionItemProps {
  condition: GenericCondition
  groupId?: string
  showDragHandle?: boolean
  showRemoveButton?: boolean
  showLogicalOperator?: boolean
  compactMode?: boolean
  className?: string
  onUpdate?: (updates: Partial<GenericCondition>) => void
  onRemove?: () => void
}

/**
 * Props for enhanced group component
 */
export interface ConditionGroupProps {
  group: ConditionGroup

  // Display options
  showDragHandle?: boolean
  showRemoveButton?: boolean
  showLogicalOperator?: boolean
  showNameInput?: boolean
  showDescription?: boolean
  showSubtext?: boolean
  allowCollapse?: boolean

  // DnD state
  isDragging?: boolean

  // Styling
  className?: string

  // Callbacks
  onUpdate?: (updates: Partial<ConditionGroup>) => void
  onRemove?: () => void

  // DnD handlers (passed from sortable wrapper)
  dragHandleAttributes?: any
  dragHandleListeners?: any
}

export interface ConditionAddProps {
  groupId?: string
  disabled?: boolean
  className?: string
  buttonText?: string
  buttonIcon?: ReactNode
}

/**
 * Value input component props
 */
export interface ValueInputProps {
  condition: GenericCondition
  field: FieldDefinition
  value: any
  onChange: (value: any, isConstantMode?: boolean) => void
  disabled?: boolean
  placeholder?: string
  className?: string
  nodeId?: string
}

/**
 * Operator selector props
 */
export interface OperatorSelectorProps {
  fieldId: string
  value: string
  onChange: (operator: Operator) => void
  disabled?: boolean
  className?: string
}

/**
 * Field selector props
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

/**
 * Import from lib - single source of truth
 * Re-export for backward compatibility
 */
export {
  OPERATOR_DEFINITIONS as STANDARD_OPERATORS,
  operatorRequiresValue,
  getOperatorDefinition,
  getOperatorsForFieldType,
  type Operator,
} from '@auxx/lib/workflow-engine/client'
