// apps/web/src/components/workflow/utils/schema-to-variable.ts

import { type UnifiedVariable, BaseType } from '../types/variable-types'
import { createUnifiedOutputVariable } from './variable-conversion'
import { type SchemaRoot, Type } from '../ui/structured-output-generator/types'

/**
 * This file contains utilities for converting between different schema and variable formats:
 *
 * 1. SchemaRoot (StructuredOutputGenerator format) - JSON Schema-like structure
 *    - Used by the StructuredOutputGenerator UI component
 *    - Contains type, properties, required fields, etc.
 *
 * 2. UnifiedVariable - The standard variable format used throughout the workflow
 *    - Used for input/output variables in nodes
 *    - Contains id, nodeId, path, type, properties, etc.
 *
 * 3. JSON data - Raw JSON objects from webhook bodies or other sources
 *    - Can be converted to SchemaRoot using jsonToSchema()
 *    - Can be validated against schemas
 *
 * Key conversion flows:
 * - JSON → SchemaRoot (jsonToSchema)
 * - SchemaRoot → UnifiedVariable (schemaToUnifiedVariable, schemaRootToUnifiedVariables)
 * - Schema validation (validateAgainstSchema)
 * - Sample generation (generateSampleFromSchema)
 */

/**
 * Convert JSON Schema type to BaseType
 */
export function schemaTypeToBaseType(schemaType: string): BaseType {
  switch (schemaType) {
    case 'string':
      return BaseType.STRING
    case 'number':
    case 'integer':
      return BaseType.NUMBER
    case 'boolean':
      return BaseType.BOOLEAN
    case 'array':
      return BaseType.ARRAY
    case 'object':
      return BaseType.OBJECT
    default:
      return BaseType.STRING
  }
}

/**
 * Convert JSON Schema to UnifiedVariable recursively
 * This is used to create output variables from structured output schemas
 *
 * NEW: Now uses full paths instead of names
 * Example: basePath="body" creates "webhook-123.body", "webhook-123.body.contact", etc.
 */
export function schemaToUnifiedVariable(
  schema: any,
  nodeId: string,
  basePath: string // Now accepts full path like "body.contact" instead of just "contact"
): UnifiedVariable {
  const variable = createUnifiedOutputVariable({
    nodeId,
    path: basePath, // Use 'path' instead of 'name'
    type: schemaTypeToBaseType(schema.type || 'string'),
    description: schema.description,
  })

  // Handle object properties: recursively create property variables with full paths
  if (schema.type === 'object' && schema.properties) {
    variable.properties = {}

    for (const [propKey, propSchema] of Object.entries(schema.properties as Record<string, any>)) {
      const propPath = `${basePath}.${propKey}` // Build nested path
      variable.properties[propKey] = schemaToUnifiedVariable(
        propSchema,
        nodeId,
        propPath // Pass full path
      )
    }
  }

  // Handle array items: create item variable with [*] syntax
  if (schema.type === 'array' && schema.items) {
    const itemPath = `${basePath}[*]`
    variable.items = schemaToUnifiedVariable(schema.items, nodeId, itemPath)
  }

  // Handle enum values
  if (schema.enum) {
    variable.enum = schema.enum
  }

  return variable
}

/**
 * Convert a SchemaRoot (from StructuredOutputGenerator) to UnifiedVariables
 * This generates output variables for nodes that have structured outputs
 */
export function schemaRootToUnifiedVariables(
  schemaRoot: SchemaRoot,
  nodeId: string,
  variableName: string = 'structured_output'
): UnifiedVariable[] {
  // Create the main structured output variable
  const structuredVar = schemaToUnifiedVariable(schemaRoot, nodeId, variableName)
  structuredVar.description = 'Structured output based on the defined schema'

  return [structuredVar]
}

/**
 * Extract individual property paths from a schema for variable selection
 * This is useful for creating a flat list of all available properties
 */
export function extractSchemaPropertyPaths(schema: any, basePath: string = ''): string[] {
  const paths: string[] = []

  if (schema.type === 'object' && schema.properties) {
    for (const [key, propSchema] of Object.entries(schema.properties as Record<string, any>)) {
      const currentPath = basePath ? `${basePath}.${key}` : key
      paths.push(currentPath)

      // Recursively extract nested object properties
      if (propSchema.type === 'object') {
        paths.push(...extractSchemaPropertyPaths(propSchema, currentPath))
      }
    }
  }

  return paths
}

