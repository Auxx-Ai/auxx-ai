// packages/lib/src/conditions/client.ts

// Client-side entry point - re-exports everything
// This allows tree-shaking and separate bundling if needed

export type { Condition, ConditionGroup, ConditionValidationResult } from './types'
export { conditionSchema, conditionGroupSchema, conditionGroupsSchema } from './schema'

// Operator definitions - SINGLE SOURCE OF TRUTH for operators
export {
  OPERATOR_DEFINITIONS,
  ALL_OPERATOR_KEYS,
  operatorRequiresValue,
  getOperatorDefinition,
  getOperatorsForBaseType,
  getOperatorsByCategory,
  getOperatorsForFieldType,
  isOperatorValidForFieldType,
  mapFieldTypeToBaseType,
} from './operator-definitions'

export type { OperatorDefinition, Operator } from './operator-definitions'

// Field input modes for resource-based conditions
export { FieldInputMode, resolveFieldInputConfig } from './field-input-modes'

export type { FieldInputConfig } from './field-input-modes'

// View config schemas and types
export {
  viewConfigSchema,
  kanbanConfigSchema,
  kanbanColumnSettingsSchema,
  columnFormattingSchema,
  currencyFormattingSchema,
  dateFormattingSchema,
  numberFormattingSchema,
  phoneFormattingSchema,
} from './view-config'

export type {
  ViewConfig,
  ViewType,
  KanbanViewConfig,
  KanbanColumnSettings,
  ColumnFormatting,
  CurrencyColumnFormatting,
  DateColumnFormatting,
  NumberColumnFormatting,
  PhoneColumnFormatting,
} from './view-config'
