// packages/lib/src/accounting/sales/credit-memos/readiness.ts

/**
 * When a channel credit memo may issue (88 D2): once every receipt and every
 * live, non-zero shipment on its order dated on or before the memo holds a live
 * posting. Issuing earlier trips the timeline's posted-memo refusal on the
 * receipt, or books contra-revenue against revenue not yet in the books.
 *
 * Reads only, plus the marker write the issuing pass leaves (§7.4). No
 * permission checks (docs/lib-module-guide.md §6).
 */

import type { Database, Transaction } from '@auxx/database'
import type { SystemAttribute } from '@auxx/types/system-attribute'
import { toCalendarDay } from '@auxx/utils/calendar-day'
import { requireCachedEntityDefId } from '../../../cache'
import { createFieldValueContext } from '../../../field-values/field-value-helpers'
import { setValueWithType } from '../../../field-values/field-value-mutations'
import { toFieldType } from '../../../field-values/stored-field-type'
import { toRecordId } from '../../../resources/resource-id'
import {
  findSystemRecordIdsByValue,
  readSystemRecords,
  systemFieldMap,
  systemFields,
} from '../../../resources/system-records'
import { periodKeyForDate } from '../../ledger/periods/periods'
import { findLiveSubjectPostings, findPendingDraftPostings } from '../../ledger/reads/list-postings'
import { listOrderApplications, readMovements } from '../../money/reads'
import { isLiveFulfillment } from '../fulfillments/client'
import { readFulfillmentsForOrder } from '../fulfillments/reads'

export type ChannelMemoReadiness = { ready: true } | { ready: false; reason: string }

/** The two fields 88 §7.4 puts the pass's last refusal on. */
const MARKER_ATTRS = ['credit_memo_issue_blocked_reason', 'credit_memo_issue_blocked_at'] as const

/**
 * Is every event of the memo's order dated on or before `issuedAt` in the books?
 *
 * An event dated in or before `accounting.cutoffPeriod` is in the opening
 * balance, never the ledger, so it counts as in the books. A draft is named as
 * one - the remedy is approval - and the first thing found waiting is the
 * reason, so the marker reads as one sentence.
 */
export async function readChannelMemoReadiness(
  db: Database | Transaction,
  input: {
    organizationId: string
    orderInstanceId: string
    issuedAt: string
    bookTimeZone: string
    cutoffPeriod: string | null
  }
): Promise<ChannelMemoReadiness> {
  const { organizationId, orderInstanceId, issuedAt, bookTimeZone, cutoffPeriod } = input
  const afterCutoff = (day: string) => !cutoffPeriod || day.slice(0, 7) > cutoffPeriod

  const applications = (await listOrderApplications(db, organizationId, orderInstanceId)).filter(
    (row) => row.operation === 'apply'
  )
  const receiptIds = [...new Set(applications.map((row) => row.moneyTransactionId))]
  const receipts = await readMovements(db, organizationId, receiptIds, {
    purpose: 'customer_receipt',
  })
  const receiptsBefore = [...receipts.values()].filter((money) => {
    if (money.occurredAt === null) return false
    const day = periodKeyForDate(money.occurredAt, 'day', bookTimeZone)
    return day <= issuedAt && afterCutoff(day)
  })
  if (receiptsBefore.length) {
    const ids = receiptsBefore.map((money) => money.id)
    const posted = await findLiveSubjectPostings(db, organizationId, {
      sourceKind: 'money_transaction',
      sourceIds: ids,
    })
    const waiting = ids.filter((id) => posted.get(id)?.status !== 'posted')
    if (waiting.length) {
      const drafts = await findPendingDraftPostings(db, organizationId, {
        sourceKind: 'money_transaction',
        sourceIds: waiting,
      })
      const id = waiting[0]!
      return {
        ready: false,
        reason: drafts.has(id)
          ? `receipt ${id} is a draft awaiting approval`
          : `receipt ${id} has no posting`,
      }
    }
  }

  const shipments = (
    await readFulfillmentsForOrder(db, { organizationId, orderId: orderInstanceId })
  )
    .filter(isLiveFulfillment)
    .filter((row) => row.totalMinor !== 0)
    .filter((row) => {
      const day = toCalendarDay(row.shippedAt)
      return day !== null && day <= issuedAt && afterCutoff(day)
    })
  const unposted = shipments.filter((row) => row.glPosting === null)
  if (unposted.length) {
    const drafts = await findPendingDraftPostings(db, organizationId, {
      sourceKind: 'fulfillment',
      sourceIds: unposted.map((row) => row.id),
    })
    const first = unposted[0]!
    return {
      ready: false,
      reason: drafts.has(first.id)
        ? `shipment ${first.id} is a draft awaiting approval`
        : `shipment ${first.id} has no posting`,
    }
  }
  return { ready: true }
}

/** The window the issuing pass cuts on, read once per pass. */
export interface ChannelMemoCandidateWindow {
  /** `accounting.cutoffPeriod` (`YYYY-MM`). Memos dated on or before it are never issued here. */
  cutoffPeriod: string | null
  /** Memos refused more recently than this are held back. */
  retryBefore: Date
  /** Narrow to one order - the approval continuation's scope (88 D10). */
  orderInstanceId?: string
}

const CANDIDATE_ATTRS = [
  'credit_memo_status',
  'credit_memo_source',
  'credit_memo_order',
  'credit_memo_issued_at',
  'credit_memo_issue_blocked_at',
] as const

/**
 * Draft channel memos the pass may try, oldest issue date first. Empty, never a
 * refusal, on an org with no `credit_memo` def.
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
  return records
    .map((record) => ({
      id: record.id,
      issuedAt: toCalendarDay(record.date('credit_memo_issued_at')),
      blockedAt: record.date('credit_memo_issue_blocked_at'),
    }))
    .filter((row) => row.issuedAt !== null)
    .filter((row) => !window.cutoffPeriod || row.issuedAt!.slice(0, 7) > window.cutoffPeriod)
    .filter((row) => !row.blockedAt || new Date(row.blockedAt) <= window.retryBefore)
    .sort((a, b) => a.issuedAt!.localeCompare(b.issuedAt!) || a.id.localeCompare(b.id))
    .slice(0, limit)
    .map((row) => row.id)
}

/**
 * Record why the pass could not issue, or clear the mark once it did. No
 * `userId` on the context: the hook chain must not re-enter the totals hook.
 */
export async function markCreditMemoIssueBlock(
  db: Database,
  organizationId: string,
  creditMemoInstanceId: string,
  reason: string | null
): Promise<void> {
  const fields = await systemFieldMap<SystemAttribute>(db, organizationId, [...MARKER_ATTRS])
  const reasonField = fields.credit_memo_issue_blocked_reason
  const atField = fields.credit_memo_issue_blocked_at
  // An org that has not run migration 185 has nowhere to record this.
  if (!reasonField || !atField) return
  const defId = await requireCachedEntityDefId(organizationId, 'credit_memo')
  const recordId = toRecordId(defId, creditMemoInstanceId)
  const context = createFieldValueContext(organizationId, undefined, db)
  await setValueWithType(context, {
    recordId,
    fieldId: reasonField.id,
    fieldType: toFieldType(reasonField.type),
    value: reason === null ? null : { type: 'text', value: reason },
  })
  await setValueWithType(context, {
    recordId,
    fieldId: atField.id,
    fieldType: toFieldType(atField.type),
    value: reason === null ? null : { type: 'date', value: new Date().toISOString() },
  })
}
