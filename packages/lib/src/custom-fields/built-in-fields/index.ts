// packages/lib/src/custom-fields/built-in-fields/index.ts

import { ModelTypes, type ModelType } from '../types'
import { contactBuiltInFields } from './contact'
import { ticketBuiltInFields } from './ticket'
import { conversationBuiltInFields } from './conversation'
import { partBuiltInFields } from './part'
import type { BuiltInFieldHandler, BuiltInFieldRegistry } from './types'

/**
 * Master registry of all built-in fields across all models
 * Note: 'thread' is the new name for 'conversation', 'entity' uses EntityDefinition
 */
export const BUILT_IN_FIELDS: Partial<Record<ModelType, BuiltInFieldRegistry>> = {
  [ModelTypes.CONTACT]: contactBuiltInFields,
  [ModelTypes.TICKET]: ticketBuiltInFields,
  [ModelTypes.THREAD]: conversationBuiltInFields,
  [ModelTypes.PART]: partBuiltInFields,
}

/**
 * Check if a field is a built-in field
 *
 * @param fieldId - The field ID to check
 * @param modelType - The model type
 * @returns True if the field is a built-in field
 */
export function isBuiltInField(fieldId: string, modelType: ModelType): boolean {
  const registry = BUILT_IN_FIELDS[modelType]
  return registry ? fieldId in registry : false
}

/**
 * Get the handler for a built-in field
 *
 * @param fieldId - The field ID
 * @param modelType - The model type
 * @returns The handler function, or null if not found
 */
export function getBuiltInFieldHandler(
  fieldId: string,
  modelType: ModelType
): BuiltInFieldHandler | null {
  return BUILT_IN_FIELDS[modelType]?.[fieldId]?.handler || null
}

// Re-export types
export type { BuiltInFieldHandler, BuiltInFieldConfig, BuiltInFieldRegistry } from './types'
