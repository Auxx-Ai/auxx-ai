// packages/database/src/db/models/document.ts
// Document model (org-scoped) built on BaseModel

import { and, asc, count, desc, eq, ilike, type SQL } from 'drizzle-orm'
import { Document } from '../schema/document'
import { BaseModel } from '../utils/base-model'
import { Result, type TypedResult } from '../utils/result'

/** Selected Document entity type */
export type DocumentEntity = typeof Document.$inferSelect

/** Insertable Document input type */
export type CreateDocumentInput = typeof Document.$inferInsert

/** Updatable Document input type */
export type UpdateDocumentInput = Partial<CreateDocumentInput>

export class DocumentModel extends BaseModel<
  typeof Document,
  CreateDocumentInput,
  DocumentEntity,
  UpdateDocumentInput
> {
  get table() {
    return Document
  }

  async findByDataset(datasetId: string): Promise<TypedResult<DocumentEntity[], Error>> {
    try {
      return this.findMany({ where: eq(Document.datasetId, datasetId) })
    } catch (error: any) {
      return Result.error(error)
    }
  }

  /**
   * Paginated list with optional status/search filters
   */
  async list(input: {
    datasetId: string
    status?: string
    search?: string
    page?: number
    limit?: number
    sortBy?: keyof DocumentEntity
    sortOrder?: 'asc' | 'desc'
  }): Promise<TypedResult<{ documents: DocumentEntity[]; totalCount: number }, Error>> {
    try {
      this.requireOrgIfScoped()
      const page = input.page ?? 1
      const limit = input.limit ?? 20
      const offset = (page - 1) * limit

      const whereParts: SQL<unknown>[] = []
      if (this.scopeFilter) whereParts.push(this.scopeFilter)
      whereParts.push(eq(Document.datasetId, input.datasetId))
      if (input.status) whereParts.push(eq(Document.status, input.status as any))
      if (input.search) {
        const s = `%${input.search}%`
        whereParts.push(
          // title ILIKE search OR filename ILIKE search
          ilike(Document.title, s) as any as SQL<unknown>
        )
      }

      let orderByClause: SQL<unknown> | undefined
      if (input.sortBy) {
        const col = (Document as any)[input.sortBy]
        if (col) orderByClause = input.sortOrder === 'asc' ? (asc(col) as any) : (desc(col) as any)
      } else {
        orderByClause = desc(Document.createdAt) as any
      }

      // Query page of documents
      let q = this.db.select().from(Document).$dynamic()
      if (whereParts.length) q = q.where(and(...whereParts))
      if (orderByClause) q = q.orderBy(orderByClause as any)
      q = q.limit(limit).offset(offset)
      const documents = (await q) as DocumentEntity[]

      // Count
      let cq = this.db.select({ value: count() }).from(Document).$dynamic()
      if (whereParts.length) cq = cq.where(and(...whereParts))
      const [countRow] = (await cq) as any[]
      const totalCount = countRow?.value ?? 0

      return Result.ok({ documents, totalCount })
    } catch (error: any) {
      return Result.error(error)
    }
  }
}
