// packages/lib/src/accounting/money/payouts/recheck.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { Result } from 'neverthrow'
import { reconcileTransferIds } from './assess-payouts'
import { guard } from './guard'
import { listTransfersWithOpenMatches } from './match-sync'
import { syncPayouts } from './sync'

const logger = createScopedLogger('payouts:recheck')

export interface RecheckPayoutMatchesResult {
  /** Payouts that held a `pending`/`suggested` item and were re-assessed. */
  payouts: number
  /** Payouts whose stored reconciliation changed. */
  changed: number
  /** Payouts this org's sync posted afterwards — re-posts of entries the re-check reversed. */
  reposted: number
}

/**
 * Re-run the matcher over one org's open processor items: the nightly
 * `payoutSyncJob`'s pending pass, for one org, on demand.
 */
export async function recheckOpenPayoutMatches(
  db: Database,
  params: { organizationId: string; actorUserId?: string }
): Promise<Result<RecheckPayoutMatchesResult, Error>> {
  const { organizationId, actorUserId } = params
  return guard(
    async () => {
      const open = await listTransfersWithOpenMatches(db, { organizationId })
      const ids = open.get(organizationId) ?? []
      if (!ids.length) return { payouts: 0, changed: 0, reposted: 0 }

      const changed = await reconcileTransferIds(db, organizationId, ids)
      if (!changed) return { payouts: ids.length, changed, reposted: 0 }

      // The reconcile reverses postings the new matches made stale; this org's sync re-posts them.
      const sync = await syncPayouts(db, { organizationId, actorUserId })
      if (sync.isErr()) {
        logger.warn('Re-post after re-check failed; the nightly sweep retries it', {
          organizationId,
          error: sync.error.message,
        })
        return { payouts: ids.length, changed, reposted: 0 }
      }
      return { payouts: ids.length, changed, reposted: sync.value.posted }
    },
    'Failed to re-check payout matches',
    { organizationId }
  )
}
