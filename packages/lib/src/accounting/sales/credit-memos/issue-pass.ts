// packages/lib/src/accounting/sales/credit-memos/issue-pass.ts

/**
 * Channel memos issue themselves (88 D3). A channel memo records a refund the
 * sales channel already made; there is nobody to ask. This pass issues every
 * draft channel memo through `issueCreditMemo` - the same door the drawer's Issue
 * button uses - as the org's system user, links the refunds that arrived before
 * it (91 §4.4), and parks the ones it cannot issue as `issue` work items.
 *
 * No permission checks here. The router asserts (docs/lib-module-guide.md §6).
 */

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { toCalendarDay } from '@auxx/utils/calendar-day'
import { getOrgCache } from '../../../cache'
import { AuxxError } from '../../../errors'
import {
  findSystemRecordIdsByValue,
  readSystemRecords,
  systemFields,
} from '../../../resources/system-records'
import { readOrganizationSettings } from '../../../settings/read'
import { linkImportedRefundsToMemo } from '../../money/customer-money/ingest'
import { listParkedSourceIds } from '../../work-items/reads'
import { refusalFromError } from '../../work-items/refusal'
import { deleteWorkItem, upsertWorkItem } from '../../work-items/write'
import { issueCreditMemo } from './writes'

const logger = createScopedLogger('credit-memo-issue-pass')

const workKey = (creditMemoInstanceId: string) => ({
  sourceKind: 'credit_memo',
  sourceId: creditMemoInstanceId,
  stage: 'issue' as const,
})

/** The window the issuing pass cuts on, read once per pass. */
export interface ChannelMemoCandidateWindow {
  /** `accounting.cutoffPeriod` (`YYYY-MM`). Memos dated on or before it are never issued here. */
  cutoffPeriod: string | null
  /** Also offer memos whose work item is not due yet - the continuation retries on purpose. */
  includeParked?: boolean
  /** Narrow to one order - the approval continuation's scope (88 D10). */
  orderInstanceId?: string
}

const CANDIDATE_ATTRS = [
  'credit_memo_status',
  'credit_memo_source',
  'credit_memo_order',
  'credit_memo_issued_at',
] as const

/**
 * Draft channel memos the pass may try, oldest issue date first, less those whose
 * `issue` work item is not due. Empty, never a refusal, on an org with no `credit_memo` def.
 */
export async function listChannelMemoIssueCandidates(
  db: Database,
  organizationId: string,
  limit: number,
  window: ChannelMemoCandidateWindow
): Promise<string[]> {
  const ctx = await systemFields(db, organizationId, 'credit_memo', CANDIDATE_ATTRS)
  if (!ctx?.fields.credit_memo_status || !ctx.fields.credit_memo_source) return []
  const found = await findSystemRecordIdsByValue(db, organizationId, ctx, [
    { attribute: 'credit_memo_status', option: ['draft'] },
    { attribute: 'credit_memo_source', option: ['channel'] },
    ...(window.orderInstanceId && ctx.fields.credit_memo_order
      ? [{ attribute: 'credit_memo_order' as const, related: [window.orderInstanceId] }]
      : []),
  ])
  const ids = found.get('draft') ?? []
  if (ids.length === 0) return []
  const records = await readSystemRecords(db, organizationId, ctx, { ids })
  const parked = window.includeParked
    ? new Set<string>()
    : await listParkedSourceIds(db, organizationId, {
        sourceKind: 'credit_memo',
        stage: 'issue',
        sourceIds: ids,
      }).then((result) => (result.isOk() ? result.value : new Set<string>()))
  return records
    .map((record) => ({
      id: record.id,
      issuedAt: toCalendarDay(record.date('credit_memo_issued_at')),
    }))
    .filter((row) => row.issuedAt !== null)
    .filter((row) => !window.cutoffPeriod || row.issuedAt!.slice(0, 7) > window.cutoffPeriod)
    .filter((row) => !parked.has(row.id))
    .sort((a, b) => a.issuedAt!.localeCompare(b.issuedAt!) || a.id.localeCompare(b.id))
    .slice(0, limit)
    .map((row) => row.id)
}

export interface ChannelMemoPassCounts {
  scanned: number
  issued: number
  blocked: number
}

/**
 * Issue up to `limit` draft channel memos, oldest issue date first. A memo the
 * issuer refuses - an unmapped role, a locked period - is parked until its work
 * item is due or woken.
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
    // Refunds that arrived before this memo, whether or not it issued (91 §4.4).
    await linkImportedRefundsToMemo(db, organizationId, creditMemoInstanceId)
  }
  return counts
}
