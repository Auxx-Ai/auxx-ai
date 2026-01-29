// packages/lib/src/resources/crud/unified-handler-queries.ts

import { type Database, schema } from '@auxx/database'
import { eq, and, isNull } from 'drizzle-orm'
import { type ConditionGroup } from '../../conditions'
import {
  systemConditionBuilder,
  entityConditionBuilder,
  type EntityQueryContext,
} from '../../workflow-engine'
import { ResourceRegistryService, RESOURCE_TABLE_MAP, RESOURCE_TABLE_REGISTRY } from '../registry'
import type { TableId } from '../registry/field-registry'
import type { ResourceField } from '../registry'
import {
  parseResourceFieldId,
  toResourceFieldId,
  type FieldId,
  type FieldReference,
  type ResourceFieldId,
} from '@auxx/types/field'
import { getRelatedEntityDefinitionId, type RelationshipConfig } from '@auxx/types/custom-field'
import { createScopedLogger } from '@auxx/logger'
import { toRecordId, type RecordId } from '../resource-id'
import { FieldValueService } from '../../field-values'

const logger = createScopedLogger('unified-handler-queries')

/** Type for EntityInstance select */
type EntityInstanceEntity = typeof schema.EntityInstance.$inferSelect

/**
 * Input for listFiltered query
 */
export interface ListFilteredInput {
  /** Resource type: 'contact', 'ticket', or custom entity UUID */
  entityDefinitionId: string
  /** Filter groups (optional) */
  filters?: ConditionGroup[]
  /** Sort configuration (optional) */
  sorting?: Array<{ id: string; desc: boolean }>
  /** Limit per request (default: 100) */
  limit?: number
  /** Cursor for pagination */
  cursor?: { snapshotId: string; offset: number }
}

/**
 * Result from listFiltered query
 */
export interface ListFilteredResult {
  /** Snapshot ID for cache */
  snapshotId: string
  /** Array of record IDs */
  ids: string[]
  /** Total count matching filters */
  total: number
  /** Whether more results exist */
  hasMore: boolean
  /** Whether result came from cache */
  fromCache?: boolean
}

/**
 * Scan conditions to identify which related entities are needed.
 * Returns set of relatedEntityDefinitionIds.
 *
 * @param filters - Condition groups to scan
 * @param sourceFields - Fields of the source entity
 */
export function extractRequiredRelatedEntities(
  filters: ConditionGroup[],
  sourceFields: ResourceField[]
): Set<string> {
  const relatedEntityIds = new Set<string>()

  for (const group of filters) {
    for (const condition of group.conditions) {
      const fieldRef = condition.fieldId

      // Only process array format (relationship paths)
      if (!Array.isArray(fieldRef) || fieldRef.length < 2) {
        continue
      }

      // First element is the relationship field on source entity
      const relationshipRef = fieldRef[0]

      // Parse field key (handle both ResourceFieldId and plain string)
      const relationshipFieldKey =
        typeof relationshipRef === 'string' && relationshipRef.includes(':')
          ? parseResourceFieldId(relationshipRef as ResourceFieldId).fieldId
          : relationshipRef

      // Find relationship field in source fields
      const relationshipField = sourceFields.find(
        (f) => f.key === relationshipFieldKey || (f.id && f.id === relationshipFieldKey)
      )

      if (relationshipField?.relationship) {
        const relatedEntityId = getRelatedEntityDefinitionId(relationshipField.relationship as RelationshipConfig)
        if (relatedEntityId) {
          relatedEntityIds.add(relatedEntityId)
        }
      }
    }
  }

  return relatedEntityIds
}

/**
 * Query entity instance IDs using EntityConditionBuilder
 *
 * @param params - Query parameters
 */
