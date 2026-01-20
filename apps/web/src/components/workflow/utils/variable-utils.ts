// apps/web/src/components/workflow/utils/variable-utils.ts

import type { UnifiedVariable } from '~/components/workflow/types/variable-types'
import type { FieldDefinition } from '~/components/conditions'
import {
  RESOURCE_FIELD_REGISTRY,
  RESOURCE_TABLE_MAP,
  type TableId,
  type ResourceField,
  BaseType,
  isTypeCompatible as isBaseTypeCompatible,
  getOperatorsForFieldType,
} from '@auxx/lib/workflow-engine/client'
import { useResourceStore } from '~/components/resources/store/resource-store'
import { getRelatedEntityDefinitionId, type RelationshipConfig } from '@auxx/types/custom-field'
import { parseResourceFieldId, isResourceFieldId, type ResourceFieldId } from '@auxx/types/field'

/**
 * Regular expression pattern for matching workflow variables in the format {{variable-name}}
 * Note: This has the 'g' flag for global matching (finding all occurrences)
 */
export const VARIABLE_PATTERN = /\{\{([^}]+)\}\}/g

/**
 * Regular expression pattern for testing if text contains a variable reference
 * Note: This does NOT have the 'g' flag, making it suitable for .test()
 */
const VARIABLE_TEST_PATTERN = /\{\{([^}]+)\}\}/

/**
 * Check if a string contains variable references in the format {{variable-name}}
 * @param text - The text to check for variable references
 * @returns true if the text contains at least one variable reference, false otherwise
 */
export function containsVariableReference(text: string | null | undefined): boolean {
  if (!text) return false
  return VARIABLE_TEST_PATTERN.test(text)
}

/**
 * Get the nodeId from a variable ID
 * Examples:
 *   "webhook-123.body.email" → "webhook-123"
 *   "env.API_KEY" → "env"
 *   "sys.userId" → "sys"
 */
export function getNodeIdFromVariableId(variableId: string): string {
  const firstDot = variableId.indexOf('.')
  return firstDot > 0 ? variableId.substring(0, firstDot) : variableId
}

/**
 * Get the path (relative to node) from a variable ID
 * Examples:
 *   "webhook-123.body.email" → "body.email"
 *   "env.API_KEY" → "API_KEY"
 *   "sys.userId" → "userId"
 */
export function getPathFromVariableId(variableId: string): string {
  const firstDot = variableId.indexOf('.')
  return firstDot > 0 ? variableId.substring(firstDot + 1) : ''
}

/**
 * Get the label (last segment) from a variable ID
 * Examples:
 *   "webhook-123.body.contact.email" → "email"
 *   "env.API_KEY" → "API_KEY"
 */
export function getLabelFromVariableId(variableId: string): string {
  const segments = variableId.split('.')
  return segments[segments.length - 1] || variableId
}

/**
 * Build a variable ID from nodeId and path
 * Examples:
 *   ("webhook-123", "body.email") → "webhook-123.body.email"
 *   ("env", "API_KEY") → "env.API_KEY"
 */
export function buildVariableId(nodeId: string, path: string): string {
  return `${nodeId}.${path}`
}

/**
 * Check if a variable ID is a system variable
 */
export function isSystemVariable(variableId: string | undefined): boolean {
  return typeof variableId === 'string' && variableId.startsWith('sys.')
}

/**
 * Check if a variable ID is an environment variable
 */
export function isEnvironmentVariable(variableId: string | undefined): boolean {
  return typeof variableId === 'string' && variableId.startsWith('env.')
}

/**
 * Check if a variable ID is a node variable
 * Node variables must have format "nodeId.path" (contain at least one dot)
 * and not be system or environment variables
 */
export function isNodeVariable(variableId: string | undefined): boolean {
  return (
    typeof variableId === 'string' &&
    !isSystemVariable(variableId) &&
    !isEnvironmentVariable(variableId) &&
    variableId.includes('.')
  )
}

/**
 * Check if a field is in variable mode (not constant mode)
 * fieldModes[field] === true means constant mode
 * fieldModes[field] === false or undefined means variable mode
 */
