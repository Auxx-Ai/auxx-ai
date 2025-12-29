// packages/database/src/db/models/mail-view.ts
// MailView model built on BaseModel (org-scoped)

import { MailView } from '../schema/mail-view'
import { BaseModel } from '../utils/base-model'

/** Selected MailView entity type */
export type MailViewEntity = typeof MailView.$inferSelect
/** Insertable MailView input type */
export type CreateMailViewInput = typeof MailView.$inferInsert
/** Updatable MailView input type */
export type UpdateMailViewInput = Partial<CreateMailViewInput>

/**
 * MailViewModel encapsulates CRUD for the MailView table.
 * Org-scoped via organizationId when provided to the constructor.
 */
export class MailViewModel extends BaseModel<
  typeof MailView,
  CreateMailViewInput,
  MailViewEntity,
  UpdateMailViewInput
> {
  /** Drizzle table */
  get table() {
    return MailView
  }
}
