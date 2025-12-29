// packages/database/src/db/models/customer-group-member.ts
// CustomerGroupMember model built on BaseModel (no org scope column)

import { and, eq, type SQL } from 'drizzle-orm'
import { CustomerGroupMember } from '../schema/customer-group-member'
import { BaseModel } from '../utils/base-model'
import { Result, type TypedResult } from '../utils/result'

/** Selected CustomerGroupMember entity type */
export type CustomerGroupMemberEntity = typeof CustomerGroupMember.$inferSelect
/** Insertable CustomerGroupMember input type */
export type CreateCustomerGroupMemberInput = typeof CustomerGroupMember.$inferInsert
/** Updatable CustomerGroupMember input type */
export type UpdateCustomerGroupMemberInput = Partial<CreateCustomerGroupMemberInput>

/**
 * CustomerGroupMemberModel encapsulates CRUD for the CustomerGroupMember table.
 * No org scoping is applied by default.
 */
export class CustomerGroupMemberModel extends BaseModel<
  typeof CustomerGroupMember,
  CreateCustomerGroupMemberInput,
  CustomerGroupMemberEntity,
  UpdateCustomerGroupMemberInput
> {
  /** Drizzle table */
  get table() {
    return CustomerGroupMember
  }

  /** List group ids for a contact */
  async listGroupIdsForContact(contactId: string): Promise<TypedResult<string[], Error>> {
    try {
      const rows = await this.db
        .select({ customerGroupId: CustomerGroupMember.customerGroupId })
        .from(CustomerGroupMember)
        .where(eq(CustomerGroupMember.contactId, contactId))
      return Result.ok(rows.map((r: any) => r.customerGroupId as string))
    } catch (error: any) {
      return Result.error(error)
    }
  }
}
