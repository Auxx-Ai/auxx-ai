// packages/lib/src/accounting/sales/credit-memos/issue-pass.ts

/**
 * Channel memos issue themselves (88 D3). A channel memo records a refund the
 * sales channel already made; there is nobody to ask. This pass issues every
 * draft channel memo that is ready through `issueCreditMemo` - the same door
 * the drawer's Issue button uses - as the org's system user, and parks the ones
 * it cannot issue as `issue` work items.
 *
 * No permission checks here. The router asserts (docs/lib-module-guide.md §6).
 */

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { getOrgCache } from '../../../cache'
import { AuxxError } from '../../../errors'
import { readOrganizationSettings } from '../../../settings/read'
import { refusalFromError } from '../../work-items/refusal'
import { deleteWorkItem, upsertWorkItem } from '../../work-items/write'
import { listChannelMemoIssueCandidates } from './readiness'
import { issueCreditMemo } from './writes'

const logger = createScopedLogger('credit-memo-issue-pass')

const workKey = (creditMemoInstanceId: string) => ({
  sourceKind: 'credit_memo',
  sourceId: creditMemoInstanceId,
  stage: 'issue' as const,
})

export interface ChannelMemoPassCounts {
  scanned: number
  issued: number
  blocked: number
}

/**
 * Issue up to `limit` ready channel memos, oldest issue date first. A memo the
 * issuer refuses - not ready, an unmapped role, a locked period - is parked until
 * its work item is due or woken.
 */
export async function sweepChannelCreditMemos(
  db: Database,
  input: { organizationId: string; limit?: number; timeBudgetMs?: number; orderInstanceId?: string }
): Promise<ChannelMemoPassCounts> {
  const { organizationId } = input
  const started = Date.now()
  const counts: ChannelMemoPassCounts = { scanned: 0, issued: 0, blocked: 0 }
  const settings = await readOrganizationSettings(organizationId, [
    'accounting.cutoffPeriod',
  ] as const)
  const candidates = await listChannelMemoIssueCandidates(
    db,
    organizationId,
    Math.min(input.limit ?? 100, 500),
    {
      cutoffPeriod: settings['accounting.cutoffPeriod'] ?? null,
      // The continuation retries on purpose; only the scheduled pass backs off.
      includeParked: !!input.orderInstanceId,
      orderInstanceId: input.orderInstanceId,
    }
  )
  if (candidates.length === 0) return counts
  const userId = await getOrgCache().get(organizationId, 'systemUser')

  for (const creditMemoInstanceId of candidates) {
    if (input.timeBudgetMs != null && Date.now() - started >= input.timeBudgetMs) break
    counts.scanned++
    try {
      await issueCreditMemo(db, { organizationId, userId, creditMemoInstanceId })
      await deleteWorkItem(db, organizationId, workKey(creditMemoInstanceId))
      counts.issued++
    } catch (error) {
      if (!(error instanceof AuxxError)) throw error
      logger.info('A channel memo is waiting', {
        organizationId,
        creditMemoInstanceId,
        reason: error.message,
      })
      await upsertWorkItem(db, organizationId, {
        ...workKey(creditMemoInstanceId),
        ...refusalFromError(error),
      })
      counts.blocked++
    }
  }
  return counts
}
