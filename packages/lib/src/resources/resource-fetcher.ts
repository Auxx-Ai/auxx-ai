// packages/lib/src/resources/resource-fetcher.ts

import { ContactModel, TicketModel, ThreadModel, MessageModel, UserModel, DatasetModel } from '@auxx/database/models'
import { schema, type Database } from '@auxx/database'
import { type SQL, eq, sql } from 'drizzle-orm'
import { createScopedLogger } from '@auxx/logger'
import {
  RESOURCE_TABLE_MAP,
  RESOURCE_FIELD_REGISTRY,
  type TableId,
} from './registry/field-registry'
import { isCustomResourceId } from './registry/types'
import { BaseType } from './types'
import { getEntityInstance } from '@auxx/services/entity-instances'
import { ResourceRegistryService } from './registry/resource-registry-service'
import type { ResourceField } from './registry/field-types'

const logger = createScopedLogger('resource-fetcher')

/**
 * Enrich a single resource with virtual fields
 * Centralized version of find.ts's addContactVirtualFields()
 *
 * FUTURE: This will be replaced by:
 * resourceTransformation.enrichResource(resourceType, resource)
 */
export function enrichResource(resourceType: TableId, resource: any): any {
  if (!resource) return resource

  switch (resourceType) {
    case 'contact':
      return addContactVirtualFields(resource)
    case 'ticket':
    case 'thread':
    case 'message':
      return resource
    default:
      return resource
  }
}

/**
 * Enrich array of resources with virtual fields
 */
export function enrichResources(resourceType: TableId, resources: any[]): any[] {
  if (!resources || !Array.isArray(resources)) return resources
  return resources.map((r) => enrichResource(resourceType, r))
}

/**
 * Execute a resource query using the appropriate model
 * Returns enriched data automatically
 *
 * @param resourceType - Resource type to query
 * @param organizationId - Organization ID for scoping
 * @param query - Query parameters (where, orderBy, limit)
 * @param mode - 'findOne' or 'findMany'
 * @returns Enriched resource(s) or null/empty array
 */
export async function executeResourceQuery(
  resourceType: TableId,
  organizationId: string | undefined,
  query: {
    where?: SQL<unknown>
    orderBy?: SQL<unknown>[]
    limit?: number
  },
  mode: 'findOne' | 'findMany'
): Promise<any> {
  const { where: whereSql, orderBy: orderSql, limit } = query

  try {
    switch (resourceType) {
      case 'contact': {
        const model = new ContactModel(organizationId)
        if (mode === 'findOne') {
          const result = await model.findFirst({ where: whereSql, orderBy: orderSql, limit })
          return result.ok ? enrichResource('contact', result.value) : null
        } else {
          const result = await model.findMany({ where: whereSql, orderBy: orderSql, limit })
          return result.ok ? enrichResources('contact', result.value) : []
        }
      }

      case 'ticket': {
        const model = new TicketModel(organizationId)
        if (mode === 'findOne') {
          const result = await model.findFirst({ where: whereSql, orderBy: orderSql, limit })
          return result.ok ? result.value : null
        } else {
          const result = await model.findMany({ where: whereSql, orderBy: orderSql, limit })
          return result.ok ? result.value : []
        }
      }

      case 'thread': {
        const model = new ThreadModel(organizationId)
        if (mode === 'findOne') {
          const result = await model.findFirst({ where: whereSql, orderBy: orderSql, limit })
          return result.ok ? result.value : null
        } else {
          const result = await model.findMany({ where: whereSql, orderBy: orderSql, limit })
          return result.ok ? result.value : []
        }
      }

      case 'message': {
        const model = new MessageModel(organizationId)
        if (mode === 'findOne') {
          const result = await model.findFirst({ where: whereSql, orderBy: orderSql, limit })
          return result.ok ? result.value : null
        } else {
          const result = await model.findMany({ where: whereSql, orderBy: orderSql, limit })
          return result.ok ? result.value : []
        }
      }

      case 'user': {
        // UserModel is global (no organizationId scope)
        const model = new UserModel()
        if (mode === 'findOne') {
          const result = await model.findFirst({ where: whereSql, orderBy: orderSql, limit })
          return result.ok ? result.value : null
        } else {
          const result = await model.findMany({ where: whereSql, orderBy: orderSql, limit })
          return result.ok ? result.value : []
        }
      }

      case 'dataset': {
        const model = new DatasetModel(organizationId)
        if (mode === 'findOne') {
          const result = await model.findFirst({ where: whereSql, orderBy: orderSql, limit })
          return result.ok ? result.value : null
        } else {
          const result = await model.findMany({ where: whereSql, orderBy: orderSql, limit })
          return result.ok ? result.value : []
        }
      }

      default:
        logger.error('Unsupported resource type', { resourceType })
        return mode === 'findOne' ? null : []
    }
  } catch (error) {
    logger.error('Failed to execute resource query', {
      resourceType,
      mode,
      error: error instanceof Error ? error.message : String(error),
    })
    return mode === 'findOne' ? null : []
  }
}

