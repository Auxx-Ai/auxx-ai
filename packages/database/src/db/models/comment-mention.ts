// packages/database/src/db/models/comment-mention.ts
// CommentMention model built on BaseModel (no org scope column)

import { CommentMention } from '../schema/comment-mention'
import { BaseModel } from '../utils/base-model'

/** Selected CommentMention entity type */
export type CommentMentionEntity = typeof CommentMention.$inferSelect
/** Insertable CommentMention input type */
export type CreateCommentMentionInput = typeof CommentMention.$inferInsert
/** Updatable CommentMention input type */
export type UpdateCommentMentionInput = Partial<CreateCommentMentionInput>

/**
 * CommentMentionModel encapsulates CRUD for the CommentMention table.
 * No org scoping is applied by default.
 */
export class CommentMentionModel extends BaseModel<
  typeof CommentMention,
  CreateCommentMentionInput,
  CommentMentionEntity,
  UpdateCommentMentionInput
> {
  /** Drizzle table */
  get table() {
    return CommentMention
  }
}
