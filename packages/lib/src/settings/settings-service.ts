// packages/lib/src/settings/settings-service.ts
// Functional org/user settings module (v2). Replaces the old `SettingsService`
// class — same cache + invalidation behavior, no class. See
// plans/settings/v2/README.md §Service refactor.

import { type Database, database as defaultDb, schema, type Transaction } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, inArray } from 'drizzle-orm'
import { SETTINGS_CATALOG, type SettingConfig, type SettingKey } from './catalog'
import { normalizeSettingValue } from './normalize-setting-value'
import type { SettingScope, SettingValue } from './types'

const logger = createScopedLogger('settings-service')

/**
 * The two per-org `CustomField.defaultValue` rows kept in sync with
 * `documents.invoice.defaultTiming` (money MI2 §O.2) — quote-fields.ts:263 and
 * work-order-fields.ts:485 materialize these per org at seed time.
 */
const INVOICE_TIMING_SYSTEM_ATTRIBUTES = ['quote_invoice_timing', 'work_order_invoice_timing']

/**
 * DB half of the `documents.invoice.defaultTiming` write-through (money MI2
 * §O.2, recommended variant): updates the two org `CustomField.defaultValue`
 * rows so every create door (dialog, Kopilot, API, quote→WO convert copy)
 * inherits the new default through the existing field-default machinery — no
 * create-path edits needed. Safe to run inside a transaction; call
 * {@link bustInvoiceDefaultTimingCache} after commit if this returns `true`.
 *
 * Writes `CustomField` directly rather than going through
 * `CustomFieldService.updateField()`/`updateCustomField` — both target fields
 * are `systemAttribute`-marked, and `updateCustomField`'s `isProtectedField`
 * guard (`packages/services/src/custom-fields/ownership.ts`) unconditionally
 * rejects user edits to system fields; there's no `defaultValue`-only escape
 * hatch (only `deleteField` has one, via `allowProtectedDeletion`). This
 * mirrors the entity-migration pattern (`seed/entity-migrations/helpers.ts`),
 * which also writes `CustomField` columns directly for system fields.
 */
async function writeInvoiceDefaultTimingCustomFields(params: {
  organizationId: string
  value: SettingValue
  db: Database | Transaction
}): Promise<boolean> {
  const { organizationId, value, db } = params
  if (typeof value !== 'string') return false

  const updated = await db
    .update(schema.CustomField)
    .set({ defaultValue: value, updatedAt: new Date() })
    .where(
      and(
        eq(schema.CustomField.organizationId, organizationId),
        inArray(schema.CustomField.systemAttribute, INVOICE_TIMING_SYSTEM_ATTRIBUTES)
      )
    )
    .returning({ id: schema.CustomField.id })

  return updated.length > 0
}

/**
 * Cache half of the write-through — bust the org `customFields`/`resources`
 * caches. Call once, after the DB transaction that wrote the rows commits
 * (`onCacheEvent` contract).
 */
async function bustInvoiceDefaultTimingCache(organizationId: string): Promise<void> {
  // Dynamic import — `../cache` transitively pulls in the org-settings cache
  // provider, which imports this module (see `getOrganizationSetting` above
  // for the same pattern), so a static import here would cycle.
  const { onCacheEvent } = await import('../cache/invalidate')
  await onCacheEvent('custom-field.updated', { orgId: organizationId })
}

/**
 * Single-write convenience wrapper (DB write + cache bust) for the
 * non-transactional {@link updateOrganizationSetting} path.
 */
async function applyInvoiceDefaultTimingWriteThrough(params: {
  organizationId: string
  value: SettingValue
  db: Database | Transaction
}): Promise<void> {
  const wrote = await writeInvoiceDefaultTimingCustomFields(params)
  if (wrote) await bustInvoiceDefaultTimingCache(params.organizationId)
}

/**
 * AB8's enablement stamp (plans/products/12-order-triggered-build.md §4).
 *
 * `inventory.autoBuildFromOrders` flipping ON records the moment it happened in
 * `inventory.autoBuildEnabledAt`, and the order-triggered build refuses every
 * order placed before it. Without the stamp the trigger has no way to tell an
 * order placed this morning from one back-filled out of years of Shopify
 * history, and switching the feature on would raise a build for every
 * historical order at once — the same lesson the polling backfill cutoff
 * already taught.
 *
 * Written here rather than in a form so that EVERY door that can flip the
 * boolean — the settings router, a batch save, a future onboarding step —
 * carries the stamp with it. Mirrors the `documents.invoice.defaultTiming`
 * write-through directly below it.
 *
 * 🛑 **Re-stamped on every off→on transition, not only the first.** A switch
 * turned off for three months must not reopen those three months when it comes
 * back on. Turning it OFF leaves the stamp alone — the value is only ever read
 * while the boolean is true.
 *
 * Returns `true` when it wrote, so the batch path can decide about cache busts.
 */
