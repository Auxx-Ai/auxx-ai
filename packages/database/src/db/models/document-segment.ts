// packages/database/src/db/models/document-segment.ts
// DocumentSegment model built on BaseModel (org-scoped)

import { DocumentSegment } from '../schema/document-segment'
import { BaseModel } from '../utils/base-model'

/** Selected DocumentSegment entity type */
export type DocumentSegmentEntity = typeof DocumentSegment.$inferSelect
/** Insertable DocumentSegment input type */
export type CreateDocumentSegmentInput = typeof DocumentSegment.$inferInsert
/** Updatable DocumentSegment input type */
export type UpdateDocumentSegmentInput = Partial<CreateDocumentSegmentInput>

/**
 * DocumentSegmentModel encapsulates CRUD for the DocumentSegment table.
 * Org-scoped via organizationId when provided to the constructor.
 */
export class DocumentSegmentModel extends BaseModel<
  typeof DocumentSegment,
  CreateDocumentSegmentInput,
  DocumentSegmentEntity,
  UpdateDocumentSegmentInput
> {
  /** Drizzle table */
  get table() {
    return DocumentSegment
  }
}
