// packages/lib/src/resources/variable-generators.ts

/**
 * Variable generator functions for resource triggers and nodes
 * Uses createUnifiedOutputVariable pattern for consistency with other nodes
 */

import { getRelatedEntityDefinitionId, type RelationshipConfig } from '@auxx/types/custom-field'
import { toResourceFieldId } from '@auxx/types/field'
import {
  createNestedVariable,
  type NestedVariableConfig,
} from '../workflow-engine/catalog/variable-conversion'
import type { UnifiedVariable } from '../workflow-engine/types/unified-variable'
import {
  RESOURCE_FIELD_REGISTRY,
  RESOURCE_TABLE_MAP,
  type TableId,
} from './registry/field-registry'
import { getFieldOutputKey, type ResourceField } from './registry/field-types'
import { createRelationshipCollection } from './registry/relationship-utils'
import { BaseType } from './types'

/**
 * Resource metadata needed for variable generation (works for system + custom)
 */
export interface ResourceMeta {
  /** Resource ID (e.g., 'contact', 'entity_vendors') */
  id: string
  /** Singular label (e.g., 'Contact', 'Vendor') */
  label: string
  /** Plural label (e.g., 'Contacts', 'Vendors') */
  plural: string
}

/**
 * Minimal resource shape for relationship lookups
 */
interface ResourceWithFields {
  id: string
  label: string
  plural: string
  fields: ResourceField[]
}

/**
 * Options for variable generation with relationship expansion
 */
export interface VariableGeneratorOptions {
  /**
   * All available resources (for looking up related entity fields)
   * Map from resource ID to Resource object
   */
  resourcesMap?: Map<string, ResourceWithFields>

  /**
   * Maximum depth for relationship expansion (default: 2)
   * - 0: No relationship expansion
   * - 1: Expand immediate relationships only
   * - 2: Expand relationships of relationships
   */
  maxDepth?: number
}

/**
 * Get fields for a resource (system or custom)
 * First tries static registry, then falls back to resourcesMap
 */
function getFieldsForResource(
  resourceId: string,
  options?: VariableGeneratorOptions
): ResourceField[] | undefined {
  // Try static registry first (system resources)
  const staticFields = RESOURCE_FIELD_REGISTRY[resourceId as TableId]
  if (staticFields) {
    return Object.values(staticFields)
  }

  // Fall back to resourcesMap (custom entities)
  if (options?.resourcesMap) {
    const resource = options.resourcesMap.get(resourceId)
    return resource?.fields
  }

  return undefined
}

/**
 * Get resource metadata for a resource (system or custom)
 */
function getResourceMeta(
  entityDefinitionId: string,
  options?: VariableGeneratorOptions
): ResourceMeta | undefined {
  // Try static registry first (system resources)
  const tableMeta = RESOURCE_TABLE_MAP[entityDefinitionId as TableId]
  if (tableMeta) {
    return { id: entityDefinitionId, label: tableMeta.label, plural: tableMeta.plural }
  }

  // Fall back to resourcesMap (custom entities)
  if (options?.resourcesMap) {
    const resource = options.resourcesMap.get(entityDefinitionId)
    if (resource) {
      return { id: resource.id, label: resource.label, plural: resource.plural }
    }
  }

  return undefined
}

/**
 * Generic function to create resource variables from registry
 * This is the single source of truth for resource variable generation
 */
export function createResourceVariables(resourceType: TableId, nodeId: string): UnifiedVariable {
  const fields = RESOURCE_FIELD_REGISTRY[resourceType]
  const tableMeta = RESOURCE_TABLE_MAP[resourceType]

  if (!fields) {
    throw new Error(`Unknown resource type: ${resourceType}`)
  }

  const properties: Record<string, NestedVariableConfig> = {}

  // Dynamically build properties from registry
  Object.entries(fields).forEach(([key, field]) => {
    properties[key] = convertFieldToVariableProperty(field, resourceType)
  })

  return createNestedVariable({
    deriveLabel: false,
    nodeId,
    basePath: resourceType,
    type: BaseType.OBJECT,
    label: tableMeta.label,
    description: `${tableMeta.label} that triggered this workflow`,
    properties,
    resourceId: resourceType,
  })
}

