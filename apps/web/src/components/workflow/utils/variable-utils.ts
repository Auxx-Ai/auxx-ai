// apps/web/src/components/workflow/utils/variable-utils.ts

import {
  ALL_OPERATOR_KEYS,
  getOperatorsForBaseType,
  type Operator,
} from '@auxx/lib/conditions/client'
import {
  BaseType,
  isTypeCompatible as isBaseTypeCompatible,
  RESOURCE_TABLE_MAP,
  type ResourceField,
  type TableId,
  type UnifiedVariable,
} from '@auxx/lib/workflow-engine/client'
import { getRelatedEntityDefinitionId, type RelationshipConfig } from '@auxx/types/custom-field'
import { isResourceFieldId, parseResourceFieldId, type ResourceFieldId } from '@auxx/types/field'
import type { FieldDefinition } from '~/components/conditions'
import { useResourceStore } from '~/components/resources/store/resource-store'

// The pure inference layer moved to lib (node-catalog Phase 1 —
// `@auxx/lib/workflow-engine/catalog/variable-inference`). Re-exported here so
// this module's many importers keep working; only the store-reading display
// helpers below actually live in this file now.
export {
  type ArraySegmentInfo,
  buildVariableId,
  buildVariableLabelPath,
  containsVariableReference,
  getArrayAccessorCompactLabel,
  getArrayAccessorMenuLabel,
  getArrayItemVariable,
  getLabelFromVariableId,
  getNodeIdFromVariableId,
  getPathFromVariableId,
  inferPluckOutputType,
  isEnvironmentVariable,
  isNodeVariable,
  isSystemVariable,
  isVariableMode,
  parseArraySegmentsFromId,
  parseResourceFieldFromVariableId,
  preserveArrayStructure,
  resolveFieldPath,
  setSegmentAccessor,
  VARIABLE_PATTERN,
} from '@auxx/lib/workflow-engine/client'

/**
 * `OperatorDefinition.key` is declared as a plain `string`, so narrow it back to
 * the `Operator` union before it reaches a `FieldDefinition`.
 */
const isOperatorKey = (key: string): key is Operator =>
  ALL_OPERATOR_KEYS.some((known) => known === key)

/**
 * Get display type for a variable (for UI display only)
 * This is what 90% of consumers actually need
 *
 * @param variable - The variable to get display type for
 * @returns User-friendly display type string (e.g., "Contact", "Contact[]", "string")
 *
 * @example
 * ```typescript
 * // Direct resource reference
 * getVariableDisplayType({ type: BaseType.OBJECT, resourceId: 'contact', label: 'Contact' })
 * // Returns: "Contact"
 *
 * // Relation field
 * getVariableDisplayType({ type: BaseType.RELATION, fieldReference: 'ticket:contact' })
 * // Returns: "Contact"
 *
 * // Array of resources
 * getVariableDisplayType({ type: BaseType.ARRAY, items: { type: BaseType.OBJECT, resourceId: 'contact', label: 'Contact' } })
 * // Returns: "Contact[]"
 * ```
 */
export function getVariableDisplayType(variable: UnifiedVariable): string {
  // Handle ARRAY type - recursively get items type with [] suffix
  if (variable.type === BaseType.ARRAY && variable.items) {
    return `${getVariableDisplayType(variable.items)}[]`
  }

  // Check new typed fieldReference first
  if (variable.fieldReference) {
    const { entityDefinitionId, fieldId } = parseResourceFieldId(variable.fieldReference)
    const resource = useResourceStore.getState().resourceMap.get(entityDefinitionId)
    const field = resource?.fields.find((f) => f.id === fieldId || f.key === fieldId)

    if (field?.relationship) {
      const targetId = getRelatedEntityDefinitionId(field.relationship as RelationshipConfig)
      const targetResource = targetId
        ? useResourceStore.getState().resourceMap.get(targetId)
        : undefined
      return targetResource?.label || variable.label || variable.type
    }
  }

  // Check typed resourceId (direct resource reference)
  if (variable.resourceId) {
    const resource = useResourceStore.getState().resourceMap.get(variable.resourceId)
    return resource?.label || variable.label || variable.type
  }

  return variable.type
}

/**
 * Get options for a variable (for condition builders).
 * Only call this when you actually need options.
 *
 * @param variable - The variable to get options for
 * @returns Array of options with label and value, or undefined if not an enum
 *
 * @example
 * ```typescript
 * getVariableOptions({ type: BaseType.ENUM, fieldReference: 'ticket:status', enum: ['open', 'closed'] })
 * // Returns: [{ label: 'Open', value: 'open' }, { label: 'Closed', value: 'closed' }]
 * ```
 */
