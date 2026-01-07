// packages/lib/src/conditions/client.ts

// Client-side entry point - re-exports everything
// This allows tree-shaking and separate bundling if needed

export type { Condition, ConditionGroup, ConditionValidationResult } from './types'
export { conditionSchema, conditionGroupSchema, conditionGroupsSchema } from './schema'

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
