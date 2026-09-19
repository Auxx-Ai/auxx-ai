// packages/lib/src/purchasing/vendor-credit/accounting.ts

/**
 * The vendor credit's ledger half: post one credit's issue entry, reverse it,
 * and read back the account it relieved.
 *
 * ```
 *   Dr accounts_payable                      total
 *       Cr <each line's account>               line total
 * ```
 *
 * Subject the credit, parent the bill when there is one, counterparty the
 * supplier. The lines come from `buildVendorCreditEntry`; this file owns only
 * the links and the three primitives.
 *
 * No permission checks here. The router asserts (docs/lib-module-guide.md §6).
 */

import { type Database, schema } from '@auxx/database'
import { and, asc, eq } from 'drizzle-orm'
import { VENDOR_CREDIT_SOURCE_TYPE } from '../../accounting/ledger/builders/vendor-credit'
import { resolvePeriodLock } from '../../accounting/ledger/periods/period-lock'
import { readAutoPostMode } from '../../accounting/ledger/post/auto-post'
import { postEntry } from '../../accounting/ledger/post/post-entry'
import { reverseEntry } from '../../accounting/ledger/post/reverse-entry'
import { findLiveSubjectPosting } from '../../accounting/ledger/reads/list-postings'
import type { BuiltEntry, GlPostingSourceInput, PostResult } from '../../accounting/ledger/types'
import { UnprocessableEntityError } from '../../errors'

export interface PostVendorCreditEntryInput {
  organizationId: string
  /** The `vendor_credit` EntityInstance id. */
  vendorCreditInstanceId: string
  /** The credit's `vendor_credit_vendor`, for the payable's counterparty. */
  vendorCompanyInstanceId: string | null
  /** The bill it credits, linked as the entry's parent. Null on a standalone credit. */
  vendorBillInstanceId: string | null
  entry: BuiltEntry
  actorUserId?: string
  memo?: string
}

/**
 * Post one vendor credit's issue entry.
 *
 * **Never throws** — `postEntry` never does, and the caller decides whether a
 * refusal refuses the issue.
 *
 * Auto-post reads the `expenseBill` avenue: a credit is the same buy-side
 * document lane as the bill it reverses, and no avenue was added for it
 * (71 U7, decision 2).
 */
export async function postVendorCreditEntry(
  db: Database,
  input: PostVendorCreditEntryInput
): Promise<PostResult> {
  const { organizationId, vendorCreditInstanceId, entry, actorUserId } = input

  const sources: GlPostingSourceInput[] = [
    {
      sourceKind: VENDOR_CREDIT_SOURCE_TYPE,
      sourceId: vendorCreditInstanceId,
      linkRole: 'subject',
    },
    ...(input.vendorBillInstanceId
      ? [
          {
            sourceKind: 'vendor_bill',
            sourceId: input.vendorBillInstanceId,
            linkRole: 'parent' as const,
          },
        ]
      : []),
    ...(input.vendorCompanyInstanceId
      ? [
          {
            sourceKind: 'company',
            sourceId: input.vendorCompanyInstanceId,
            linkRole: 'counterparty' as const,
          },
        ]
      : []),
  ]

  const lock = await resolvePeriodLock(organizationId)
  return postEntry(db, {
    organizationId,
    entry,
    actorUserId,
    lock,
    memo: input.memo,
    sources,
    mode: await readAutoPostMode(organizationId, 'expenseBill'),
  })
}

/**
 * Reverse the credit's live issue posting, freeing the claim. `null` when
 * nothing is standing — an unposted credit voids freely.
 */
export async function reverseVendorCreditEntry(
  db: Database,
  input: {
    organizationId: string
    vendorCreditInstanceId: string
    actorUserId?: string
    memo?: string
  }
): Promise<PostResult | null> {
  const { organizationId, vendorCreditInstanceId, actorUserId, memo } = input
  const live = await findLiveSubjectPosting(db, {
    organizationId,
    sourceKind: VENDOR_CREDIT_SOURCE_TYPE,
    sourceId: vendorCreditInstanceId,
  })
  if (live.isErr()) throw new UnprocessableEntityError(live.error.message)
  if (!live.value) return null

  const lock = await resolvePeriodLock(organizationId)
  return reverseEntry(db, {
    organizationId,
    glPostingId: live.value.id,
    actorUserId,
    lock,
    memo: memo ?? `Reversal of ${live.value.docNumber} - vendor credit voided`,
  })
}

/**
 * The account a credit's issue entry DEBITED, which a refund of that credit
 * credits back — `accounts_payable`. `null` when the credit never posted.
 *
 * `readCreditMemoControlAccount` with `direction: 'debit'` and
 * `counterpartyType: 'vendor'`: read off the posted lines rather than
 * re-resolved through the chart, so a refund returns the credit to the account
 * it actually landed in even if the role has been repointed since.
 */
export async function readVendorCreditControlAccount(
  db: Database,
  input: { organizationId: string; vendorCreditInstanceId: string }
): Promise<{ glPostingId: string; glAccountId: string; txnDate: string } | null> {
  const live = await findLiveSubjectPosting(db, {
    organizationId: input.organizationId,
    sourceKind: VENDOR_CREDIT_SOURCE_TYPE,
    sourceId: input.vendorCreditInstanceId,
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
        eq(schema.GlPostingLine.direction, 'debit'),
        eq(schema.GlPostingLine.counterpartyType, 'vendor')
      )
    )
    .orderBy(asc(schema.GlPostingLine.lineNumber))
    .limit(1)
  if (!line) return null
  return { glPostingId: live.value.id, glAccountId: line.glAccountId, txnDate: live.value.txnDate }
}
