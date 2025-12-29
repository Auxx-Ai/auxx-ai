// packages/database/src/db/models/email-template.ts
// EmailTemplate model built on BaseModel (org-scoped)

import { EmailTemplate } from '../schema/email-template'
import { BaseModel } from '../utils/base-model'

/** Selected EmailTemplate entity type */
export type EmailTemplateEntity = typeof EmailTemplate.$inferSelect
/** Insertable EmailTemplate input type */
export type CreateEmailTemplateInput = typeof EmailTemplate.$inferInsert
/** Updatable EmailTemplate input type */
export type UpdateEmailTemplateInput = Partial<CreateEmailTemplateInput>

/**
 * EmailTemplateModel encapsulates CRUD for the EmailTemplate table.
 * Org-scoped via organizationId when provided to the constructor.
 */
export class EmailTemplateModel extends BaseModel<
  typeof EmailTemplate,
  CreateEmailTemplateInput,
  EmailTemplateEntity,
  UpdateEmailTemplateInput
> {
  /** Drizzle table */
  get table() {
    return EmailTemplate
  }
}