async function stampAutoBuildEnabledAt(params: {
  organizationId: string
  /** The stored value BEFORE this write. `undefined` when no row existed. */
  previousValue: SettingValue | undefined
  value: SettingValue
  db: Database | Transaction
}): Promise<boolean> {
  const { organizationId, previousValue, value, db } = params
  // 🛑 The TRANSITION, not the value. Stamping on every write of `true` would let
  // a settings form re-saved unchanged move the cutoff forward, silently skipping
  // every order placed since the switch was actually turned on.
  if (value !== true || previousValue === true) return false

  const stampedAt = new Date().toISOString()
  await db
    .insert(schema.OrganizationSetting)
    .values({
      organizationId,
      key: 'inventory.autoBuildEnabledAt',
      value: stampedAt,
      scope: SETTINGS_CATALOG['inventory.autoBuildEnabledAt'].scope,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [schema.OrganizationSetting.organizationId, schema.OrganizationSetting.key],
      set: { value: stampedAt, updatedAt: new Date() },
    })

  return true
}

/**
 * Get an organization setting, ignoring user overrides.
 */
export async function getOrganizationSetting(params: {
  organizationId: string
  key: SettingKey
  db?: Database | Transaction
}): Promise<SettingValue> {
  const { organizationId, key, db = defaultDb } = params

  const settingConfig = SETTINGS_CATALOG[key]
  if (!settingConfig) {
    throw new Error(`Unknown setting: ${key}`)
  }

  // Injected database (e.g. transaction) → read directly for write-after-read consistency
  if (db !== defaultDb) {
    const [orgSetting] = await db
      .select()
      .from(schema.OrganizationSetting)
      .where(
        and(
          eq(schema.OrganizationSetting.organizationId, organizationId),
          eq(schema.OrganizationSetting.key, key)
        )
      )
      .limit(1)
    return orgSetting ? (orgSetting.value as SettingValue) : settingConfig.defaultValue
  }

  // Org cache map already merges catalog defaults with persisted org rows
  const { getOrgCache } = await import('../cache')
  const settings = await getOrgCache().get(organizationId, 'orgSettings')
  return key in settings ? settings[key]! : settingConfig.defaultValue
}

/**
 * Get all organization settings, ignoring user overrides.
 */
export async function getAllOrganizationSettings(params: {
  organizationId: string
  scope?: SettingScope
  db?: Database | Transaction
}): Promise<Record<string, SettingValue>> {
  const { organizationId, scope, db = defaultDb } = params

  const orgSettings = await db
    .select()
    .from(schema.OrganizationSetting)
    .where(
      and(
        eq(schema.OrganizationSetting.organizationId, organizationId),
        ...(scope ? [eq(schema.OrganizationSetting.scope, scope as any)] : [])
      )
    )

  const result: Record<string, SettingValue> = {}

  // First, add all default values from the catalog
  for (const [key, config] of Object.entries(SETTINGS_CATALOG)) {
    if (!scope || config.scope === scope) {
      result[key] = config.defaultValue
    }
  }

  // Then override with organization settings
  for (const orgSetting of orgSettings) {
    result[orgSetting.key] = orgSetting.value as SettingValue
  }

  return result
}

/**
 * Get a setting for a user, considering organization defaults and user overrides.
 * A user override only applies when the catalog entry declares `access: 'user'`
 * — the per-org `allowUserOverride` DB column is no longer consulted. Reads
 * directly by `(userId, organizationId, key)` — no join through
 * `OrganizationSetting.id` (settings v2 re-key).
 */
export async function getUserSetting(params: {
  userId: string
  organizationId: string
  key: string
  db?: Database | Transaction
}): Promise<SettingValue> {
  const { userId, organizationId, key, db = defaultDb } = params

  const settingConfig = SETTINGS_CATALOG[key as SettingKey]
  if (!settingConfig) {
    // Return null for unknown settings instead of throwing
    logger.warn(`Unknown setting requested: ${key}`)
    return null
  }

  // Org-only setting → ignore any user override, read the org row directly.
  if (settingConfig.access !== 'user') {
    const [orgSetting] = await db
      .select()
      .from(schema.OrganizationSetting)
      .where(
        and(
          eq(schema.OrganizationSetting.organizationId, organizationId),
          eq(schema.OrganizationSetting.key, key)
        )
      )
      .limit(1)
    return orgSetting ? (orgSetting.value as SettingValue) : settingConfig.defaultValue
  }

  const [userSetting] = await db
    .select()
    .from(schema.UserSetting)
    .where(
      and(
        eq(schema.UserSetting.userId, userId),
        eq(schema.UserSetting.organizationId, organizationId),
        eq(schema.UserSetting.key, key)
      )
    )
    .limit(1)

  if (userSetting) {
    return userSetting.value as SettingValue
  }

  const [orgSetting] = await db
    .select()
    .from(schema.OrganizationSetting)
    .where(
      and(
        eq(schema.OrganizationSetting.organizationId, organizationId),
        eq(schema.OrganizationSetting.key, key)
      )
    )
    .limit(1)

  return orgSetting ? (orgSetting.value as SettingValue) : settingConfig.defaultValue
}

