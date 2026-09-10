// packages/lib/src/postings/provider-sync/marker-reads.ts
//
// How far the inbound sync has genuinely read, for one organization - the read
// half of brief 20 §7.3's "synced through" marker.
//
// 🛑 The marker is TWO facts, not one, and a reader that took only the date
// would be wrong for the most common org in the product: whether anything is
// connected at all. An org with no accounting provider must render NO marker -
// not "synced through: never", not an empty one - because a marker on an
// unconnected org is meaningless and implies a connection exists. So the
// connection is resolved here, next to the date, rather than left to six
// statement pages to remember separately.
//
// No `db` parameter, on purpose. Both halves are answered from the org cache
// (`orgSettings`) and the provider registry, and `resolvePeriodLock` in this
// same subsystem is the precedent: a read that never touches a connection has
// nothing to do with one, and taking a `db` it ignores would invite a caller to
// pass a transaction and expect write-after-read consistency it will not get.
//
// @see plans/accounting/tasks/20-two-authors-one-ledger.md §7.3

import type { Result } from 'neverthrow'
import { getOrganizationSetting } from '../../settings/settings-service'
import { NONE_PROVIDER_ID, resolveAccountingProvider } from '../provider'
import { PROVIDER_SYNCED_THROUGH_SETTING_KEY, type ProviderSyncMarker } from './client'
import { guard } from './guard'

/**
 * What the statement pages render their completeness line from.
 *
 * ⚠️ Fails SOFT, unlike `resolvePeriodLock`. A malformed stored value is
 * reported as "never synced" rather than thrown, because the consequence of
 * each reading is not symmetric here: this value gates a SENTENCE, not a
 * posting. Failing closed would take down every statement in the product over
 * a display string, and "nothing has been read yet" is the conservative
 * reading - it understates coverage, which is the safe direction for a marker
 * whose whole job is to stop a statement overstating its own completeness.
 *
 * @returns `err` only on an unreachable settings store; never on a bad value.
 */
export async function readProviderSyncMarker(
  organizationId: string
): Promise<Result<ProviderSyncMarker, Error>> {
  return guard(
    async () => {
      const provider = await resolveAccountingProvider(organizationId)
      if (provider.id === NONE_PROVIDER_ID) {
        return { connected: false, providerId: NONE_PROVIDER_ID, syncedThrough: null }
      }

      const raw = await getOrganizationSetting({
        organizationId,
        key: PROVIDER_SYNCED_THROUGH_SETTING_KEY,
      })
      const trimmed = typeof raw === 'string' ? raw.trim() : ''

      return {
        connected: true,
        providerId: provider.id,
        syncedThrough: DAY_PATTERN.test(trimmed) ? trimmed : null,
      }
    },
    'Failed to read the provider sync marker',
    { organizationId }
  )
}

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/
