// apps/web/src/components/workflow/utils/variable-cloning.ts

import type { UnifiedVariable } from '~/components/workflow/types/variable-types'

/**
 * Clone a variable structure and rewrite all nested IDs with a new base ID.
 *
 * This is essential for operations that transform arrays while preserving
 * their item structure. Common use cases:
 * - Loop node: Clone array items to loop iteration variable
 * - List node: Clone input array structure to output array for operations
 *   like filter, sort, map, unique, etc.
 *
 * The function performs a deep clone and recursively updates:
 * - The variable's own ID
 * - All nested property IDs (for OBJECT types)
 * - All nested item IDs (for ARRAY types)
 *
 * @param sourceVariable - The variable structure to clone (typically from variable.items)
 * @param newBaseId - The new base ID to use
 * @param oldBaseId - The old base ID to replace
 * @returns Deeply cloned variable with all IDs updated
 *
 * @example
 * // Loop node: Clone array items to loop iteration variable
 * const sourceArray = getVariableById("find-abc.contacts")
 * const loopItem = cloneAndRewriteVariableIds(
 *   sourceArray.items,
 *   "loop-xyz.item",           // New base: loop iteration item
 *   "find-abc.contacts[*]"     // Old base: array items
 * )
 * // Result: All nested IDs are rewritten
 * // "find-abc.contacts[*].firstName" → "loop-xyz.item.firstName"
 * // "find-abc.contacts[*].email" → "loop-xyz.item.email"
 *
 * @example
 * // List node: Clone input array items to output array items
 * const sourceArray = getVariableById("find-abc.contacts")
 * const clonedItems = cloneAndRewriteVariableIds(
 *   sourceArray.items,
 *   "list-xyz.result[*]",      // New base: output array items
 *   "find-abc.contacts[*]"     // Old base: input array items
 * )
 * // Result: Preserves full structure with updated IDs
 * // "find-abc.contacts[*].firstName" → "list-xyz.result[*].firstName"
 * // "find-abc.contacts[*].tickets" → "list-xyz.result[*].tickets"
 */
export function cloneAndRewriteVariableIds(
  sourceVariable: Partial<UnifiedVariable>,
  newBaseId: string,
  oldBaseId: string
): Partial<UnifiedVariable> {
  // Shallow clone the variable
  const cloned: Partial<UnifiedVariable> = { ...sourceVariable }

  // Update the ID if it exists and matches the old base ID
  if (sourceVariable.id && sourceVariable.id.startsWith(oldBaseId)) {
    cloned.id = sourceVariable.id.replace(oldBaseId, newBaseId)
  }

  // Recursively update properties (for OBJECT types)
  if (sourceVariable.properties) {
    cloned.properties = {}
    Object.entries(sourceVariable.properties).forEach(([key, prop]) => {
      cloned.properties![key] = cloneAndRewriteVariableIds(
        prop,
        newBaseId,
        oldBaseId
      ) as UnifiedVariable
    })
  }

  // Recursively update items (for ARRAY types)
  if (sourceVariable.items) {
    cloned.items = cloneAndRewriteVariableIds(
      sourceVariable.items,
      newBaseId,
      oldBaseId
    ) as UnifiedVariable
  }

  return cloned
}

/**
 * Recursively assign IDs to a variable structure that doesn't have IDs.
 * Used when building new variables from type information (e.g., pluck operation).
 *
 * @param variable - Variable structure without IDs
 * @param baseId - Base ID to assign (will append property keys for nested structures)
 * @returns Variable with all IDs assigned
 *
 * @example
 * ```typescript
 * const structure = {
 *   type: BaseType.OBJECT,
 *   properties: {
 *     firstName: { type: BaseType.STRING },
 *     email: { type: BaseType.EMAIL }
 *   }
 * }
 * const withIds = assignVariableIds(structure, 'list-123.result[*]')
 * // Result:
 * // {
 * //   id: 'list-123.result[*]',
 * //   type: 'object',
 * //   properties: {
 * //     firstName: { id: 'list-123.result[*].firstName', type: 'string' },
 * //     email: { id: 'list-123.result[*].email', type: 'email' }
 * //   }
 * // }
 * ```
 */
export function assignVariableIds(
  variable: Partial<UnifiedVariable>,
  baseId: string
): UnifiedVariable {
  // Create result with assigned ID
  const result: UnifiedVariable = {
    ...variable,
    id: baseId,
  } as UnifiedVariable

  // Recursively assign IDs to properties
  if (variable.properties) {
    result.properties = {}
    Object.entries(variable.properties).forEach(([key, prop]) => {
      if (prop) {
        result.properties![key] = assignVariableIds(prop, `${baseId}.${key}`)
      }
    })
  }

  // Recursively assign IDs to array items
  if (variable.items) {
    result.items = assignVariableIds(variable.items, `${baseId}[*]`)
  }

  return result
}
