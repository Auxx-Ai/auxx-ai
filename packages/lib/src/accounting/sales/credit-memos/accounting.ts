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
import { CREDIT_MEMO_SOURCE_TYPE } from '../../ledger/builders/credit-memo'
import { resolvePeriodLock } from '../../ledger/periods/period-lock'
import { readAutoPostMode } from '../../ledger/post/auto-post'
import { postEntry } from '../../ledger/post/post-entry'
import { reverseEntry } from '../../ledger/post/reverse-entry'
import { findLiveSubjectPosting } from '../../ledger/reads/list-postings'
import type { BuiltEntry, GlPostingSourceInput, PostResult } from '../../ledger/types'
import { readOrderSourceScope } from '../../money/customer-money/reads'

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
 * Reverse the memo's live issue posting, freeing the claim. `null` when nothing
 * is standing - an unposted memo voids freely.
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
