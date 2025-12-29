// packages/sdk/src/client/forms/utils/serialize.ts

import type { FormSchema, SerializedFormValue } from '../types.js'

/**
 * Serialized schema format.
 */
export interface SerializedSchema {
  fields: Record<string, SerializedFormValue>
}

/**
 * Serialize a FormSchema to JSON for postMessage.
 * Converts FormValue instances to plain objects.
 */
export function serializeSchema(schema: FormSchema): SerializedSchema {
  const fields: Record<string, SerializedFormValue> = {}

  for (const [name, field] of Object.entries(schema)) {
    if (!field || typeof field.toJSON !== 'function') {
      throw new Error(
        `Invalid field "${name}": must be a FormValue instance (e.g., Forms.string())`
      )
    }

    fields[name] = field.toJSON()
  }

  return { fields }
}