/**
 * Create thread variables for thread-based triggers
 * Uses registry-based generation for consistency
 */
export function createThreadVariables(nodeId: string): UnifiedVariable {
  return createResourceVariables('thread', nodeId)
}

/**
 * Create message variables for message-based triggers
 * Uses registry-based generation for consistency
 */
export function createMessageVariables(nodeId: string): UnifiedVariable {
  return createResourceVariables('message', nodeId)
}

/**
 * Create dataset variables for dataset-based operations
 * Uses registry-based generation for consistency
 */
export function createDatasetVariables(nodeId: string): UnifiedVariable {
  return createResourceVariables('dataset', nodeId)
}

/**
 * Create trigger metadata variables with operation-specific properties
 */
export function createTriggerMetadata(nodeId: string, operation: string): UnifiedVariable {
  const baseProperties: Record<string, NestedVariableConfig> = {
    timestamp: {
      type: BaseType.DATETIME,
      description: `When the resource was ${operation}`,
    },
  }

  // Add operation-specific properties
  switch (operation) {
    case 'manual':
      baseProperties.source = {
        type: BaseType.STRING,
        label: 'Source',
        description: 'Source of the trigger (manual)',
      }
      baseProperties.resourceType = {
        type: BaseType.STRING,
        label: 'Resource Type',
        description: 'Type of resource that was manually triggered',
      }
      baseProperties.createdBy = {
        type: BaseType.STRING,
        label: 'Created By',
        description: 'User ID who manually triggered the workflow',
      }
      baseProperties.resourceId = {
        type: BaseType.STRING,
        label: 'Resource ID',
        description: 'ID of the resource that was manually triggered',
      }
      break

    case 'updated':
      baseProperties.changedFields = {
        type: BaseType.ARRAY,
        label: 'Changed Fields',
        description: 'List of fields that were modified',
        items: {
          type: BaseType.STRING,
          description: 'Field name',
        },
      }
      baseProperties.previousValues = {
        type: BaseType.JSON,
        description: 'Previous values of changed fields',
      }
      break

    case 'deleted':
      baseProperties.deletedBy = {
        type: BaseType.OBJECT,
        label: 'Deleted By',
        description: 'User who deleted the resource',
        properties: {
          id: {
            type: BaseType.STRING,
            description: 'User ID',
          },
          name: {
            type: BaseType.STRING,
            description: 'User full name',
          },
          email: {
            type: BaseType.EMAIL,
            description: 'User email address',
          },
        },
      }
      break
  }

  return createNestedVariable({
    deriveLabel: false,
    nodeId,
    basePath: 'trigger',
    type: BaseType.OBJECT,
    label: 'Trigger Info',
    description: 'Information about the trigger event',
    properties: baseProperties,
  })
}

/**
 * Convert a ResourceField to a UnifiedVariable property
 * Used internally by resource output variable generators
 *
 * @param field - The field to convert
 * @param tableId - Current table/resource ID
 * @param visitedTables - Set of already visited tables (circular reference protection)
 * @param currentDepth - Current nesting depth
 * @param options - Options including resourcesMap for custom entity lookup
 */
