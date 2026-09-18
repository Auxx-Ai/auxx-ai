// packages/lib/src/postings/provider-sync/run-state-io.ts
//
// The two settings-store calls `run-state.ts` makes, isolated so the fold logic
// above them is testable without a database.
//
// The read passes `database` explicitly rather than omitting it: `saveProviderSyncBlob`
// skips cache invalidation (HANDOFF §10.5), so the cache is never trustworthy for this key.

import { database } from '@auxx/database'
import { readOrganizationSettings } from '../../settings/read'
import { updateOrganizationSetting } from '../../settings/settings-service'
import { PROVIDER_SYNC_STATE_SETTING_KEY, type ProviderSyncStateBlob } from './client'

/** The stored blob, or `{}` when this org has never run a sync. */
export async function loadProviderSyncBlob(organizationId: string): Promise<ProviderSyncStateBlob> {
  const settings = await readOrganizationSettings(
    organizationId,
    [PROVIDER_SYNC_STATE_SETTING_KEY] as const,
    database
  )
  const value = settings[PROVIDER_SYNC_STATE_SETTING_KEY]
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
