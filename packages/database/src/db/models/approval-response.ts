// packages/database/src/db/models/approval-response.ts
// ApprovalResponse model built on BaseModel (no org scope column)

import { ApprovalResponse } from '../schema/approval-response'
import { BaseModel } from '../utils/base-model'

/** Selected ApprovalResponse entity type */
export type ApprovalResponseEntity = typeof ApprovalResponse.$inferSelect
/** Insertable ApprovalResponse input type */
export type CreateApprovalResponseInput = typeof ApprovalResponse.$inferInsert
/** Updatable ApprovalResponse input type */
export type UpdateApprovalResponseInput = Partial<CreateApprovalResponseInput>

/**
 * ApprovalResponseModel encapsulates CRUD for the ApprovalResponse table.
 * No org scoping is applied by default.
 */
export class ApprovalResponseModel extends BaseModel<
  typeof ApprovalResponse,
  CreateApprovalResponseInput,
  ApprovalResponseEntity,
  UpdateApprovalResponseInput
> {
  /** Drizzle table */
  get table() {
    return ApprovalResponse
  }
}
