// packages/database/src/db/models/customer-source.ts
// CustomerSource model built on BaseModel (org-scoped)

import { CustomerSource } from '../schema/customer-source'
import { BaseModel } from '../utils/base-model'

/** Selected CustomerSource entity type */
export type CustomerSourceEntity = typeof CustomerSource.$inferSelect
/** Insertable CustomerSource input type */
export type CreateCustomerSourceInput = typeof CustomerSource.$inferInsert
/** Updatable CustomerSource input type */
export type UpdateCustomerSourceInput = Partial<CreateCustomerSourceInput>

/**
 * CustomerSourceModel encapsulates CRUD for the CustomerSource table.
 * Org-scoped via organizationId when provided to the constructor.
 */
export class CustomerSourceModel extends BaseModel<
  typeof CustomerSource,
  CreateCustomerSourceInput,
  CustomerSourceEntity,
  UpdateCustomerSourceInput
> {
  /** Drizzle table */
  get table() {
    return CustomerSource
  }
}
