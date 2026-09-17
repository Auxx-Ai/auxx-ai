// packages/lib/src/postings/provider-sync/run-state-io.ts
//
// The two settings-store calls `run-state.ts` makes, isolated so the fold logic
// above them is testable without a database.
//
// 🛑 The read does NOT go through `getOrganizationSetting`. That resolves from
// the `orgSettings` org cache, which `updateOrganizationSetting` does not
// invalidate (HANDOFF §10.5) - so a read-modify-write across a continuation
// chain would fold every slice onto the same stale blob and lose all but the
// last. The blob is written after every slice, far too often to bust the cache
// on, so this reads the row directly instead.

import { database, schema } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import { updateOrganizationSetting } from '../../settings/settings-service'
import { PROVIDER_SYNC_STATE_SETTING_KEY, type ProviderSyncStateBlob } from './client'

/** The stored blob, or `{}` when this org has never run a sync. */
export async function loadProviderSyncBlob(organizationId: string): Promise<ProviderSyncStateBlob> {
  const [row] = await database
    .select({ value: schema.OrganizationSetting.value })
    .from(schema.OrganizationSetting)
    .where(
      and(
        eq(schema.OrganizationSetting.organizationId, organizationId),
        eq(schema.OrganizationSetting.key, PROVIDER_SYNC_STATE_SETTING_KEY)
      )
    )
    .limit(1)

  const value = row?.value
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as ProviderSyncStateBlob)
    : {}
}

/** Overwrite the blob. The caller has already merged; this does not read first. */
export async function saveProviderSyncBlob(
  organizationId: string,
  blob: ProviderSyncStateBlob
): Promise<void> {
  await updateOrganizationSetting({
    organizationId,
    key: PROVIDER_SYNC_STATE_SETTING_KEY,
    // Written after every slice, so busting the org cache here would fire an
    // `org.settings.changed` to every member per chunk. The read above goes to
    // the row, not the cache, precisely so it does not have to.
    skipCacheInvalidation: true,
    value: blob,
  })
}
