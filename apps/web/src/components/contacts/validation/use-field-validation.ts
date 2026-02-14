// ~/components/contacts/fields/validation/useFieldValidation.ts

import { FieldType } from '@auxx/database/enums'
import { useCallback } from 'react'
import { z } from 'zod'
// Helper to create dynamic validation schema based on field type
export const useFieldValidation = () => {
  const generateValidationSchema = useCallback((field: any) => {
    let schema = z.string()
    // Add required validation if the field is required
    if (field.required) {
      schema = schema.min(1, `${field.name} is required`)
    } else {
      // schema = schema.optional()
    }
    // Add type-specific validation
    switch (field.type) {
      case FieldType.EMAIL:
        schema = field.required
          ? schema.email(`Please enter a valid email address`)
          : z.email(`Please enter a valid email address`).optional()
        break
      case FieldType.NUMBER:
        schema = field.required
          ? schema.refine((val) => !Number.isNaN(Number(val)), {
              error: 'Please enter a valid number',
            })
          : schema
              .refine((val) => !val || !Number.isNaN(Number(val)), {
                error: 'Please enter a valid number',
              })
              .optional()
        break
      case FieldType.URL:
        schema = field.required
          ? schema.url(`Please enter a valid URL`)
          : schema.url(`Please enter a valid URL`).optional()
        break
      case FieldType.PHONE_INTL:
        // Simple validation for phone - can be enhanced
        schema = field.required
          ? schema.min(5, `Please enter a valid phone number`)
          : schema.min(5, `Please enter a valid phone number`).optional()
        break
    }
    return schema
  }, [])
  // Validate a single field
  const validateField = useCallback(
    (field: any, value: string) => {
      const schema = generateValidationSchema(field)
      try {
        schema.parse(value)
        return { valid: true, error: null }
      } catch (error) {
        if (error instanceof z.ZodError) {
          return { valid: false, error: error[0]?.message || 'Invalid input' }
        }
        return { valid: false, error: 'Invalid input' }
      }
    },
    [generateValidationSchema]
  )
  // Generate a complete zod schema for all fields
  const generateFormSchema = useCallback(
    (fields: any[]) => {
      const schemaObject: Record<string, z.ZodType<any>> = {}
      fields.forEach((field) => {
        schemaObject[field.id] = generateValidationSchema(field)
      })
      return z.object(schemaObject)
    },
    [generateValidationSchema]
  )
  return { validateField, generateFormSchema }
}