/**
 * Get all settings for a user, considering organization defaults and user overrides.
 * `UserSetting` rows are looked up directly by `(userId, organizationId)` — no
 * join through `OrganizationSetting.id` (settings v2 re-key).
 */
export async function getAllUserSettings(params: {
  userId: string
  organizationId: string
  scope?: SettingScope
  db?: Database | Transaction
}): Promise<Record<string, SettingValue>> {
  const { userId, organizationId, scope, db = defaultDb } = params

  const orgSettings = await db
    .select()
    .from(schema.OrganizationSetting)
    .where(
      and(
        eq(schema.OrganizationSetting.organizationId, organizationId),
        ...(scope ? [eq(schema.OrganizationSetting.scope, scope as any)] : [])
      )
    )

  const userSettings = await db
    .select()
    .from(schema.UserSetting)
    .where(
      and(
        eq(schema.UserSetting.userId, userId),
        eq(schema.UserSetting.organizationId, organizationId)
      )
    )
  const userMap = new Map(userSettings.map((us) => [us.key, us]))

  const result: Record<string, SettingValue> = {}

  // First, add all default values from the catalog
  for (const [key, config] of Object.entries(SETTINGS_CATALOG)) {
    if (!scope || config.scope === scope) {
      result[key] = config.defaultValue
    }
  }

  // Then override with organization settings and user settings where allowed
  for (const orgSetting of orgSettings) {
    const settingConfig = SETTINGS_CATALOG[orgSetting.key as SettingKey] as
      | SettingConfig
      | undefined

    if (settingConfig?.access === 'user') {
      const us = userMap.get(orgSetting.key)
      result[orgSetting.key] = us ? (us.value as SettingValue) : (orgSetting.value as SettingValue)
    } else {
      result[orgSetting.key] = orgSetting.value as SettingValue
    }
  }

  return result
}

/**
 * Update an organization setting. Validates the value against the catalog's
 * `fieldType` via {@link normalizeSettingValue} and upserts.
 */
export async function updateOrganizationSetting(params: {
  organizationId: string
  key: SettingKey
  value: SettingValue
  db?: Database | Transaction
}): Promise<void> {
  const { organizationId, key, value, db = defaultDb } = params

  const settingConfig = SETTINGS_CATALOG[key]
  if (!settingConfig) {
    throw new Error(`Unknown setting: ${key}`)
  }

  const normalizedValue = normalizeSettingValue(key, settingConfig, value)

  // Read BEFORE the upsert — the off→on transition is what AB8's stamp keys on,
  // and it is not observable from the row once the write has landed.
  const previousValue =
    key === 'inventory.autoBuildFromOrders'
      ? await readOrganizationSettingValue({ organizationId, key, db })
      : undefined

  await db
    .insert(schema.OrganizationSetting)
    .values({
      organizationId,
      key,
      value: normalizedValue,
      scope: settingConfig.scope,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [schema.OrganizationSetting.organizationId, schema.OrganizationSetting.key],
      set: { value: normalizedValue, updatedAt: new Date() },
    })

  if (key === 'documents.invoice.defaultTiming') {
    await applyInvoiceDefaultTimingWriteThrough({ organizationId, value: normalizedValue, db })
  }
  if (key === 'inventory.autoBuildFromOrders') {
    await stampAutoBuildEnabledAt({ organizationId, previousValue, value: normalizedValue, db })
  }
}

/** The raw stored value for one key, or `undefined` when the org has no row. */
async function readOrganizationSettingValue(params: {
  organizationId: string
  key: SettingKey
  db: Database | Transaction
}): Promise<SettingValue | undefined> {
  const [row] = await params.db
    .select({ value: schema.OrganizationSetting.value })
    .from(schema.OrganizationSetting)
    .where(
      and(
        eq(schema.OrganizationSetting.organizationId, params.organizationId),
        eq(schema.OrganizationSetting.key, params.key)
      )
    )
    .limit(1)
  return row ? (row.value as SettingValue) : undefined
}

/**
 * Update a user setting. Rejects keys the catalog declares `access: 'org'`.
 * Upserts directly on `(userId, organizationId, key)` — no more auto-created
 * `OrganizationSetting` row (settings v2 re-key drops the `organizationSettingId`
 * FK dance).
 */