function convertFieldToVariableProperty(
  field: ResourceField,
  tableId: string,
  visitedTables: Set<string> = new Set(),
  currentDepth: number = 0,
  options?: VariableGeneratorOptions
): NestedVariableConfig {
  const maxDepth = options?.maxDepth ?? 2

  // Handle RELATION type
  if (field.type === BaseType.RELATION && field.relationship) {
    const relationship = field.relationship as RelationshipConfig
    const relationshipType = relationship.relationshipType
    // Derive relatedEntityDefinitionId from inverseResourceFieldId using helper
    const relatedEntityDefinitionId = getRelatedEntityDefinitionId(relationship)

    // Check for circular references
    if (relatedEntityDefinitionId && visitedTables.has(relatedEntityDefinitionId)) {
      return {
        type: BaseType.STRING,
        label: field.label,
        description: `${field.description || field.label} (circular reference - not expanded)`,
      }
    }

    // Check depth limit
    if (currentDepth >= maxDepth) {
      return {
        type: BaseType.STRING,
        label: field.label,
        description: `${field.description || field.label} (depth limit reached)`,
      }
    }

    // Get target fields using helper (works for both system and custom resources)
    const targetFields = relatedEntityDefinitionId
      ? getFieldsForResource(relatedEntityDefinitionId, options)
      : undefined
    const targetMeta = relatedEntityDefinitionId
      ? getResourceMeta(relatedEntityDefinitionId, options)
      : undefined

    // For belongs_to or has_one: Generate object with .referenceId
    if (relationshipType === 'belongs_to' || relationshipType === 'has_one') {
      const properties: Record<string, NestedVariableConfig> = {}

      // Add .referenceId property
      properties.referenceId = {
        type: BaseType.STRING,
        label: 'Reference ID',
        description: `ID of the related ${targetMeta?.label || relatedEntityDefinitionId || 'entity'}`,
      }

      // Add target table fields
      if (targetFields && relatedEntityDefinitionId) {
        const newVisited = new Set(visitedTables)
        newVisited.add(tableId)

        targetFields.forEach((targetField) => {
          // Include relationship fields if within depth limit (for drilling down)
          if (targetField.type === BaseType.RELATION) {
            if (currentDepth + 1 < maxDepth) {
              properties[getFieldOutputKey(targetField)] = convertFieldToVariableProperty(
                targetField,
                relatedEntityDefinitionId,
                newVisited,
                currentDepth + 1,
                options
              )
            }
          } else {
            properties[getFieldOutputKey(targetField)] = convertFieldToVariableProperty(
              targetField,
              relatedEntityDefinitionId,
              newVisited,
              currentDepth + 1,
              options
            )
          }
        })
      }

      return {
        type: BaseType.OBJECT,
        label: field.label,
        description: field.description,
        properties,
        fieldReference: toResourceFieldId(tableId, getFieldOutputKey(field)),
        resourceId: relatedEntityDefinitionId,
      }
    }

    // For has_many: Generate collection structure with drilling support
    if (relationshipType === 'has_many') {
      const itemProperties: Record<string, NestedVariableConfig> = {}

      if (targetFields && relatedEntityDefinitionId) {
        const newVisited = new Set(visitedTables)
        newVisited.add(tableId)

        targetFields.forEach((targetField) => {
          // Include has_many relationships for drilling (e.g., Products -> Variants)
          if (targetField.type === BaseType.RELATION) {
            const nestedRelType = targetField.relationship?.relationshipType
            // Only drill into has_many, skip many_to_many in nested context
            if (nestedRelType === 'has_many' && currentDepth + 1 < maxDepth) {
              itemProperties[getFieldOutputKey(targetField)] = convertFieldToVariableProperty(
                targetField,
                relatedEntityDefinitionId,
                newVisited,
                currentDepth + 1,
                options
              )
            } else if (nestedRelType === 'belongs_to' || nestedRelType === 'has_one') {
              // Include belongs_to references within depth limit
              if (currentDepth + 1 < maxDepth) {
                itemProperties[getFieldOutputKey(targetField)] = convertFieldToVariableProperty(
                  targetField,
                  relatedEntityDefinitionId,
                  newVisited,
                  currentDepth + 1,
                  options
                )
              }
            }
          } else {
            // Include non-relationship fields
            itemProperties[getFieldOutputKey(targetField)] = convertFieldToVariableProperty(
              targetField,
              relatedEntityDefinitionId,
              newVisited,
              currentDepth + 1,
              options
            )
          }
        })
      }

      // Use helper function to create collection structure
      const collectionProperties = createRelationshipCollection(
        targetMeta?.label || relatedEntityDefinitionId || 'entity'
      )

      // Set the values property with proper item structure for UI rendering
      collectionProperties.values.items = {
        type: BaseType.OBJECT,
        label: targetMeta?.label || relatedEntityDefinitionId || 'entity',
        properties: itemProperties,
        resourceId: relatedEntityDefinitionId,
      }

      return {
        type: BaseType.OBJECT,
        label: field.label,
        description: field.description,
        properties: collectionProperties,
        resourceId: relatedEntityDefinitionId,
      }
    }

    // For many_to_many: Limited support (no nested drilling)
    if (relationshipType === 'many_to_many') {
      const itemProperties: Record<string, NestedVariableConfig> = {}

      if (targetFields && relatedEntityDefinitionId) {
        const newVisited = new Set(visitedTables)
        newVisited.add(tableId)

        // Only include non-relationship fields for many-to-many
        targetFields.forEach((targetField) => {
          if (targetField.type !== BaseType.RELATION) {
            itemProperties[getFieldOutputKey(targetField)] = convertFieldToVariableProperty(
              targetField,
              relatedEntityDefinitionId,
              newVisited,
              currentDepth + 1,
              options
            )
          }
        })
      }

      const collectionProperties = createRelationshipCollection(
        targetMeta?.label || relatedEntityDefinitionId || 'entity'
      )

      // Set the values property with proper item structure for UI rendering
      collectionProperties.values.items = {
        type: BaseType.OBJECT,
        label: targetMeta?.label || relatedEntityDefinitionId || 'entity',
        properties: itemProperties,
        resourceId: relatedEntityDefinitionId,
      }

      return {
        type: BaseType.OBJECT,
        label: field.label,
        description: field.description,
        properties: collectionProperties,
        resourceId: relatedEntityDefinitionId,
      }
    }
  }

  // Handle other types (STRING, EMAIL, ENUM, ACTOR, etc.)
  const fieldOptions = field.options?.options
  const actorOptions = field.options?.actor
  return {
    type: field.type,
    label: field.label,
    description: field.description || `${field.label} of the resource`,
    ...(fieldOptions &&
      fieldOptions.length > 0 && {
        options: { options: fieldOptions },
      }),
    ...(actorOptions && {
      options: { ...field.options, actor: actorOptions },
    }),
    // Include fieldReference for ACTOR fields so condition system can resolve metadata
    ...(field.type === BaseType.ACTOR && {
      fieldReference: toResourceFieldId(tableId, getFieldOutputKey(field)),
    }),
  }
}

