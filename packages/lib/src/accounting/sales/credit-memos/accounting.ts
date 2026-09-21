// packages/lib/src/accounting/sales/credit-memos/accounting.ts

/**
 * The credit memo's ledger half: post one memo's issue entry, and reverse it.
 *
 * ```
 *   Dr revenue_returns_allowances   subtotal
 *   Dr sales_tax_payable            tax
 *       Cr accounts_receivable        total
 * ```
 *
 * Subject the memo, counterparty its contact, `storeId` the order's own source
 * account (TARGET §5). The lines come from `buildCreditMemoEntry`, which
 * `writes.ts` calls through `resolveIssue`; this file owns only the links and
 * the two primitives.
 *
 * No permission checks here. The router asserts (docs/lib-module-guide.md §6).
 */

import { type Database, schema } from '@auxx/database'
import { and, asc, eq } from 'drizzle-orm'
import { UnprocessableEntityError } from '../../../errors'
import { getOrganizationSetting } from '../../../settings/settings-service'
import { documentEntryKey } from '../../documents/document-entry-key'
import type { DocumentPosting } from '../../documents/document-ledger-state'
import {
  type BuiltCreditMemoEntry,
  buildCreditMemoEntry,
  CREDIT_MEMO_SOURCE_TYPE,
} from '../../ledger/builders/credit-memo'
import { resolvePeriodLock } from '../../ledger/periods/period-lock'
import { readAutoPostMode } from '../../ledger/post/auto-post'
import { discardDraftsForSource } from '../../ledger/post/draft-lines'
import { LEDGER_CURRENCY, postEntry } from '../../ledger/post/post-entry'
import { reverseEntry } from '../../ledger/post/reverse-entry'
import { findLiveSubjectPosting, listPostingsForSource } from '../../ledger/reads/list-postings'
import type { BuiltEntry, GlPostingSourceInput, PostResult } from '../../ledger/types'
import { readOrderSourceScope } from '../../money/customer-money/reads'
import { roundCents } from '../totals/totals'
import type { CreditMemoLineRecord, CreditMemoRecord } from './reads'

/** The org's document currency, or the ledger's when the setting is blank. */
export async function organizationCurrency(organizationId: string): Promise<string> {
  const raw = await getOrganizationSetting({ organizationId, key: 'organization.currency' })
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : LEDGER_CURRENCY
}

/** How a memo's repost key hashes when the generation marker will not fit beside its digits. */
export const CREDIT_MEMO_ENTRY_KEY_HASH = {
  prefix: 'CGN',
  label: 'credit memo repost',
} as const

export interface CreditMemoEntrySource {
  memo: CreditMemoRecord
  lines: readonly CreditMemoLineRecord[]
  /** `YYYY-MM-DD`. The accounting date the entry is dated, resolved by the door. */
  issuedAt: string
  /** The org's document currency; refused when it differs from the ledger's. */
  currency: string
  /** Whether revenue was ever posted for what this memo credits. See `resolveIssue`. */
  reverseRevenue: boolean
  /** How many times this memo has posted. 1 (the default) keys on the memo number. */
  generation?: number
}

/**
 * The entry this memo's CURRENT lines produce - pure, persists nothing.
 *
 * The one place the record shape meets the builder, so Issue, the preview and
 * the edit lane's compare-and-repost on Save cannot disagree about what a memo's
 * entry is. The totals are summed from the LINES (74 D6: the header amounts are
 * the totals hook's projection of them), never read off the header's mirrors.
 */
export function buildEntryForCreditMemo(source: CreditMemoEntrySource): BuiltCreditMemoEntry {
  const { memo, lines, issuedAt, currency, reverseRevenue } = source
  const subtotal = roundCents(lines.reduce((sum, line) => sum + line.subtotalMinor, 0))
  const taxTotal = roundCents(lines.reduce((sum, line) => sum + (line.taxTotalMinor ?? 0), 0))
  return buildCreditMemoEntry({
    creditMemoId: memo.id,
    number: memo.number,
    periodKey: documentEntryKey(memo.number, source.generation ?? 1, CREDIT_MEMO_ENTRY_KEY_HASH),
    issuedAt,
    currency,
    ledgerCurrency: LEDGER_CURRENCY,
    subtotal,
    taxTotal,
    total: subtotal + taxTotal,
    reverseRevenue,
    contactInstanceId: memo.contactInstanceId,
    memo: `Credit memo ${memo.number} issued`,
  })
}

export interface PostCreditMemoEntryInput {
  organizationId: string
  /** The `credit_memo` EntityInstance id. */
  creditMemoInstanceId: string
  /** The memo's `credit_memo_contact`, for the receivable's counterparty. */
  contactInstanceId: string | null
  /** The order the memo credits, for the store axis. Null on a native memo. */
  orderInstanceId: string | null
  entry: BuiltEntry
  actorUserId?: string
  memo?: string
}

