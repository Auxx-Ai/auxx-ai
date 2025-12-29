// packages/services/src/app-settings/schema-to-zod.ts

import { z } from 'zod'
import type { SettingsSchemaField } from './merge-with-defaults'

/**
 * Convert SDK settings schema to Zod schema for validation
 * Handles all field types: string, number, boolean, select, struct
 *
 * @param schema - The settings schema from SDK
 * @returns Zod schema for validation
 */
export function schemaToZod(schema: Record<string, SettingsSchemaField>): z.ZodObject<any> {
  const shape: Record<string, z.ZodTypeAny> = {}

  for (const [key, field] of Object.entries(schema)) {
    shape[key] = fieldToZod(field, key)
  }

  return z.object(shape)
}

/**
 * Convert a single field to its Zod equivalent
 *
 * @param field - The field definition
 * @param fieldName - Name of the field (for error messages)
 * @returns Zod schema for this field
 */
function fieldToZod(field: SettingsSchemaField, fieldName: string): z.ZodTypeAny {
  let zodSchema: z.ZodTypeAny

  switch (field.type) {
    case 'string':
      zodSchema = createStringSchema(field)
      break
    case 'number':
      zodSchema = createNumberSchema(field)
      break
    case 'boolean':
      zodSchema = z.boolean()
      break
    case 'select':
      zodSchema = createSelectSchema(field)
      break
    case 'struct':
      zodSchema = createStructSchema(field)
      break
    default:
      zodSchema = z.any()
  }

  // Handle optional fields
  if (field.is_optional) {
    zodSchema = zodSchema.optional()
  }

  return zodSchema
}

/**
 * Create Zod schema for string fields with validation constraints
 *
 * @param field - String field definition
 * @returns Zod string schema
 */
function createStringSchema(field: SettingsSchemaField): z.ZodString {
  let schema = z.string({
    error: (issue) =>
      issue.input === undefined ? 'This field is required' : 'Must be a valid string',
  })

  const meta = field._metadata

  if (meta?.minLength !== undefined) {
    schema = schema.min(meta.minLength, { error: `Minimum ${meta.minLength} characters` })
  }
  if (meta?.maxLength !== undefined) {
    schema = schema.max(meta.maxLength, { error: `Maximum ${meta.maxLength} characters` })
  }
  if (meta?.pattern) {
    try {
      schema = schema.regex(new RegExp(meta.pattern), { error: 'Invalid format' })
    } catch (err) {
      console.warn(`Invalid regex pattern for string field: ${meta.pattern}`)
    }
  }

  return schema
}

/**
 * Create Zod schema for number fields with validation constraints
 *
 * @param field - Number field definition
 * @returns Zod number schema
 */
function createNumberSchema(field: SettingsSchemaField): z.ZodNumber {
  let schema = z.number({
    error: (issue) =>
      issue.input === undefined ? 'This field is required' : 'Must be a valid number',
  })

  const meta = field._metadata

  if (meta?.min !== undefined) {
    schema = schema.min(meta.min, { error: `Minimum value is ${meta.min}` })
  }
  if (meta?.max !== undefined) {
    schema = schema.max(meta.max, { error: `Maximum value is ${meta.max}` })
  }

  return schema
}

/**
 * Create Zod schema for select fields with enum validation
 *
 * @param field - Select field definition
 * @returns Zod enum schema
 */
function createSelectSchema(field: SettingsSchemaField): z.ZodEnum<any> {
  const options = field._metadata?.options

  if (!options || !Array.isArray(options) || options.length === 0) {
    throw new Error('Select field must have options array')
  }

  return z.enum(options as [string, ...string[]], {
    error: `Must be one of: ${options.join(', ')}`,
  })
}

/**
 * Create Zod schema for struct (nested object) fields
 * Recursively converts nested fields to Zod schemas
 *
 * @param field - Struct field definition
 * @returns Zod object schema
 */
function createStructSchema(field: SettingsSchemaField): z.ZodObject<any> {
  if (!field.fields) {
    throw new Error('Struct field must have nested fields')
  }

  // Recursively convert nested schema
  return schemaToZod(field.fields)
}
