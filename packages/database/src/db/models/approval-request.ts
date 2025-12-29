// packages/database/src/db/models/approval-request.ts
// ApprovalRequest model built on BaseModel (org-scoped)

import { ApprovalRequest } from '../schema/approval-request'
import { BaseModel } from '../utils/base-model'

/** Selected ApprovalRequest entity type */
export type ApprovalRequestEntity = typeof ApprovalRequest.$inferSelect
/** Insertable ApprovalRequest input type */
export type CreateApprovalRequestInput = typeof ApprovalRequest.$inferInsert
/** Updatable ApprovalRequest input type */
export type UpdateApprovalRequestInput = Partial<CreateApprovalRequestInput>

/**
 * ApprovalRequestModel encapsulates CRUD for the ApprovalRequest table.
 * Org-scoped via organizationId when provided to the constructor.
 */
export class ApprovalRequestModel extends BaseModel<
  typeof ApprovalRequest,
  CreateApprovalRequestInput,
  ApprovalRequestEntity,
  UpdateApprovalRequestInput
> {
  /** Drizzle table */
  get table() {
    return ApprovalRequest
  }
}
