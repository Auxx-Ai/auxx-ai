// packages/sdk/src/root/entities/define-entity.ts

import { assertValidIdentityField, type FieldDecl } from '../fields/define-field.js'

/** Entity key regex — stable owner-scoped identity key, e.g. `'orders'`. */
const ENTITY_KEY_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/

/** Cosmetic API slug regex — lowercase, collision-suffixed by the installer. */
const API_SLUG_RE = /^[a-z][a-z0-9_]*$/

/**
 * A definition an app owns end to end — declared via `defineEntity`,
 * registered on `app.entities`. Distinct from `defineFields`, which adds
 * fields to an EXISTING platform entity: `defineEntity` provisions the whole
 * def (and its fields) on install, gated by the same consent flow the
 * platform's entity-template installer already uses.
 *
 * See docs/app-fields-and-entities-guide.md.
 */
export interface EntityDecl {
  /**
   * Stable, owner-scoped identity key (e.g. `'orders'`) — becomes
   * `EntityDefinition.sourceKey`. On reinstall the platform adopts the
   * existing def by `(appInstallationId, sourceKey)` rather than creating a
   * duplicate. Never rename this after shipping — see the guide's "dev
   * reinstall after key changes" gotcha.
   */
  readonly key: string
  /** Cosmetic API slug (e.g. `'shopify_orders'`) — collision-suffixed by the
   *  installer, safe to keep stable across renames of `singular`/`plural`. */
  readonly apiSlug: string
  readonly singular: string
  readonly plural: string
  readonly description?: string
  readonly icon?: string
  readonly color?: string
  /** Field `key` shown as the record's primary display name. Must name a
   *  declared field in `fields`. */
  readonly primaryDisplayField: string
  /** Field `key` shown as a secondary display line. Must name a declared
   *  field in `fields`. */
  readonly secondaryDisplayField?: string
  /** Field `key` of a URL/FILE field wired as the def's avatar/display image.
   *  Must name a declared field in `fields`. */
  readonly avatarField?: string
  /**
   * The entity's own fields. Capabilities default to
   * `{ creatable: false, updatable: false }` at provision time (the app or
   * its connector writes them) — set `updatable: true` on a field users
   * should be able to edit.
   */
  readonly fields: readonly FieldDecl[]
}

/**
 * Declare + validate an entity an app owns end to end. Registered on
 * `app.entities: [orders, lineItems, ...]`.
 *
 * Validates: `key` / field-key shape, unique field keys, at most one
 * `identity: true` field, and that `primaryDisplayField` /
 * `secondaryDisplayField` / `avatarField` each name a declared field.
 * Relationship `{ entityKey }` targets are resolved against the app's full
 * `app.entities` list at catalog-extraction time (a single entity module
 * can't see its siblings) — an unresolved target is a build-time error, not a
 * runtime one.
 *
 * @example
 * ```ts
 * import { defineEntity } from '@auxx/sdk/entities'
 *
 * export const orders = defineEntity({
 *   key: 'orders',
 *   apiSlug: 'shopify_orders',
 *   singular: 'Shopify Order',
 *   plural: 'Shopify Orders',
 *   primaryDisplayField: 'name',
 *   fields: [
 *     { key: 'shopifyId', type: 'TEXT', name: 'Shopify Order ID', identity: true },
 *     { key: 'name', type: 'TEXT', name: 'Order Name' },
 *   ],
 * })
 * ```
 */
export function defineEntity<const E extends EntityDecl>(entity: E): E {
  if (!ENTITY_KEY_RE.test(entity.key)) {
    throw new Error(
      `defineEntity: invalid key "${entity.key}" — must match ${ENTITY_KEY_RE.source}`
    )
  }
  if (!API_SLUG_RE.test(entity.apiSlug)) {
    throw new Error(
      `defineEntity "${entity.key}": invalid apiSlug "${entity.apiSlug}" — must match ${API_SLUG_RE.source}`
    )
  }

  const fieldKeys = new Set<string>()
  let identityFieldKey: string | undefined
  for (const field of entity.fields) {
    if (!ENTITY_KEY_RE.test(field.key)) {
      throw new Error(
        `defineEntity "${entity.key}": invalid field key "${field.key}" — must match ${ENTITY_KEY_RE.source}`
      )
    }
    if (fieldKeys.has(field.key)) {
      throw new Error(`defineEntity "${entity.key}": duplicate field key "${field.key}"`)
    }
    fieldKeys.add(field.key)
    assertValidIdentityField(field)
    if (field.identity) {
      if (identityFieldKey !== undefined) {
        throw new Error(
          `defineEntity "${entity.key}": more than one identity field ("${identityFieldKey}" and "${field.key}") — at most one identity field is allowed per entity`
        )
      }
      identityFieldKey = field.key
    }
  }

  for (const [label, fieldKey] of [
    ['primaryDisplayField', entity.primaryDisplayField],
    ['secondaryDisplayField', entity.secondaryDisplayField],
    ['avatarField', entity.avatarField],
  ] as const) {
    if (fieldKey !== undefined && !fieldKeys.has(fieldKey)) {
      throw new Error(
        `defineEntity "${entity.key}": ${label} "${fieldKey}" is not a declared field`
      )
    }
  }

  return entity
}
