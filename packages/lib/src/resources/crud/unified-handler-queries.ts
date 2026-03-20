// packages/lib/src/resources/crud/unified-handler-queries.ts

import { type Database, schema } from '@auxx/database'
import type { FieldType } from '@auxx/database/types'
import { createScopedLogger } from '@auxx/logger'
import { getRelatedEntityDefinitionId, type RelationshipConfig } from '@auxx/types/custom-field'
import {
  type FieldId,
  type FieldReference,
  parseResourceFieldId,
  type ResourceFieldId,
  toResourceFieldId,
} from '@auxx/types/field'
import { and, eq, isNull } from 'drizzle-orm'
import {
  findCachedResource,
  getCachedEntityDefId,
  getCachedResourceFields,
  getOrgCache,
} from '../../cache'
import type { ConditionGroup } from '../../conditions'
import { FieldValueService, formatToRawValue } from '../../field-values'
import {
  type EntityQueryContext,
  entityConditionBuilder,
} from '../../workflow-engine/query-builder/entity-condition-builder'
import { systemConditionBuilder } from '../../workflow-engine/query-builder/system-condition-builder'
import {
  getFieldOutputKey,
  RESOURCE_TABLE_MAP,
  RESOURCE_TABLE_REGISTRY,
  type ResourceField,
} from '../registry'
import type { TableId } from '../registry/field-registry'
import type { ResourceRegistryService } from '../registry/resource-registry-service'
import { type RecordId, toRecordId } from '../resource-id'

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
      let relationshipFieldKey: string | undefined

      // Array format: ['ticket:contact', 'contact:email']
      if (Array.isArray(fieldRef) && fieldRef.length >= 2) {
        const relationshipRef = fieldRef[0]
        relationshipFieldKey =
          typeof relationshipRef === 'string' && relationshipRef.includes(':')
            ? parseResourceFieldId(relationshipRef as ResourceFieldId).fieldId
            : relationshipRef
      }
      // Dot notation: 'contact.email'
      else if (typeof fieldRef === 'string' && fieldRef.includes('.')) {
        relationshipFieldKey = fieldRef.split('.')[0]
      } else {
        continue
      }

      if (!relationshipFieldKey) continue

      // Find relationship field in source fields
      const relationshipField = sourceFields.find(
        (f) =>
          getFieldOutputKey(f) === relationshipFieldKey ||
          f.key === relationshipFieldKey ||
          (f.id && f.id === relationshipFieldKey)
      )

      if (relationshipField?.relationship) {
        const relatedEntityId = getRelatedEntityDefinitionId(
          relationshipField.relationship as RelationshipConfig
        )
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

  // Get fields for this entity from org cache
  const fields = await getCachedResourceFields(organizationId, entityDefinitionId)

  // Detect required related entities from filters
  const requiredRelatedEntities = extractRequiredRelatedEntities(filters, fields)
  logger.debug(
    `Detected ${requiredRelatedEntities.size} required related entities: ${Array.from(requiredRelatedEntities).join(', ')}`
  )

  // Build relatedEntityFields map from org cache
  const relatedEntityFields: Record<string, ResourceField[]> = {}
  for (const relatedEntityId of requiredRelatedEntities) {
    logger.debug(`Fetching fields for related entity: ${relatedEntityId}`)
    const relatedFields = await getCachedResourceFields(organizationId, relatedEntityId)
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

  if (entityConditionBuilder.droppedConditions.length > 0) {
    logger.warn(
      `Dropped ${entityConditionBuilder.droppedConditions.length} filter condition(s): ${JSON.stringify(entityConditionBuilder.droppedConditions)}`
    )
    if (process.env.NODE_ENV === 'development') {
      console.error(
        `[entity-query] Filter conditions dropped:`,
        entityConditionBuilder.droppedConditions
      )
    }
  }

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

  // Contact and Ticket tables have been dropped - they now use EntityInstance.
  const tableMap: Record<string, any> = {
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
  recordId: RecordId
  fieldValues: Record<string, unknown>
}

/**
 * Field info for client-side operations
 */
export interface ListAllFieldInfo {
  id: string
  key: string
  type: string
}

/**
 * Result from listAll query
 */
export interface ListAllResult {
  /** Records with field values (inherits displayName, secondaryDisplayValue, avatarUrl from EntityInstanceEntity) */
  items: ListAllItem[]
  /** Resolved entityDefinitionId UUID */
  entityDefinitionId: string
  /** Map of field key to field info (for resolving fieldIds when saving) */
  fields: Record<string, ListAllFieldInfo>
}

// ─────────────────────────────────────────────────────────────────────────────
// RESOLUTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve entityDefinitionId or apiSlug to actual entityDefinitionId UUID using org cache.
 *
 * @param organizationId - Organization ID for cache lookup
 * @param params - Must provide either entityDefinitionId or apiSlug
 * @returns Resolved entityDefinitionId UUID
 * @throws Error if neither provided or not found
 */
export async function resolveEntityIdFromCache(
  organizationId: string,
  params: { entityDefinitionId?: string; apiSlug?: string }
): Promise<string> {
  const { entityDefinitionId, apiSlug } = params

  const key = apiSlug ?? entityDefinitionId
  if (!key) {
    throw new Error('Must provide entityDefinitionId or apiSlug')
  }

  // Try finding as a resource (handles entityType, apiSlug, and UUID)
  const resource = await findCachedResource(organizationId, key)
  if (resource) {
    return resource.entityDefinitionId ?? resource.id
  }

  // If it looks like a UUID/CUID (not a short type name), return as-is
  if (key.length >= 20) {
    return key
  }

  // Try entityDefs cache for entity types
  const resolved = await getCachedEntityDefId(organizationId, key)
  if (resolved) return resolved

  // Try entityDefSlugs cache for apiSlugs
  const slugs = await getOrgCache().get(organizationId, 'entityDefSlugs')
  if (slugs[key]) return slugs[key]

  throw new Error(`Entity not found for key: ${key}`)
}

/**
 * @deprecated Use resolveEntityIdFromCache instead
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
  const fieldValueService = new FieldValueService(organizationId, userId, db)

  // Resolve to actual entityDefinitionId UUID
  const entityDefId = await resolveEntityIdFromCache(organizationId, {
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

  // Get all fields for this entity from org cache
  const fields = await getCachedResourceFields(organizationId, entityDefId)

  // Build fields map (outputKey → { id, key, type })
  const fieldsMap: Record<string, ListAllFieldInfo> = {}
  for (const field of fields) {
    const outputKey = getFieldOutputKey(field)
    fieldsMap[outputKey] = {
      id: field.id,
      key: outputKey,
      type: field.fieldType ?? field.type,
    }
  }

  if (records.length === 0) {
    return { items: [], entityDefinitionId: entityDefId, fields: fieldsMap }
  }

  // Build field references and maps from ResourceFieldId → field.key and → fieldType
  const resourceFieldIdToKey = new Map<string, string>()
  const resourceFieldIdToType = new Map<string, FieldType>()
  let fieldReferences: FieldReference[]

  if (params.fieldIds && params.fieldIds.length > 0) {
    // Use specific fields provided
    fieldReferences = params.fieldIds.map((fieldId) => {
      const resourceFieldId = toResourceFieldId(entityDefId, fieldId)
      // Find field by id to get its key and type
      const field = fields.find((f) => f.id === fieldId)
      if (field) {
        resourceFieldIdToKey.set(resourceFieldId, getFieldOutputKey(field))
        resourceFieldIdToType.set(resourceFieldId, (field.fieldType ?? field.type) as FieldType)
      }
      return resourceFieldId as ResourceFieldId
    })
  } else {
    // Use all fields
    fieldReferences = fields
      .filter((f) => f.resourceFieldId) // Only fields with resourceFieldId
      .map((f) => {
        resourceFieldIdToKey.set(f.resourceFieldId as string, getFieldOutputKey(f))
        resourceFieldIdToType.set(f.resourceFieldId as string, (f.fieldType ?? f.type) as FieldType)
        return f.resourceFieldId as ResourceFieldId
      })
  }

  // If no fields, return records without field values
  if (fieldReferences.length === 0) {
    return {
      items: records.map((r) => ({
        ...r,
        recordId: toRecordId(entityDefId, r.id),
        fieldValues: {},
      })),
      entityDefinitionId: entityDefId,
      fields: fieldsMap,
    }
  }

  // Fetch field values for all records
  const recordIds = records.map((r) => toRecordId(entityDefId, r.id))
  const { values } = await fieldValueService.batchGetValues({
    recordIds,
    fieldReferences,
  })

  // Group field values by recordId, using field key (not ResourceFieldId) as the key
  const fieldValuesByRecord = new Map<string, Record<string, unknown>>()
  for (const recordId of recordIds) {
    fieldValuesByRecord.set(recordId, {})
  }

  for (const result of values) {
    const existing = fieldValuesByRecord.get(result.recordId) ?? {}
    // Convert ResourceFieldId to field key for the output
    const resourceFieldId = Array.isArray(result.fieldRef)
      ? result.fieldRef.join('::')
      : result.fieldRef
    const fieldKey = resourceFieldIdToKey.get(resourceFieldId) ?? resourceFieldId
    const fieldType = resourceFieldIdToType.get(resourceFieldId)

    // Extract raw value from TypedFieldValue (e.g., { type: 'text', value: '#C9B6F2' } → '#C9B6F2')
    const rawValue =
      fieldType && result.value != null ? formatToRawValue(result.value, fieldType) : result.value
    existing[fieldKey] = rawValue
    fieldValuesByRecord.set(result.recordId, existing)
  }

  // Merge field values into records
  const items = records.map((record) => {
    const recordId = toRecordId(entityDefId, record.id)
    return {
      ...record,
      recordId,
      fieldValues: fieldValuesByRecord.get(recordId) ?? {},
    }
  })

  return {
    items,
    entityDefinitionId: entityDefId,
    fields: fieldsMap,
  }
}
