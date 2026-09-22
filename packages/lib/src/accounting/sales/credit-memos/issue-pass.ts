// packages/lib/src/accounting/sales/credit-memos/issue-pass.ts

/**
 * Channel memos issue themselves (88 D3). A channel memo records a refund the
 * sales channel already made; there is nobody to ask. This pass issues every
 * draft channel memo that is ready through `issueCreditMemo` - the same door
 * the drawer's Issue button uses - as the org's system user, and records why
 * the ones it cannot issue are waiting (§7.4).
 *
 * No permission checks here. The router asserts (docs/lib-module-guide.md §6).
 */

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { getOrgCache } from '../../../cache'
import { AuxxError } from '../../../errors'
import { readOrganizationSettings } from '../../../settings/read'
import { POSTING_RETRY_INTERVAL_MS } from '../../money/blocked-movements'
import { listChannelMemoIssueCandidates, markCreditMemoIssueBlock } from './readiness'
import { issueCreditMemo } from './writes'

const logger = createScopedLogger('credit-memo-issue-pass')

export interface ChannelMemoPassCounts {
  scanned: number
  issued: number
  blocked: number
}

/**
 * Issue up to `limit` ready channel memos, oldest issue date first. A memo the
 * issuer refuses - not ready, an unmapped role, a locked period - is marked with
 * the refusal and held back for {@link POSTING_RETRY_INTERVAL_MS}.
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
      retryBefore: input.orderInstanceId
        ? new Date(started + 1)
        : new Date(started - POSTING_RETRY_INTERVAL_MS),
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
      await markCreditMemoIssueBlock(db, organizationId, creditMemoInstanceId, null)
      counts.issued++
    } catch (error) {
      if (!(error instanceof AuxxError)) throw error
      logger.info('A channel memo is waiting', {
        organizationId,
        creditMemoInstanceId,
        reason: error.message,
      })
      await markCreditMemoIssueBlock(db, organizationId, creditMemoInstanceId, error.message)
      counts.blocked++
    }
  }
  return counts
}