/**
 * Helper to create query_info variable
 */
function createQueryInfoVariable(nodeId: string): UnifiedVariable {
  return createNestedVariable({
    deriveLabel: false,
    nodeId,
    basePath: 'query_info',
    type: BaseType.OBJECT,
    label: 'Query Info',
    description: 'Information about the executed query',
    properties: {
      resource_type: {
        type: BaseType.STRING,
        label: 'Resource Type',
        description: 'The type of resource that was searched',
      },
      find_mode: {
        type: BaseType.STRING,
        label: 'Find Mode',
        description: 'Whether findOne or findMany was used',
      },
      order_by: {
        type: BaseType.STRING,
        label: 'Order By',
        description: 'Field used for sorting (if any)',
      },
      limit_applied: {
        type: BaseType.NUMBER,
        label: 'Limit Applied',
        description: 'Maximum number of results returned',
      },
    },
  })
}

/**
 * Generate Find node variables from fields
 * Unified function for both system resources and custom entities
 *
 * @param fields - ResourceField[] from resource.fields
 * @param resourceMeta - Resource metadata { id, label, plural }
 * @param nodeId - Node ID for variable scoping
 * @param findMode - Whether to find one or many
 * @param options - Options for relationship expansion (resourcesMap, maxDepth)
 */
export function generateFindNodeVariablesFromFields(
  fields: ResourceField[],
  resourceMeta: ResourceMeta,
  nodeId: string,
  findMode: 'findOne' | 'findMany',
  options?: VariableGeneratorOptions
): UnifiedVariable[] {
  // Hidden fields are system-internal — never surface as workflow variables.
  fields = fields.filter((f) => !f.capabilities.hidden)

  const variables: UnifiedVariable[] = []

  if (fields.length === 0) {
    // No visible fields to shape a record with, but `count` is still written
    // unconditionally by the engine (`contextManager.setNodeVariable(nodeId,
    // 'count', resultCount)`, find.ts) regardless of field count — declare it
    // here too, matching the non-empty path below.
    variables.push({
      id: `${nodeId}.count`,
      label: 'Count',
      type: BaseType.NUMBER,
      category: 'node',
      description: `Number of ${resourceMeta.label.toLowerCase()} records found`,
    })
    variables.push(createQueryInfoVariable(nodeId))
    return variables
  }

  // Build properties from fields - use key for consistent variable paths
  const properties: Record<string, NestedVariableConfig> = {}
  fields.forEach((field) => {
    properties[getFieldOutputKey(field)] = convertFieldToVariableProperty(
      field,
      resourceMeta.id,
      new Set(),
      0,
      options
    )
  })

  if (findMode === 'findOne') {
    variables.push(
      createNestedVariable({
        deriveLabel: false,
        nodeId,
        basePath: resourceMeta.id,
        type: BaseType.OBJECT,
        label: resourceMeta.label,
        description: `Found ${resourceMeta.label.toLowerCase()} (null if not found)`,
        properties,
        resourceId: resourceMeta.id,
      })
    )
  } else {
    // For findMany, create array variable with items
    const pluralPath = resourceMeta.plural.toLowerCase()
    const itemVar = createNestedVariable({
      deriveLabel: false,
      nodeId,
      basePath: `${pluralPath}[*]`,
      type: BaseType.OBJECT,
      label: resourceMeta.label,
      description: `${resourceMeta.label} record`,
      properties,
      resourceId: resourceMeta.id,
    })

    variables.push({
      id: `${nodeId}.${pluralPath}`,
      label: resourceMeta.plural,
      type: BaseType.ARRAY,
      category: 'node',
      description: `Array of ${resourceMeta.label.toLowerCase()} records`,
      items: itemVar,
    })
  }

  // Count variable — matches backend contextManager.setNodeVariable(nodeId, 'count', resultCount)
  variables.push({
    id: `${nodeId}.count`,
    label: 'Count',
    type: BaseType.NUMBER,
    category: 'node',
    description: `Number of ${resourceMeta.label.toLowerCase()} records found`,
  })

  // Query info variable
  variables.push(createQueryInfoVariable(nodeId))

  return variables
}