export function isVariableMode(
  fieldModes: Record<string, boolean> | undefined,
  field: string
): boolean {
  return fieldModes?.[field] !== true
}

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
      const targetResource = useResourceStore.getState().resourceMap.get(targetId)
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

  // Fallback: use enum values as both label and value
  if (variable.enum) {
    return variable.enum.map((v) => ({ label: String(v), value: String(v) }))
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
    return {
      relatedEntityDefinitionId: variable.options.relationship.relatedEntityDefinitionId,
      relationshipType: variable.options.relationship.relationshipType,
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
        relatedEntityDefinitionId: getRelatedEntityDefinitionId(rel),
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
    displayType,
    actualType,
    operators: getOperatorsForFieldType(actualType).map((op) => op.key),
    options,
    fieldReference: variable.fieldReference,
    relatedEntityDefinitionId: relationship?.relatedEntityDefinitionId,
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
  if (variable.resourceId && relationshipTypes.includes(variable.resourceId)) {
    return true
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

  return false
}

/**
 * Parse variable ID to extract resource type and field key
 * Used to look up metadata from RESOURCE_FIELD_REGISTRY
 *
 * @param variableId - Variable ID in format "nodeId.resourceType.fieldKey"
 * @returns Parsed resource type and field key, or null if not a registry-based variable
 *
 * @example
 * ```typescript
 * parseResourceFieldFromVariableId('find-123.ticket.status')
 * // Returns: { resourceType: 'ticket', fieldKey: 'status' }
 *
 * parseResourceFieldFromVariableId('find-123.ticket.contact.name')
 * // Returns: { resourceType: 'ticket', fieldKey: 'contact.name' }
 * ```
 */
export function parseResourceFieldFromVariableId(
  variableId: string
): { resourceType: TableId; fieldKey: string } | null {
  // Pattern: nodeId.resourceType.fieldKey (e.g., "find-123.ticket.status")
  const parts = variableId.split('.')
  if (parts.length < 3) return null

  const resourceType = parts[1] as TableId
  const fieldKey = parts.slice(2).join('.') // Handle nested paths like "contact.name"

  // Validate that this is a known resource type
  if (!RESOURCE_FIELD_REGISTRY[resourceType]) return null

  return { resourceType, fieldKey }
}

/**
 * Get the item variable from an array variable
 *
 * @param arrayVar - Array variable to extract items from
 * @returns The items variable, or null if not an array
 *
 * @example
 * ```typescript
 * const contacts = { type: BaseType.ARRAY, items: { type: BaseType.OBJECT, ... } }
 * const itemVar = getArrayItemVariable(contacts) // Returns the Contact object structure
 * ```
 */
export function getArrayItemVariable(arrayVar: UnifiedVariable): UnifiedVariable | null {
  if (arrayVar.type !== BaseType.ARRAY) return null
  return arrayVar.items || null
}

/**
 * Resolve a field path in a variable structure (supports nested paths like "contact.firstName")
 *
 * @param itemVar - The item variable to traverse
 * @param fieldPath - The field path (e.g., "contact.firstName", "tags")
 * @returns The resolved field variable, or null if not found
 *
 * @example
 * ```typescript
 * // Navigate to nested field
 * const ticket = { type: BaseType.OBJECT, properties: { contact: { properties: { firstName: {...} } } } }
 * const field = resolveFieldPath(ticket, 'contact.firstName') // Returns firstName variable
 * ```
 */
export function resolveFieldPath(
  itemVar: UnifiedVariable | null,
  fieldPath: string
): UnifiedVariable | null {
  if (!itemVar || !fieldPath) return null

  const parts = fieldPath.split('.')
  let current = itemVar

  for (const part of parts) {
    // Navigate through properties
    if (current.properties && current.properties[part]) {
      current = current.properties[part]
    } else {
      // Field not found in path
      return null
    }
  }

  return current
}

/**
 * Infer output type for pluck operation
 *
 * @param inputArrayVar - The input array variable
 * @param pluckField - The field path to pluck (e.g., "contact.firstName")
 * @param flatten - Whether to flatten array results
 * @returns The inferred output type metadata
 *
 * @example
 * ```typescript
 * // Pluck simple field: Contact[].email -> string[]
 * inferPluckOutputType(contactsArray, 'email', false)
 * // Returns: { type: BaseType.EMAIL, items: undefined, ... }
 *
 * // Pluck nested field: Ticket[].contact.firstName -> string[]
 * inferPluckOutputType(ticketsArray, 'contact.firstName', false)
 * // Returns: { type: BaseType.STRING, items: undefined, ... }
 *
 * // Pluck array field with flatten: Contact[].tags (flatten) -> string[]
 * inferPluckOutputType(contactsArray, 'tags', true)
 * // Returns: { type: BaseType.STRING, items: undefined, ... }
 * ```
 */
export function inferPluckOutputType(
  inputArrayVar: UnifiedVariable | null,
  pluckField: string,
  flatten: boolean = false
): {
  type: BaseType
  items?: UnifiedVariable
  resourceId?: string
  properties?: Record<string, UnifiedVariable>
} | null {
  if (!inputArrayVar) return null

  // Get the item structure from the input array
  const itemVar = getArrayItemVariable(inputArrayVar)
  if (!itemVar) return null

  // Resolve the field being plucked
  const fieldVar = resolveFieldPath(itemVar, pluckField)
  if (!fieldVar) return null

  // Detect and unwrap collection wrappers (one-to-many, many-to-many relations)
  // Collection wrappers are objects with:
  // - type: 'object'
  // - fieldReference: 'resourceType:fieldKey' (e.g., 'contact:ticket')
  // - properties.values: array of actual items
  const isCollectionWrapper =
    fieldVar.type === BaseType.OBJECT &&
    fieldVar.fieldReference &&
    isResourceFieldId(fieldVar.fieldReference) &&
    fieldVar.properties?.values?.type === BaseType.ARRAY

  if (isCollectionWrapper && fieldVar.properties?.values?.items) {
    // Extract items from collection.values
    // Note: collection.values.items IS the properties object directly, not a wrapped structure
    const valuesArray = fieldVar.properties.values
    const itemProperties = valuesArray.items! // This is the properties object itself

    // Parse reference to get target resource type using typed parsing
    // "contact:ticket" → { entityDefinitionId: 'contact', fieldId: 'ticket' }
    const { fieldId: targetTable } = parseResourceFieldId(
      fieldVar.fieldReference as ResourceFieldId
    )

    return {
      type: BaseType.OBJECT, // Collection items are always objects (resource types)
      items: undefined, // Objects don't have items (only arrays do)
      resourceId: targetTable,
      properties: itemProperties as any, // Properties will get IDs assigned by calling code
    }
  }

  // If the field itself is an array and flatten is true, unwrap one level
  if (fieldVar.type === BaseType.ARRAY && flatten && fieldVar.items) {
    return {
      type: fieldVar.items.type,
      items: fieldVar.items.items, // Nested items (if any)
      resourceId: fieldVar.items.resourceId,
      properties: fieldVar.items.properties,
    }
  }

  // Return the field's type as-is
  return {
    type: fieldVar.type,
    items: fieldVar.items,
    resourceId: fieldVar.resourceId,
    properties: fieldVar.properties,
  }
}

/**
 * Preserve array structure for operations that don't transform item types
 * (filter, sort, unique, reverse, slice)
 *
 * @param inputArrayVar - The input array variable
 * @returns The same structure (shallow clone)
 *
 * @example
 * ```typescript
 * // Filter operation: Contact[] -> Contact[] (same structure)
 * const filtered = preserveArrayStructure(contactsArray)
 * // Returns a shallow copy of the array structure
 * ```
 */
export function preserveArrayStructure(
  inputArrayVar: UnifiedVariable | null
): UnifiedVariable | null {
  if (!inputArrayVar || inputArrayVar.type !== BaseType.ARRAY) return null

  // Return a shallow copy of the array structure
  return {
    ...inputArrayVar,
    items: inputArrayVar.items ? { ...inputArrayVar.items } : undefined,
  }
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