/**
 * Fetch a single resource by ID
 * Supports both system resources (contact, ticket, etc.) and custom entities (entity_xxx)
 *
 * @param resourceType - Resource type (system or custom entity)
 * @param resourceId - ID of the resource to fetch
 * @param organizationId - Organization ID for scoping
 * @returns Resource data or null if not found
 */
export async function fetchResourceById(
  resourceType: string,
  resourceId: string,
  organizationId: string | undefined
): Promise<any | null> {
  // Handle custom entities (entity_xxx)
  if (isCustomResourceId(resourceType)) {
    if (!organizationId) {
      logger.error('organizationId required for custom entity fetch', { resourceType })
      return null
    }

    try {
      const result = await getEntityInstance({
        id: resourceId,
        organizationId,
      })

      if (result.isErr()) {
        if (result.error.code === 'ENTITY_INSTANCE_NOT_FOUND') {
          return null
        }
        logger.error('Failed to fetch entity instance', {
          resourceType,
          resourceId,
          error: result.error.message,
        })
        return null
      }

      // Transform entity instance to include fieldValues as flat object
      const instance = result.value
      const fieldValues: Record<string, any> = {}

      // Extract field values from the values relation
      // The 'values' array contains CustomFieldValue entries with a 'field' relation
      if (instance.values && Array.isArray(instance.values)) {
        for (const value of instance.values as any[]) {
          // Use field.name as the key (apiName doesn't exist in CustomField schema)
          if (value.field?.name) {
            fieldValues[value.field.name] = value.value
          }
        }
      }

      return {
        id: instance.id,
        entityDefinitionId: instance.entityDefinitionId,
        createdAt: instance.createdAt,
        updatedAt: instance.updatedAt,
        fieldValues,
      }
    } catch (error) {
      logger.error('Failed to fetch entity instance', {
        resourceType,
        resourceId,
        error: error instanceof Error ? error.message : String(error),
      })
      return null
    }
  }

  // Handle system resources (contact, ticket, thread, message)
  const tableInfo = RESOURCE_TABLE_MAP[resourceType as TableId]
  if (!tableInfo) {
    logger.error('Invalid resource type', { resourceType })
    return null
  }

  const whereSql = eq(schema[tableInfo.dbName].id, resourceId)
  return executeResourceQuery(resourceType as TableId, organizationId, { where: whereSql }, 'findOne')
}

/**
 * Add virtual fields to contact (matches find.ts implementation)
 *
 * FUTURE: This function will be replaced by:
 * resourceTransformation.enrichResource('contact', contact)
 */
function addContactVirtualFields(contact: any): any {
  if (!contact) return contact
  return {
    ...contact,
    name:
      contact.firstName && contact.lastName
        ? `${contact.firstName} ${contact.lastName}`.trim()
        : contact.firstName || contact.lastName || '',
  }
}

/**
 * Extract resource type from event type
 * e.g., 'contact:created' → 'contact'
 */
export function getResourceTypeFromEvent(eventType: string): TableId | null {
  const parts = eventType.split(':')
  const resourceType = parts[0]!

  // Check if the resourceType exists in RESOURCE_TABLE_MAP
  if (resourceType in RESOURCE_TABLE_MAP) {
    return resourceType as TableId
  }

  return null
}

/**
 * Get the ID field name for an event type
 * Maps event data field names to resource ID field names
 */
export function getResourceIdField(eventType: string): string | null {
  const idFieldMap: Record<string, string> = {
    'contact:created': 'contactId',
    'contact:updated': 'contactId',
    'contact:deleted': 'contactId',
    'contact:merged': 'contactId',
    'contact:group:added': 'contactId',
    'contact:group:removed': 'contactId',
    'ticket:created': 'ticketId',
    'ticket:updated': 'ticketId',
    'ticket:deleted': 'ticketId',
    'ticket:status:changed': 'ticketId',
    'thread:created': 'threadId',
    'thread:updated': 'threadId',
    'message:received': 'messageId',
    'message:sent': 'messageId',
  }
  return idFieldMap[eventType] || null
}

