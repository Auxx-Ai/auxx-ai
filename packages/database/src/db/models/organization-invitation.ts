// packages/database/src/db/models/organization-invitation.ts
// OrganizationInvitation model built on BaseModel (org-scoped)

import { OrganizationInvitation } from '../schema/organization-invitation'
import { BaseModel } from '../utils/base-model'

/** Selected OrganizationInvitation entity type */
export type OrganizationInvitationEntity = typeof OrganizationInvitation.$inferSelect
/** Insertable OrganizationInvitation input type */
export type CreateOrganizationInvitationInput = typeof OrganizationInvitation.$inferInsert
/** Updatable OrganizationInvitation input type */
export type UpdateOrganizationInvitationInput = Partial<CreateOrganizationInvitationInput>

/**
 * OrganizationInvitationModel encapsulates CRUD for the OrganizationInvitation table.
 * Org-scoped via organizationId when provided to the constructor.
 */
export class OrganizationInvitationModel extends BaseModel<
  typeof OrganizationInvitation,
  CreateOrganizationInvitationInput,
  OrganizationInvitationEntity,
  UpdateOrganizationInvitationInput
> {
  /** Drizzle table */
  get table() {
    return OrganizationInvitation
  }
}
