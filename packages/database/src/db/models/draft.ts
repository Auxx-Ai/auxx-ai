// packages/database/src/db/models/draft.ts
// Draft model (org-scoped) built on BaseModel

import { Draft } from '../schema/draft'
import { BaseModel } from '../utils/base-model'

/** Selected Draft entity type */
export type DraftEntity = typeof Draft.$inferSelect
/** Insertable Draft input type */
export type CreateDraftInput = typeof Draft.$inferInsert
/** Updatable Draft input type */
export type UpdateDraftInput = Partial<CreateDraftInput>

/**
 * DraftModel encapsulates CRUD for the Draft table.
 * Org-scoped via organizationId when provided to the constructor.
 */
export class DraftModel extends BaseModel<
  typeof Draft,
  CreateDraftInput,
  DraftEntity,
  UpdateDraftInput
> {
  get table() {
    return Draft
  }
}
