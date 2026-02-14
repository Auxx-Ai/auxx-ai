// packages/database/src/db/utils/base-model.ts
// BaseModel: shared CRUD helpers for Drizzle models (server-only)

import { createId } from '@paralleldrive/cuid2'
import {
  and,
  count,
  eq,
  type InferInsertModel,
  type InferSelectModel,
  inArray,
  type SQL,
} from 'drizzle-orm'
import type { AnyPgTable } from 'drizzle-orm/pg-core'
import type { Database } from '../client'
import { database as defaultDatabase } from '../client'
import { NotFoundError } from './errors'
import { Result, type TypedResult } from './result'
import { orgScope } from './scopes'

/** Minimal returning payload when the driver yields a QueryResult object */
type ReturningQueryResult<TRow> = {
  /** Array of rows returned by the driver */
  rows: TRow[]
}

/** Normalize Drizzle returning results into a predictable row array */
function normalizeReturningRows<TRow>(result: TRow[] | ReturningQueryResult<TRow>): TRow[] {
  if (Array.isArray(result)) return result
  return Array.isArray(result.rows) ? result.rows : []
}

/** Restricts table generics to concrete Drizzle tables (not subqueries) */
type ConcretePgTable = AnyPgTable & {
  readonly _: {
    readonly brand: 'Table'
  }
}

/** Query options for list operations */
export type QueryOptions = {
  /** Optional where clause(s) to apply */
  where?: SQL<unknown> | SQL<unknown>[]
  /** Optional order by clause(s) */
  orderBy?: SQL<unknown> | SQL<unknown>[]
  /** Optional result limit */
  limit?: number
  /** Optional result offset */
  offset?: number
}

/** Pagination options for paginated queries */
export type PaginationOptions = {
  /** 1-based page number */
  page?: number
  /** items per page */
  pageSize?: number
  /** Optional order by clause(s) */
  orderBy?: SQL<unknown> | SQL<unknown>[]
}

/** Result envelope for paginated queries */
export type PaginatedResult<T> = {
  /** Current page of data */
  data: T[]
  /** Total records matching the filter */
  total: number
  /** Current 1-based page */
  page: number
  /** Page size used */
  pageSize: number
  /** Total number of pages */
  totalPages: number
  /** Whether a later page exists */
  hasNextPage: boolean
  /** Whether a previous page exists */
  hasPreviousPage: boolean
}

/**
 * BaseModel
 * - Generic, table-agnostic CRUD helper composed with Drizzle types
 * - Supports optional organization scoping via `scopeFilter`
 */
export abstract class BaseModel<
  /** Drizzle table type */
  TTable extends ConcretePgTable,
  /** Insert input type */
  TCreate = InferInsertModel<TTable>,
  /** Select (entity) type */
  TEntity = InferSelectModel<TTable>,
  /** Update input type */
  TUpdate = Partial<TCreate>,
