// packages/database/src/db/models/customer-group.ts
// CustomerGroup model built on BaseModel (org-scoped)

import { CustomerGroup } from '../schema/customer-group'
import { BaseModel } from '../utils/base-model'

/** Selected CustomerGroup entity type */
export type CustomerGroupEntity = typeof CustomerGroup.$inferSelect
/** Insertable CustomerGroup input type */
export type CreateCustomerGroupInput = typeof CustomerGroup.$inferInsert
/** Updatable CustomerGroup input type */
export type UpdateCustomerGroupInput = Partial<CreateCustomerGroupInput>

/**
 * CustomerGroupModel encapsulates CRUD for the CustomerGroup table.
 * Org-scoped via organizationId when provided to the constructor.
 */
export class CustomerGroupModel extends BaseModel<
  typeof CustomerGroup,
  CreateCustomerGroupInput,
  CustomerGroupEntity,
  UpdateCustomerGroupInput
> {
  /** Drizzle table */
  get table() {
    return CustomerGroup
  }
}