export async function updateUserSetting(params: {
  userId: string
  organizationId: string
  key: SettingKey
  value: SettingValue
  db?: Database | Transaction
}): Promise<void> {
  const { userId, organizationId, key, value, db = defaultDb } = params

  const settingConfig = SETTINGS_CATALOG[key]
  if (!settingConfig) {
    throw new Error(`Unknown setting: ${key}`)
  }

  if (settingConfig.access !== 'user') {
    throw new Error(`Setting ${key} is organization-only and cannot be overridden by users`)
  }

  const normalizedValue = normalizeSettingValue(key, settingConfig, value)

  await db
    .insert(schema.UserSetting)
    .values({
      userId,
      organizationId,
      key,
      value: normalizedValue,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [
        schema.UserSetting.userId,
        schema.UserSetting.organizationId,
        schema.UserSetting.key,
      ],
      set: { value: normalizedValue, updatedAt: new Date() },
    })
}

/**
 * Reset a user setting to the organization default (deletes the `UserSetting` row).
 */
export async function resetUserSetting(params: {
  userId: string
  organizationId: string
  key: SettingKey
  db?: Database | Transaction
}): Promise<void> {
  const { userId, organizationId, key, db = defaultDb } = params

  await db
    .delete(schema.UserSetting)
    .where(
      and(
        eq(schema.UserSetting.userId, userId),
        eq(schema.UserSetting.organizationId, organizationId),
        eq(schema.UserSetting.key, key)
      )
    )
}

/**
 * Batch update organization settings in a single transaction.
 */
export async function batchUpdateOrganizationSettings(params: {
  organizationId: string
  settings: Array<{ key: SettingKey; value: SettingValue }>
  db?: Database | Transaction
}): Promise<void> {
  const { organizationId, settings, db = defaultDb } = params
  let touchedInvoiceDefaultTiming = false

  await db.transaction(async (tx) => {
    for (const setting of settings) {
      const { key, value } = setting

      const settingConfig = SETTINGS_CATALOG[key]
      if (!settingConfig) {
        throw new Error(`Unknown setting: ${key}`)
      }

      const normalizedValue = normalizeSettingValue(key, settingConfig, value)

      // See `updateOrganizationSetting` — read before the upsert, or the
      // transition AB8's stamp keys on is already gone.
      const previousValue =
        key === 'inventory.autoBuildFromOrders'
          ? await readOrganizationSettingValue({ organizationId, key, db: tx })
          : undefined

      await tx
        .insert(schema.OrganizationSetting)
        .values({
          organizationId,
          key,
          value: normalizedValue,
          scope: settingConfig.scope,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [schema.OrganizationSetting.organizationId, schema.OrganizationSetting.key],
          set: { value: normalizedValue, updatedAt: new Date() },
        })

      if (key === 'documents.invoice.defaultTiming') {
        const wrote = await writeInvoiceDefaultTimingCustomFields({
          organizationId,
          value: normalizedValue,
          db: tx,
        })
        if (wrote) touchedInvoiceDefaultTiming = true
      }
      if (key === 'inventory.autoBuildFromOrders') {
        await stampAutoBuildEnabledAt({
          organizationId,
          previousValue,
          value: normalizedValue,
          db: tx,
        })
      }
    }
  })

  if (touchedInvoiceDefaultTiming) await bustInvoiceDefaultTimingCache(organizationId)
}

/** One organization setting merged with its catalog metadata. */
export interface OrganizationSettingWithMetadata {
  key: SettingKey
  value: SettingValue
  /** Catalog-declared overridability — replaces the old `allowUserOverride` column read. */
  access: 'org' | 'user'
  metadata: SettingConfig
}

/**
 * Get all settings for an organization with their catalog metadata.
 */
export async function getOrganizationSettingsWithMetadata(params: {
  organizationId: string
  scope?: SettingScope
  db?: Database | Transaction
}): Promise<OrganizationSettingWithMetadata[]> {
  const { organizationId, scope, db = defaultDb } = params

  const orgSettings = await db
    .select()
    .from(schema.OrganizationSetting)
    .where(
      and(
        eq(schema.OrganizationSetting.organizationId, organizationId),
        ...(scope ? [eq(schema.OrganizationSetting.scope, scope as any)] : [])
      )
    )

  return Object.entries(SETTINGS_CATALOG)
    .filter(([, config]) => !scope || config.scope === scope)
    .map(([key, metadata]) => {
      const orgSetting = orgSettings.find((s) => s.key === key)
      return {
        key: key as SettingKey,
        value: orgSetting ? (orgSetting.value as SettingValue) : metadata.defaultValue,
        access: metadata.access,
        metadata,
      }
    })
}
