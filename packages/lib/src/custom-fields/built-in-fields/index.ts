// packages/lib/src/custom-fields/built-in-fields/index.ts

import type { FieldType } from '@auxx/database/types'
import { type ModelType, ModelTypes } from '../types'
import { contactBuiltInFields } from './contact'
import { conversationBuiltInFields } from './conversation'
import { partBuiltInFields } from './part'
import { ticketBuiltInFields } from './ticket'
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

/**
 * Get the FieldType for a built-in field
 *
 * @param fieldId - The field ID
 * @param modelType - The model type
 * @returns The field type, or null if not found
 */
export function getBuiltInFieldType(fieldId: string, modelType: ModelType): FieldType | null {
  return BUILT_IN_FIELDS[modelType]?.[fieldId]?.type ?? null
}

// Re-export types
export type { BuiltInFieldConfig, BuiltInFieldHandler, BuiltInFieldRegistry } from './types'
