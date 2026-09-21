// packages/lib/src/accounting/purchasing/vendor-credit/accounting.ts

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

import { type Database, schema, type Transaction } from '@auxx/database'
import { and, asc, eq } from 'drizzle-orm'
import { UnprocessableEntityError } from '../../../errors'
import { VENDOR_CREDIT_SOURCE_TYPE } from '../../ledger/builders/vendor-credit'
import { resolvePeriodLock } from '../../ledger/periods/period-lock'
import { readAutoPostMode } from '../../ledger/post/auto-post'
import { discardDraftsForSource } from '../../ledger/post/draft-lines'
import { type InTxPostResult, postEntry, postEntryInTx } from '../../ledger/post/post-entry'
import { reverseEntry } from '../../ledger/post/reverse-entry'
import { findLiveSubjectPosting } from '../../ledger/reads/list-postings'
import { readControlAccountLine } from '../../ledger/reads/read-posting'
import type { BuiltEntry, GlPostingSourceInput, PostResult } from '../../ledger/types'

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
  const lock = await resolvePeriodLock(input.organizationId)
  return postEntry(db, {
    ...(await vendorCreditPostOptions(input)),
    lock,
  })
}

/**
 * {@link postVendorCreditEntry} on the CALLER'S transaction, for an issue that
 * also moves stock (73 §8.2): the money entry and the `return_to_vendor` entry
 * are two halves of one supplier return and must commit together.
 *
 * Unlike `postEntry` this THROWS, so the caller's transaction rolls back with
 * it; a REFUSAL still comes back as a `PostResult`. The caller hands the
 * returned `pendingExport` to `exportPostedEntry` after the commit.
 */
export async function postVendorCreditEntryInTx(
  tx: Transaction,
  input: PostVendorCreditEntryInput
): Promise<InTxPostResult> {
  const lock = await resolvePeriodLock(input.organizationId, tx)
  return postEntryInTx(tx, { ...(await vendorCreditPostOptions(input)), lock })
}

/** The claim links and the auto-post mode both doors share. */
async function vendorCreditPostOptions(input: PostVendorCreditEntryInput) {
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

  return {
    organizationId,
    entry,
    actorUserId,
    memo: input.memo,
    sources,
    mode: await readAutoPostMode(organizationId, 'expenseBill'),
  }
}

/**
 * Reverse the credit's live issue posting, freeing the claim. A draft still in
 * the outbox is discarded instead. `null` when nothing is standing — an
 * unposted credit voids freely.
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
  const discarded = await discardDraftsForSource(db, {
    organizationId,
    sourceKind: VENDOR_CREDIT_SOURCE_TYPE,
    sourceId: vendorCreditInstanceId,
  })
  if (discarded.isErr()) throw new UnprocessableEntityError(discarded.error.message)
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

  const line = await readControlAccountLine(db, input.organizationId, {
    glPostingId: live.value.id,
    direction: 'debit',
    counterpartyType: 'vendor',
  })
  if (!line) return null
  return { glPostingId: live.value.id, glAccountId: line.glAccountId, txnDate: live.value.txnDate }
}