export function getVariableOptions(
  variable: UnifiedVariable
): Array<{ label: string; value: string }> | undefined {
  if (variable.type !== BaseType.ENUM) return undefined

  // Check options first (unified format)
  if (variable.options?.options) {
    return variable.options.options.map((opt) => ({
      label: opt.label,
      value: opt.value,
    }))
  }

  // Check typed fieldReference
  if (variable.fieldReference) {
    const { entityDefinitionId, fieldId } = parseResourceFieldId(variable.fieldReference)
    const resource = useResourceStore.getState().resourceMap.get(entityDefinitionId)
    const field = resource?.fields.find((f) => f.id === fieldId || f.key === fieldId)
    if (field?.options?.options) {
      return field.options.options.map((opt) => ({
        label: opt.label,
        value: opt.value,
      }))
    }
  }

  return undefined
}

/**
 * Get relationship metadata for a variable (for relation inputs)
 * Only call this when you need relationship info
 *
 * @param variable - The variable to get relationship metadata for
 * @returns Relationship metadata with relatedEntityDefinitionId, relationshipType, and field
 *
 * @example
 * ```typescript
 * getVariableRelationship({ type: BaseType.RELATION, fieldReference: 'ticket:contact' })
 * // Returns: { relatedEntityDefinitionId: 'contact', relationshipType: 'belongs_to', field: {...} }
 * ```
 */
export function getVariableRelationship(variable: UnifiedVariable):
  | {
      relatedEntityDefinitionId?: string
      relationshipType?: 'belongs_to' | 'has_one' | 'has_many' | 'many_to_many'
      field?: ResourceField
    }
  | undefined {
  // Check options first (new unified format)
  if (variable.options?.relationship) {
    const rel = variable.options.relationship
    return {
      // RelationshipConfig stores only `inverseResourceFieldId`; the related
      // definition id has to be derived from it.
      relatedEntityDefinitionId: getRelatedEntityDefinitionId(rel) ?? undefined,
      relationshipType: rel.relationshipType,
    }
  }

  // Check typed fieldReference - use parseResourceFieldId() instead of manual split
  if (variable.fieldReference) {
    const { entityDefinitionId, fieldId } = parseResourceFieldId(variable.fieldReference)
    const resource = useResourceStore.getState().resourceMap.get(entityDefinitionId)
    const field = resource?.fields.find((f) => f.id === fieldId || f.key === fieldId)

    if (field?.relationship) {
      const rel = field.relationship as RelationshipConfig
      return {
        relatedEntityDefinitionId: getRelatedEntityDefinitionId(rel) ?? undefined,
        relationshipType: rel.relationshipType,
        field,
      }
    }
    return undefined
  }

  // Check typed resourceId (direct resource reference)
  if (variable.resourceId) {
    return { relatedEntityDefinitionId: variable.resourceId }
  }

  return undefined
}

/**
 * Get field definition for condition builders.
 * Replaces parseVariable() with a cleaner implementation using typed ResourceFieldId system.
 *
 * @param variable - The variable to get field definition for
 * @returns FieldDefinition with operators, enum values, and relationship metadata
 *
 * @example
 * ```typescript
 * const fieldDef = getVariableFieldDefinition(contactVariable)
 * // Returns: { actualType: BaseType.RELATION, operators: ['is', 'is not'], relatedEntityDefinitionId: 'contact' }
 * ```
 */
export function getVariableFieldDefinition(variable: UnifiedVariable): FieldDefinition {
  const relationship = getVariableRelationship(variable)
  const options = getVariableOptions(variable)
  const displayType = getVariableDisplayType(variable)

  // Determine actual type for operators
  let actualType = variable.type as BaseType
  if (relationship?.relatedEntityDefinitionId) {
    actualType = BaseType.RELATION
  }

  return {
    ...variable,
    type: actualType,
    displayType,
    operators: getOperatorsForBaseType(actualType)
      .map((op) => op.key)
      .filter(isOperatorKey),
    options: options ? { options } : undefined,
    fieldReference: variable.fieldReference,
    targetEntityDefinitionId: relationship?.relatedEntityDefinitionId,
  }
}

/**
 * Check if a variable is compatible with allowed types
 * Handles relationship type matching via reference field AND
 * falls back to base type compatibility for non-relationship types
 *
 * @param variable - Variable to check
 * @param allowedTypes - Array of allowed types (can include TableId for relationships)
 * @returns True if variable is compatible
 */
