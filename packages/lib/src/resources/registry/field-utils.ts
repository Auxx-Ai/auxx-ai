// packages/lib/src/resources/registry/field-utils.ts

import type { ExecutionContextManager } from '../../workflow-engine/core/execution-context'
import { getOperatorsForType } from '../../workflow-engine/operators/type-operator-map'
import { createResourceReference } from '../../workflow-engine/types/resource-reference'
import { BaseType } from '../types'
import { RESOURCE_FIELD_REGISTRY, type TableId } from './field-registry'
import { getFieldOutputKey, type ResourceField } from './field-types'
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
  // Use getFieldOutputKey (systemAttribute ?? key) to match frontend variable paths
  Object.entries(fields).forEach(([fieldKey, fieldDef]) => {
    // Look up by registry key (camelCase, matches Drizzle query results)
    // Also try outputKey as fallback (for RecordMeta from test/debug path)
    const outputKey = getFieldOutputKey(fieldDef)
    const fieldValue = resourceData[fieldKey] ?? resourceData[outputKey]

    // Skip undefined values
    if (fieldValue === undefined) {
      return
    }

    // Only store scalar fields directly (not relationships)
    // Relationships will be lazy-loaded when accessed
    if (fieldDef.type !== BaseType.RELATION) {
      contextManager.setVariable(`${nodeId}.${resourceType}.${outputKey}`, fieldValue)
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

  // Store standard EntityInstance fields under output keys matching systemAttribute values
  // (mirrors how setResourceVariables uses getFieldOutputKey for system resources)
  const ENTITY_STANDARD_FIELDS: Array<{ prop: string; outputKey: string }> = [
    { prop: 'id', outputKey: 'record_id' },
    { prop: 'createdAt', outputKey: 'created_at' },
    { prop: 'updatedAt', outputKey: 'updated_at' },
    { prop: 'entityDefinitionId', outputKey: 'entityDefinitionId' },
  ]

  for (const { prop, outputKey } of ENTITY_STANDARD_FIELDS) {
    if (resourceData[prop] !== undefined) {
      contextManager.setVariable(`${nodeId}.${resourceType}.${outputKey}`, resourceData[prop])
    }
  }

  // Also store `id` directly — extractIdFromValue, resolveNestedObject, and other paths expect it
  contextManager.setVariable(`${nodeId}.${resourceType}.id`, resourceData.id)

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

// ─────────────────────────────────────────────────────────────
// IDENTIFIER FIELD HELPERS (pure functions on Resource)
// ─────────────────────────────────────────────────────────────

/**
 * Get all fields that can be used to identify/match existing records.
 * Includes system fields with isIdentifier and custom fields with isUnique.
 */
export function getIdentifierFields(resource: { fields: ResourceField[] }): ResourceField[] {
  return resource.fields.filter((f) => f.isIdentifier)
}

/**
 * Get the default identifier field for a resource.
 * Returns the first identifier field, or undefined if none.
 */
export function getDefaultIdentifierField(resource: {
  fields: ResourceField[]
}): ResourceField | undefined {
  return getIdentifierFields(resource)[0]
}

// ─────────────────────────────────────────────────────────────
// SYSTEM FIELD HELPERS
// ─────────────────────────────────────────────────────────────

/**
 * Determines if a field is a system field (built-in to the table)
 */
export function isSystemField(field: ResourceField): boolean {
  return field.isSystem === true
}

/**
 * Determines if a field is computed from other fields
 */
export function isComputedField(field: ResourceField): boolean {
  return Array.isArray(field.sourceFields) && field.sourceFields.length > 0
}

/**
 * Sort fields: system fields first (by systemSortOrder), then custom fields by sortOrder.
 * Excludes 'id' field, inactive custom fields, and fields with `capabilities.hidden`.
 * Deduplicates by key to prevent React key conflicts.
 */
export function sortFieldsForDisplay(fields: ResourceField[]): ResourceField[] {
  // Deduplicate by key - prefer system fields over custom fields with same key
  const seenKeys = new Set<string>()
  const deduped = fields.filter((f) => {
    if (seenKeys.has(f.key)) return false
    seenKeys.add(f.key)
    return true
  })

  const systemFields = deduped
    .filter(
      (f) => f.isSystem && f.key !== 'id' && f.showInPanel !== false && !f.capabilities.hidden
    )
    .sort((a, b) => (a.systemSortOrder ?? '').localeCompare(b.systemSortOrder ?? ''))

  const customFields = deduped
    .filter(
      (f) => !f.isSystem && f.active !== false && f.showInPanel !== false && !f.capabilities.hidden
    )
    .sort((a, b) => (a.sortOrder ?? '').localeCompare(b.sortOrder ?? ''))

  return [...systemFields, ...customFields]
}

/**
 * Get fields that should be displayed in the property panel.
 * Filters out hidden fields and sorts appropriately.
 */
export function getDisplayFields(fields: ResourceField[]): ResourceField[] {
  return sortFieldsForDisplay(
    fields.filter((f) => f.showInPanel !== false && !f.capabilities.hidden)
  )
}
