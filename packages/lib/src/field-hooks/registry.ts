// packages/lib/src/field-hooks/registry.ts

import type { SystemAttribute } from '@auxx/types/system-attribute'
import { registerAllHooks } from './register-hooks'
import type {
  EntityPreDeleteHandler,
  EntityTriggerHandler,
  FieldPreHookHandler,
  FieldTriggerHandler,
} from './types'

// =============================================================================
// POST-WRITE TRIGGER REGISTRIES
// =============================================================================

/**
 * Field triggers — fire when a specific systemAttribute value changes.
 * Keyed by SystemAttribute for compile-time validation.
 */
export const FIELD_TRIGGERS: Partial<Record<SystemAttribute, FieldTriggerHandler[]>> = {}

/**
 * Entity triggers — fire when an entity of a specific slug is created or deleted.
 * Keyed by entity apiSlug (e.g., 'vendor-parts', 'subparts').
 */
export const ENTITY_TRIGGERS: Record<string, EntityTriggerHandler[]> = {}

// =============================================================================
// PRE-WRITE HOOK REGISTRIES
// =============================================================================

/**
 * Per-field pre-hooks scoped by `${entitySlug}:${systemAttribute}` (or
 * `*:${systemAttribute}` for cross-entity hooks). Entity-scoped hooks run
 * before global hooks in the composed chain.
 */
const FIELD_PRE_HOOKS: Map<string, FieldPreHookHandler[]> = new Map()

/** Pre-delete entity hooks keyed by entitySlug. */
const ENTITY_PRE_DELETE_HOOKS: Map<string, EntityPreDeleteHandler[]> = new Map()

// =============================================================================
// LAZY INIT
// =============================================================================

let initialized = false
function ensureInitialized(): void {
  if (initialized) return
  initialized = true
  registerAllHooks()
}

// =============================================================================
// POST-WRITE TRIGGER ACCESSORS (existing behavior)
// =============================================================================

/** Get all field trigger handlers for a given systemAttribute */
export function getFieldTriggers(systemAttribute: SystemAttribute): FieldTriggerHandler[] {
  ensureInitialized()
  return FIELD_TRIGGERS[systemAttribute] ?? []
}

/** Get all entity trigger handlers for a given entity slug */
export function getEntityTriggers(entitySlug: string): EntityTriggerHandler[] {
  ensureInitialized()
  return ENTITY_TRIGGERS[entitySlug] ?? []
}

/** Check if any field triggers are registered for a given systemAttribute */
export function hasFieldTriggers(systemAttribute: SystemAttribute): boolean {
  ensureInitialized()
  const triggers = FIELD_TRIGGERS[systemAttribute]
  return triggers !== undefined && triggers.length > 0
}

/**
 * Register field trigger handlers for a systemAttribute.
 * Appends to any existing handlers.
 */
export function registerFieldTriggers(
  systemAttribute: SystemAttribute,
  handlers: FieldTriggerHandler[]
): void {
  const existing = FIELD_TRIGGERS[systemAttribute] ?? []
  FIELD_TRIGGERS[systemAttribute] = [...existing, ...handlers]
}

/**
 * Register entity trigger handlers for an entity slug.
 * Appends to any existing handlers.
 */
export function registerEntityTriggers(entitySlug: string, handlers: EntityTriggerHandler[]): void {
  const existing = ENTITY_TRIGGERS[entitySlug] ?? []
  ENTITY_TRIGGERS[entitySlug] = [...existing, ...handlers]
}

// =============================================================================
// PRE-WRITE HOOK ACCESSORS
// =============================================================================

function preHookKey(entitySlug: string, systemAttribute: SystemAttribute): string {
  return `${entitySlug}:${systemAttribute}`
}

/**
 * Register per-field pre-hooks for `(entitySlug, systemAttribute)`. Use the
 * sentinel `'*'` for `entitySlug` to register a global (cross-entity) hook.
 * Appends to any existing handlers.
 */
export function registerFieldPreHooks(
  entitySlug: string | '*',
  systemAttribute: SystemAttribute,
  handlers: FieldPreHookHandler[]
): void {
  if (handlers.length === 0) return
  const key = preHookKey(entitySlug, systemAttribute)
  const existing = FIELD_PRE_HOOKS.get(key) ?? []
  FIELD_PRE_HOOKS.set(key, [...existing, ...handlers])
}

/**
 * Get the composed pre-hook chain for `(entitySlug, systemAttribute)`.
 * Entity-scoped handlers run first, global (`'*'`) handlers run after.
 */
export function getFieldPreHooks(
  entitySlug: string,
  systemAttribute: SystemAttribute
): FieldPreHookHandler[] {
  ensureInitialized()
  const scoped = FIELD_PRE_HOOKS.get(preHookKey(entitySlug, systemAttribute)) ?? []
  const global = FIELD_PRE_HOOKS.get(preHookKey('*', systemAttribute)) ?? []
  if (scoped.length === 0) return global
  if (global.length === 0) return scoped
  return [...scoped, ...global]
}

/**
 * Cheap probe used by the bulk path to skip hook batching when nothing is
 * registered for the (entitySlug, systemAttribute) pair.
 */
export function hasFieldPreHooks(entitySlug: string, systemAttribute: SystemAttribute): boolean {
  ensureInitialized()
  return (
    (FIELD_PRE_HOOKS.get(preHookKey(entitySlug, systemAttribute))?.length ?? 0) > 0 ||
    (FIELD_PRE_HOOKS.get(preHookKey('*', systemAttribute))?.length ?? 0) > 0
  )
}

/** Register pre-delete handlers for an entity slug. */
export function registerEntityPreDeleteHooks(
  entitySlug: string,
  handlers: EntityPreDeleteHandler[]
): void {
  if (handlers.length === 0) return
  const existing = ENTITY_PRE_DELETE_HOOKS.get(entitySlug) ?? []
  ENTITY_PRE_DELETE_HOOKS.set(entitySlug, [...existing, ...handlers])
}

/** Get pre-delete handlers for an entity slug. */
export function getEntityPreDeleteHooks(entitySlug: string): EntityPreDeleteHandler[] {
  ensureInitialized()
  return ENTITY_PRE_DELETE_HOOKS.get(entitySlug) ?? []
}
