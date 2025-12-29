// packages/sdk/src/client/forms/utils/validation.ts

import type { FormSchema } from '../types.js'

/**
 * Validate that FormField names match schema keys.
 * Throws an error if a field references a non-existent schema key.
 */
export function validateFormFields(children: any[], schema: FormSchema): void {
  const schemaKeys = Object.keys(schema)

  for (const child of children) {
    if (child?.component === 'FormField') {
      const fieldName = child.attributes?.name

      if (!fieldName) {
        throw new Error('FormField must have a "name" prop')
      }

      if (!schemaKeys.includes(fieldName)) {
        throw new Error(
          `FormField "${fieldName}" does not exist in schema. ` +
            `Available fields: ${schemaKeys.join(', ')}`
        )
      }
    }
  }
}