export async function queryEntityInstanceIds(params: {
  db: Database
  entityDefinitionId: string
  organizationId: string
  filters: ConditionGroup[]
  sorting: Array<{ id: string; desc: boolean }>
}): Promise<string[]> {
  const { db, entityDefinitionId, organizationId, filters, sorting } = params

  logger.debug(
    `Querying entity instances for entityDefinitionId: ${entityDefinitionId}, filters: ${JSON.stringify(filters)}`
  )

  // Get fields for this entity via ResourceRegistryService
  const registryService = new ResourceRegistryService(organizationId, db)
  const fields = await registryService.getFieldsForResource(entityDefinitionId)

  // Detect required related entities from filters
  const requiredRelatedEntities = extractRequiredRelatedEntities(filters, fields)
  logger.debug(
    `Detected ${requiredRelatedEntities.size} required related entities: ${Array.from(requiredRelatedEntities).join(', ')}`
  )

  // Build relatedEntityFields map
  const relatedEntityFields: Record<string, ResourceField[]> = {}
  for (const relatedEntityId of requiredRelatedEntities) {
    logger.debug(`Fetching fields for related entity: ${relatedEntityId}`)
    const relatedFields = await registryService.getFieldsForResource(relatedEntityId)
    relatedEntityFields[relatedEntityId] = relatedFields
    logger.debug(`Loaded ${relatedFields.length} fields for entity '${relatedEntityId}'`)
  }

  // Build WHERE clause using existing EntityConditionBuilder
  const context: EntityQueryContext = {
    fields,
    outerTable: schema.EntityInstance,
    relatedEntityFields,
  }

  const whereClause = entityConditionBuilder.buildGroupedQuery(filters, context)

  // Build ORDER BY
  const orderByClauses =
    sorting.length > 0
      ? entityConditionBuilder.buildOrderBySql(
          sorting[0].id,
          sorting[0].desc ? 'desc' : 'asc',
          context
        )
      : undefined

  // Execute query
  let query = db
    .select({ id: schema.EntityInstance.id })
    .from(schema.EntityInstance)
    .where(
      and(
        eq(schema.EntityInstance.entityDefinitionId, entityDefinitionId),
        eq(schema.EntityInstance.organizationId, organizationId),
        isNull(schema.EntityInstance.archivedAt),
        whereClause
      )
    )
    .$dynamic()

  if (orderByClauses) {
    query = query.orderBy(...orderByClauses)
  }

  const results = await query
  return results.map((r) => r.id)
}

/**
 * Query system resource IDs using SystemConditionBuilder
 *
 * @param params - Query parameters
 */
export async function querySystemResourceIds(params: {
  db: Database
  tableId: TableId
  organizationId: string
  filters: ConditionGroup[]
  sorting: Array<{ id: string; desc: boolean }>
}): Promise<string[]> {
  const { db, tableId, organizationId, filters, sorting } = params

  // Build WHERE clause using existing SystemConditionBuilder
  const whereClause = systemConditionBuilder.buildGroupedQuery(filters, tableId)

  // Build ORDER BY
  const orderByClauses =
    sorting.length > 0
      ? systemConditionBuilder.buildOrderBySql(
          sorting[0].id,
          sorting[0].desc ? 'desc' : 'asc',
          tableId
        )
      : undefined

  // Get the table schema
  const tableSchema = getTableSchema(tableId)
  if (!tableSchema) {
    throw new Error(`Unknown table: ${tableId}`)
  }

  // Execute query
  let query = db
    .select({ id: tableSchema.id })
    .from(tableSchema)
    .where(and(eq(tableSchema.organizationId, organizationId), whereClause))
    .$dynamic()

  if (orderByClauses) {
    query = query.orderBy(...orderByClauses)
  }

  const results = await query
  return results.map((r) => r.id)
}

/**
 * Get Drizzle table schema for a system resource
 *
 * @param tableId - System table ID
 */
export function getTableSchema(tableId: TableId) {
  const tableInfo = RESOURCE_TABLE_MAP[tableId]
  if (!tableInfo) return undefined

  const tableMap: Record<string, any> = {
    Contact: schema.Contact,
    Ticket: schema.Ticket,
    Inbox: schema.Inbox,
    User: schema.User,
    Thread: schema.Thread,
    Message: schema.Message,
    Participant: schema.Participant,
    Dataset: schema.Dataset,
    Part: schema.Part,
  }

  return tableMap[tableInfo.dbName]
}

/**
 * Check if a resource ID is a system resource
 *
 * @param resourceId - Resource ID to check
 */
export function isSystemResource(resourceId: string): boolean {
  return RESOURCE_TABLE_REGISTRY.some((r) => r.id === resourceId)
}

// ─────────────────────────────────────────────────────────────────────────────
// LIST ALL TYPES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Input for listAll query
 */
export interface ListAllInput {
  /** Entity definition ID - can be UUID or type like 'tag', 'contact' */
  entityDefinitionId?: string
  /** API slug like 'tags', 'contacts' */
  apiSlug?: string
  /** Specific field IDs to fetch (all fields if undefined) */
  fieldIds?: FieldId[]
  /** Include archived records */
  includeArchived?: boolean
}

/**
 * Record with field values
 */
export type ListAllItem = EntityInstanceEntity & {
  fieldValues: Record<string, unknown>
}

/**
 * Result from listAll query
 */
export interface ListAllResult {
  /** Records with field values (inherits displayName, secondaryDisplayValue, avatarUrl from EntityInstanceEntity) */
  items: ListAllItem[]
  /** Resolved entityDefinitionId UUID */
  entityDefinitionId: string
}

