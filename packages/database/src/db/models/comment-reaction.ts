// packages/database/src/db/models/comment-reaction.ts
// CommentReaction model built on BaseModel (no org scope column)

import { CommentReaction } from '../schema/comment-reaction'
import { BaseModel } from '../utils/base-model'

/** Selected CommentReaction entity type */
export type CommentReactionEntity = typeof CommentReaction.$inferSelect
/** Insertable CommentReaction input type */
export type CreateCommentReactionInput = typeof CommentReaction.$inferInsert
/** Updatable CommentReaction input type */
export type UpdateCommentReactionInput = Partial<CreateCommentReactionInput>

/**
 * CommentReactionModel encapsulates CRUD for the CommentReaction table.
 * No org scoping is applied by default.
 */
export class CommentReactionModel extends BaseModel<
  typeof CommentReaction,
  CreateCommentReactionInput,
  CommentReactionEntity,
  UpdateCommentReactionInput
> {
  /** Drizzle table */
  get table() {
    return CommentReaction
  }
}