/**
 * Fetch resource with specific relationships loaded
 * Uses ResourceRegistryService for unified field lookup (system + custom)
 *
 * This is the core of lazy loading - fetches only requested relationships
 * instead of loading everything upfront.
 *
 * @param resourceType - Type of resource (system or custom entity)
 * @param resourceId - ID of resource to fetch
 * @param relationships - Array of relationship field names to load (e.g., ["contact", "Variants"])
 * @param organizationId - Organization context
 * @param db - Database connection
 * @param existingService - Optional pre-existing ResourceRegistryService to avoid re-instantiation
 * @returns Resource with requested relationships populated, or null if not found
 *
 * @example
 * // Fetch ticket with only contact relationship
 * const ticket = await fetchResourceWithRelationships(
 *   'ticket', 'ticket-123', ['contact'], 'org-456', db
 * )
 *
 * // Fetch custom entity with relationships
 * const product = await fetchResourceWithRelationships(
 *   'entity_products', 'product-123', ['Variants'], 'org-456', db
 * )
 */
export async function fetchResourceWithRelationships(
  resourceType: string,
  resourceId: string,
  relationships: string[],
  organizationId: string | undefined,
  db?: Database,
  existingService?: ResourceRegistryService
): Promise<any | null> {
  // 1. Fetch base resource
  const resource = await fetchResourceById(resourceType, resourceId, organizationId)
  if (!resource) return null

  // If no relationships requested or no DB for custom entity lookups, return base resource
  if (relationships.length === 0) return resource

  // 2. Get field definitions using ResourceRegistryService (handles both system + custom)
  // Fall back to static registry for system resources if no DB provided
  let fields: ResourceField[]
  let registryService: ResourceRegistryService | null = existingService ?? null

  if (db && organizationId) {
    registryService = registryService ?? new ResourceRegistryService(organizationId, db)
    fields = await registryService.getFieldsForResource(resourceType)
  } else if (!isCustomResourceId(resourceType)) {
    // System resource - use static registry
    const fieldRegistry = RESOURCE_FIELD_REGISTRY[resourceType as TableId]
    fields = fieldRegistry ? Object.values(fieldRegistry) : []
  } else {
    // Custom resource but no DB - can't fetch relationships
    logger.warn('DB required for custom entity relationship lookup', { resourceType })
    return resource
  }

  const fieldMap = new Map(fields.map((f) => [f.key, f]))

  // 3. Fetch all requested relationships in parallel for performance
  const fetchPromises = relationships.map(async (relFieldName) => {
    const fieldDef = fieldMap.get(relFieldName)

    // Skip if not a relationship field
    if (!fieldDef || fieldDef.type !== BaseType.RELATION || !fieldDef.relationship) {
      return { relFieldName, value: undefined }
    }

    const rel = fieldDef.relationship
    const targetResourceType = rel.targetTable

    switch (rel.cardinality) {
      case 'many-to-one':
      case 'one-to-one': {
        // belongs_to: Get related entity by ID stored in this resource
        const relatedId = getRelatedIdForBelongsTo(resource, fieldDef, resourceType)

        if (relatedId) {
          const relatedResource = await fetchResourceById(targetResourceType, relatedId, organizationId)
          return { relFieldName, value: relatedResource }
        } else {
          return { relFieldName, value: null }
        }
      }

      case 'one-to-many': {
        // has_many: Query child resources where FK points to this resource
        let items: any[] = []

        if (db && organizationId && registryService) {
          items = await fetchHasManyRelationship(
            resourceId,
            resourceType,
            targetResourceType,
            fieldDef,
            organizationId,
            db,
            registryService
          )
        } else if (!isCustomResourceId(targetResourceType)) {
          // System resource without DB - use static registry for has_many
          items = await fetchHasManySystemResource(
            resourceId,
            targetResourceType as TableId,
            fieldDef,
            organizationId
          )
        }

        // Wrap in collection structure to match frontend variable schema
        // Frontend createRelationshipCollection() generates: values, count, isEmpty, first, last
        return {
          relFieldName,
          value: {
            values: items,
            count: items.length,
            isEmpty: items.length === 0,
            first: items[0] ?? null,
            last: items[items.length - 1] ?? null,
          },
        }
      }

      case 'many-to-many': {
        // TODO: Implement when many-to-many relationships exist
        return { relFieldName, value: [] }
      }

      default:
        return { relFieldName, value: undefined }
    }
  })

  // Wait for all relationship fetches to complete in parallel
  const results = await Promise.all(fetchPromises)

  // Apply results to resource
  for (const { relFieldName, value } of results) {
    if (value !== undefined) {
      resource[relFieldName] = value
    }
  }

  return resource
}

