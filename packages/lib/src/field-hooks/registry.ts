// packages/lib/src/field-hooks/registry.ts

import type { FieldType } from '@auxx/database/types'
import type { SystemAttribute } from '@auxx/types/system-attribute'
import { registerAllHooks } from './register-hooks'
import type {
  EntityFieldChangeHandler,
  EntityPostDeleteHandler,
  EntityPreDeleteHandler,
  FieldPreHookHandler,
} from './types'

// =============================================================================
// POST-WRITE TRIGGER REGISTRIES
// =============================================================================

// NOTE: both compile-time trigger registries were removed — the manufacturing FIELD
// triggers (B2 §8) and ENTITY triggers (B2 §9) now live on the record-rules engine as
// server-declared system rules (see `field-hooks/system-record-rules.ts` +
// `field-hooks/system-entity-rules.ts`).

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

/** Post-delete entity hooks keyed by entitySlug. */
const ENTITY_POST_DELETE_HOOKS: Map<string, EntityPostDeleteHandler[]> = new Map()

/**
 * Per-entity field-change post-hooks. Keyed by entitySlug, with the sentinel
 * `'*'` reserved for handlers that fire on every field write regardless of
 * entity. Entity-scoped handlers run before global handlers in the composed
 * chain.
 */
const ENTITY_FIELD_CHANGE_HOOKS: Map<string, EntityFieldChangeHandler[]> = new Map()

/**
 * Field-type-keyed field-change post-hooks (plans/address-field/01-single-input-address-field.md
 * §5 item 2, decision #13). Deliberately separate from `ENTITY_FIELD_CHANGE_HOOKS` and its `'*'`
 * sentinel: a handler registered here fires for every field of a given `fieldType` regardless of
 * entity, WITHOUT flipping `hasEntityFieldChangeHooks` (and its oldValue pre-fetch + snapshot
 * resolution cost) on for every entity the way a `'*'`-scoped entity hook would. No `'*'`
 * sentinel of its own — register per concrete `FieldType`.
 */
const FIELD_TYPE_CHANGE_HOOKS: Map<FieldType, EntityFieldChangeHandler[]> = new Map()

// =============================================================================
// LAZY INIT
// =============================================================================

let initialized = false
function ensureInitialized(): void {
  if (initialized) return
  initialized = true
  registerAllHooks()
}

/**
 * Self-init entry point for readers OUTSIDE this registry that depend on the hook
 * bootstrap's side effects — e.g. the recordRules cache provider needs
 * `registerFieldSystemRules()`'s declarations before it computes the rule union, or a
 * fresh process whose first record-rules touch is a connector sync would cache a
 * system-rule-free union org-wide. Idempotent (one-shot latch).
 */
export function ensureHooksRegistered(): void {
  ensureInitialized()
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

/** Register post-delete handlers for an entity slug. */
export function registerEntityPostDeleteHooks(
  entitySlug: string,
  handlers: EntityPostDeleteHandler[]
): void {
  if (handlers.length === 0) return
  const existing = ENTITY_POST_DELETE_HOOKS.get(entitySlug) ?? []
  ENTITY_POST_DELETE_HOOKS.set(entitySlug, [...existing, ...handlers])
}

/** Get post-delete handlers for an entity slug. */
export function getEntityPostDeleteHooks(entitySlug: string): EntityPostDeleteHandler[] {
  ensureInitialized()
  return ENTITY_POST_DELETE_HOOKS.get(entitySlug) ?? []
}

// =============================================================================
// POST-WRITE FIELD-CHANGE HOOK ACCESSORS
// =============================================================================

/**
 * Register entity field-change handlers. Use the sentinel `'*'` for
 * `entitySlug` to register a global handler that fires on every field write
 * regardless of entity. Appends to any existing handlers.
 */
export function registerEntityFieldChangeHooks(
  entitySlug: string | '*',
  handlers: EntityFieldChangeHandler[]
): void {
  if (handlers.length === 0) return
  const existing = ENTITY_FIELD_CHANGE_HOOKS.get(entitySlug) ?? []
  ENTITY_FIELD_CHANGE_HOOKS.set(entitySlug, [...existing, ...handlers])
}

/**
 * Get the composed field-change hook chain for a given entitySlug.
 * Entity-scoped handlers run first, global (`'*'`) handlers run after.
 */
export function getEntityFieldChangeHooks(entitySlug: string): EntityFieldChangeHandler[] {
  ensureInitialized()
  const scoped = ENTITY_FIELD_CHANGE_HOOKS.get(entitySlug) ?? []
  const global = ENTITY_FIELD_CHANGE_HOOKS.get('*') ?? []
  if (scoped.length === 0) return global
  if (global.length === 0) return scoped
  return [...scoped, ...global]
}

/**
 * Cheap probe used at the fire point to skip the oldValue pre-fetch when
 * nobody is listening for this entity (and no global handler is registered).
 */
export function hasEntityFieldChangeHooks(entitySlug: string): boolean {
  ensureInitialized()
  return (
    (ENTITY_FIELD_CHANGE_HOOKS.get(entitySlug)?.length ?? 0) > 0 ||
    (ENTITY_FIELD_CHANGE_HOOKS.get('*')?.length ?? 0) > 0
  )
}

/**
 * Register field-change post-hooks keyed by `fieldType` (decision #13) — fires for every field
 * of this type on every entity, in addition to (after) that entity's own entity-scoped chain.
 * Appends to any existing handlers.
 */
export function registerFieldTypeChangeHooks(
  fieldType: FieldType,
  handlers: EntityFieldChangeHandler[]
): void {
  if (handlers.length === 0) return
  const existing = FIELD_TYPE_CHANGE_HOOKS.get(fieldType) ?? []
  FIELD_TYPE_CHANGE_HOOKS.set(fieldType, [...existing, ...handlers])
}

/** Get the field-type-keyed field-change hook chain for a given `fieldType`. */
export function getFieldTypeChangeHooks(fieldType: FieldType): EntityFieldChangeHandler[] {
  ensureInitialized()
  return FIELD_TYPE_CHANGE_HOOKS.get(fieldType) ?? []
}

/**
 * Cheap probe mirroring `hasEntityFieldChangeHooks` — used at fire points alongside it so a
 * write can skip the oldValue pre-fetch only when NEITHER the entity nor the field's type has a
 * registered handler.
 */
export function hasFieldTypeChangeHooks(fieldType: FieldType): boolean {
  ensureInitialized()
  return (FIELD_TYPE_CHANGE_HOOKS.get(fieldType)?.length ?? 0) > 0
}
