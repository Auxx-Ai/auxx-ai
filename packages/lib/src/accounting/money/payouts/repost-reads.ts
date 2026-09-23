// packages/lib/src/accounting/money/payouts/repost-reads.ts

import { type Database, schema } from '@auxx/database'
import { and, desc, eq, exists, gt, inArray, like, ne, notExists, or } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'

/**
 * The `parent` link the matcher's reversal carries, naming the `MoneyTransfer` it corrected.
 * A reversal without it was a person's, and is never re-booked automatically.
 */
export const STALE_REVERSAL_LINK = { sourceKind: 'money_transfer', linkRole: 'parent' } as const

/** One payout to re-post from stored data, and the feed that says which rail it settled. */
export interface RepostTarget {
  transferId: string
  payoutExternalId: string
  providerKey: string
  paymentGatewayId: string | null
}

/**
 * Of these transfers, the ones whose items a reversed payout posting named, no live posting names
 * now, and whose latest reversal was the matcher's. Keyed on the `member` rows because reversing
 * deletes the subject row but keeps them.
 */
export async function listTransfersAwaitingRepost(
  db: Database,
  organizationId: string,
  transferIds: readonly string[]
): Promise<RepostTarget[]> {
  if (!transferIds.length) return []
  const transfer = schema.MoneyTransfer
  const entry = schema.ProcessorBalanceEntry
  const link = schema.GlPostingSource
  const posting = schema.GlPosting
  const reversal = alias(schema.GlPosting, 'reversal')
  const marker = alias(schema.GlPostingSource, 'stale_marker')
  const laterEntry = alias(schema.ProcessorBalanceEntry, 'later_entry')
  const laterLink = alias(schema.GlPostingSource, 'later_link')
  const laterPosting = alias(schema.GlPosting, 'later_posting')
  const liveEntry = alias(schema.ProcessorBalanceEntry, 'live_entry')
  const liveLink = alias(schema.GlPostingSource, 'live_link')
  const livePosting = alias(schema.GlPosting, 'live_posting')

  return db
    .selectDistinct({
      transferId: transfer.id,
      payoutExternalId: transfer.externalId,
      providerKey: schema.FinancialSourceAccount.providerKey,
      paymentGatewayId: schema.FinancialSourceAccount.paymentGatewayId,
    })
    .from(transfer)
    .innerJoin(
      schema.FinancialSourceAccount,
      and(
        eq(schema.FinancialSourceAccount.organizationId, transfer.organizationId),
        eq(schema.FinancialSourceAccount.id, transfer.sourceAccountId)
      )
    )
    .innerJoin(
      entry,
      and(
        eq(entry.organizationId, transfer.organizationId),
        eq(entry.sourceAccountId, transfer.sourceAccountId),
        eq(entry.payoutExternalId, transfer.externalId)
      )
    )
    .innerJoin(
      link,
      and(
        eq(link.organizationId, entry.organizationId),
        eq(link.sourceKind, 'processor_balance_entry'),
        eq(link.linkRole, 'member'),
        eq(link.sourceId, entry.id)
      )
    )
    .innerJoin(
      posting,
      and(
        eq(posting.organizationId, link.organizationId),
        eq(posting.id, link.glPostingId),
        eq(posting.postingType, 'payout'),
        eq(posting.status, 'reversed')
      )
    )
    .innerJoin(
      reversal,
      and(eq(reversal.organizationId, posting.organizationId), eq(reversal.reversesId, posting.id))
    )
    .where(
      and(
        eq(transfer.organizationId, organizationId),
        inArray(transfer.id, [...new Set(transferIds)]),
        exists(
          db
            .select({ id: marker.id })
            .from(marker)
            .where(
              and(
                eq(marker.organizationId, reversal.organizationId),
                eq(marker.glPostingId, reversal.id),
                eq(marker.sourceKind, STALE_REVERSAL_LINK.sourceKind),
                eq(marker.linkRole, STALE_REVERSAL_LINK.linkRole),
                eq(marker.sourceId, transfer.id)
              )
            )
        ),
        // Only the latest reversed entry speaks for the payout.
        notExists(
          db
            .select({ id: laterLink.id })
            .from(laterEntry)
            .innerJoin(
              laterLink,
              and(
                eq(laterLink.organizationId, laterEntry.organizationId),
                eq(laterLink.sourceKind, 'processor_balance_entry'),
                eq(laterLink.linkRole, 'member'),
                eq(laterLink.sourceId, laterEntry.id)
              )
            )
            .innerJoin(
              laterPosting,
              and(
                eq(laterPosting.organizationId, laterLink.organizationId),
                eq(laterPosting.id, laterLink.glPostingId),
                eq(laterPosting.postingType, 'payout'),
                gt(laterPosting.createdAt, posting.createdAt)
              )
            )
            .where(
              and(
                eq(laterEntry.organizationId, transfer.organizationId),
                eq(laterEntry.sourceAccountId, transfer.sourceAccountId),
                eq(laterEntry.payoutExternalId, transfer.externalId)
              )
            )
        ),
        notExists(
          db
            .select({ id: liveLink.id })
            .from(liveEntry)
            .innerJoin(
              liveLink,
              and(
                eq(liveLink.organizationId, liveEntry.organizationId),
                eq(liveLink.sourceKind, 'processor_balance_entry'),
                eq(liveLink.linkRole, 'member'),
                eq(liveLink.sourceId, liveEntry.id)
              )
            )
            .innerJoin(
              livePosting,
              and(
                eq(livePosting.organizationId, liveLink.organizationId),
                eq(livePosting.id, liveLink.glPostingId),
                ne(livePosting.status, 'reversed')
              )
            )
            .where(
              and(
                eq(liveEntry.organizationId, transfer.organizationId),
                eq(liveEntry.sourceAccountId, transfer.sourceAccountId),
                eq(liveEntry.payoutExternalId, transfer.externalId)
              )
            )
        )
      )
    )
}

/**
 * Whether this payout's latest entry was reversed by anyone but the matcher - a person's Reverse,
 * or a provider failure - so no poster may book it again. Keyed on the payout number because a
 * payout with no evidence rows has no member links to follow.
 */
export async function isPayoutHeldReversed(
  db: Database,
  organizationId: string,
  payoutNumber: string
): Promise<boolean> {
  const posting = schema.GlPosting
  const [latest] = await db
    .select({ id: posting.id, status: posting.status })
    .from(posting)
    .where(
      and(
        eq(posting.organizationId, organizationId),
        eq(posting.postingType, 'payout'),
        eq(posting.revision, 0),
        or(eq(posting.periodKey, payoutNumber), like(posting.periodKey, `${payoutNumber}-R%`))
      )
    )
    .orderBy(desc(posting.createdAt))
    .limit(1)
  if (!latest || latest.status !== 'reversed') return false
  const reversal = alias(schema.GlPosting, 'reversal')
  const [marked] = await db
    .select({ id: schema.GlPostingSource.id })
    .from(reversal)
    .innerJoin(
      schema.GlPostingSource,
      and(
        eq(schema.GlPostingSource.organizationId, reversal.organizationId),
        eq(schema.GlPostingSource.glPostingId, reversal.id),
        eq(schema.GlPostingSource.sourceKind, STALE_REVERSAL_LINK.sourceKind),
        eq(schema.GlPostingSource.linkRole, STALE_REVERSAL_LINK.linkRole)
      )
    )
    .where(and(eq(reversal.organizationId, organizationId), eq(reversal.reversesId, latest.id)))
    .limit(1)
  return !marked
}
