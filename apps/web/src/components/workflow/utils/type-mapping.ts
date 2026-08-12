// apps/web/src/components/workflow/utils/type-mapping.ts

import type { WorkflowBlockField } from '~/components/workflow/types/block-types'
import type { UnifiedVariable } from '~/components/workflow/types/variable-types'
import { BaseType } from '~/components/workflow/types/variable-types'
import { createUnifiedOutputVariable } from '~/components/workflow/utils/variable-conversion'

/**
 * Validate that a field has required properties
 *
 * @param field - The field to validate
 * @returns True if field is valid, false otherwise
 */
function isValidWorkflowBlockField(field: any): field is WorkflowBlockField {
  if (!field) {
    console.error('[Type Mapping] Field is null or undefined')
    return false
  }

  if (!field.type) {
    console.error('[Type Mapping] Field missing required "type" property:', field)
    return false
  }

  if (!field.name) {
    console.error('[Type Mapping] Field missing required "name" property:', field)
    return false
  }

  return true
}

/**
 * Map WorkflowBlockField type to BaseType for variable system
 *
 * @param fieldType - The field type from WorkflowBlockField
 * @returns The corresponding BaseType enum value
 */
export function mapFieldTypeToBaseType(fieldType: string | undefined): BaseType {
  if (!fieldType || fieldType === 'undefined') {
    console.error(
      '[Type Mapping] field.type is undefined or invalid!',
      'This indicates a serialization bug where the type property was lost.'
    )
    return BaseType.ANY
  }

  switch (fieldType) {
    case 'string':
      return BaseType.STRING
    case 'number':
      return BaseType.NUMBER
    case 'boolean':
      return BaseType.BOOLEAN
    case 'select':
      return BaseType.STRING // Select is a specialized string
    case 'array':
      return BaseType.ARRAY
    case 'struct':
    case 'object':
      return BaseType.OBJECT
    case 'currency':
      return BaseType.CURRENCY
    case 'any':
      return BaseType.ANY
    default:
      console.warn(
        `[Type Mapping] Unknown field type: "${fieldType}", defaulting to ANY.`,
        'Valid types: string, number, boolean, select, array, struct, object, any'
      )
      return BaseType.ANY
  }
}

/**
 * Convert WorkflowBlockField to UnifiedVariable
 *
 * @param field - The field to convert
 * @param nodeId - The node ID this output belongs to
 * @param parentPath - Path of the enclosing struct/array, relative to the node. Nested
 *   fields only carry their own key (`name`), so without this the variable ID collapses
 *   to `<nodeId>.<key>` and the picker hands out a path the engine can't resolve — the
 *   runtime stores the top-level output only (`<nodeId>.order`), and reads walk into it.
 * @returns A UnifiedVariable for the variable system
 */
export function convertFieldToOutputVariable(
  field: WorkflowBlockField,
  nodeId: string,
  parentPath?: string
): UnifiedVariable {
  // Captured before the guard: `field` narrows to `never` in the invalid branch,
  // but this function is deliberately defensive about malformed runtime input.
  const fieldName: string | undefined = field?.name
  const path = parentPath ? `${parentPath}.${fieldName ?? 'unknown'}` : (fieldName ?? 'unknown')

  return buildOutputVariable(field, nodeId, path)
}

/**
 * Convert a field whose path within the node is already known.
 * Split out so array items can claim the `<array>[*]` path instead of appending their
 * own (synthetic) name to it.
 */
function buildOutputVariable(
  field: WorkflowBlockField,
  nodeId: string,
  path: string
): UnifiedVariable {
  // Validate field structure
  if (!isValidWorkflowBlockField(field)) {
    console.error('[Type Mapping] Invalid field passed to convertFieldToOutputVariable:', {
      field,
      nodeId,
      path,
    })
    // Return a fallback variable to prevent crashes
    return createUnifiedOutputVariable({
      nodeId,
      path,
      type: BaseType.ANY,
      description: 'Invalid field definition - missing required properties',
    })
  }

  // Determine BaseType based on field.type and field.format
  let baseType = mapFieldTypeToBaseType(field.type)

  // Override type based on format for strings
  if (field.type === 'string' && field.format) {
    switch (field.format) {
      case 'date':
        baseType = BaseType.DATE
        break
      case 'datetime':
        baseType = BaseType.DATETIME
        break
      case 'time':
        baseType = BaseType.TIME
        break
      case 'email':
        baseType = BaseType.EMAIL
        break
      case 'url':
      case 'uri':
        baseType = BaseType.URL
        break
      case 'phone':
        baseType = BaseType.PHONE
        break
      // Other formats (if any) keep as STRING
    }
  }

  // Build properties recursively for struct/object types
  let properties: Record<string, UnifiedVariable> | undefined
  if (field.properties) {
    properties = {}
    for (const [key, prop] of Object.entries(field.properties)) {
      properties[key] = buildOutputVariable(prop, nodeId, `${path}.${prop?.name || key}`)
    }
  }

  // Build items recursively for array types. The item IS the array at `[*]`, so it takes
  // that path outright rather than appending its own (synthetic) name to the parent.
  let items: UnifiedVariable | undefined
  if (field.items) {
    items = buildOutputVariable(field.items, nodeId, `${path}[*]`)
  }

  return createUnifiedOutputVariable({
    nodeId,
    path,
    type: baseType, // Now format-aware
    description: field.description,
    properties,
    items,
  })
}

/**
 * Convert all output fields to unified variables
 *
 * @param outputs - Record of output fields from block schema
 * @param nodeId - The node ID these outputs belong to
 * @returns Array of UnifiedVariables for the variable system
 */
export function convertOutputFieldsToVariables(
  outputs: Record<string, WorkflowBlockField>,
  nodeId: string
): UnifiedVariable[] {
  return Object.values(outputs).map((field) => convertFieldToOutputVariable(field, nodeId))
}
