// apps/web/src/components/workflow/ui/structured-output-generator/utils.ts

import { BaseType } from '../../types/unified-types'
import { ArrayType, type Field, Type } from './types'

/**
 *
 */
export function getFieldType(schema: Field): Type | ArrayType {
  if (schema.type === Type.array) {
    if (schema.items) {
      switch (schema.items.type) {
        case Type.string:
          return ArrayType.string
        case Type.number:
          return ArrayType.number
        case Type.boolean:
          return ArrayType.boolean
        case Type.object:
          return ArrayType.object
        default:
          return schema.type
      }
    }
  }
  return schema.type
}

/**
 *
 */
export function getHasChildren(schema: Field): boolean {
  return (
    (schema.type === Type.object &&
      !!schema.properties &&
      Object.keys(schema.properties).length > 0) ||
    (schema.type === Type.array &&
      !!schema.items &&
      schema.items.type === Type.object &&
      !!schema.items.properties &&
      Object.keys(schema.items.properties).length > 0)
  )
}

export function findPropertyWithPath(schema: Field, path: string[]): Field | null {
  if (path.length === 0) return schema

  const [key, ...rest] = path

  if (key === 'properties' && schema.properties) {
    const [propName, ...propRest] = rest
    if (propName && schema.properties[propName]) {
      return findPropertyWithPath(schema.properties[propName], propRest)
    }
  }

  if (key === 'items' && schema.items) {
    return findPropertyWithPath(schema.items, rest)
  }

  return null
}

export function checkJsonDepth(obj: any, currentDepth = 0): number {
  if (currentDepth > 100) return currentDepth // Prevent infinite recursion

  let maxDepth = currentDepth

  if (typeof obj === 'object' && obj !== null) {
    for (const key in obj) {
      if (Object.hasOwn(obj, key)) {
        const depth = checkJsonDepth(obj[key], currentDepth + 1)
        maxDepth = Math.max(maxDepth, depth)
      }
    }
  }

  return maxDepth
}

export function checkJsonSchemaDepth(schema: any, currentDepth = 0): number {
  if (currentDepth > 100) return currentDepth // Prevent infinite recursion

  let maxDepth = currentDepth

  if (schema.type === 'object' && schema.properties) {
    for (const key in schema.properties) {
      const depth = checkJsonSchemaDepth(schema.properties[key], currentDepth + 1)
      maxDepth = Math.max(maxDepth, depth)
    }
  }

  if (schema.type === 'array' && schema.items) {
    const depth = checkJsonSchemaDepth(schema.items, currentDepth + 1)
    maxDepth = Math.max(maxDepth, depth)
  }

  return maxDepth
}

export function convertBooleanToString(schema: any): void {
  if (schema.type === 'object' && schema.properties) {
    for (const key in schema.properties) {
      convertBooleanToString(schema.properties[key])
    }
  }

  if (schema.type === 'array' && schema.items) {
    convertBooleanToString(schema.items)
  }

  if (schema.enum && Array.isArray(schema.enum)) {
    schema.enum = schema.enum.map((value: any) =>
      typeof value === 'boolean' ? String(value) : value
    )
  }
}

export function preValidateSchema(schema: any): { success: boolean; error?: { message: string } } {
  if (typeof schema !== 'object' || schema === null) {
    return { success: false, error: { message: 'Schema must be an object' } }
  }

  if (!schema.type) {
    return { success: false, error: { message: 'Schema must have a type property' } }
  }

  if (schema.type !== 'object') {
    return { success: false, error: { message: 'Root schema type must be "object"' } }
  }

  return { success: true }
}

export function validateSchemaAgainstDraft7(schema: any): string[] {
  const errors: string[] = []

  // Basic validation - you can expand this based on your needs
  if (schema.type === 'object' && !schema.properties) {
    errors.push('Object type must have properties')
  }

  return errors
}

export function getValidationErrorMessage(errors: string[]): string {
  return errors.join('\n')
}

export function getKeyboardKeyNameBySystem(key: string): string {
  const isMac =
    typeof window !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(window.navigator.platform)

  if (key === 'ctrl') {
    return isMac ? '⌘' : 'Ctrl'
  }

  return key
}

export function getKeyboardKeyCodeBySystem(key: string): string {
  const isMac =
    typeof window !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(window.navigator.platform)

  if (key === 'ctrl') {
    return isMac ? 'cmd' : 'ctrl'
  }

  return key
}

/**
 * Generate unique ID for schema fields
 */
export function generateFieldId(): string {
  return `field_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

/**
 * Get available types for the type selector
 */
export function getAvailableTypes(): BaseType[] {
  return [
    BaseType.STRING,
    BaseType.NUMBER,
    BaseType.BOOLEAN,
    BaseType.OBJECT,
    BaseType.ARRAY,
    BaseType.ENUM,
  ]
}

/**
 * Get default value for a given type
 */
export function getDefaultValueForType(type: BaseType): any {
  switch (type) {
    case BaseType.STRING:
      return ''
    case BaseType.NUMBER:
      return 0
    case BaseType.BOOLEAN:
      return false
    case BaseType.ARRAY:
      return []
    case BaseType.OBJECT:
      return {}
    case BaseType.ENUM:
      return ''
    default:
      return null
  }
}

/**
 * Validate field name
 */
export function validateFieldName(name: string, existingNames: string[] = []): string | null {
  if (!name || name.trim() === '') {
    return 'Field name is required'
  }

  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    return 'Field name must start with a letter or underscore and contain only letters, numbers, and underscores'
  }

  if (existingNames.includes(name)) {
    return 'Field name already exists'
  }

  return null
}
