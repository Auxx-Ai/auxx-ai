// // packages/lib/src/resources/crud/resource-crud-service.ts

// import type { Database } from '@auxx/database'
// import { createScopedLogger } from '@auxx/logger'
// import { parseRecordId, type RecordId } from '@auxx/types/resource'
// import { ResourceRegistryService } from '../registry/resource-registry-service'
// import { getHandler } from './handlers'
// import type { CrudContext, CrudResult, TransformedData, BulkResult } from './types'

// const logger = createScopedLogger('resource-crud-service')

// /**
//  * Unified CRUD service for all resource types.
//  * Routes operations to appropriate handlers.
//  */
// export class ResourceCrudService {
//   private db: Database
//   private organizationId: string
//   private userId: string
//   private registry: ResourceRegistryService

//   constructor(db: Database, organizationId: string, userId: string = '') {
//     this.db = db
//     this.organizationId = organizationId
//     this.userId = userId
//     this.registry = new ResourceRegistryService(organizationId, db)
//   }

//   /**
//    * Create a new record
//    * @param entityDefinitionId - Entity definition ID (e.g., 'contact' or custom entity UUID)
//    * @param data - Field data to create the record with
//    * @param options - Additional options (userId, skipEvents)
//    */
//   async create(
//     entityDefinitionId: string,
//     data: Record<string, unknown>,
//     options: { userId?: string; skipEvents?: boolean } = {}
//   ): Promise<CrudResult> {
//     logger.debug('create called', { entityDefinitionId })

//     const handler = getHandler(entityDefinitionId)
//     if (!handler) {
//       logger.error('No handler found for create', { entityDefinitionId })
//       return { success: false, error: `No handler for resource: ${entityDefinitionId}` }
//     }

//     logger.debug('Found handler for create', { entityDefinitionId, handlerExists: !!handler })

//     const transformed = await this.transformData(entityDefinitionId, data)
//     const ctx = this.buildContext(options)

//     return handler.create(transformed, ctx)
//   }

//   /**
//    * Update an existing record using RecordId
//    * @param recordId - Full RecordId (entityDefinitionId:entityInstanceId)
//    * @param data - Field data to update
//    * @param options - Additional options (userId, skipEvents)
//    */
//   async update(
//     recordId: RecordId,
//     data: Record<string, unknown>,
//     options: { userId?: string; skipEvents?: boolean } = {}
//   ): Promise<CrudResult> {
//     logger.debug('update called', { recordId, hasRecordId: !!recordId })

//     const { entityDefinitionId, entityInstanceId } = parseRecordId(recordId)

//     logger.debug('update parsed recordId', { entityDefinitionId, entityInstanceId })

//     if (!entityDefinitionId) {
//       return { success: false, error: `Invalid recordId - no entityDefinitionId: ${recordId}` }
//     }
//     if (!entityInstanceId) {
//       return { success: false, error: `Invalid recordId - no entityInstanceId: ${recordId}` }
//     }

//     const handler = getHandler(entityDefinitionId)
//     if (!handler) {
//       logger.error('No handler found', { entityDefinitionId })
//       return { success: false, error: `No handler for resource: ${entityDefinitionId}` }
//     }

//     const transformed = await this.transformData(entityDefinitionId, data)
//     const ctx = this.buildContext(options)

//     return handler.update(entityInstanceId, transformed, ctx)
//   }

//   /**
//    * Delete a record using RecordId
//    * @param recordId - Full RecordId (entityDefinitionId:entityInstanceId)
//    * @param options - Additional options (userId, skipEvents)
//    */
//   async delete(
//     recordId: RecordId,
//     options: { userId?: string; skipEvents?: boolean } = {}
//   ): Promise<CrudResult> {
//     const { entityDefinitionId, entityInstanceId } = parseRecordId(recordId)

//     const handler = getHandler(entityDefinitionId)
//     if (!handler) {
//       return { success: false, error: `No handler for resource: ${entityDefinitionId}` }
//     }

//     const ctx = this.buildContext(options)
//     return handler.delete(entityInstanceId, ctx)
//   }

//   /**
//    * Find record by unique field value
//    * @param entityDefinitionId - Entity definition ID (e.g., 'contact' or custom entity UUID)
//    * @param fieldKey - Field key to match on
//    * @param value - Value to search for
//    * @param options - Additional options (userId)
//    */
//   async findByField(
//     entityDefinitionId: string,
//     fieldKey: string,
//     value: string,
//     options: { userId?: string } = {}
//   ): Promise<string | null> {
//     const handler = getHandler(entityDefinitionId)
//     if (!handler?.findByField) {
//       return null
//     }

//     const ctx = this.buildContext(options)
//     return handler.findByField(fieldKey, value, ctx)
//   }