/**
 * Post one credit memo's issue entry.
 *
 * **Never throws** - `postEntry` never does, and the caller decides whether a
 * refusal refuses the issue.
 */
export async function postCreditMemoEntry(
  db: Database,
  input: PostCreditMemoEntryInput
): Promise<PostResult> {
  const { organizationId, creditMemoInstanceId, contactInstanceId, entry, actorUserId } = input

  // Task 47 §5. A memo belongs to at most one order, so one scope covers the
  // whole entry and `revenue_returns_allowances` lands in the store's own
  // contra-revenue account when the org keeps one.
  const scope = await readOrderSourceScope(db, organizationId, input.orderInstanceId)
  const sources: GlPostingSourceInput[] = [
    { sourceKind: CREDIT_MEMO_SOURCE_TYPE, sourceId: creditMemoInstanceId, linkRole: 'subject' },
    ...(contactInstanceId
      ? [{ sourceKind: 'contact', sourceId: contactInstanceId, linkRole: 'counterparty' as const }]
      : []),
  ]
  const lock = await resolvePeriodLock(organizationId)
  return postEntry(db, {
    organizationId,
    entry,
    actorUserId,
    lock,
    memo: input.memo,
    scope,
    sources,
    storeId: typeof scope.store === 'string' ? scope.store : null,
    mode: await readAutoPostMode(organizationId, 'creditMemo'),
  })
}

/**
 * Every general-ledger entry sourced on one credit memo, newest first. A draft
 * waiting in the outbox is in the list with `status: 'draft'` through its
 * `pending` link.
 */
export async function listCreditMemoPostings(
  db: Database,
  params: { organizationId: string; creditMemoInstanceId: string }
): Promise<DocumentPosting[]> {
  const { organizationId, creditMemoInstanceId } = params
  const result = await listPostingsForSource(db, {
    organizationId,
    sourceKind: CREDIT_MEMO_SOURCE_TYPE,
    sourceId: creditMemoInstanceId,
  })
  if (result.isErr()) return []
  return result.value.map((posting) => ({
    glPostingId: posting.id,
    docNumber: posting.docNumber,
    status: posting.status,
    postingType: posting.postingType,
  }))
}

/**
 * Reverse the memo's live issue posting, freeing the claim. A draft still in the
 * outbox is discarded instead. `null` when nothing is standing - an unposted
 * memo voids freely.
 */
export async function reverseCreditMemoEntry(
  db: Database,
  input: {
    organizationId: string
    creditMemoInstanceId: string
    actorUserId?: string
    memo?: string
  }
): Promise<PostResult | null> {
  const { organizationId, creditMemoInstanceId, actorUserId, memo } = input
  const discarded = await discardDraftsForSource(db, {
    organizationId,
    sourceKind: CREDIT_MEMO_SOURCE_TYPE,
    sourceId: creditMemoInstanceId,
  })
  if (discarded.isErr()) throw new UnprocessableEntityError(discarded.error.message)
  const live = await findLiveSubjectPosting(db, {
    organizationId,
    sourceKind: CREDIT_MEMO_SOURCE_TYPE,
    sourceId: creditMemoInstanceId,
  })
  if (live.isErr()) throw new UnprocessableEntityError(live.error.message)
  if (!live.value) return null

  const lock = await resolvePeriodLock(organizationId)
  return reverseEntry(db, {
    organizationId,
    glPostingId: live.value.id,
    actorUserId,
    lock,
    memo: memo ?? `Reversal of ${live.value.docNumber} - credit memo voided`,
  })
}

/**
 * The account a memo's issue entry credited, which a refund of that memo debits
 * back. `null` when the memo never posted.
 *
 * Read off the posted lines rather than re-resolved through the chart: a refund
 * must return the credit to the account it actually landed in, even if the
 * `accounts_receivable` role has been repointed since.
 */
export async function readCreditMemoControlAccount(
  db: Database,
  input: { organizationId: string; creditMemoInstanceId: string }
): Promise<{ glPostingId: string; glAccountId: string; txnDate: string } | null> {
  const live = await findLiveSubjectPosting(db, {
    organizationId: input.organizationId,
    sourceKind: CREDIT_MEMO_SOURCE_TYPE,
    sourceId: input.creditMemoInstanceId,
  })
  if (live.isErr()) throw new UnprocessableEntityError(live.error.message)
  if (!live.value) return null

  const [line] = await db
    .select({ glAccountId: schema.GlPostingLine.glAccountId })
    .from(schema.GlPostingLine)
    .where(
      and(
        eq(schema.GlPostingLine.organizationId, input.organizationId),
        eq(schema.GlPostingLine.glPostingId, live.value.id),
        eq(schema.GlPostingLine.direction, 'credit'),
        eq(schema.GlPostingLine.counterpartyType, 'customer')
      )
    )
    .orderBy(asc(schema.GlPostingLine.lineNumber))
    .limit(1)
  if (!line) return null
  return { glPostingId: live.value.id, glAccountId: line.glAccountId, txnDate: live.value.txnDate }
}
