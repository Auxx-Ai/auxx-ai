// packages/lib/src/conditions/index.ts

// Types
export type { Condition, ConditionGroup, ConditionValidationResult } from './types'

// Condition evaluator for client-side filtering
export { evaluateConditions } from './evaluate'
export type { FieldResolver } from './evaluate'

// Schemas
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
  checkboxFormattingSchema,
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
  CheckboxColumnFormatting,
  FieldViewConfig,
  ViewContextType,
} from './view-config'

// Field view config exports
export {
  fieldViewConfigSchema,
  viewContextTypeSchema,
  viewContextTypes,
  createDefaultFieldViewConfig,
} from './view-config'