/**
 * Get related entity ID for a belongs_to relationship
 * Handles both system resources (dbColumn) and custom entities (fieldValues)
 */
function getRelatedIdForBelongsTo(
  resource: any,
  fieldDef: ResourceField,
  resourceType: string
): string | null {
  // System resources store FK in dbColumn (e.g., contactId)
  if (!isCustomResourceId(resourceType)) {
    const fkColumn = fieldDef.dbColumn || `${fieldDef.key}Id`
    return resource[fkColumn] ?? null
  }

  // Custom entities store relationship values in fieldValues
  // The value is the related entity instance ID
  if (resource.fieldValues?.[fieldDef.key]) {
    return resource.fieldValues[fieldDef.key]
  }

  // Try direct access (in case fieldValues was flattened)
  if (resource[fieldDef.key] && typeof resource[fieldDef.key] === 'string') {
    return resource[fieldDef.key]
  }

  return null
}

/**
 * Fetch related entities for a has_many relationship
 * Uses ResourceRegistryService for unified field lookup
 *
 * For has_many, children store a reference to the parent.
 * We need to find all child entities where their relationship field = parentId
 */
async function fetchHasManyRelationship(
  parentId: string,
  parentResourceType: string,
  targetResourceType: string,
  fieldDef: ResourceField,
  organizationId: string,
  db: Database,
  registryService: ResourceRegistryService
): Promise<any[]> {
  // Get target resource fields using the already-instantiated registryService
  const targetResource = await registryService.getById(targetResourceType)

  if (!targetResource) {
    logger.warn('Target resource not found for has_many', { targetResourceType })
    return []
  }

  // Find the reciprocal field on target that points back to parent
  const reciprocalField = targetResource.fields.find(
    (f) => f.type === BaseType.RELATION && f.relationship?.targetTable === parentResourceType
  )

  if (!reciprocalField) {
    logger.warn('No reciprocal field found for has_many relationship', {
      parentResourceType,
      targetResourceType,
      fieldName: fieldDef.key,
    })
    return []
  }

  // For system resources, use existing query infrastructure
  if (targetResource.type === 'system') {
    return fetchHasManySystemResource(parentId, targetResourceType as TableId, reciprocalField, organizationId)
  }

  // For custom entities, query via CustomFieldValue with cached field definitions
  return fetchHasManyCustomEntity(parentId, reciprocalField, targetResourceType, db, registryService)
}

/**
 * Fetch has_many for system resources
 */
async function fetchHasManySystemResource(
  parentId: string,
  targetResourceType: TableId,
  reciprocalField: ResourceField,
  organizationId: string | undefined
): Promise<any[]> {
  if (!reciprocalField.dbColumn) return []

  const tableName = RESOURCE_TABLE_MAP[targetResourceType]?.dbName
  if (!tableName) return []

  const whereSql = eq(schema[tableName][reciprocalField.dbColumn], parentId)
  return executeResourceQuery(targetResourceType, organizationId, { where: whereSql }, 'findMany')
}

/**
 * Fetch has_many for custom entities
 *
 * SIMPLIFIED: Uses cached field definitions instead of joining to field table.
 * Query CustomFieldValue where:
 * - fieldId = reciprocal relationship field
 * - value->>'data' = parent entity ID (values are wrapped in { data: ... })
 */
