// packages/lib/src/conditions/client.ts

// Client-side entry point - re-exports everything
// This allows tree-shaking and separate bundling if needed

// Condition evaluation (pure TypeScript, safe for client)
export {
  evaluateConditions,
  FIELD_NOT_RESOLVABLE,
  type FieldResolver,
  normalizeStatusConditions,
} from './evaluate'
export type { FieldInputConfig } from './field-input-modes'
// Field input modes for resource-based conditions
export { FieldInputMode, resolveFieldInputConfig } from './field-input-modes'
export type { FieldViewConfig, ViewContextType } from './field-view-config'
export {
  createDefaultFieldViewConfig,
  fieldViewConfigSchema,
  viewContextTypeSchema,
  viewContextTypes,
} from './field-view-config'
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
export { conditionGroupSchema, conditionGroupsSchema, conditionSchema } from './schema'
export type { Condition, ConditionGroup, ConditionValidationResult } from './types'
export type {
  CheckboxColumnFormatting,
  ColumnFormatting,
  CurrencyColumnFormatting,
  DateColumnFormatting,
  KanbanColumnSettings,
  KanbanViewConfig,
  NumberColumnFormatting,
  PhoneColumnFormatting,
  ViewConfig,
  ViewType,
} from './view-config'
// View config schemas and types
export {
  columnFormattingSchema,
  currencyFormattingSchema,
  dateFormattingSchema,
  kanbanColumnSettingsSchema,
  kanbanConfigSchema,
  numberFormattingSchema,
  phoneFormattingSchema,
  viewConfigSchema,
} from './view-config'