// ─────────────────────────────────────────────────────────────────────────────
// RESOLUTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve entityDefinitionId or apiSlug to actual entityDefinitionId UUID.
 *
 * @param registryService - Resource registry service
 * @param params - Must provide either entityDefinitionId or apiSlug
 * @param params.entityDefinitionId - Can be UUID or entity type ('tag', 'contact')
 * @param params.apiSlug - API slug ('tags', 'contacts', 'products')
 * @returns Resolved entityDefinitionId UUID
 * @throws Error if neither provided or not found
 */
export async function resolveEntityId(
  registryService: ResourceRegistryService,
  params: { entityDefinitionId?: string; apiSlug?: string }
): Promise<string> {
  const { entityDefinitionId, apiSlug } = params

  // Resolve from apiSlug if provided
  if (apiSlug) {
    return registryService.resolveEntityDefIdFromApiSlug(apiSlug)
  }

  // Resolve entityDefinitionId (handles 'tag' → UUID, or UUID → UUID)
  if (entityDefinitionId) {
    return registryService.resolveEntityDefId(entityDefinitionId)
  }

  throw new Error('Must provide entityDefinitionId or apiSlug')
}

// ─────────────────────────────────────────────────────────────────────────────
// LIST ALL QUERY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * List all entities with field values for small datasets (no pagination).
 * Resolves entityDefinitionId (can be 'tag', 'contact', or UUID) or apiSlug to actual UUID.
 *
 * @param ctx - Query context
 * @param params - List all parameters
 * @returns Items with field values and resolved entityDefinitionId
 */
export async function listAll(
  ctx: {
    db: Database
    organizationId: string
    userId: string
  },
  params: ListAllInput
): Promise<ListAllResult> {
  const { db, organizationId, userId } = ctx

  // Create services
  const registryService = new ResourceRegistryService(organizationId, db)
  const fieldValueService = new FieldValueService(organizationId, userId, db, registryService)

  // Resolve to actual entityDefinitionId UUID
  const entityDefId = await resolveEntityId(registryService, {
    entityDefinitionId: params.entityDefinitionId,
    apiSlug: params.apiSlug,
  })

  // Fetch all records (safety limit for "all")
  const records = await db.query.EntityInstance.findMany({
    where: (ei, { eq, and, isNull }) => {
      const conditions = [
        eq(ei.entityDefinitionId, entityDefId),
        eq(ei.organizationId, organizationId),
      ]
      if (!params.includeArchived) {
        conditions.push(isNull(ei.archivedAt))
      }
      return and(...conditions)
    },
    orderBy: (ei, { desc }) => [desc(ei.updatedAt)],
    limit: 1000,
  })

  if (records.length === 0) {
    return { items: [], entityDefinitionId: entityDefId }
  }

  // Build field references - either from params.fieldIds or from all fields
  let fieldReferences: FieldReference[]

  if (params.fieldIds && params.fieldIds.length > 0) {
    // Use specific fields provided
    fieldReferences = params.fieldIds.map(
      (fieldId) => toResourceFieldId(entityDefId, fieldId) as ResourceFieldId
    )
  } else {
    // Get all fields for this entity and build references
    const fields = await registryService.getFieldsForResource(entityDefId)
    fieldReferences = fields
      .filter((f) => f.resourceFieldId) // Only fields with resourceFieldId
      .map((f) => f.resourceFieldId as ResourceFieldId)
  }

  // If no fields, return records without field values
  if (fieldReferences.length === 0) {
    return {
      items: records.map((r) => ({ ...r, fieldValues: {} })),
      entityDefinitionId: entityDefId,
    }
  }

  // Fetch field values for all records
  const recordIds = records.map((r) => toRecordId(entityDefId, r.id))
  const { values } = await fieldValueService.batchGetValues({
    recordIds,
    fieldReferences,
  })

  // Group field values by recordId
  const fieldValuesByRecord = new Map<string, Record<string, unknown>>()
  for (const recordId of recordIds) {
    fieldValuesByRecord.set(recordId, {})
  }

  for (const result of values) {
    const existing = fieldValuesByRecord.get(result.recordId) ?? {}
    // Use the fieldReference as key (ResourceFieldId string)
    const fieldKey = Array.isArray(result.fieldReference)
      ? result.fieldReference.join('::')
      : result.fieldReference
    existing[fieldKey] = result.value
    fieldValuesByRecord.set(result.recordId, existing)
  }

  // Merge field values into records
  const items = records.map((record) => ({
    ...record,
    fieldValues: fieldValuesByRecord.get(toRecordId(entityDefId, record.id)) ?? {},
  }))

  return {
    items,
    entityDefinitionId: entityDefId,
  }
}
