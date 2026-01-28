// packages/lib/src/mail-views/client.ts
// Client-safe exports only - no database dependencies

export {
  MAIL_VIEW_FIELD_DEFINITIONS,
  getMailViewFieldDefinition,
  getMailViewFields,
  getDefaultOperatorForField,
  type MailViewFieldDefinition,
} from './mail-view-field-definitions'
