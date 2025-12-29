// packages/database/src/db/models/search-history.ts
// SearchHistory model built on BaseModel (org-scoped)

import { and, asc, desc, eq, type SQL } from 'drizzle-orm'
import { SearchHistory } from '../schema/search-history'
import { BaseModel } from '../utils/base-model'
import { Result, type TypedResult } from '../utils/result'

/** Selected SearchHistory entity type */
export type SearchHistoryEntity = typeof SearchHistory.$inferSelect
/** Insertable SearchHistory input type */
export type CreateSearchHistoryInput = typeof SearchHistory.$inferInsert
/** Updatable SearchHistory input type */
export type UpdateSearchHistoryInput = Partial<CreateSearchHistoryInput>

/**
 * SearchHistoryModel encapsulates CRUD for the SearchHistory table.
 * Org-scoped via organizationId when provided to the constructor.
 */
export class SearchHistoryModel extends BaseModel<
  typeof SearchHistory,
  CreateSearchHistoryInput,
  SearchHistoryEntity,
  UpdateSearchHistoryInput
> {
  /** Drizzle table */
  get table() {
    return SearchHistory
  }

  async countByUser(userId: string): Promise<TypedResult<number, Error>> {
    return this.count({ where: and(this.scopeFilter ?? (undefined as any), eq(SearchHistory.userId, userId)) as any })
  }

  async findOldestByUser(userId: string, limit: number): Promise<TypedResult<SearchHistoryEntity[], Error>> {
    try {
      const whereParts: SQL<unknown>[] = []
      if (this.scopeFilter) whereParts.push(this.scopeFilter)
      whereParts.push(eq(SearchHistory.userId, userId))
      let q = this.db.select().from(SearchHistory).orderBy(asc(SearchHistory.searchedAt)).$dynamic()
      if (whereParts.length === 1) q = q.where(whereParts[0])
      else q = q.where(and(...whereParts))
      if (limit) q = q.limit(limit)
      const rows = await q
      return Result.ok(rows as SearchHistoryEntity[])
    } catch (error: any) {
      return Result.error(error)
    }
  }

  async createForUser(userId: string, query: string): Promise<TypedResult<SearchHistoryEntity, Error>> {
    return this.create({ userId: userId as any, query: query as any } as any)
  }
}
