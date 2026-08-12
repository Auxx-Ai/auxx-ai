// packages/lib/src/conditions/client.ts

// Client-side entry point - re-exports everything
// This allows tree-shaking and separate bundling if needed

// Condition evaluation (pure TypeScript, safe for client)
export {
  type ConditionDiagnostic,
  type ConditionEvaluation,
  evaluateConditions,
  evaluateConditionsWithDiagnostics,
  FIELD_NOT_RESOLVABLE,
  type FieldResolver,
  normalizeStatusConditions,
} from './evaluate'
// THE operator evaluator — shared by mail/record-rule filters, the workflow if-else
// node and the list-filter node.
export { evaluateOperator, isEmptyValue, isKnownOperator, looseEquals } from './evaluate-operator'
export type { FieldInputConfig } from './field-input-modes'
// Field input modes for resource-based conditions
export { FieldInputMode, resolveFieldInputConfig } from './field-input-modes'
export type { FieldGroup, FieldViewConfig, ViewContextType } from './field-view-config'
export {
  createDefaultFieldViewConfig,
  fieldGroupSchema,
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
export type { ConditionContext } from './resolve-context'
export { resolveConditionContext } from './resolve-context'
export { conditionGroupSchema, conditionGroupsSchema, conditionSchema } from './schema'
export type {
  Condition,
  ConditionGroup,
  ConditionValidationResult,
  ConditionValueSource,
} from './types'
export type {
  CalendarViewConfig,
  CheckboxColumnFormatting,
  ColumnFormatting,
  CurrencyColumnFormatting,
  DateColumnFormatting,
  KanbanColumnSettings,
  KanbanViewConfig,
  NumberColumnFormatting,
  PhoneColumnFormatting,
  TableViewPreferenceConfig,
  ViewConfig,
  ViewType,
} from './view-config'
// View config schemas and types
export {
  calendarConfigSchema,
  columnFormattingSchema,
  currencyFormattingSchema,
  dateFormattingSchema,
  kanbanColumnSettingsSchema,
  kanbanConfigSchema,
  numberFormattingSchema,
  phoneFormattingSchema,
  tableViewPreferenceConfigSchema,
  viewConfigSchema,
} from './view-config'
