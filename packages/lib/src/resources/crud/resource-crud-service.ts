// packages/lib/src/resources/crud/resource-crud-service.ts

import type { Database } from '@auxx/database'
import { ResourceRegistryService } from '../registry/resource-registry-service'
import { getHandler } from './handlers'
import type {
  CrudContext,
  CrudResult,
  TransformedData,
  BulkResult,
  CreateRecordOptions,
  UpdateRecordOptions,
  FindByFieldOptions,
} from './types'

/**
 * Unified CRUD service for all resource types.
 * Routes operations to appropriate handlers.
 */
export class ResourceCrudService {
  private db: Database
  private organizationId: string
  private userId: string
  private registry: ResourceRegistryService

  constructor(db: Database, organizationId: string, userId: string = '') {
    this.db = db
    this.organizationId = organizationId
    this.userId = userId
    this.registry = new ResourceRegistryService(organizationId, db)
  }

  /**
   * Create a new record
   */
  async create(
    resourceType: string,
    data: Record<string, unknown>,
    options: { userId?: string; skipEvents?: boolean } = {}
  ): Promise<CrudResult> {
    const handler = getHandler(resourceType)
    if (!handler) {
      return { success: false, error: `No handler for resource: ${resourceType}` }
    }

    const transformed = await this.transformData(resourceType, data)
    const ctx = this.buildContext(options)

    return handler.create(transformed, ctx)
  }

  /**
   * Create using the legacy CreateRecordOptions format
   * @deprecated Use create(resourceType, data, options) instead
   */
  async createWithOptions(
    resourceType: string,
    options: CreateRecordOptions
  ): Promise<CrudResult> {
    const handler = getHandler(resourceType)
    if (!handler) {
      return { success: false, error: `No handler for resource: ${resourceType}` }
    }

    const transformed: TransformedData = {
      standardFields: options.standardFields,
      customFields: options.customFields ?? {},
    }
    const ctx = this.buildContext({})

    return handler.create(transformed, ctx)
  }

  /**
   * Update an existing record
   */
  async update(
    resourceType: string,
    id: string,
    data: Record<string, unknown>,
    options: { userId?: string; skipEvents?: boolean } = {}
  ): Promise<CrudResult> {
    const handler = getHandler(resourceType)
    if (!handler) {
      return { success: false, error: `No handler for resource: ${resourceType}` }
    }

    const transformed = await this.transformData(resourceType, data)
    const ctx = this.buildContext(options)

    return handler.update(id, transformed, ctx)
  }

  /**
   * Update using the legacy UpdateRecordOptions format
   * @deprecated Use update(resourceType, id, data, options) instead
   */
  async updateWithOptions(
    resourceType: string,
    options: UpdateRecordOptions
  ): Promise<CrudResult> {
    const handler = getHandler(resourceType)
    if (!handler) {
      return { success: false, error: `No handler for resource: ${resourceType}` }
    }

    const transformed: TransformedData = {
      standardFields: options.standardFields,
      customFields: options.customFields ?? {},
    }
    const ctx = this.buildContext({})

    return handler.update(options.id, transformed, ctx)
  }

  /**
   * Delete a record
   */
  async delete(
    resourceType: string,
    id: string,
    options: { userId?: string; skipEvents?: boolean } = {}
  ): Promise<CrudResult> {
    const handler = getHandler(resourceType)
    if (!handler) {
      return { success: false, error: `No handler for resource: ${resourceType}` }
    }

    const ctx = this.buildContext(options)
    return handler.delete(id, ctx)
  }

  /**
   * Find record by unique field value
   */
  async findByField(
    resourceType: string,
    fieldKey: string,
    value: string,
    options: { userId?: string } = {}
  ): Promise<string | null> {
    const handler = getHandler(resourceType)
    if (!handler?.findByField) {
      return null
    }

    const ctx = this.buildContext(options)
    return handler.findByField(fieldKey, value, ctx)
  }

  /**
   * Find record by field using legacy FindByFieldOptions format
   * @deprecated Use findByField(resourceType, fieldKey, value) instead
   */
  async findByFieldWithOptions(
    resourceType: string,
    options: FindByFieldOptions
  ): Promise<string | null> {
    return this.findByField(resourceType, options.fieldKey, options.value)
  }

