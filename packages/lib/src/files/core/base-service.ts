// packages/lib/src/files/core/base-service.ts

import { type Database, database as db, schema, type Transaction } from '@auxx/database'
import { and, eq, isNull, type SQL } from 'drizzle-orm'
import type {
  BulkOperationOptions,
  BulkOperationResult,
  SearchOptions,
  ServiceResult,
  ValidationResult,
} from './types'

/**
 * Constructor type for mixin pattern
 */
export type Constructor<T = {}> = new (...args: any[]) => T

/**
 * Database type - either the main Drizzle client or a transaction client
 * Using any for now to avoid complex type gymnastics with Drizzle's dynamic types
 */
export type DatabaseClient = Database | Transaction

/**
 * Enhanced base class for file and asset services with generic database operations
 * Provides common CRUD operations and shared functionality with maximum code reuse
 */
export abstract class BaseService<
  TEntity,
  TEntityWithRelations,
  TCreateRequest,
  TUpdateRequest,
  TSearchResult,
> {
  protected readonly db: DatabaseClient
  protected readonly organizationId?: string
  protected readonly userId?: string

  constructor(organizationId?: string, userId?: string, dbInstance: DatabaseClient = db) {
    this.organizationId = organizationId
    this.userId = userId
    this.db = dbInstance
  }

  // ============= Transaction Helper =============

  /**
   * Create a service instance bound to a transaction client
   * Enables proper transactional operations across service methods
   */
  withTx(tx: any): this {
    // Return a shallow clone bound to the transaction client
    const clone = Object.create(Object.getPrototypeOf(this))
    Object.assign(clone, this, { db: tx })
    return clone as this
  }

  /**
   * Smart transaction helper - creates new transaction or uses existing one
   * Automatically handles nested transaction scenarios
   */
  async getTx<T>(callback: (tx: any) => Promise<T>): Promise<T> {
    // Check if we're already in a transaction context
    // Transaction clients don't have transaction method
    if (typeof this.db.transaction !== 'function') {
      // Already in transaction, use current db (which is the transaction client)
      return callback(this.db)
    } else {
      // Not in transaction, create new one
      return this.db.transaction(callback)
    }
  }

  // ============= Abstract Methods (must be implemented by subclasses) =============

  /**
   * Get the entity name for logging and error messages
   */
  protected abstract getEntityName(): string

  /**
   * Process create data before insertion (validation, defaults, etc.)
   */
  protected abstract processCreateData(data: TCreateRequest): Promise<any>

  /**
   * Get the include options for relations when fetching entities
   */
  protected getRelationIncludes(): any {
    return {}
  }

  // ============= CRUD Operations =============

  /**
   * Create a new entity with generic database operations
   */
  async create(data: TCreateRequest, db?: DatabaseClient): Promise<TEntity> {
    // This method should be overridden by subclasses to use appropriate Drizzle operations
    // Generic implementation not possible with Drizzle's schema-based approach
    throw new Error(`create() method must be implemented by ${this.getEntityName()} subclass`)
  }

  /**
   * Get an entity by ID with organization scoping
   */
  async get(id: string, db?: DatabaseClient): Promise<TEntity | null> {
    // This method should be overridden by subclasses to use appropriate Drizzle operations
    // Generic implementation not possible with Drizzle's schema-based approach
    throw new Error(`get() method must be implemented by ${this.getEntityName()} subclass`)
  }

  /**
   * Get an entity with all populated relations
   */
  async getWithRelations(id: string, db?: DatabaseClient): Promise<TEntityWithRelations | null> {
    // This method should be overridden by subclasses to use appropriate Drizzle operations
    // Generic implementation not possible with Drizzle's schema-based approach
    throw new Error(
      `getWithRelations() method must be implemented by ${this.getEntityName()} subclass`
    )
  }

  /**
   * Update an existing entity with validation
   */
  async update(id: string, data: TUpdateRequest, db?: DatabaseClient): Promise<TEntity> {
    // This method should be overridden by subclasses to use appropriate Drizzle operations
    // Generic implementation not possible with Drizzle's schema-based approach
    throw new Error(`update() method must be implemented by ${this.getEntityName()} subclass`)
  }

  /**
   * Delete an entity (soft delete)
   */
  async delete(id: string, db?: DatabaseClient): Promise<void> {
    // This method should be overridden by subclasses to use appropriate Drizzle operations
    // Generic implementation not possible with Drizzle's schema-based approach
    throw new Error(`delete() method must be implemented by ${this.getEntityName()} subclass`)
  }

  /**
   * Permanently delete an entity
   */
  async permanentDelete(id: string, db?: DatabaseClient): Promise<void> {
    // This method should be overridden by subclasses to use appropriate Drizzle operations
    // Generic implementation not possible with Drizzle's schema-based approach
    throw new Error(
      `permanentDelete() method must be implemented by ${this.getEntityName()} subclass`
    )
  }

  /**
   * Restore a soft-deleted entity
   */
  async restore(id: string): Promise<TEntity> {
    // This method should be overridden by subclasses to use appropriate Drizzle operations
    // Generic implementation not possible with Drizzle's schema-based approach
    throw new Error(`restore() method must be implemented by ${this.getEntityName()} subclass`)
  }

  // ============= Listing & Search Operations =============

  /**
   * List entities with pagination and filtering
   */
  async list(
    options: {
      limit?: number
      offset?: number
      sortBy?: string
      sortOrder?: 'asc' | 'desc'
      filters?: any
      includeDeleted?: boolean
    } = {}
  ): Promise<{ items: TEntity[]; total: number; hasMore: boolean }> {
    // This method should be overridden by subclasses to use appropriate Drizzle operations
    // Generic implementation not possible with Drizzle's schema-based approach
    throw new Error(`list() method must be implemented by ${this.getEntityName()} subclass`)
  }

  /**
   * Search entities (basic implementation - can be overridden)
   */
  async search(query: string, options?: SearchOptions): Promise<TSearchResult[]> {
    // This method should be overridden by subclasses to use appropriate Drizzle operations
    // Generic implementation not possible with Drizzle's schema-based approach
    throw new Error(`search() method must be implemented by ${this.getEntityName()} subclass`)
  }

  /**
   * Count entities matching criteria
   */
  async count(filters?: any): Promise<number> {
    // This method should be overridden by subclasses to use appropriate Drizzle operations
    // Generic implementation not possible with Drizzle's schema-based approach
    throw new Error(`count() method must be implemented by ${this.getEntityName()} subclass`)
  }

  /**
   * Get searchable fields for basic search (can be overridden)
   */
  protected getSearchFields(): string[] {
    return ['name'] // Default search field
  }

  // ============= Bulk Operations =============

  /**
   * Create multiple entities
   */
  async bulkCreate(
    items: TCreateRequest[],
    options?: BulkOperationOptions
  ): Promise<BulkOperationResult<TEntity>> {
    const { batchSize = 100, continueOnError = false, dryRun = false } = options || {}

    const results: TEntity[] = []
    const errors: Array<{ item: TCreateRequest; error: string }> = []
    let processed = 0

    if (dryRun) {
      return {
        success: true,
        processed: items.length,
        failed: 0,
        errors: [],
        results: [],
      }
    }

    // Process in batches
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize)

      for (const item of batch) {
        try {
          const result = await this.create(item)
          results.push(result)
          processed++
        } catch (error) {
          errors.push({
            item,
            error: error instanceof Error ? error.message : 'Unknown error',
          })

          if (!continueOnError) {
            break
          }
        }
      }

      if (errors.length > 0 && !continueOnError) {
        break
      }
    }

    return {
      success: errors.length === 0,
      processed,
      failed: errors.length,
      errors,
      results,
    }
  }

  /**
   * Update multiple entities
   */
  async bulkUpdate(
    updates: Array<{ id: string; data: TUpdateRequest }>,
    options?: BulkOperationOptions
  ): Promise<BulkOperationResult<TEntity>> {
    const { batchSize = 100, continueOnError = false, dryRun = false } = options || {}

    const results: TEntity[] = []
    const errors: Array<{ item: { id: string; data: TUpdateRequest }; error: string }> = []
    let processed = 0

    if (dryRun) {
      return {
        success: true,
        processed: updates.length,
        failed: 0,
        errors: [],
        results: [],
      }
    }

    // Process in batches
    for (let i = 0; i < updates.length; i += batchSize) {
      const batch = updates.slice(i, i + batchSize)

      for (const { id, data } of batch) {
        try {
          const result = await this.update(id, data)
          results.push(result)
          processed++
        } catch (error) {
          errors.push({
            item: { id, data },
            error: error instanceof Error ? error.message : 'Unknown error',
          })

          if (!continueOnError) {
            break
          }
        }
      }

      if (errors.length > 0 && !continueOnError) {
        break
      }
    }

    return {
      success: errors.length === 0,
      processed,
      failed: errors.length,
      errors,
      results,
    }
  }

  /**
   * Delete multiple entities
   */
  async bulkDelete(
    ids: string[],
    options?: BulkOperationOptions
  ): Promise<BulkOperationResult<{ id: string }>> {
    const { batchSize = 100, continueOnError = false, dryRun = false } = options || {}

    const results: { id: string }[] = []
    const errors: Array<{ item: string; error: string }> = []
    let processed = 0

    if (dryRun) {
      return {
        success: true,
        processed: ids.length,
        failed: 0,
        errors: [],
        results: [],
      }
    }

    // Process in batches
    for (let i = 0; i < ids.length; i += batchSize) {
      const batch = ids.slice(i, i + batchSize)

      for (const id of batch) {
        try {
          await this.delete(id)
          results.push({ id })
          processed++
        } catch (error) {
          errors.push({
            item: id,
            error: error instanceof Error ? error.message : 'Unknown error',
          })

          if (!continueOnError) {
            break
          }
        }
      }

      if (errors.length > 0 && !continueOnError) {
        break
      }
    }

    return {
      success: errors.length === 0,
      processed,
      failed: errors.length,
      errors,
      results,
    }
  }

  // ============= Validation & Access Control =============

  /**
   * Validate entity data (basic implementation)
   */
  async validate(data: any): Promise<ValidationResult> {
    const errors: string[] = []
    const warnings: string[] = []

    // Basic validation - subclasses should override for specific validation
    if (data.organizationId && this.organizationId && data.organizationId !== this.organizationId) {
      errors.push('Organization ID mismatch')
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    }
  }

  /**
   * Check if user has access to entity
   */
  async hasAccess(
    entityId: string,
    userId: string,
    permission: 'read' | 'write' | 'delete'
  ): Promise<boolean> {
    // Basic organization-level access control
    if (!this.organizationId) {
      return true // No organization scoping
    }

    const entity = await this.get(entityId)
    if (!entity) {
      return false
    }

    // Check organization membership
    const hasOrgAccess = (entity as any).organizationId === this.organizationId

    // Additional permission checks can be implemented by subclasses
    return hasOrgAccess
  }

  // ============= Statistics & Analytics =============

  /**
   * Get entity statistics
   */
  async getStats(): Promise<{
    total: number
    byStatus: Record<string, number>
    recentActivity: any[]
  }> {
    // This method should be overridden by subclasses to use appropriate Drizzle operations
    // Generic implementation not possible with Drizzle's schema-based approach
    throw new Error(`getStats() method must be implemented by ${this.getEntityName()} subclass`)
  }

  // ============= Utility Methods =============

  /**
   * Check if entity exists
   */
  async exists(id: string): Promise<boolean> {
    const entity = await this.get(id)
    return entity !== null
  }

  /**
   * Generate unique identifier for entity (uses database default)
   */
  static generateId(): string {
    // Drizzle handles ID generation automatically with schema defaults
    // This method is kept for compatibility but not typically needed
    return crypto.randomUUID()
  }

  // ============= Helper Methods =============

  /**
   * Build base where clause with organization scoping and soft delete handling
   */
  protected buildBaseWhereClause(
    additionalConditions: SQL[] = [],
    includeDeleted = false
  ): SQL | undefined {
    const conditions: SQL[] = [...additionalConditions]

    // Add organization scoping if available
    if (this.organizationId) {
      const entitySchema = this.getEntitySchema()
      if (entitySchema && 'organizationId' in entitySchema) {
        conditions.push(eq(entitySchema.organizationId, this.organizationId))
      }
    }

    // Exclude soft-deleted by default (if entity supports it)
    if (!includeDeleted) {
      const entitySchema = this.getEntitySchema()
      if (entitySchema && 'deletedAt' in entitySchema) {
        conditions.push(isNull(entitySchema.deletedAt))
      }
    }

    return conditions.length > 0 ? and(...conditions) : undefined
  }

  /**
   * Get the schema for this entity type
   */
  protected getEntitySchema(): any {
    const entityName = this.getEntityName()
    const capitalizedName = entityName.charAt(0).toUpperCase() + entityName.slice(1)
    return (schema as any)[capitalizedName]
  }

  /**
   * Get the current organization ID for this service instance
   */
  protected getOrganizationId(): string | undefined {
    return this.organizationId
  }

  /**
   * Get the current user ID for this service instance
   */
  protected getUserId(): string | undefined {
    return this.userId
  }

  /**
   * Ensure organization ID is set for operations that require it
   */
  protected requireOrganization(): string {
    if (!this.organizationId) {
      throw new Error(`${this.getEntityName()} operation requires organization context`)
    }
    return this.organizationId
  }

  /**
   * Ensure user ID is set for operations that require it
   */
  protected requireUserId(): string {
    if (!this.userId) {
      throw new Error(`${this.getEntityName()} operation requires user context`)
    }
    return this.userId
  }
}
