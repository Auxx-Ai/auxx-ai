// packages/database/src/db/models/comment.ts
// Comment model built on BaseModel (org-scoped)

import { Comment } from '../schema/comment'
import { BaseModel } from '../utils/base-model'

/** Selected Comment entity type */
export type CommentEntity = typeof Comment.$inferSelect
/** Insertable Comment input type */
export type CreateCommentInput = typeof Comment.$inferInsert
/** Updatable Comment input type */
export type UpdateCommentInput = Partial<CreateCommentInput>

/**
 * CommentModel encapsulates CRUD for the Comment table.
 * Org-scoped via organizationId when provided to the constructor.
 */
export class CommentModel extends BaseModel<
  typeof Comment,
  CreateCommentInput,
  CommentEntity,
  UpdateCommentInput
> {
  /** Drizzle table */
  get table() {
    return Comment
  }
}