//   /**
//    * Bulk create records
//    * @param entityDefinitionId - Entity definition ID (e.g., 'contact' or custom entity UUID)
//    * @param records - Array of record data to create
//    * @param options - Additional options (userId, skipEvents)
//    */
//   async bulkCreate(
//     entityDefinitionId: string,
//     records: Array<Record<string, unknown>>,
//     options: { userId?: string; skipEvents?: boolean } = {}
//   ): Promise<BulkResult> {
//     const handler = getHandler(entityDefinitionId)
//     if (!handler) {
//       return {
//         total: records.length,
//         succeeded: 0,
//         failed: records.length,
//         results: records.map((_, i) => ({
//           success: false as const,
//           error: `No handler for resource: ${entityDefinitionId}`,
//           index: i,
//         })),
//       }
//     }

//     const ctx = this.buildContext({ ...options, skipEvents: true })

//     // Transform all records
//     const transformed = await Promise.all(
//       records.map((r) => this.transformData(entityDefinitionId, r))
//     )

//     // Use handler's bulk method if available
//     if (handler.bulkCreate) {
//       return handler.bulkCreate(transformed, ctx)
//     }

//     // Fallback to sequential creates
//     const results: Array<CrudResult & { index: number }> = []
//     let succeeded = 0
//     let failed = 0

//     for (let i = 0; i < transformed.length; i++) {
//       const result = await handler.create(transformed[i]!, ctx)
//       results.push({ ...result, index: i })
//       if (result.success) succeeded++
//       else failed++
//     }

//     return { total: records.length, succeeded, failed, results }
//   }

//   /**
//    * Bulk update records using RecordId in each record
//    * @param records - Array of { recordId, data } to update
//    * @param options - Additional options (userId, skipEvents)
//    */
//   async bulkUpdate(
//     records: Array<{ recordId: RecordId; data: Record<string, unknown> }>,
//     options: { userId?: string; skipEvents?: boolean } = {}
//   ): Promise<BulkResult> {
//     if (records.length === 0) {
//       return { total: 0, succeeded: 0, failed: 0, results: [] }
//     }

//     const ctx = this.buildContext({ ...options, skipEvents: true })
//     const results: Array<CrudResult & { index: number }> = []
//     let succeeded = 0
//     let failed = 0

//     for (let i = 0; i < records.length; i++) {
//       const { recordId, data } = records[i]!
//       const { entityDefinitionId, entityInstanceId } = parseRecordId(recordId)

//       const handler = getHandler(entityDefinitionId)
//       if (!handler) {
//         results.push({
//           success: false,
//           error: `No handler for resource: ${entityDefinitionId}`,
//           index: i,
//         })
//         failed++
//         continue
//       }

//       const transformed = await this.transformData(entityDefinitionId, data)
//       const result = await handler.update(entityInstanceId, transformed, ctx)
//       results.push({ ...result, index: i })
//       if (result.success) succeeded++
//       else failed++
//     }

//     return { total: records.length, succeeded, failed, results }
//   }

//   // ───────────────────────────────────────────────────────────────────────────
//   // Private helpers
//   // ───────────────────────────────────────────────────────────────────────────

//   private buildContext(options: { userId?: string; skipEvents?: boolean }): CrudContext {
//     return {
//       db: this.db,
//       organizationId: this.organizationId,
//       userId: options.userId ?? this.userId,
//       skipEvents: options.skipEvents,
//     }
//   }

//   /**
//    * Transform input data from field keys to handler format.
//    * Separates standard fields from custom fields.
//    */
//   private async transformData(
//     entityDefinitionId: string,
//     data: Record<string, unknown>
//   ): Promise<TransformedData> {
//     const resource = await this.registry.getById(entityDefinitionId)
//     if (!resource) {
//       // Unknown resource - treat all as standard fields
//       return { standardFields: data, customFields: {} }
//     }

//     const standardFields: Record<string, unknown> = {}
//     const customFields: Record<string, unknown> = {}

//     // Pass through entity definition ID for custom entities
//     if (resource.type === 'custom' && resource.entityDefinitionId) {
//       standardFields._entityDefinitionId = resource.entityDefinitionId
//       // Use apiSlug from resource
//       standardFields._entitySlug = resource.apiSlug
//     }

//     for (const [key, value] of Object.entries(data)) {
//       if (value === undefined || value === null || value === '') continue

//       // Find field definition
//       const field = resource.fields.find((f) => f.key === key || f.id === key)

//       if (!field) {
//         // Unknown field - check if it looks like a custom field ID (cuid2 = 25 chars)
//         if (key.length === 25) {
//           customFields[key] = value
//         } else {
//           standardFields[key] = value
//         }
//         continue
//       }

//       // Custom field (has ID) goes to customFields
//       if (field.id) {
//         customFields[field.id] = value
//         continue
//       }

//       // System field with dbColumn - use dbColumn as key
//       if ('dbColumn' in field && field.dbColumn) {
//         standardFields[field.dbColumn as string] = value
//       } else {
//         standardFields[field.key] = value
//       }
//     }

//     return { standardFields, customFields }
//   }
// }
