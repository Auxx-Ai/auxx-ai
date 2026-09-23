// packages/lib/src/accounting/money/payouts/recheck.ts

import type { Database } from '@auxx/database'
import type { Result } from 'neverthrow'
import { reconcileTransferIds } from './assess-payouts'
import { guard } from './guard'
import { listTransfersWithOpenMatches } from './match-sync'

export interface RecheckPayoutMatchesResult {
  /** Payouts that held a `pending`/`suggested` item and were re-assessed. */
  payouts: number
  /** Payouts whose stored reconciliation changed. */
  changed: number
  /** Payouts re-posted from stored data after the new matches reversed their entry. */
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
      const { changed, reposted } = await reconcileTransferIds(db, organizationId, ids, {
        actorUserId,
      })
      return { payouts: ids.length, changed, reposted }
    },
    'Failed to re-check payout matches',
    { organizationId }
  )
}