/**
 * Generate CRUD node variables from fields
 * Unified function for both system resources and custom entities
 *
 * @param fields - ResourceField[] from resource.fields
 * @param resourceMeta - Resource metadata { id, label, plural }
 * @param nodeId - Node ID for variable scoping
 * @param crudMode - CRUD operation mode
 * @param options - Options for relationship expansion
 */
export function generateCrudNodeVariablesFromFields(
  fields: ResourceField[],
  resourceMeta: ResourceMeta,
  nodeId: string,
  crudMode: 'create' | 'update' | 'delete',
  options?: VariableGeneratorOptions
): UnifiedVariable[] {
  // Hidden fields are system-internal — never surface as workflow variables.
  fields = fields.filter((f) => !f.capabilities.hidden)

  const variables: UnifiedVariable[] = []

  // Main resource variable (for create/update). Skipped when there are no
  // visible fields to shape it from — but that must only skip THIS variable,
  // not the status block below (success/operation/resourceType/error/…),
  // which the engine writes unconditionally regardless of field count.
  if (crudMode !== 'delete' && fields.length > 0) {
    // Build properties from fields
    const properties: Record<string, NestedVariableConfig> = {}
    fields.forEach((field) => {
      properties[getFieldOutputKey(field)] = convertFieldToVariableProperty(
        field,
        resourceMeta.id,
        new Set(),
        0,
        options
      )
    })

    const modeLabel = crudMode === 'create' ? 'created' : 'updated'
    variables.push(
      createNestedVariable({
        deriveLabel: false,
        nodeId,
        basePath: resourceMeta.id,
        type: BaseType.OBJECT,
        label: resourceMeta.label,
        description: `The ${modeLabel} ${resourceMeta.label.toLowerCase()}`,
        properties,
        resourceId: resourceMeta.id,
      })
    )
  }

  // Delete-specific variables
  if (crudMode === 'delete') {
    variables.push(
      createNestedVariable({
        deriveLabel: false,
        nodeId,
        basePath: 'deleted',
        type: BaseType.BOOLEAN,
        label: 'Deleted',
        description: 'Whether the resource was successfully deleted',
      })
    )

    variables.push(
      createNestedVariable({
        deriveLabel: false,
        nodeId,
        basePath: 'id',
        type: BaseType.STRING,
        label: 'Deleted Resource ID',
        description: 'ID of the deleted resource',
      })
    )
  }

  // Common operation variables
  variables.push(
    createNestedVariable({
      deriveLabel: false,
      nodeId,
      basePath: 'success',
      type: BaseType.BOOLEAN,
      label: 'Success',
      description: 'Whether the operation was successful',
    })
  )

  variables.push(
    createNestedVariable({
      deriveLabel: false,
      nodeId,
      basePath: 'operation',
      type: BaseType.STRING,
      label: 'Operation',
      description: 'The CRUD operation that was performed (create/update/delete)',
    })
  )

  variables.push(
    createNestedVariable({
      deriveLabel: false,
      nodeId,
      basePath: 'resourceType',
      type: BaseType.STRING,
      label: 'Resource Type',
      description: 'The type of resource that was operated on',
    })
  )

  // Error variables
  variables.push(
    createNestedVariable({
      deriveLabel: false,
      nodeId,
      basePath: 'error',
      type: BaseType.STRING,
      label: 'Error Message',
      description: 'Error message if the operation failed (null if successful)',
    })
  )

  variables.push(
    createNestedVariable({
      deriveLabel: false,
      nodeId,
      basePath: 'errorDetails',
      type: BaseType.OBJECT,
      label: 'Error Details',
      description: 'Detailed error information for debugging (null if successful)',
    })
  )

  return variables
}

