// packages/lib/src/workflow-engine/resources/registry/field-utils.ts

import { getOperatorsForType } from '../../workflow-engine/operators/type-operator-map'
import type { ResourceField } from './field-types'
import { RESOURCE_FIELD_REGISTRY, type TableId } from './field-registry'
import type { ExecutionContextManager } from '../../workflow-engine/core/execution-context'
import { createResourceReference } from '../../workflow-engine/types/resource-reference'
import { BaseType } from '../types'
import { isCustomResourceId } from './types'

/**
 * Get valid operators for a resource field.
 * Uses TYPE_OPERATOR_MAP by default, or field.operatorOverrides if specified.
 */
export function getFieldOperators(field: ResourceField): string[] {
  return getOperatorsForType(field.type, field.operatorOverrides)
}

/**
 * Check if an operator is valid for a field.
 */
export function isValidOperatorForField(field: ResourceField, operator: string): boolean {
  const validOperators = getFieldOperators(field)
  return validOperators.includes(operator)
}

/**
 * Set resource variables in execution context using field registry
 * Creates node-scoped variables: nodeId.resourceType.field
 *
 * This function uses lazy loading - stores a resource reference instead of the full object,
 * and only loads relationships when accessed.
 *
 * @param resourceType - The type of resource (e.g., 'ticket', 'contact')
 * @param resourceData - The actual resource data object
 * @param contextManager - The execution context manager to set variables in
 * @param nodeId - The node ID to scope variables to
 *
 * @example
 * ```typescript
 * setResourceVariables('ticket', ticketData, contextManager, 'trigger-1')
 * // Creates variables:
 * // - trigger-1.ticket (ResourceReference - lightweight)
 * // - trigger-1.id (scalar field - direct access)
 * // - trigger-1.title (scalar field - direct access)
 * // ... etc for scalar fields
 * // Relationships loaded on-demand via lazy loading
 * ```
 */
export function setResourceVariables(
  resourceType: TableId,
  resourceData: any,
  contextManager: ExecutionContextManager,
  nodeId: string
): void {
  const fields = RESOURCE_FIELD_REGISTRY[resourceType]

  if (!fields) {
    throw new Error(`Unknown resource type: ${resourceType}`)
  }

  // Get organization ID from context for resource reference
  const organizationId = contextManager.getContext().organizationId

  if (!resourceData?.id) {
    throw new Error(`Resource data must have an 'id' field for lazy loading`)
  }

  // Create and store resource reference (lightweight)
  const resourceRef = createResourceReference(resourceType, resourceData.id, organizationId)
  contextManager.setVariable(`${nodeId}.${resourceType}`, resourceRef)

  // Store commonly accessed scalar fields directly to avoid lazy loading overhead
  // This includes all non-RELATION fields from the registry
  // IMPORTANT: Store at nodeId.resourceType.fieldKey to match UI variable paths
  Object.entries(fields).forEach(([fieldKey, fieldDef]) => {
    const fieldValue = resourceData[fieldKey]

    // Skip undefined values
    if (fieldValue === undefined) {
      return
    }

    // Only store scalar fields directly (not relationships)
    // Relationships will be lazy-loaded when accessed
    if (fieldDef.type !== BaseType.RELATION) {
      contextManager.setVariable(`${nodeId}.${resourceType}.${fieldKey}`, fieldValue)
    }
  })
}

/**
 * Set resource variables for custom entity resources (entity_xxx)
 * Unlike setResourceVariables, this doesn't use static field registry.
 * Instead, it stores all fields from resourceData dynamically.
 *
 * @param resourceType - The custom entity type (e.g., 'entity_vendors')
 * @param resourceData - The actual resource data object (EntityInstance with fieldValues)
 * @param contextManager - The execution context manager to set variables in
 * @param nodeId - The node ID to scope variables to
 *
 * @example
 * ```typescript
 * setEntityVariables('entity_vendors', vendorData, contextManager, 'trigger-1')
 * // Creates variables:
 * // - trigger-1.entity_vendors (ResourceReference)
 * // - trigger-1.entity_vendors.id
 * // - trigger-1.entity_vendors.fieldName (for each field in fieldValues)
 * ```
 */
export function setEntityVariables(
  resourceType: string,
  resourceData: any,
  contextManager: ExecutionContextManager,
  nodeId: string
): void {
  if (!isCustomResourceId(resourceType)) {
    throw new Error(`setEntityVariables only handles custom entities. Got: ${resourceType}`)
  }

  const organizationId = contextManager.getContext().organizationId

  if (!resourceData?.id) {
    throw new Error(`Resource data must have an 'id' field`)
  }

  // Create and store resource reference (lightweight)
  // Note: createResourceReference accepts TableId but we're using a custom entity ID
  // The function handles string types at runtime
  const resourceRef = createResourceReference(resourceType as any, resourceData.id, organizationId)
  contextManager.setVariable(`${nodeId}.${resourceType}`, resourceRef)

  // Store the id field
  contextManager.setVariable(`${nodeId}.${resourceType}.id`, resourceData.id)

  // Store standard EntityInstance fields
  const standardFields = ['createdAt', 'updatedAt', 'entityDefinitionId']
  for (const field of standardFields) {
    if (resourceData[field] !== undefined) {
      contextManager.setVariable(`${nodeId}.${resourceType}.${field}`, resourceData[field])
    }
  }

  // Store custom field values from fieldValues object
  // EntityInstance stores custom fields in a JSONB `fieldValues` column
  if (resourceData.fieldValues && typeof resourceData.fieldValues === 'object') {
    Object.entries(resourceData.fieldValues).forEach(([fieldKey, fieldValue]) => {
      if (fieldValue !== undefined) {
        // Skip complex objects (relationships) - store only scalar values
        if (typeof fieldValue !== 'object' || fieldValue === null) {
          contextManager.setVariable(`${nodeId}.${resourceType}.${fieldKey}`, fieldValue)
        }
      }
    })
  }
}
