// packages/lib/src/conditions/index.ts

// Field-ref collector (partial-snapshot classification for record-rules sync consumer)
export type { CollectedConditionFields } from './collect-field-ids'
export { collectConditionFieldIds } from './collect-field-ids'
export type { ConditionDiagnostic, ConditionEvaluation, FieldResolver } from './evaluate'
// Condition evaluator for client-side filtering. Write paths (anything that mutates on
// a match) must use the diagnostics variant — see the doc comment on `evaluate.ts`.
export { evaluateConditions, evaluateConditionsWithDiagnostics } from './evaluate'
// THE operator evaluator — shared by mail/record-rule filters, the workflow if-else
// node and the list-filter node.
export { evaluateOperator, isEmptyValue, isKnownOperator, looseEquals } from './evaluate-operator'
export type { FieldInputConfig } from './field-input-modes'
// Field input modes for resource-based conditions
export { FieldInputMode, resolveFieldInputConfig } from './field-input-modes'
// Collapsible panel field groups (view-config only — never enter resource.fields)
export type { FieldGroup } from './field-view-config'
export { fieldGroupSchema } from './field-view-config'
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
// Context resolver for value-source placeholders (currentUser, …)
export type { ConditionContext } from './resolve-context'
export { resolveConditionContext } from './resolve-context'
// Schemas
export { conditionGroupSchema, conditionGroupsSchema, conditionSchema } from './schema'
// Types
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
  FieldViewConfig,
  KanbanColumnSettings,
  KanbanViewConfig,
  NumberColumnFormatting,
  PhoneColumnFormatting,
  TableViewPreferenceConfig,
  ViewConfig,
  ViewContextType,
  ViewType,
} from './view-config'
// View config schemas and types
// Field view config exports
export {
  calendarConfigSchema,
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
  tableViewPreferenceConfigSchema,
  viewConfigSchema,
  viewContextTypeSchema,
  viewContextTypes,
} from './view-config'
