// apps/web/src/lib/extensions/forms/deserialize-schema.ts

import { z } from 'zod'
import { handleDeserializationError, handleUnknownFieldType } from './error-handler'
import type { SerializedFormValue } from './types'

/**
 * Deserialize a serialized form schema into a Zod schema.
 * Recreates validation rules from metadata.
 */
export function deserializeSchema(fields: Record<string, SerializedFormValue>): z.ZodObject<any> {
  const shape: Record<string, z.ZodTypeAny> = {}

  try {
    for (const [name, field] of Object.entries(fields)) {
      shape[name] = deserializeField(name, field)
    }

    return z.object(shape)
  } catch (error) {
    handleDeserializationError(error as Error)
  }
}

/**
 * Deserialize a single field.
 */
function deserializeField(name: string, field: SerializedFormValue): z.ZodTypeAny {
  switch (field.type) {
    case 'string':
      return deserializeStringField(field)

    case 'number':
      return deserializeNumberField(field)

    case 'boolean':
      return deserializeBooleanField(field)

    case 'select':
      return deserializeSelectField(field)

    default:
      handleUnknownFieldType((field as any).type, name)
  }
}

/**
 * Deserialize string field with custom error messages.
 */
function deserializeStringField(
  field: Extract<SerializedFormValue, { type: 'string' }>
): z.ZodTypeAny {
  const { metadata } = field
  const errors = metadata.errorMessages || {}

  let schema: any = z.string({ message: errors.required || 'Required' }).trim()

  // Apply validation rules from metadata
  // If minLength is specified, it handles the required check too
  if (metadata.minLength !== undefined) {
    schema = schema.min(
      metadata.minLength,
      errors.minLength || `Must be at least ${metadata.minLength} characters`
    )
  } else if (!metadata.optional) {
    // Only add min(1) if no minLength is specified
    schema = schema.min(1, errors.required || 'Required')
  }

  if (metadata.maxLength !== undefined) {
    schema = schema.max(
      metadata.maxLength,
      errors.maxLength || `Must be ${metadata.maxLength} characters or less`
    )
  }

  if (metadata.email) {
    schema = schema.email(errors.email || 'Must be a valid email')
  }

  if (metadata.url) {
    schema = schema.url(errors.url || 'Must be a valid URL')
  }

  if (metadata.defaultValue !== undefined) {
    schema = schema.default(metadata.defaultValue)
  }

  // Handle optional
  if (metadata.optional) {
    return z.preprocess((val) => (val === '' ? undefined : val), schema.optional())
  }

  return schema
}

/**
 * Deserialize number field with custom error messages.
 */
function deserializeNumberField(
  field: Extract<SerializedFormValue, { type: 'number' }>
): z.ZodTypeAny {
  const { metadata } = field
  const errors = metadata.errorMessages || {}

  let schema: any = z.number({ message: errors.required || 'Required' }).or(
    z.string().transform((val) => {
      const num = parseFloat(val)
      return Number.isNaN(num) ? undefined : num
    })
  )

  if (metadata.min !== undefined) {
    schema = schema.min(metadata.min, errors.min || `Must be at least ${metadata.min}`)
  }

  if (metadata.max !== undefined) {
    schema = schema.max(metadata.max, errors.max || `Must be ${metadata.max} or less`)
  }

  if (metadata.integer) {
    schema = schema.int(errors.integer || 'Must be a whole number')
  }

  if (metadata.positive) {
    schema = schema.positive(errors.positive || 'Must be positive')
  }

  if (metadata.defaultValue !== undefined) {
    schema = schema.default(metadata.defaultValue)
  }

  if (metadata.optional) {
    return schema.optional()
  }

  return schema
}

/**
 * Deserialize boolean field.
 */
function deserializeBooleanField(
  field: Extract<SerializedFormValue, { type: 'boolean' }>
): z.ZodTypeAny {
  const { metadata } = field

  let schema: any = z.boolean()

  if (metadata.defaultValue !== undefined) {
    schema = schema.default(metadata.defaultValue)
  }

  return schema
}

/**
 * Deserialize select field.
 */
function deserializeSelectField(
  field: Extract<SerializedFormValue, { type: 'select' }>
): z.ZodTypeAny {
  const { metadata } = field
  const errors = metadata.errorMessages || {}

  if (!metadata.options || metadata.options.length === 0) {
    throw new Error('Select field must have at least one option')
  }

  const values = metadata.options.map((opt) => opt.value) as [string, ...string[]]
  let schema: any = z.enum(values, {
    message: errors.required || 'Please select an option',
  })

  if (metadata.defaultValue !== undefined) {
    schema = schema.default(metadata.defaultValue)
  }

  if (metadata.optional) {
    return schema.optional()
  }

  return schema
}