/**
 * Generate Resource Trigger node variables from fields
 * Unified function for both system resources and custom entities
 *
 * @param fields - ResourceField[] from resource.fields
 * @param resourceMeta - Resource metadata { id, label, plural }
 * @param nodeId - Node ID for variable scoping
 * @param operation - Trigger operation ('created', 'updated', 'deleted', 'manual')
 * @param options - Options for relationship expansion (resourcesMap, maxDepth)
 */
export function generateResourceTriggerVariablesFromFields(
  fields: ResourceField[],
  resourceMeta: ResourceMeta,
  nodeId: string,
  operation: 'created' | 'updated' | 'deleted' | 'manual',
  options?: VariableGeneratorOptions
): UnifiedVariable[] {
  // Hidden fields are system-internal — never surface as workflow variables.
  fields = fields.filter((f) => !f.capabilities.hidden)

  const variables: UnifiedVariable[] = []

  if (fields.length === 0) {
    // Return just trigger metadata if no fields
    variables.push(createTriggerMetadata(nodeId, operation))
    return variables
  }

  // Build properties from fields - use key for consistent variable paths
  const properties: Record<string, NestedVariableConfig> = {}
  fields.forEach((field) => {
    properties[getFieldOutputKey(field)] = convertFieldToVariableProperty(
      field,
      resourceMeta.id,
      new Set(),
      0,
      options
    )
  })

  // Main resource variable
  variables.push(
    createNestedVariable({
      deriveLabel: false,
      nodeId,
      basePath: resourceMeta.id,
      type: BaseType.OBJECT,
      label: resourceMeta.label,
      description: `The ${resourceMeta.label.toLowerCase()} that was ${operation}`,
      properties,
      resourceId: resourceMeta.id,
    })
  )

  // Trigger metadata (operation-specific)
  variables.push(createTriggerMetadata(nodeId, operation))

  return variables
}
