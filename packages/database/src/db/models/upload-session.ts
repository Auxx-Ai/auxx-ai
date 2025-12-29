// packages/database/src/db/models/upload-session.ts
// UploadSession model built on BaseModel (org-scoped)

import { UploadSession } from '../schema/upload-session'
import { BaseModel } from '../utils/base-model'

/** Selected UploadSession entity type */
export type UploadSessionEntity = typeof UploadSession.$inferSelect
/** Insertable UploadSession input type */
export type CreateUploadSessionInput = typeof UploadSession.$inferInsert
/** Updatable UploadSession input type */
export type UpdateUploadSessionInput = Partial<CreateUploadSessionInput>

/**
 * UploadSessionModel encapsulates CRUD for the UploadSession table.
 * Org-scoped via organizationId when provided to the constructor.
 */
export class UploadSessionModel extends BaseModel<
  typeof UploadSession,
  CreateUploadSessionInput,
  UploadSessionEntity,
  UpdateUploadSessionInput
> {
  /** Drizzle table */
  get table() {
    return UploadSession
  }
}