/**
 * Validate if a value matches a JSON schema
 * Returns true if valid, false otherwise
 */
export function validateAgainstSchema(value: any, schema: any): boolean {
  // Basic type validation
  if (schema.type) {
    const valueType = Array.isArray(value) ? 'array' : typeof value

    if (schema.type !== valueType) {
      // Special case for number/integer
      if (!((schema.type === 'integer' || schema.type === 'number') && valueType === 'number')) {
        return false
      }
    }
  }

  // Validate object properties
  if (schema.type === 'object' && schema.properties) {
    if (typeof value !== 'object' || value === null) {
      return false
    }

    // Check required properties
    if (schema.required) {
      for (const required of schema.required) {
        if (!(required in value)) {
          return false
        }
      }
    }

    // Validate each property
    for (const [key, propValue] of Object.entries(value)) {
      if (schema.properties[key]) {
        if (!validateAgainstSchema(propValue, schema.properties[key])) {
          return false
        }
      } else if (schema.additionalProperties === false) {
        return false
      }
    }
  }

  // Validate array items
  if (schema.type === 'array' && schema.items) {
    if (!Array.isArray(value)) {
      return false
    }

    for (const item of value) {
      if (!validateAgainstSchema(item, schema.items)) {
        return false
      }
    }
  }

  // Validate enum values
  if (schema.enum && !schema.enum.includes(value)) {
    return false
  }

  return true
}

/**
 * Generate a sample value that matches a JSON schema
 * Useful for providing examples or default values
 */
export function generateSampleFromSchema(schema: any): any {
  if (schema.example !== undefined) {
    return schema.example
  }

  if (schema.default !== undefined) {
    return schema.default
  }

  if (schema.enum && schema.enum.length > 0) {
    return schema.enum[0]
  }

  switch (schema.type) {
    case 'string':
      return 'example string'
    case 'number':
    case 'integer':
      return 0
    case 'boolean':
      return false
    case 'array':
      if (schema.items) {
        return [generateSampleFromSchema(schema.items)]
      }
      return []
    case 'object':
      if (schema.properties) {
        const obj: any = {}
        for (const [key, propSchema] of Object.entries(schema.properties as Record<string, any>)) {
          obj[key] = generateSampleFromSchema(propSchema)
        }
        return obj
      }
      return {}
    default:
      return null
  }
}

/**
 * Convert a JSON object to a JSON Schema (SchemaRoot)
 * This is used when converting webhook body data to a schema
 */
export function jsonToSchema(json: any): SchemaRoot {
  const convertValue = (value: any): any => {
    if (value === null || value === undefined) {
      return { type: Type.string }
    }

    if (Array.isArray(value)) {
      if (value.length === 0) {
        return { type: Type.array, items: { type: Type.string } }
      }

      const firstItem = value[0]
      if (typeof firstItem === 'object' && firstItem !== null) {
        return {
          type: Type.array,
          items: convertValue(firstItem),
        }
      }

      const itemType =
        typeof firstItem === 'number'
          ? Type.number
          : typeof firstItem === 'boolean'
            ? Type.boolean
            : Type.string
      return { type: Type.array, items: { type: itemType } }
    }

    if (typeof value === 'object') {
      const properties: Record<string, any> = {}
      const required: string[] = []

      for (const [key, val] of Object.entries(value)) {
        properties[key] = convertValue(val)
        required.push(key)
      }

      return {
        type: Type.object,
        properties,
        required,
        additionalProperties: false,
      }
    }

    switch (typeof value) {
      case 'number':
        return { type: Type.number }
      case 'boolean':
        return { type: Type.boolean }
      default:
        return { type: Type.string }
    }
  }

  const schema = convertValue(json)

  // Ensure root is always an object
  if (schema.type !== Type.object) {
    return {
      type: Type.object,
      properties: {
        value: schema,
      },
      required: ['value'],
      additionalProperties: false,
    }
  }

  return schema as SchemaRoot
}