async function fetchHasManyCustomEntity(
  parentId: string,
  reciprocalField: ResourceField,
  targetResourceType: string,
  db: Database,
  registryService: ResourceRegistryService
): Promise<any[]> {
  if (!reciprocalField.id) {
    logger.warn('Reciprocal field missing ID for has_many custom entity lookup')
    return []
  }

  // Query entity instances that have this parent as their relationship value
  // Note: The relation is named 'entityInstance' in the schema (see customFieldValueRelations)
  // Note: CustomFieldValue.value is JSONB stored as { data: actualValue }
  // Use ->>'data' to extract the actual value for comparison
  const results = await db.query.CustomFieldValue.findMany({
    where: (cfv, { and }) =>
      and(
        eq(cfv.fieldId, reciprocalField.id!),
        sql`${cfv.value}->>'data' = ${parentId}`
      ),
    with: {
      entityInstance: {
        with: {
          values: true, // Just values, no nested field join - we use cached definitions
        },
      },
    },
  })

  // Get field definitions from cache (no DB query!)
  const fields = await registryService.getFieldsForResource(targetResourceType)
  const fieldIdToName = new Map(fields.map((f) => [f.id, f.key]))

  // Transform to standard entity format
  return results
    .filter((r) => r.entityInstance && !r.entityInstance.archivedAt)
    .map((r) => {
      const instance = r.entityInstance!
      const fieldValues: Record<string, any> = {}

      for (const value of instance.values ?? []) {
        const fieldName = fieldIdToName.get(value.fieldId)
        if (fieldName) {
          // Extract actual value from { data: ... } wrapper
          const rawValue = value.value as any
          fieldValues[fieldName] = rawValue?.data ?? rawValue
        }
      }

      return {
        id: instance.id,
        entityDefinitionId: instance.entityDefinitionId,
        createdAt: instance.createdAt,
        updatedAt: instance.updatedAt,
        fieldValues,
      }
    })
}

/**
 * Analyze a path to determine which relationships need to be fetched
 * NOW ASYNC - uses ResourceRegistryService for unified field lookup (system + custom)
 *
 * Walks through path segments and identifies RELATION fields that
 * need to be loaded from the database.
 *
 * @param resourceType - Starting resource type (system or custom)
 * @param path - Path like "contact.firstName" or "Variants.first.Price"
 * @param organizationId - Organization ID for custom entity lookups
 * @param db - Database connection
 * @param existingService - Optional pre-existing ResourceRegistryService to avoid re-instantiation
 * @returns Array of relationship field names needed
 *
 * @example
 * await analyzePathForRelationships('ticket', 'contact.firstName', orgId, db)
 * // Returns: ["contact"]
 *
 * await analyzePathForRelationships('entity_products', 'Variants.first.Price', orgId, db)
 * // Returns: ["Variants"]
 */
export async function analyzePathForRelationships(
  resourceType: string,
  path: string,
  organizationId: string,
  db: Database,
  existingService?: ResourceRegistryService
): Promise<string[]> {
  const segments = path.split('.')
  const relationshipsNeeded: string[] = []
  let currentResourceType: string = resourceType

  // Use existing service if provided, otherwise create a new one
  const registryService = existingService ?? new ResourceRegistryService(organizationId, db)

  logger.debug('analyzePathForRelationships: starting analysis', {
    resourceType,
    path,
    segments,
  })

  for (const segment of segments) {
    // Skip array accessors (.first, .last, [0], numeric indices)
    if (segment.match(/\[.*\]/) || segment === 'first' || segment === 'last' || /^\d+$/.test(segment)) {
      logger.debug('analyzePathForRelationships: skipping accessor', { segment })
      continue
    }

    // Get fields for current resource type (handles both system and custom)
    const fields = await registryService.getFieldsForResource(currentResourceType)

    logger.debug('analyzePathForRelationships: got fields', {
      currentResourceType,
      segment,
      fieldCount: fields.length,
      relationFields: fields
        .filter((f) => f.type === BaseType.RELATION)
        .map((f) => ({ key: f.key, target: f.relationship?.targetTable })),
    })

    const field = fields.find((f) => f.key === segment)

    if (field?.type === BaseType.RELATION && field.relationship) {
      // This is a relationship - needs fetching
      logger.debug('analyzePathForRelationships: found relationship', {
        segment,
        targetTable: field.relationship.targetTable,
        cardinality: field.relationship.cardinality,
      })
      relationshipsNeeded.push(segment)
      currentResourceType = field.relationship.targetTable
    } else {
      // Hit a scalar field or unknown field - stop analyzing
      logger.debug('analyzePathForRelationships: not a relationship, stopping', {
        segment,
        fieldFound: !!field,
        fieldType: field?.type,
      })
      break
    }
  }

  logger.debug('analyzePathForRelationships: result', { relationshipsNeeded })
  return relationshipsNeeded
}
