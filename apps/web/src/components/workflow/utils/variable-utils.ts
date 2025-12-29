// apps/web/src/components/workflow/utils/variable-utils.ts

import type {
  UnifiedVariable,
  FieldReferenceMetadata,
} from '~/components/workflow/types/variable-types'
import type { FlowNode } from '~/components/workflow/types/node-base'
import type { FieldDefinition } from '~/components/workflow/ui/conditions/types'
import {
  RESOURCE_FIELD_REGISTRY,
  RESOURCE_TABLE_MAP,
  type TableId,
  type ResourceField,
  BaseType,
  isTypeCompatible as isBaseTypeCompatible,
  getOperatorsForFieldType,
} from '@auxx/lib/workflow-engine/client'

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
 * Extract all variable references from text
 * Returns array of variable names found in {{variable}} patterns
 * @param text - The text to extract variables from
 * @returns Array of unique variable names (without the curly braces)
 */
export function extractVariablesFromText(text: string): string[] {
  const variables: string[] = []
  let match

  // Reset lastIndex to ensure consistent results (important for global regex)
  VARIABLE_PATTERN.lastIndex = 0

  while ((match = VARIABLE_PATTERN.exec(text)) !== null) {
    const varName = match[1]?.trim()
    if (varName && !variables.includes(varName)) {
      variables.push(varName)
    }
  }

  // Reset lastIndex after use
  VARIABLE_PATTERN.lastIndex = 0

  return variables
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
 * Unified variable parser that returns all metadata about a variable
 * This is the single source of truth for understanding variable types, references, and UI metadata
 *
 * @param variable - The variable to parse
 * @returns Comprehensive metadata including display type, actual type for operators, field references, enum values, etc.
 *
 * @example
 * ```typescript
 * // Direct resource object (e.g., Contact from "Contact Created" trigger)
 * const parsed = parseVariable(contactVariable)
 * // Returns: { actualType: BaseType.REFERENCE, targetTable: 'contact', operators: ['is', 'is not', ...] }
 *
 * // Relation field (e.g., ticket.contact)
 * const parsed = parseVariable(ticketContactVariable)
 * // Returns: { actualType: BaseType.RELATION, targetTable: 'contact', fieldReference: 'ticket:contact', ... }
 * ```
 */
export function parseVariable(variable: UnifiedVariable) {
  // Start with base variable data
  const result = {
    ...variable,
    displayType: variable.type as string,
    actualType: variable.type as BaseType,
    operators: getOperatorsForFieldType(variable.type as BaseType).map((op) => op.key),
    enumValues: undefined as Array<{ label: string; dbValue: string }> | undefined,
    fieldReference: undefined as string | undefined,
    targetTable: undefined as TableId | undefined,
    resourceType: undefined as TableId | undefined,
    fieldKey: undefined as string | undefined,
    field: undefined as ResourceField | undefined,
  }

  // Handle ARRAY type - show items type with [] suffix
  if (variable.type === BaseType.ARRAY && variable.items) {
    // Recursively parse the items to get their display type
    const itemsParsed = parseVariable(variable.items)
    result.displayType = `${itemsParsed.displayType}[]`
    // Keep actualType as ARRAY for operator compatibility
    result.actualType = BaseType.ARRAY
  }

  // Handle ENUM type - look up enum values from registry (with both label and dbValue)
  if (variable.type === BaseType.ENUM && variable.enum) {
    const parsed = parseResourceFieldFromVariableId(variable.id)
    if (parsed) {
      const fieldConfig = RESOURCE_FIELD_REGISTRY[parsed.resourceType]?.[parsed.fieldKey]
      if (fieldConfig?.enumValues) {
        // Use full enum objects for proper label/value handling in condition builder
        result.enumValues = fieldConfig.enumValues
      }
    }
    // Fallback: use enum values as both label and dbValue
    if (!result.enumValues) {
      result.enumValues = variable.enum.map((v) => ({ label: String(v), dbValue: String(v) }))
    }
  }

  // Handle OBJECT/RELATION types with reference
  if (variable.reference) {
    // Check if it's a direct resource object (e.g., "contact") vs relation field (e.g., "ticket:contact")
    if (!variable.reference.includes(':')) {
      // Direct resource object (reference is just table name like "contact" or "entity_products")
      const tableMeta = RESOURCE_TABLE_MAP[variable.reference as TableId]
      if (tableMeta) {
        result.displayType = tableMeta.label // e.g., "Contact"
        result.actualType = BaseType.RELATION // Use REFERENCE type for correct operators
        result.fieldReference = variable.reference // Store for filtering
        result.targetTable = variable.reference as TableId
        result.operators = getOperatorsForFieldType(BaseType.REFERENCE).map((op) => op.key)
      } else if (variable.label) {
        // Fallback for custom entities: use the label property
        result.displayType = variable.label // e.g., "Product"
        result.actualType = BaseType.RELATION
        result.fieldReference = variable.reference
      }
    } else {
      // Relation field (reference in format "resourceType:fieldKey")
      const parts = variable.reference.split(':')
      const resourceType = parts[0]
      const fieldKey = parts[1]
      if (!resourceType || !fieldKey) return result

      const field = RESOURCE_FIELD_REGISTRY[resourceType]?.[fieldKey]

      if (field?.type === BaseType.RELATION && field.relationship) {
        const targetTable = field.relationship.targetTable as TableId
        const tableMeta = RESOURCE_TABLE_MAP[targetTable]

        result.displayType = tableMeta?.label || variable.type // e.g., "Contact"
        result.actualType = BaseType.RELATION // Use RELATION type for correct operators
        result.fieldReference = variable.reference // e.g., "ticket:contact"
        result.targetTable = targetTable
        result.resourceType = resourceType as TableId
        result.fieldKey = fieldKey
        result.field = field
        result.operators = getOperatorsForFieldType(BaseType.RELATION).map((op) => op.key)
      }
    }
  }

  return result
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

  // Check if variable IS a resource type (direct match on reference field)
  // This matches resource object variables like trigger.ticket, findNode.contact, etc.
  if (variable.reference && relationshipTypes.includes(variable.reference as string)) {
    return true
  }

  // Check relationship type match via reference (for RELATION fields)
  if (variable.reference && relationshipTypes.length > 0) {
    const parsed = parseVariable(variable)
    if (parsed.targetTable && relationshipTypes.includes(parsed.targetTable)) {
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
  reference?: string
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
  // - reference: 'resourceType:fieldKey' (e.g., 'contact:ticket')
  // - properties.values: array of actual items
  const isCollectionWrapper =
    fieldVar.type === BaseType.OBJECT &&
    fieldVar.reference?.includes(':') &&
    fieldVar.properties?.values?.type === BaseType.ARRAY

  if (isCollectionWrapper && fieldVar.properties?.values?.items) {
    // Extract items from collection.values
    // Note: collection.values.items IS the properties object directly, not a wrapped structure
    const valuesArray = fieldVar.properties.values
    const itemProperties = valuesArray.items!  // This is the properties object itself

    // Parse reference to get target resource type
    // "contact:ticket" → "ticket"
    const parts = fieldVar.reference!.split(':')
    const targetTable = parts[1] || parts[0]

    return {
      type: BaseType.OBJECT,  // Collection items are always objects (resource types)
      items: undefined,  // Objects don't have items (only arrays do)
      reference: targetTable,
      properties: itemProperties as any,  // Properties will get IDs assigned by calling code
    }
  }

  // If the field itself is an array and flatten is true, unwrap one level
  if (fieldVar.type === BaseType.ARRAY && flatten && fieldVar.items) {
    return {
      type: fieldVar.items.type,
      items: fieldVar.items.items, // Nested items (if any)
      reference: fieldVar.items.reference,
      properties: fieldVar.items.properties,
    }
  }

  // Return the field's type as-is
  return {
    type: fieldVar.type,
    items: fieldVar.items,
    reference: fieldVar.reference,
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
    if (!field.fieldReference.includes(':')) {
      // Direct resource object (reference is just table name like "contact")
      const tableMeta = RESOURCE_TABLE_MAP[field.fieldReference as TableId]
      if (tableMeta) {
        return tableMeta.label // e.g., "Contact", "Ticket", "User"
      }
    } else {
      // Relation field (reference in format "resourceType:fieldKey")
      const parts = field.fieldReference.split(':')
      const targetTable = (parts.length === 2 ? parts[1] : parts[0]) as TableId

      // Look up the table label from registry
      const tableMeta = RESOURCE_TABLE_MAP[targetTable]
      if (tableMeta) {
        return tableMeta.label // e.g., "Contact", "Ticket"
      }
    }
  }

  // For all other types, return the BaseType value as-is
  // (Already user-friendly: "string", "number", "boolean", etc.)
  return field.type
}