  /**
   * Bulk create records
   */
  async bulkCreate(
    resourceType: string,
    records: Array<Record<string, unknown>>,
    options: { userId?: string; skipEvents?: boolean } = {}
  ): Promise<BulkResult> {
    const handler = getHandler(resourceType)
    if (!handler) {
      return {
        total: records.length,
        succeeded: 0,
        failed: records.length,
        results: records.map((_, i) => ({
          success: false as const,
          error: `No handler for resource: ${resourceType}`,
          index: i,
        })),
      }
    }

    const ctx = this.buildContext({ ...options, skipEvents: true })

    // Transform all records
    const transformed = await Promise.all(
      records.map((r) => this.transformData(resourceType, r))
    )

    // Use handler's bulk method if available
    if (handler.bulkCreate) {
      return handler.bulkCreate(transformed, ctx)
    }

    // Fallback to sequential creates
    const results: Array<CrudResult & { index: number }> = []
    let succeeded = 0
    let failed = 0

    for (let i = 0; i < transformed.length; i++) {
      const result = await handler.create(transformed[i]!, ctx)
      results.push({ ...result, index: i })
      if (result.success) succeeded++
      else failed++
    }

    return { total: records.length, succeeded, failed, results }
  }

  /**
   * Bulk update records
   */
  async bulkUpdate(
    resourceType: string,
    records: Array<{ id: string; data: Record<string, unknown> }>,
    options: { userId?: string; skipEvents?: boolean } = {}
  ): Promise<BulkResult> {
    const handler = getHandler(resourceType)
    if (!handler) {
      return {
        total: records.length,
        succeeded: 0,
        failed: records.length,
        results: records.map((_, i) => ({
          success: false as const,
          error: `No handler for resource: ${resourceType}`,
          index: i,
        })),
      }
    }

    const ctx = this.buildContext({ ...options, skipEvents: true })

    const results: Array<CrudResult & { index: number }> = []
    let succeeded = 0
    let failed = 0

    for (let i = 0; i < records.length; i++) {
      const transformed = await this.transformData(resourceType, records[i]!.data)
      const result = await handler.update(records[i]!.id, transformed, ctx)
      results.push({ ...result, index: i })
      if (result.success) succeeded++
      else failed++
    }

    return { total: records.length, succeeded, failed, results }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ───────────────────────────────────────────────────────────────────────────

  private buildContext(options: { userId?: string; skipEvents?: boolean }): CrudContext {
    return {
      db: this.db,
      organizationId: this.organizationId,
      userId: options.userId ?? this.userId,
      skipEvents: options.skipEvents,
    }
  }

  /**
   * Transform input data from field keys to handler format.
   * Separates standard fields from custom fields.
   */
  private async transformData(
    resourceType: string,
    data: Record<string, unknown>
  ): Promise<TransformedData> {
    const resource = await this.registry.getById(resourceType)
    if (!resource) {
      // Unknown resource - treat all as standard fields
      return { standardFields: data, customFields: {} }
    }

    const standardFields: Record<string, unknown> = {}
    const customFields: Record<string, unknown> = {}

    // Pass through entity definition ID for custom entities
    if (resource.type === 'custom' && resource.entityDefinitionId) {
      standardFields._entityDefinitionId = resource.entityDefinitionId
      // Extract slug from resource ID (entity_<slug>)
      const slug = resource.id.replace('entity_', '')
      standardFields._entitySlug = slug
    }

    for (const [key, value] of Object.entries(data)) {
      if (value === undefined || value === null || value === '') continue

      // Find field definition
      const field = resource.fields.find((f) => f.key === key || f.id === key)

      if (!field) {
        // Unknown field - check if it looks like a custom field ID (cuid2 = 25 chars)
        if (key.length === 25) {
          customFields[key] = value
        } else {
          standardFields[key] = value
        }
        continue
      }

      // Custom field (has ID) goes to customFields
      if (field.id) {
        customFields[field.id] = value
        continue
      }

      // System field with dbColumn - use dbColumn as key
      if ('dbColumn' in field && field.dbColumn) {
        standardFields[field.dbColumn as string] = value
      } else {
        standardFields[field.key] = value
      }
    }

    return { standardFields, customFields }
  }
}
