// packages/sdk/src/client/forms/index.ts

import { FormString } from './types/string.js'
import { FormNumber } from './types/number.js'
import { FormBoolean } from './types/boolean.js'
import { FormSelect } from './types/select.js'
import type { SelectOption } from './types.js'

export * from './types.js'
export * from './base.js'
export * from './utils/serialize.js'
export * from './utils/validation.js'
export { FormString } from './types/string.js'
export { FormNumber } from './types/number.js'
export { FormBoolean } from './types/boolean.js'
export { FormSelect } from './types/select.js'

/**
 * Forms factory for creating form fields.
 *
 * @example
 * const schema = {
 *   name: Forms.string().minLength(2),
 *   age: Forms.number().optional().positive(),
 *   active: Forms.boolean(),
 *   status: Forms.select([
 *     { value: 'active', label: 'Active' },
 *     { value: 'inactive', label: 'Inactive' }
 *   ])
 * }
 */
export const Forms = {
  string: () => FormString.create(),
  number: () => FormNumber.create(),
  boolean: () => FormBoolean.create(),
  select: <T extends string>(options: SelectOption<T>[]) => FormSelect.create(options),
}

/**
 * Settings factory (alias to Forms)
 * Use this when defining app settings schemas
 *
 * @example
 * const settingsSchema = {
 *   organization: {
 *     apiKey: Settings.string().placeholder('Enter your API key'),
 *     maxRetries: Settings.number().default(3),
 *     enableLogging: Settings.boolean().default(true),
 *   }
 * }
 */
export const Settings = Forms
