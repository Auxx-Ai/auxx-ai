// packages/lib/src/workflow-engine/resources/variable-generators.ts

/**
 * Variable generator functions for resource triggers and nodes
 * Uses createUnifiedOutputVariable pattern for consistency with other nodes
 */

import { getRelatedEntityDefinitionId, type RelationshipConfig } from '@auxx/types/custom-field'
import { type ResourceFieldId, toResourceFieldId } from '@auxx/types/field'
import {
  RESOURCE_FIELD_REGISTRY,
  RESOURCE_TABLE_MAP,
  type TableId,
} from './registry/field-registry'
import { getFieldOutputKey, type ResourceField } from './registry/field-types'
import { createRelationshipCollection } from './registry/relationship-utils'
import { BaseType } from './types'

// Import types - these will resolve at runtime in the frontend
type UnifiedVariable = any

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
 * Create a nested variable structure (backend version)
 * Automatically generates all intermediate variables with correct full paths
 */
function createNestedVariable(config: {
  nodeId: string
  basePath: string
  type: BaseType
  label?: string
  description?: string
  /**
   * Typed field reference.
   * Format: `${entityDefinitionId}:${fieldId}`
   */
  fieldReference?: ResourceFieldId
  /**
   * Direct resource ID.
   * For when the variable IS a resource, not a field ON a resource.
   */
  resourceId?: string
  properties?: Record<
    string,
    {
      type: BaseType
      description?: string
      label?: string
      properties?: any
      items?: any
      fieldReference?: ResourceFieldId
      resourceId?: string
    }
  >
  items?: {
    type: BaseType
    description?: string
    label?: string
    properties?: any
    fieldReference?: ResourceFieldId
    resourceId?: string
  }
}): UnifiedVariable {
  const fullPath = `${config.nodeId}.${config.basePath}`
  const label = config.label

  // Only include specific props from config if they exist
  const variable: UnifiedVariable = {
    id: fullPath,
    type: config.type,
    label: label,
    category: 'node',
    ...(config.description && { description: config.description }),
    // Typed field references
    ...(config.fieldReference && { fieldReference: config.fieldReference }),
    ...(config.resourceId && { resourceId: config.resourceId }),
  }

  // Recursively create property variables with full paths
  if (config.properties) {
    variable.properties = {}
    Object.entries(config.properties).forEach(([key, propConfig]) => {
      const propPath = `${config.basePath}.${key}`
      variable.properties![key] = createNestedVariable({
        nodeId: config.nodeId,
        basePath: propPath,
        ...propConfig,
      })
    })
  }

  // Create array item variable
  if (config.items) {
    const itemPath = `${config.basePath}[*]`
    variable.items = createNestedVariable({
      nodeId: config.nodeId,
      basePath: itemPath,
      ...config.items,
    })
  }

  return variable
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

  const properties: Record<string, any> = {}

  // Dynamically build properties from registry
  Object.entries(fields).forEach(([key, field]) => {
    properties[key] = convertFieldToVariableProperty(field, resourceType)
  })

  return createNestedVariable({
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
 * Create contact variables for contact-based triggers
 * Uses registry-based generation for consistency
 */
export function createContactVariables(nodeId: string): UnifiedVariable {
  return createResourceVariables('contact', nodeId)
}

/**
 * Create ticket variables for ticket-based triggers
 * Uses registry-based generation for consistency
 */
export function createTicketVariables(nodeId: string): UnifiedVariable {
  return createResourceVariables('ticket', nodeId)
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
  const baseProperties: Record<string, any> = {
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
): any {
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
        type: 'string',
        label: field.label,
        description: `${field.description || field.label} (circular reference - not expanded)`,
      }
    }

    // Check depth limit
    if (currentDepth >= maxDepth) {
      return {
        type: 'string',
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
      const properties: Record<string, any> = {}

      // Add .referenceId property
      properties.referenceId = {
        type: 'string',
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
        type: 'object',
        label: field.label,
        description: field.description,
        properties,
        fieldReference: toResourceFieldId(tableId, getFieldOutputKey(field)),
      }
    }

    // For has_many: Generate collection structure with drilling support
    if (relationshipType === 'has_many') {
      const itemProperties: Record<string, any> = {}

      if (targetFields && relatedEntityDefinitionId) {
        const newVisited = new Set(visitedTables)
        newVisited.add(tableId)

        targetFields.forEach((targetField) => {
          // Include has_many relationships for drilling (e.g., Products -> Variants)
          if (targetField.type === BaseType.RELATION) {
            const nestedRelType = targetField.relationship?.relationshipType
            // Only drill into has_many, skip many_to_many in nested context
            if (nestedRelType === 'has_many' && currentDepth + 1 < maxDepth) {
              itemProperties[targetField.key] = convertFieldToVariableProperty(
                targetField,
                relatedEntityDefinitionId,
                newVisited,
                currentDepth + 1,
                options
              )
            } else if (nestedRelType === 'belongs_to' || nestedRelType === 'has_one') {
              // Include belongs_to references within depth limit
              if (currentDepth + 1 < maxDepth) {
                itemProperties[targetField.key] = convertFieldToVariableProperty(
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
            itemProperties[targetField.key] = convertFieldToVariableProperty(
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
        type: 'object',
        label: field.label,
        description: field.description,
        properties: collectionProperties,
        resourceId: relatedEntityDefinitionId,
      }
    }

    // For many_to_many: Limited support (no nested drilling)
    if (relationshipType === 'many_to_many') {
      const itemProperties: Record<string, any> = {}

      if (targetFields && relatedEntityDefinitionId) {
        const newVisited = new Set(visitedTables)
        newVisited.add(tableId)

        // Only include non-relationship fields for many-to-many
        targetFields.forEach((targetField) => {
          if (targetField.type !== BaseType.RELATION) {
            itemProperties[targetField.key] = convertFieldToVariableProperty(
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
        type: 'object',
        label: field.label,
        description: field.description,
        properties: collectionProperties,
        resourceId: relatedEntityDefinitionId,
      }
    }
  }

  // Handle other types (STRING, EMAIL, ENUM, etc.)
  const fieldOptions = field.options?.options
  return {
    type: field.type,
    label: field.label,
    description: field.description || `${field.label} of the resource`,
    // Include enum values if this is an enum field with options
    ...(fieldOptions &&
      fieldOptions.length > 0 && {
        enum: fieldOptions.map((opt) => opt.value),
        // Optional: Add enum labels for UI
        enumLabels: fieldOptions.reduce(
          (acc, opt) => {
            acc[opt.value] = opt.label
            return acc
          },
          {} as Record<string, string>
        ),
      }),
  }
}

/**
 * Generate output variables for a resource
 * Works for Find, CRUD, and Trigger nodes
 * Supports both system resources and custom entities
 *
 * @param resourceType - Resource type (e.g., 'ticket', 'contact', 'entity_products')
 * @param nodeId - Node ID for variable scoping
 * @param mode - Output mode: 'single', 'array', 'crud-create', 'crud-update', 'crud-delete'
 * @param options - Additional options for variable generation (includes resourcesMap for custom entities)
 */
export function generateResourceOutputVariables(
  resourceType: string,
  nodeId: string,
  mode: 'single' | 'array' | 'crud-create' | 'crud-update' | 'crud-delete',
  options?: VariableGeneratorOptions & {
    basePath?: string // Custom base path (default: resourceType)
    includeMetadata?: boolean // Include operation metadata
    additionalFields?: string[] // Additional fields to include
  }
): UnifiedVariable | null {
  // Use helper that supports both system resources and custom entities
  const fieldsArray = getFieldsForResource(resourceType, options)

  if (!fieldsArray) {
    console.warn(`No field registry found for resource: ${resourceType}`)
    return null
  }

  // Convert array to object format for existing code
  const fields: Record<string, ResourceField> = {}
  for (const field of fieldsArray) {
    fields[getFieldOutputKey(field)] = field
  }

  const basePath = options?.basePath || resourceType

  // Build properties from registry (includes relationships)
  const properties: Record<string, any> = {}

  Object.entries(fields).forEach(([key, field]) => {
    // Include all fields (basic + relationships)
    properties[key] = convertFieldToVariableProperty(field, resourceType)
  })

  // Handle different modes
  switch (mode) {
    case 'single':
      // Single resource object (Find.findOne, CRUD create/update)
      return createNestedVariable({
        nodeId,
        basePath,
        type: BaseType.OBJECT,
        label: resourceType.charAt(0).toUpperCase() + resourceType.slice(1),
        description: `${resourceType} record from the database`,
        properties,
        resourceId: resourceType,
      })

    case 'array':
      // Array of resources (Find.findMany) - returns the item structure
      return createNestedVariable({
        nodeId,
        basePath: `${basePath}[*]`,
        type: BaseType.OBJECT,
        label: resourceType.charAt(0).toUpperCase() + resourceType.slice(1),
        description: `${resourceType} record`,
        properties,
        resourceId: resourceType,
      })

    case 'crud-create':
    case 'crud-update':
      // CRUD operations return the resource + metadata
      return createNestedVariable({
        nodeId,
        basePath,
        type: BaseType.OBJECT,
        label: resourceType.charAt(0).toUpperCase() + resourceType.slice(1),
        description: `The ${mode === 'crud-create' ? 'created' : 'updated'} ${resourceType}`,
        properties,
        resourceId: resourceType,
      })

    case 'crud-delete':
      // Delete only returns ID and success flag (handled separately)
      return null

    default:
      return null
  }
}

/**
 * Generate variables for Find node
 * Supports both system resources and custom entities
 */
export function generateFindNodeVariables(
  resourceType: string,
  nodeId: string,
  findMode: 'findOne' | 'findMany',
  options?: VariableGeneratorOptions
): UnifiedVariable[] {
  const variables: UnifiedVariable[] = []

  // Main resource variable(s)
  if (findMode === 'findOne') {
    const resourceVar = generateResourceOutputVariables(resourceType, nodeId, 'single', options)
    if (resourceVar) {
      resourceVar.description = `Found ${resourceType} (null if not found)`
      variables.push(resourceVar)
    }
  } else {
    // For findMany, create array variable with items
    // Use plural path for consistency: contacts[*] instead of contact[*]
    const pluralPath = `${resourceType}s`
    const itemVar = generateResourceOutputVariables(resourceType, nodeId, 'array', {
      ...options,
      basePath: pluralPath, // ✅ Pass plural base so items use "contacts[*]" not "contact[*]"
    })
    if (itemVar) {
      const arrayVar: UnifiedVariable = {
        id: `${nodeId}.${pluralPath}`,
        label: `${resourceType.charAt(0).toUpperCase() + resourceType.slice(1)}s`,
        type: BaseType.ARRAY,
        // reference: resourceType,
        category: 'node',
        description: `Array of ${resourceType} records`,
        items: itemVar,
      }
      variables.push(arrayVar)
    }
  }

  // Query info variable
  variables.push(
    createNestedVariable({
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
  )

  return variables
}

/**
 * Helper to create query_info variable
 */
function createQueryInfoVariable(nodeId: string): UnifiedVariable {
  return createNestedVariable({
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
  const variables: UnifiedVariable[] = []

  if (fields.length === 0) {
    // Return just query_info if no fields
    variables.push(createQueryInfoVariable(nodeId))
    return variables
  }

  // Build properties from fields - use key for consistent variable paths
  const properties: Record<string, any> = {}
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

  // Query info variable
  variables.push(createQueryInfoVariable(nodeId))

  return variables
}

/**
 * Generate variables for CRUD node
 * Supports both system resources and custom entities
 */
export function generateCrudNodeVariables(
  resourceType: string,
  nodeId: string,
  crudMode: 'create' | 'update' | 'delete',
  options?: VariableGeneratorOptions
): UnifiedVariable[] {
  const variables: UnifiedVariable[] = []

  // Main resource variable (for create/update)
  if (crudMode !== 'delete') {
    const mode = crudMode === 'create' ? 'crud-create' : 'crud-update'
    const resourceVar = generateResourceOutputVariables(resourceType, nodeId, mode, options)
    if (resourceVar) {
      variables.push(resourceVar)
    }
  }

  // Delete-specific variables
  if (crudMode === 'delete') {
    variables.push(
      createNestedVariable({
        nodeId,
        basePath: 'deleted',
        type: BaseType.BOOLEAN,
        label: 'Deleted',
        description: 'Whether the resource was successfully deleted',
      })
    )

    variables.push(
      createNestedVariable({
        nodeId,
        basePath: 'id',
        type: BaseType.STRING,
        label: 'Deleted Resource ID',
        description: 'ID of the deleted resource',
      })
    )
  }

  // Common operation variables (all modes)
  variables.push(
    createNestedVariable({
      nodeId,
      basePath: 'success',
      type: BaseType.BOOLEAN,
      label: 'Success',
      description: 'Whether the CRUD operation completed successfully',
    })
  )

  variables.push(
    createNestedVariable({
      nodeId,
      basePath: 'operation',
      type: BaseType.STRING,
      label: 'Operation',
      description: 'The CRUD operation that was performed (create/update/delete)',
    })
  )

  variables.push(
    createNestedVariable({
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
      nodeId,
      basePath: 'error',
      type: BaseType.STRING,
      label: 'Error Message',
      description: 'Error message if the operation failed (null if successful)',
    })
  )

  variables.push(
    createNestedVariable({
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
  const variables: UnifiedVariable[] = []

  // Main resource variable (for create/update)
  if (crudMode !== 'delete') {
    if (fields.length === 0) {
      return variables
    }

    // Build properties from fields
    const properties: Record<string, any> = {}
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
        nodeId,
        basePath: 'deleted',
        type: BaseType.BOOLEAN,
        label: 'Deleted',
        description: 'Whether the resource was successfully deleted',
      })
    )

    variables.push(
      createNestedVariable({
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
      nodeId,
      basePath: 'success',
      type: BaseType.BOOLEAN,
      label: 'Success',
      description: 'Whether the operation was successful',
    })
  )

  variables.push(
    createNestedVariable({
      nodeId,
      basePath: 'operation',
      type: BaseType.STRING,
      label: 'Operation',
      description: 'The CRUD operation that was performed (create/update/delete)',
    })
  )

  variables.push(
    createNestedVariable({
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
      nodeId,
      basePath: 'error',
      type: BaseType.STRING,
      label: 'Error Message',
      description: 'Error message if the operation failed (null if successful)',
    })
  )

  variables.push(
    createNestedVariable({
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
 * Generate variables for Resource Trigger nodes
 * Uses existing registry-based variable creators for consistency with CRUD/Find nodes
 * Supports both system resources and custom entities
 *
 * @param resourceType - Resource type (e.g., 'ticket', 'contact', 'entity_products')
 * @param nodeId - Node ID for variable scoping
 * @param operation - Trigger operation ('created', 'updated', 'deleted', 'manual')
 * @param options - Options for custom entity lookup (resourcesMap)
 */
export function generateResourceTriggerVariables(
  resourceType: string,
  nodeId: string,
  operation: 'created' | 'updated' | 'deleted' | 'manual',
  options?: VariableGeneratorOptions
): UnifiedVariable[] {
  const variables: UnifiedVariable[] = []

  // 1. Main resource variable (use existing registry-based function)
  if (resourceType === 'ticket') {
    variables.push(createTicketVariables(nodeId))
  } else if (resourceType === 'contact') {
    variables.push(createContactVariables(nodeId))
  } else {
    // Fallback to generic generation for other resource types (including custom entities)
    const resourceVar = generateResourceOutputVariables(resourceType, nodeId, 'single', options)
    if (resourceVar) {
      resourceVar.description = `The ${resourceType} that was ${operation}`
      variables.push(resourceVar)
    }
  }

  // 2. Trigger metadata (using existing function)
  variables.push(createTriggerMetadata(nodeId, operation))

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
  const variables: UnifiedVariable[] = []

  if (fields.length === 0) {
    // Return just trigger metadata if no fields
    variables.push(createTriggerMetadata(nodeId, operation))
    return variables
  }

  // Build properties from fields - use key for consistent variable paths
  const properties: Record<string, any> = {}
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
