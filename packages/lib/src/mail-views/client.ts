// packages/lib/src/mail-views/client.ts
// Client-safe exports only - no database dependencies

export {
  getDefaultOperatorForField,
  getMailViewFieldDefinition,
  getMailViewFields,
  isSearchScopeCondition,
  MAIL_VIEW_FIELD_DEFINITIONS,
  type MailViewFieldDefinition,
  SEARCH_SCOPE_FIELD_DEFINITION,
  SEARCH_SCOPE_FIELD_ID,
} from './mail-view-field-definitions'
