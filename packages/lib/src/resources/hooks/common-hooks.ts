// packages/lib/src/resources/hooks/common-hooks.ts

import type { SystemHook, SystemHookRegistry } from './types'

/**
 * Auto-populate created_by field with current user ID on create.
 * Only runs during create operations (not updates).
 */
export const autoSetCreatedBy: SystemHook = async ({ operation, field, values, userId }) => {
  // Only set on create, never on update
  if (operation !== 'create') {
    return values
  }

  // Skip if already set (shouldn't happen since isCreatable is false, but defensive)
  if (values[field.id] !== undefined) {
    return values
  }

  // Set the created_by value as an actor reference
  return {
    ...values,
    [field.id]: { type: 'actor', actorType: 'user', id: userId },
  }
}

/**
 * Common hooks that run for ALL entity types (system and custom).
 * These are keyed by systemAttribute and run regardless of entityType.
 */
export const COMMON_HOOKS: SystemHookRegistry = {
  created_by_id: [autoSetCreatedBy],
}