export function isVariableTypeCompatible(
  variable: UnifiedVariable,
  allowedTypes: (BaseType | string)[]
): boolean {
  // If no type restrictions, allow all
  if (allowedTypes.length === 0) return true

  // Separate relationship types (TableId strings) from BaseTypes
  const relationshipTypes = allowedTypes.filter(
    (t) => typeof t === 'string' && !Object.values(BaseType).includes(t as BaseType)
  )
  const baseTypes = allowedTypes.filter((t) =>
    Object.values(BaseType).includes(t as BaseType)
  ) as BaseType[]

  // Check if variable IS a resource type (direct match on resourceId)
  // This matches resource object variables like trigger.ticket, findNode.contact, etc.
  if (variable.resourceId && relationshipTypes.length > 0) {
    // Direct match (fast path — works when both sides use the same format)
    if (relationshipTypes.includes(variable.resourceId)) {
      return true
    }

    // Cross-reference: resolve both sides via resource store
    // Handles mixed formats (e.g., variable uses slug, allowedTypes has entityDefinitionId, or vice versa)
    const resourceStore = useResourceStore.getState()
    const varResource = resourceStore.resourceMap.get(variable.resourceId)
    if (varResource) {
      const varEntityId = varResource.entityDefinitionId ?? varResource.id
      for (const relType of relationshipTypes) {
        const relResource = resourceStore.resourceMap.get(relType)
        const relEntityId = relResource
          ? (relResource.entityDefinitionId ?? relResource.id)
          : relType
        if (varEntityId === relEntityId) {
          return true
        }
      }
    }
  }

  // Check relationship type match via fieldReference (for RELATION fields)
  // Use getVariableRelationship() instead of parseVariable()
  if (relationshipTypes.length > 0) {
    const relationship = getVariableRelationship(variable)
    if (
      relationship?.relatedEntityDefinitionId &&
      relationshipTypes.includes(relationship.relatedEntityDefinitionId)
    ) {
      return true
    }
  }

  // Check base type compatibility using library function (for all other types)
  // This handles flexible type compatibility like ENUM→STRING, NUMBER→STRING, etc.
  if (baseTypes.length > 0) {
    if (isBaseTypeCompatible(variable.type as BaseType, baseTypes)) {
      return true
    }
  }

  return false
}

/**
 * Check if a variable or any of its descendants match the allowed types
 * This enables forward-looking type checking for relationship navigation
 *
 * @param variable - Variable to check (will recursively check its properties)
 * @param allowedTypes - Array of allowed types (can include TableId for relationships)
 * @returns True if variable itself or any descendant is compatible
 */
export function hasCompatibleChildPath(
  variable: UnifiedVariable,
  allowedTypes: (BaseType | string)[]
): boolean {
  // If no type restrictions, allow all
  if (allowedTypes.length === 0) return true

  // Check if the variable itself is compatible
  if (isVariableTypeCompatible(variable, allowedTypes)) {
    return true
  }

  // Check if any children match (recursive check)
  if (variable.properties) {
    for (const child of Object.values(variable.properties)) {
      if (hasCompatibleChildPath(child, allowedTypes)) {
        return true
      }
    }
  }

  // Arrays hold their child shape under `items`, not `properties`. Without this
  // branch an array-of-objects is reported as having no compatible descendant,
  // so a typed field renders it non-selectable AND non-navigable — you could
  // never drill into `find_1.<cuid>` to reach `[*].email` on a STRING field.
  // `isNavigableVariable` has always honoured `items`; this keeps the two in step.
  if (variable.items) {
    return hasCompatibleChildPath(variable.items, allowedTypes)
  }

  return false
}

/**
 * Get display-friendly type label for a FieldDefinition
 * Converts raw BaseType values to user-friendly labels (e.g., "RELATION" → "Contact")
 *
 * @param field - The field definition
 * @returns User-friendly type label
 *
 * @example
 * ```typescript
 * // Primitive type
 * getFieldDisplayType({ type: BaseType.STRING, ... }) // Returns: "string"
 *
 * // Relation field
 * getFieldDisplayType({ type: BaseType.RELATION, fieldReference: "ticket:contact", ... })
 * // Returns: "Contact"
 *
 * // Object with reference (direct resource)
 * getFieldDisplayType({ type: BaseType.OBJECT, fieldReference: "contact", ... })
 * // Returns: "Contact"
 * ```
 */
export function getFieldDisplayType(field: FieldDefinition): string {
  // Handle fields with reference metadata (OBJECT, RELATION, or REFERENCE types)
  if (field.fieldReference) {
    // Check if it's a direct resource object (reference is just table name like "contact")
    // vs a relation field (reference in format "resourceType:fieldKey" like "ticket:contact")
    if (!isResourceFieldId(field.fieldReference)) {
      // Direct resource object (reference is just table name like "contact")
      const tableMeta = RESOURCE_TABLE_MAP[field.fieldReference as TableId]
      if (tableMeta) {
        return tableMeta.label // e.g., "Contact", "Ticket", "User"
      }
    } else {
      // Relation field - use parseResourceFieldId() instead of manual split
      const { fieldId: targetTable } = parseResourceFieldId(field.fieldReference as ResourceFieldId)

      // Look up the table label from registry
      const tableMeta = RESOURCE_TABLE_MAP[targetTable as TableId]
      if (tableMeta) {
        return tableMeta.label // e.g., "Contact", "Ticket"
      }
    }
  }

  // For all other types, return the BaseType value as-is
  // (Already user-friendly: "string", "number", "boolean", etc.)
  return field.type
}
