// packages/lib/src/postings/provider-sync/marker-writes.ts
//
// The only writer of `accounting.providerSyncedThrough` (brief 20 §7.3).
//
// 🛑🛑 **THE MARKER MAY ONLY EVER ADVANCE OVER A CHUNK THAT ACTUALLY
// SUCCEEDED.** Its whole job is to say what has genuinely been read, and a
// marker that ran ahead of a failed chunk lies in the one direction that
// matters: it tells the reader of a December balance sheet that December has
// been read, when the entries the accountant authored in it were refused. The
// caller (`sync.ts`) decides what "succeeded" means; this file's contribution is
// that there is exactly one door onto the key, so the decision is in one place.
//
// ⚠️ `updateOrganizationSetting` does NOT invalidate the `orgSettings` cache -
// its callers do (HANDOFF §10.5). A writer that forgets leaves every server
// reading a stale snapshot, which for this key means every statement keeps
// rendering the OLD marker after a sync that moved it. So the event is fired
// here, next to the write, rather than left to a router that may not be the only
// caller: the sync also runs from a worker.

import { createScopedLogger } from '@auxx/logger'
import type { Result } from 'neverthrow'
import { UnprocessableEntityError } from '../../errors'
import { updateOrganizationSetting } from '../../settings/settings-service'
import { PROVIDER_SYNCED_THROUGH_SETTING_KEY } from './client'
import { guard } from './guard'

const logger = createScopedLogger('postings:provider-sync')

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/**
 * Stamp how far the inbound sync has read without a refusal.
 *
 * @param through `YYYY-MM-DD`, the END of the last range read cleanly. A value
 *   in any other shape is refused rather than stored: the statement pages
 *   compare it against their own end date with a plain string compare (both
 *   sides sort lexically as they sort chronologically), and a value that is not
 *   a day key would compare as "behind everything" forever with nothing on any
 *   page able to say why.
 */
export async function recordProviderSyncedThrough(
  organizationId: string,
  through: string
): Promise<Result<void, Error>> {
  return guard(
    async () => {
      if (!DAY_PATTERN.test(through)) {
        throw new UnprocessableEntityError(
          `The provider sync marker must be a YYYY-MM-DD date, not "${through}".`,
          { organizationId, through }
        )
      }

      await updateOrganizationSetting({
        organizationId,
        key: PROVIDER_SYNCED_THROUGH_SETTING_KEY,
        value: through,
      })

      // `broadcastUserKeys: true` is load-bearing and is the same lesson brief
      // 19's fill path learned by driving (`opening-trial-balance/
      // fill-from-provider.ts:179`): the browser's settings store hydrates from
      // the per-user `userSettings` cache, which the `org.settings.changed` edge
      // reaches only when the event broadcasts to user keys. With `{ orgId }`
      // alone a full reload still shows the previous marker - which on this key
      // is a statement claiming a completeness it does not have.
      const { onCacheEvent } = await import('../../cache/invalidate')
      await onCacheEvent('org.settings.changed', { orgId: organizationId, broadcastUserKeys: true })

      logger.info('Advanced the provider sync marker', { organizationId, syncedThrough: through })
    },
    'Failed to record the provider sync marker',
    { organizationId, through }
  )
}
