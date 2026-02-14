// packages/lib/src/conditions/index.ts

export type { FieldResolver } from './evaluate'

// Condition evaluator for client-side filtering
export { evaluateConditions } from './evaluate'
export type { FieldInputConfig } from './field-input-modes'
// Field input modes for resource-based conditions
export { FieldInputMode, resolveFieldInputConfig } from './field-input-modes'
export type { Operator, OperatorDefinition } from './operator-definitions'
// Operator definitions - SINGLE SOURCE OF TRUTH for operators
export {
  ALL_OPERATOR_KEYS,
  getOperatorDefinition,
  getOperatorsByCategory,
  getOperatorsForBaseType,
  getOperatorsForFieldType,
  isOperatorValidForFieldType,
  mapFieldTypeToBaseType,
  OPERATOR_DEFINITIONS,
  operatorRequiresValue,
} from './operator-definitions'
// Schemas
export { conditionGroupSchema, conditionGroupsSchema, conditionSchema } from './schema'
// Types
export type { Condition, ConditionGroup, ConditionValidationResult } from './types'
export type {
  CheckboxColumnFormatting,
  ColumnFormatting,
  CurrencyColumnFormatting,
  DateColumnFormatting,
  FieldViewConfig,
  KanbanColumnSettings,
  KanbanViewConfig,
  NumberColumnFormatting,
  PhoneColumnFormatting,
  ViewConfig,
  ViewContextType,
  ViewType,
} from './view-config'
// View config schemas and types
// Field view config exports
export {
  checkboxFormattingSchema,
  columnFormattingSchema,
  createDefaultFieldViewConfig,
  currencyFormattingSchema,
  dateFormattingSchema,
  fieldViewConfigSchema,
  kanbanColumnSettingsSchema,
  kanbanConfigSchema,
  numberFormattingSchema,
  phoneFormattingSchema,
  viewConfigSchema,
  viewContextTypeSchema,
  viewContextTypes,
} from './view-config'
