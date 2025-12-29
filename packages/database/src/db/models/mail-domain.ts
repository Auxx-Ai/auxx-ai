// packages/database/src/db/models/mail-domain.ts
// MailDomain model built on BaseModel (org-scoped)

import { MailDomain } from '../schema/mail-domain'
import { BaseModel } from '../utils/base-model'

/** Selected MailDomain entity type */
export type MailDomainEntity = typeof MailDomain.$inferSelect
/** Insertable MailDomain input type */
export type CreateMailDomainInput = typeof MailDomain.$inferInsert
/** Updatable MailDomain input type */
export type UpdateMailDomainInput = Partial<CreateMailDomainInput>

/**
 * MailDomainModel encapsulates CRUD for the MailDomain table.
 * Org-scoped via organizationId when provided to the constructor.
 */
export class MailDomainModel extends BaseModel<
  typeof MailDomain,
  CreateMailDomainInput,
  MailDomainEntity,
  UpdateMailDomainInput
> {
  /** Drizzle table */
  get table() {
    return MailDomain
  }
}
