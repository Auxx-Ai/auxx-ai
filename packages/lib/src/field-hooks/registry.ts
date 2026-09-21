// packages/lib/src/field-hooks/registry.ts

import { FieldTypeValues } from '@auxx/database/enums'
import type { FieldType } from '@auxx/database/types'
import type { SystemAttribute } from '@auxx/types/system-attribute'
import { registerAllHooks } from './register-hooks'
import type {
  DeriveHandler,
  DeriveOptions,
  EntityFieldChangeHandler,
  EntityPostDeleteHandler,
  EntityPreCreateHandler,
  EntityPreDeleteHandler,
  FieldPreHookHandler,
  MarkHandler,
  ReactHandler,
  RegisteredFieldChangeHook,
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

/** Pre-create entity hooks keyed by entitySlug. */
const ENTITY_PRE_CREATE_HOOKS = /* @__PURE__ */ new Map<string, EntityPreCreateHandler[]>()
/** Pre-delete entity hooks keyed by entitySlug. */
const ENTITY_PRE_DELETE_HOOKS: Map<string, EntityPreDeleteHandler[]> = new Map()

/** Post-delete entity hooks keyed by entitySlug. */
const ENTITY_POST_DELETE_HOOKS: Map<string, EntityPostDeleteHandler[]> = new Map()

/**
 * Per-entity field-change post-hooks, kinded (plans/events/10 §4.1). Keyed by entitySlug,
 * with the sentinel `'*'` reserved for handlers that fire on every field write regardless
 * of entity. Entity-scoped handlers run before global handlers in the composed chain.
 */
const ENTITY_FIELD_CHANGE_HOOKS: Map<string, RegisteredFieldChangeHook[]> = new Map()

/**
 * Field-type-keyed field-change post-hooks (plans/address-field/01 §5 item 2, decision #13).
 * Separate from `ENTITY_FIELD_CHANGE_HOOKS` and its `'*'` sentinel so a handler for every
 * ADDRESS_STRUCT field does not flip `hasEntityFieldChangeHooks` (and its oldValue pre-fetch)
 * on for every entity. No `'*'` sentinel of its own — register per concrete `FieldType`.
 */
const FIELD_TYPE_CHANGE_HOOKS: Map<FieldType, RegisteredFieldChangeHook[]> = new Map()

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

/**
 * Register pre-create handlers for an entity slug.
 *
 * The seam for anything that must refuse a create outright - a composite
 * uniqueness key, a quota, a precondition on another record. See
 * {@link EntityPreCreateEvent} for why a field pre-hook cannot do this.
 */
export function registerEntityPreCreateHooks(
  entitySlug: string,
  handlers: EntityPreCreateHandler[]
): void {
  if (handlers.length === 0) return
  const existing = ENTITY_PRE_CREATE_HOOKS.get(entitySlug) ?? []
  ENTITY_PRE_CREATE_HOOKS.set(entitySlug, [...existing, ...handlers])
}

/** Get pre-create handlers for an entity slug. */
export function getEntityPreCreateHooks(entitySlug: string): EntityPreCreateHandler[] {
  ensureInitialized()
  return ENTITY_PRE_CREATE_HOOKS.get(entitySlug) ?? []
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

/** Entity slug (or `'*'`) or a concrete `FieldType` — the two keyspaces post-hooks live in. */
export type FieldChangeHookKey = string | FieldType

// `FieldType` is a string union, so a slug and a type share one keyspace at runtime; the
// enum's values are the discriminator.
const FIELD_TYPE_KEYS: ReadonlySet<string> = new Set<string>(FieldTypeValues)

function isFieldTypeKey(key: FieldChangeHookKey): key is FieldType {
  return FIELD_TYPE_KEYS.has(key)
}

function appendHooks(key: FieldChangeHookKey, hooks: RegisteredFieldChangeHook[]): void {
  if (hooks.length === 0) return
  if (isFieldTypeKey(key)) {
    FIELD_TYPE_CHANGE_HOOKS.set(key, [...(FIELD_TYPE_CHANGE_HOOKS.get(key) ?? []), ...hooks])
    return
  }
  ENTITY_FIELD_CHANGE_HOOKS.set(key, [...(ENTITY_FIELD_CHANGE_HOOKS.get(key) ?? []), ...hooks])
}

/** Handlers that only mark a reconciler. Run on every lane, including sync from `touched` keys. */
export function registerMarkHooks(key: FieldChangeHookKey, handlers: MarkHandler[]): void {
  appendHooks(
    key,
    handlers.map((handler) => ({ kind: 'mark', handler }))
  )
}

/** Handlers that read and write. Inline and post-commit; on sync only when `options.batch` is set. */
export function registerDeriveHooks(
  key: FieldChangeHookKey,
  handlers: DeriveHandler[],
  options: DeriveOptions = {}
): void {
  appendHooks(
    key,
    handlers.map((handler) => ({ kind: 'derive', handler, options }))
  )
}

/** Consumers (rules, cache invalidation). Inline and post-commit, never on sync. */
export function registerReactHooks(key: FieldChangeHookKey, handlers: ReactHandler[]): void {
  appendHooks(
    key,
    handlers.map((handler) => ({ kind: 'react', handler }))
  )
}

/**
 * The kinded chain for an entity slug: entity-scoped first, then global (`'*'`). This is what
 * `dispatchFieldChanges` reads; the inline gate reads the adapted form below.
 */
export function getRegisteredEntityFieldChangeHooks(
  entitySlug: string
): RegisteredFieldChangeHook[] {
  ensureInitialized()
  const scoped = ENTITY_FIELD_CHANGE_HOOKS.get(entitySlug) ?? []
  const global = ENTITY_FIELD_CHANGE_HOOKS.get('*') ?? []
  if (scoped.length === 0) return global
  if (global.length === 0) return scoped
  return [...scoped, ...global]
}

/** The kinded field-type-keyed chain for a `fieldType`. */
export function getRegisteredFieldTypeChangeHooks(
  fieldType: FieldType
): RegisteredFieldChangeHook[] {
  ensureInitialized()
  return FIELD_TYPE_CHANGE_HOOKS.get(fieldType) ?? []
}

/**
 * One hook as the inline gate calls it. A mark's ref is a structural subset of the event, so
 * it runs as-is; a derive honours `skipOnCreate` here so the flag means the same on every lane.
 */
export function toEntityFieldChangeHandler(
  hook: RegisteredFieldChangeHook
): EntityFieldChangeHandler {
  if (hook.kind === 'derive' && hook.options.skipOnCreate) {
    const { handler } = hook
    return async (event) => {
      if (event.isCreate) return
      await handler(event)
    }
  }
  return hook.handler
}

/**
 * Get the composed field-change hook chain for a given entitySlug, as plain handlers in the
 * order they run. Entity-scoped handlers run first, global (`'*'`) handlers run after.
 */
export function getEntityFieldChangeHooks(entitySlug: string): EntityFieldChangeHandler[] {
  return getRegisteredEntityFieldChangeHooks(entitySlug).map(toEntityFieldChangeHandler)
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

/** Get the field-type-keyed field-change hook chain for a given `fieldType`, as plain handlers. */
export function getFieldTypeChangeHooks(fieldType: FieldType): EntityFieldChangeHandler[] {
  return getRegisteredFieldTypeChangeHooks(fieldType).map(toEntityFieldChangeHandler)
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

/** Test seam. Never call from production code. */
export function __resetFieldChangeHooksForTest(): void {
  ENTITY_FIELD_CHANGE_HOOKS.clear()
  FIELD_TYPE_CHANGE_HOOKS.clear()
}
