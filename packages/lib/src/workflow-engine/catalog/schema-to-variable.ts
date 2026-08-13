// packages/lib/src/workflow-engine/catalog/schema-to-variable.ts

import { BaseType } from '../core/types'
import type { UnifiedVariable } from '../types/unified-variable'
import { mapFieldTypeToBaseType } from '../utils/field-type-mapper'
import { createUnifiedOutputVariable } from './variable-conversion'

/**
 * JSON Schema ⇄ `UnifiedVariable` conversion — relocated from apps/web
 * `utils/schema-to-variable.ts` (Phase 2 §1 of the node-catalog migration) so
 * `information-extractor`'s `resolveOutputs` can move into its manifest.
 * Already pure: no React/zustand/browser imports. The `WorkflowBlockField`
 * conversion (`schemaRootToWorkflowFields` / `schemaFieldToWorkflowField`)
 * stayed in apps/web — it types against `WorkflowBlockField`/`Field`/
 * `SchemaRoot`, which belong to the (unrelated) app-block-schema system, not
 * the node catalog; moving those types too was out of scope for this split.
 */

/**
 * Resolve a schema node's `BaseType`, enriched by the schema editor's vendor
 * metadata. `x-auxx.fieldType` (authored FieldType) wins, then a string
 * `format` (`date-time`/`date`/`email`/`uri`), falling back to the bare JSON
 * Schema `type`. Lets downstream bindings see EMAIL / DATETIME / URL vars
 * instead of a flat STRING.
 */
function deriveBaseType(schema: any): BaseType {
  const fieldType = schema?.['x-auxx']?.fieldType
  if (typeof fieldType === 'string') return mapFieldTypeToBaseType(fieldType)

  switch (schema?.format) {
    case 'date-time':
      return BaseType.DATETIME
    case 'date':
      return BaseType.DATE
    case 'email':
      return BaseType.EMAIL
    case 'uri':
      return BaseType.URL
  }
  return schemaTypeToBaseType(schema?.type || 'string')
}

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
    type: deriveBaseType(schema),
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
 * Convert a SchemaRoot (a node's structured-output JSON Schema) to
 * UnifiedVariables — the output variables for nodes that have structured output.
 */
export function schemaRootToUnifiedVariables(
  schemaRoot: any,
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
