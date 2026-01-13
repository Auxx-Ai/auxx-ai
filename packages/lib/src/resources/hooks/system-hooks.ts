// packages/lib/src/resources/hooks/system-hooks.ts

import { CONTACT_HOOKS } from './contact-hooks'
import type { SystemHook, SystemHookRegistry } from './types'

/**
 * Central registry of system hooks for all entity types.
 * Maps entityType (from EntityDefinition.entityType) to its hook registry.
 *
 * When adding new system entities:
 * 1. Create a new hooks file (e.g., ticket-hooks.ts)
 * 2. Define system attribute hooks in that file
 * 3. Import and register here in HOOKS_BY_ENTITY_TYPE
 *
 * Example:
 * ```typescript
 * import { TICKET_HOOKS } from './ticket-hooks'
 *
 * const HOOKS_BY_ENTITY_TYPE: Record<string, SystemHookRegistry> = {
 *   contact: CONTACT_HOOKS,
 *   ticket: TICKET_HOOKS,
 * }
 * ```
 */
const HOOKS_BY_ENTITY_TYPE: Record<string, SystemHookRegistry> = {
  contact: CONTACT_HOOKS,
  // Future system entities:
  // ticket: TICKET_HOOKS,
  // conversation: CONVERSATION_HOOKS,
}

/**
 * Get system hooks for a specific entity type.
 * Returns empty registry for entity types without hooks.
 *
 * @param entityType - The entityType from EntityDefinition (e.g., 'contact', 'ticket')
 * @returns Registry of system hooks for this entity type
 *
 * @example
 * ```typescript
 * const hooks = getSystemHooks('contact')
 * // Returns: { primary_email: [...], contact_status: [...] }
 *
 * const hooks = getSystemHooks('custom-entity')
 * // Returns: {} (no hooks for custom entities)
 * ```
 */
export function getSystemHooks(entityType: string | null): SystemHookRegistry {
  if (!entityType) return {}
  return HOOKS_BY_ENTITY_TYPE[entityType] ?? {}
}

/**
 * Get hooks for a specific system attribute within an entity type.
 * Returns empty array if no hooks are registered.
 *
 * @param entityType - The entityType from EntityDefinition
 * @param systemAttribute - The systemAttribute from CustomField (e.g., 'primary_email')
 * @returns Array of hooks for this system attribute
 *
 * @example
 * ```typescript
 * const hooks = getHooksForAttribute('contact', 'primary_email')
 * // Returns: [validateEmailFormat, normalizeEmailValue, checkEmailUniqueness]
 * ```
 */
export function getHooksForAttribute(
  entityType: string | null,
  systemAttribute: string
): SystemHook[] {
  const registry = getSystemHooks(entityType)
  return registry[systemAttribute] ?? []
}

/**
 * Check if an entity type has any system hooks registered.
 *
 * @param entityType - The entityType from EntityDefinition
 * @returns True if hooks are registered for this entity type
 */
export function hasSystemHooks(entityType: string | null): boolean {
  if (!entityType) return false
  return entityType in HOOKS_BY_ENTITY_TYPE
}
