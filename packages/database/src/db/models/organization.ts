// packages/database/src/db/models/organization.ts
// Organization model built on BaseModel (no org scope)

import { Organization } from '../schema/organization'
import { BaseModel } from '../utils/base-model'

/** Selected Organization entity type */
export type OrganizationEntity = typeof Organization.$inferSelect
/** Insertable Organization input type */
export type CreateOrganizationInput = typeof Organization.$inferInsert
/** Updatable Organization input type */
export type UpdateOrganizationInput = Partial<CreateOrganizationInput>

/**
 * OrganizationModel encapsulates CRUD for the Organization table.
 * No org scoping is applied.
 */
export class OrganizationModel extends BaseModel<
  typeof Organization,
  CreateOrganizationInput,
  OrganizationEntity,
  UpdateOrganizationInput
> {
  get table() {
    return Organization
  }

  get scopeFilter() {
    return undefined
  }
}
