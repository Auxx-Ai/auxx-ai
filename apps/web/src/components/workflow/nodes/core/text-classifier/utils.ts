// apps/web/src/components/workflow/nodes/core/text-classifier/utils.ts

import { generateId } from '@auxx/utils/generateId'
import type { TextClassifierNodeData } from './types'

// Re-export variable utilities from shared location
// export { extractVariablesFromText } from '../../../utils/variable-utils'

/**
 * Generate a unique category ID
 */
export function generateCategoryId(): string {
  return generateId()
}

/**
 * Validate category name uniqueness
 */
export function isCategoryNameUnique(
  name: string,
  categories: TextClassifierNodeData['categories'],
  excludeId?: string
): boolean {
  return !categories.some(
    (cat) => cat.name.toLowerCase() === name.toLowerCase() && cat.id !== excludeId
  )
}

/**
 * Get default category name
 */
export function getDefaultCategoryName(
  existingCategories: TextClassifierNodeData['categories']
): string {
  let counter = existingCategories.length + 1
  let name = `Category ${counter}`

  while (!isCategoryNameUnique(name, existingCategories)) {
    counter++
    name = `Category ${counter}`
  }

  return name
}
