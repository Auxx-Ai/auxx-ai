// packages/lib/src/settings/read.ts
//
// One reader for "these keys", typed per key from the catalog's default,
// replacing the Promise.all/sequential-await fan-outs callers built around the
// single-key getter (plans/accounting/LIB-LAYOUT.md §3e).

import { type Database, database as defaultDb, schema, type Transaction } from '@auxx/database'
import { and, eq, inArray } from 'drizzle-orm'
import { SETTINGS_CATALOG, type SettingKey } from './catalog'
import type { SettingValue } from './types'

type DefaultValueOf<K extends SettingKey> = (typeof SETTINGS_CATALOG)[K]['defaultValue']

/**
 * Widen a literal primitive back to its base type — a generic key parameter
 * instantiates `defaultValue` as the catalog's literal (`false`), not `boolean`.
 */
type Widen<T> = T extends boolean
  ? boolean
  : T extends string
    ? string
    : T extends number
      ? number
      : T

/**
 * The TS type a `null`-default entry's `fieldType` actually promises once set —
 * one small map keyed on the catalog's own field, not a second per-key map.
 * Anything not listed (TAGS, SINGLE_SELECT, …) has no null-default entry today,
 * so it falls back to {@link SettingValue} rather than guessing.
 */
type ValueForFieldType<F> = F extends 'TEXT' | 'RICH_TEXT'
  ? string
  : F extends 'NUMBER' | 'CURRENCY'
    ? number
    : F extends 'CHECKBOX'
      ? boolean
      : F extends 'DATETIME'
        ? string
        : F extends 'JSON'
          ? object
          : SettingValue

/**
 * A key's value type, derived from its catalog entry. A `null` default only
 * proves the row can be unset — {@link ValueForFieldType} supplies what it
 * holds once it isn't, from the same entry's `fieldType`.
 */
export type SettingValueFor<K extends SettingKey> =
  Widen<DefaultValueOf<K>> extends null
    ? ValueForFieldType<(typeof SETTINGS_CATALOG)[K]['fieldType']> | null
    : Widen<DefaultValueOf<K>>

/** The shape {@link readOrganizationSettings} returns for a given key list. */
export type OrganizationSettingsResult<K extends readonly SettingKey[]> = {
  [P in K[number]]: SettingValueFor<P>
}

/**
 * Read a fixed set of organization settings in one shot, typed per key.
 * Without `db`, one read of the cached `orgSettings` map (catalog defaults
 * already merged in). With `db`, one `SELECT … WHERE key IN (…)`, merged over
 * catalog defaults here instead.
 *
 * Pass `db` only from inside a transaction that wrote one of these keys
 * earlier in the same transaction — every other caller should omit it and
 * take the cached path.
 */
export async function readOrganizationSettings<K extends readonly SettingKey[]>(
  organizationId: string,
  keys: K,
  db?: Database | Transaction
): Promise<OrganizationSettingsResult<K>> {
  const result = {} as Record<string, SettingValue>

  if (db) {
    const rows = await db
      .select({ key: schema.OrganizationSetting.key, value: schema.OrganizationSetting.value })
      .from(schema.OrganizationSetting)
      .where(
        and(
          eq(schema.OrganizationSetting.organizationId, organizationId),
          inArray(schema.OrganizationSetting.key, keys as readonly string[])
        )
      )
    const byKey = new Map(rows.map((row) => [row.key, row.value as SettingValue]))
    for (const key of keys) {
      const config = SETTINGS_CATALOG[key]
      if (!config) throw new Error(`Unknown setting: ${key}`)
      result[key] = byKey.has(key) ? byKey.get(key)! : config.defaultValue
    }
    return result as OrganizationSettingsResult<K>
  }

  // Dynamic import — `../cache` pulls in the org-settings cache provider, which
  // imports this package's barrel, so a static import here would cycle.
  const { getOrgCache } = await import('../cache')
  const settings = await getOrgCache().get(organizationId, 'orgSettings')
  for (const key of keys) {
    const config = SETTINGS_CATALOG[key]
    if (!config) throw new Error(`Unknown setting: ${key}`)
    result[key] = key in settings ? settings[key]! : config.defaultValue
  }
  return result as OrganizationSettingsResult<K>
}

/**
 * Every organization id currently storing `value` for `key` — a cross-org scan
 * for the rare job that needs "which orgs have this on" rather than "what is
 * this for one org" (the recording scheduler's `recording.enabled` sweep).
 * Not cached: this is a periodic job, not a per-request read, and the
 * `orgSettings` cache is keyed per org, not per setting value.
 */
export async function listOrganizationIdsBySetting(
  key: SettingKey,
  value: SettingValue,
  db: Database | Transaction = defaultDb
): Promise<string[]> {
  const rows = await db
    .select({ organizationId: schema.OrganizationSetting.organizationId })
    .from(schema.OrganizationSetting)
    .where(
      and(eq(schema.OrganizationSetting.key, key), eq(schema.OrganizationSetting.value, value))
    )
  return rows.map((row) => row.organizationId)
}
