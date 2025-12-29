// packages/database/src/db/models/snippet.ts
// Snippet model built on BaseModel (org-scoped)

import { Snippet } from '../schema/snippet'
import { BaseModel } from '../utils/base-model'

/** Selected Snippet entity type */
export type SnippetEntity = typeof Snippet.$inferSelect
/** Insertable Snippet input type */
export type CreateSnippetInput = typeof Snippet.$inferInsert
/** Updatable Snippet input type */
export type UpdateSnippetInput = Partial<CreateSnippetInput>

/**
 * SnippetModel encapsulates CRUD for the Snippet table.
 * Org-scoped via organizationId when provided to the constructor.
 */
export class SnippetModel extends BaseModel<
  typeof Snippet,
  CreateSnippetInput,
  SnippetEntity,
  UpdateSnippetInput
> {
  /** Drizzle table */
  get table() {
    return Snippet
  }
}