> {
  /** Optional organization context for multi-tenant scoping */
  protected readonly organizationId?: string
  /** Drizzle database instance */
  protected readonly db: Database

  /**
   * Construct a new model
   * @param organizationId optional tenant scope if applicable to the table
   * @param db optional database override (defaults to singleton)
   */
  constructor(organizationId?: string, db: Database = defaultDatabase) {
    this.organizationId = organizationId
    this.db = db
  }

  /** The Drizzle table to operate on (must be implemented by subclass) */
  abstract get table(): TTable

  /**
   * Optional default filter applied to all queries (e.g., organization scope)
   * Defaults to organizationId scoping when the table has an organizationId column.
   */
  get scopeFilter(): SQL<unknown> | undefined {
    return orgScope(this.table as any, this.organizationId)
  }

  /** Whether this model should enforce organization scoping by default */
  protected get orgScoped(): boolean {
    return (
      typeof this.table === 'object' &&
      this.table != null &&
      'organizationId' in (this.table as any)
    )
  }

  /** Throw if table is org-scoped but no organizationId provided */
  protected requireOrgIfScoped(): void {
    if (this.orgScoped && !this.organizationId) {
      throw new Error('organizationId required for org-scoped model')
    }
  }

  /** Default select shape for reads (defaults to full row via select().from(table)) */
  // Subclasses can override find* methods for custom selections

  /**
   * Base scoped query builder selecting the model's default shape
   * - Applies scopeFilter (e.g., eq(table.organizationId, this.organizationId)) when defined
   * - Domain models can override this getter to add joins as needed
   */
  get scope() {
    this.requireOrgIfScoped()
    let q = this.db
      .select()
      // @ts-expect-error Drizzle issue: TableLikeHasEmptySelection misclassifies plain table usage
      .from(this.table)
      .$dynamic()
    if (this.scopeFilter) q = q.where(this.scopeFilter)
    return q
  }

  /**
   * Find a single entity by primary id
   */
  async findById(id: string | number): Promise<TypedResult<TEntity | null, Error>> {
    try {
      this.requireOrgIfScoped()
      if (!(this.table as any) || !('id' in (this.table as any))) {
        throw new Error('findById is not supported for tables without an id column')
      }
      let q = this.db
        .select()
        // @ts-expect-error Drizzle issue: TableLikeHasEmptySelection misclassifies plain table usage
        .from(this.table)
        .limit(1)
        .$dynamic()
      const whereParts: SQL<unknown>[] = []
      if (this.scopeFilter) whereParts.push(this.scopeFilter)
      whereParts.push(eq((this.table as any).id, id as any))
      if (whereParts.length) q = q.where(and(...whereParts))
      const rows = await q
      return Result.ok((rows?.[0] as TEntity) ?? null)
    } catch (error: any) {
      return Result.error(error)
    }
  }

  /**
   * Find many entities with optional where/order/limit/offset
   */
  async findMany(opts: QueryOptions = {}): Promise<TypedResult<TEntity[], Error>> {
    try {
      this.requireOrgIfScoped()
      let q = this.db
        .select()
        // @ts-expect-error Drizzle issue: TableLikeHasEmptySelection misclassifies plain table usage
        .from(this.table)
        .$dynamic()
      const whereParts: SQL<unknown>[] = []
      if (this.scopeFilter) whereParts.push(this.scopeFilter)
      if (opts.where) {
        const arr = Array.isArray(opts.where) ? opts.where : [opts.where]
        whereParts.push(...arr)
      }
      if (whereParts.length) q = q.where(and(...whereParts))
      if (opts.limit) q = q.limit(opts.limit)
      if (opts.offset) q = q.offset(opts.offset)
      if (opts.orderBy) {
        const orderClauses = Array.isArray(opts.orderBy) ? opts.orderBy : [opts.orderBy]
        q = q.orderBy(...orderClauses)
      }
      const rows = await q
      return Result.ok(rows as TEntity[])
    } catch (error: any) {
      return Result.error(error)
    }
  }

  /**
   * Find the first entity matching optional filters
   */
  async findFirst(opts: QueryOptions = {}): Promise<TypedResult<TEntity | null, Error>> {
    const res = await this.findMany({ ...opts, limit: 1 })
    if (!Result.isOk(res)) return res
    return Result.ok(res.value[0] ?? null)
  }

  /**
   * Insert a new entity
   */
  async create(data: TCreate): Promise<TypedResult<TEntity, Error>> {
    try {
      this.requireOrgIfScoped()
      const values: any = { ...data }
      if (this.organizationId && 'organizationId' in this.table) {
        values.organizationId = this.organizationId
      }
      // Ensure updatedAt exists for schemas that require it without a default
      if ('updatedAt' in (this.table as any) && values.updatedAt == null) {
        values.updatedAt = new Date()
      }
      // Ensure id exists for schemas that require it without a DB default
      if ('id' in (this.table as any) && values.id == null) {
        values.id = createId()
      }
      const [row] = await this.db.insert(this.table).values(values).returning()
      return Result.ok(row as TEntity)
    } catch (error: any) {
      return Result.error(error)
    }
  }

  /**
   * Update an entity by id
   */
  async update(id: string | number, data: TUpdate): Promise<TypedResult<TEntity, Error>> {
    try {
      this.requireOrgIfScoped()

      // Ensure table supports id-based operations
      if (!(this.table as any) || !('id' in (this.table as any))) {
        throw new Error('id-based update is not supported for tables without an id column')
      }

      // Build SET object conditionally (only set updatedAt when column exists)
      const setData: Record<string, unknown> = { ...(data as any) }
      if ('updatedAt' in (this.table as any)) {
        setData.updatedAt = new Date()
      }

      let q = this.db
        .update(this.table)
        .set(setData as any)
        .returning()
        .$dynamic()

      const whereParts: SQL<unknown>[] = []
      if (this.scopeFilter) whereParts.push(this.scopeFilter)
      whereParts.push(eq((this.table as any).id, id as any))
      if (whereParts.length) q = q.where(and(...whereParts))

      const rawResult = (await q) as TEntity[] | ReturningQueryResult<TEntity>
      const rows = normalizeReturningRows(rawResult)
      const row = rows[0]
      if (!row) return Result.error(new NotFoundError(`Record with id ${id} not found`))
      return Result.ok(row)
    } catch (error: any) {
      return Result.error(error)
    }
  }

  /**
   * Hard delete an entity by id
   */
  async delete(id: string | number): Promise<TypedResult<boolean, Error>> {
    try {
      this.requireOrgIfScoped()
      if (!(this.table as any) || !('id' in (this.table as any))) {
        throw new Error('id-based delete is not supported for tables without an id column')
      }

      let q = this.db.delete(this.table).$dynamic()
      const whereParts: SQL<unknown>[] = []
      if (this.scopeFilter) whereParts.push(this.scopeFilter)
      whereParts.push(eq((this.table as any).id, id as any))
      if (whereParts.length) q = q.where(and(...whereParts))
      await q
      return Result.ok(true)
    } catch (error: any) {
      return Result.error(error)
    }
  }

  /**
   * Soft delete helper (expects table to have deletedAt)
   */
  async softDelete(id: string | number): Promise<TypedResult<TEntity, Error>> {
    return this.update(id, { deletedAt: new Date() } as unknown as TUpdate)
  }

  /**
   * Count entities matching optional filters
   */
  async count(opts: QueryOptions = {}): Promise<TypedResult<number, Error>> {
    try {
      this.requireOrgIfScoped()
      let q = this.db
        .select({ value: count() })
        // @ts-expect-error Drizzle issue: TableLikeHasEmptySelection misclassifies plain table usage
        .from(this.table)
        .$dynamic()
      const whereParts: SQL<unknown>[] = []
      if (this.scopeFilter) whereParts.push(this.scopeFilter)
      if (opts.where) {
        const arr = Array.isArray(opts.where) ? opts.where : [opts.where]
        whereParts.push(...arr)
      }
      if (whereParts.length) q = q.where(and(...whereParts))
      const [row] = await q
      return Result.ok((row as any)?.value ?? 0)
    } catch (error: any) {
      return Result.error(error)
    }
  }

  /**
   * Determine if an entity exists by id
   */
  async exists(id: string | number): Promise<TypedResult<boolean, Error>> {
    this.requireOrgIfScoped()
    if (!(this.table as any) || !('id' in (this.table as any))) {
      return Result.error(
        new Error('id-based exists is not supported for tables without an id column')
      )
    }
    const res = await this.findById(id)
    if (!Result.isOk(res)) return Result.ok(false)
    return Result.ok(Boolean(res.value))
  }

  /**
   * Find entities with pagination
   */
  async findPaginated(
    opts: PaginationOptions = {}
  ): Promise<TypedResult<PaginatedResult<TEntity>, Error>> {
    this.requireOrgIfScoped()
    const page = opts.page ?? 1
    const pageSize = opts.pageSize ?? 20
    const offset = (page - 1) * pageSize

    const [dataRes, countRes] = await Promise.all([
      this.findMany({ limit: pageSize, offset, orderBy: opts.orderBy }),
      this.count(),
    ])

    if (!Result.isOk(dataRes)) return Result.error(dataRes.error)
    if (!Result.isOk(countRes)) return Result.error(countRes.error)

    const total = countRes.value ?? 0
    const totalPages = Math.max(1, Math.ceil(total / pageSize))
    return Result.ok({
      data: dataRes.value,
      total,
      page,
      pageSize,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    })
  }

  /**
   * Insert multiple entities
   */
  async createMany(data: TCreate[]): Promise<TypedResult<TEntity[], Error>> {
    try {
      this.requireOrgIfScoped()
      const values = data.map((d) => {
        const row: Record<string, unknown> = { ...(d as any) }
        if (this.organizationId && 'organizationId' in (this.table as any)) {
          row.organizationId = this.organizationId
        }
        if ('updatedAt' in (this.table as any) && row.updatedAt == null) {
          row.updatedAt = new Date()
        }
        if ('id' in (this.table as any) && (row as any).id == null) {
          row.id = createId()
        }
        return row
      })

      const rawResult = (await this.db
        .insert(this.table)
        .values(values as any)
        .returning()) as TEntity[] | ReturningQueryResult<TEntity>
      const rows = normalizeReturningRows(rawResult)
      return Result.ok(rows as TEntity[])
    } catch (error: any) {
      return Result.error(error)
    }
  }

  /**
   * Update multiple entities by id list
   */
  async updateMany(
    ids: (string | number)[],
    data: TUpdate
  ): Promise<TypedResult<TEntity[], Error>> {
    try {
      this.requireOrgIfScoped()
      if (!(this.table as any) || !('id' in (this.table as any))) {
        throw new Error('id-based updateMany is not supported for tables without an id column')
      }

      const setData: Record<string, unknown> = { ...(data as any) }
      if ('updatedAt' in (this.table as any)) {
        setData.updatedAt = new Date()
      }

      let q = this.db
        .update(this.table)
        .set(setData as any)
        .returning()
        .$dynamic()

      const whereParts: SQL<unknown>[] = []
      if (this.scopeFilter) whereParts.push(this.scopeFilter)
      whereParts.push(inArray((this.table as any).id, ids as any))
      if (whereParts.length) q = q.where(and(...whereParts))

      const rows = await q
      return Result.ok(rows as TEntity[])
    } catch (error: any) {
      return Result.error(error)
    }
  }

  /**
   * Delete multiple entities by id list
   */
  async deleteMany(ids: (string | number)[]): Promise<TypedResult<boolean, Error>> {
    try {
      this.requireOrgIfScoped()
      if (!(this.table as any) || !('id' in (this.table as any))) {
        throw new Error('id-based deleteMany is not supported for tables without an id column')
      }
      let q = this.db.delete(this.table).$dynamic()
      const whereParts: SQL<unknown>[] = []
      if (this.scopeFilter) whereParts.push(this.scopeFilter)
      whereParts.push(inArray((this.table as any).id, ids as any))
      if (whereParts.length) q = q.where(and(...whereParts))
      await q
      return Result.ok(true)
    } catch (error: any) {
      return Result.error(error)
    }
  }
}
