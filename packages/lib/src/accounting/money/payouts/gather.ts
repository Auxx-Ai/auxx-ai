// packages/lib/src/accounting/money/payouts/gather.ts

/**
 * The READ half of the payout sync: what a source says one payout settled, and
 * which of it auxx has a record for.
 *
 * `sync.ts` is what writes the record and posts. Provider-neutral since brief 27
 * unit 2: the items come through the {@link PayoutSource} in hand and the
 * arithmetic is `client.ts`'s and pure.
 *
 * ## Recognition is the stored match (`plans/accounting/payout-links.md` §11.3)
 *
 * When the feed has `ProcessorBalanceEntry` rows for this payout, the split is
 * read off their `matchState` and nothing is fetched to decide it. The
 * `PayoutItem` split below it is the fallback for a feed the evidence lane has
 * never observed - Stripe Connect today - and `recognise.ts` is what answers
 * that one.
 */

import { type Database, withAccountingCommitLock } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { UnprocessableEntityError } from '../../../errors'
import {
  type PayoutSourceValue,
  type PayoutSplit,
  splitPayout,
  sumSplits,
  totalsOnlySplit,
} from './client'
import { syncStoredMatches } from './match-sync'
import { listPayoutFeedAccountIds, listPayoutMemberEntryIds } from './reads'
import { recognise } from './recognise'
import type { PayoutHeader, PayoutSource, PayoutSourceCtx } from './source'

const logger = createScopedLogger('payouts:gather')

/**
 * A payout as auxx sees it: the provider's own numbers, plus the split.
 */
export interface GatheredPayout {
  /** The provider's payout id, `po_…`. */
  payoutId: string
  /** `YYYY-MM-DD` in UTC - the date the money reached the bank. */
  paidAt: string
  /** Lowercase, as the provider reports it. */
  currency: string
  /** The WHOLE transfer that reached the bank, integer minor units. */
  depositedMinor: number
  /** The provider's own status: `paid`, `in_transit`, `failed`, `canceled`. */
  gatewayStatus: PayoutHeader['status']
  /**
   * The provider's destination hint (Stripe: the external-account id, brief 13
   * §2.3), or `null` when it reports none. Never Stripe's `last4` - see
   * `sync.ts` on why.
   */
  destination: string | null
  /** `synced` when the split came from items, `imported` when from totals (§4 rule 2). */
  source: PayoutSourceValue
  split: PayoutSplit
}

/**
 * Read one payout's items through its source and split them against the
 * records auxx holds.
 *
 * ⚠️ **`depositedMinor` is transcribed from the header, never summed from the
 * items** (§4 rule 3). Summing would silently correct the provider's
 * arithmetic, which is the one thing that makes a clearing account impossible
 * to reconcile - and it is also what the cash leg must equal for the bank line
 * to match.
 *
 * A source with `listItems` is itemised and the record says `synced`. A source
 * without it must put `totals` on the header, and the record says `imported`.
 * Neither is a refusal: the header is malformed, and that is the source's bug.
 */
export async function gatherPayout(
  db: Database,
  params: { ctx: PayoutSourceCtx; source: PayoutSource; header: PayoutHeader }
): Promise<GatheredPayout> {
  const { ctx, source, header } = params

  let split: PayoutSplit
  let recordSource: PayoutSourceValue
  let itemCount = 0
  const stored = await storedSplit(db, ctx, header.providerPayoutId)
  if (stored) {
    split = stored.split
    recordSource = 'synced'
    itemCount = stored.entryCount
  } else if (source.listItems) {
    const items = await source.listItems(ctx, header)
    const recognised = await recognise(db, ctx.organizationId, items)
    split = splitPayout(items, recognised)
    recordSource = 'synced'
    itemCount = items.length
  } else if (header.totals) {
    split = totalsOnlySplit(header.totals)
    recordSource = 'imported'
  } else {
    throw new UnprocessableEntityError(
      `Payout ${header.providerPayoutId} from the ${source.id} source carries neither items nor totals`,
      { organizationId: ctx.organizationId, payoutId: header.providerPayoutId }
    )
  }

  logger.info('Gathered a payout', {
    organizationId: ctx.organizationId,
    sourceId: source.id,
    payoutId: header.providerPayoutId,
    from: stored ? 'evidence rows' : 'provider items',
    items: itemCount,
    recognisedGrossMinor: split.grossMinor,
    unrecognisedCount: split.unrecognisedCount,
  })

  return {
    payoutId: header.providerPayoutId,
    paidAt: header.paidAt,
    currency: header.currency,
    depositedMinor: header.depositedMinor,
    gatewayStatus: header.status,
    destination: header.destinationHint ?? null,
    source: recordSource,
    split,
  }
}

/**
 * The split from this payout's stored evidence rows, or `null` when the feed has
 * none and the legacy item split is the answer.
 *
 * ⚠️ **The matcher is run inline first.** The sync and the reconcile are two
 * independent schedules (§4), so a payout can reach here with rows the drain has
 * never assessed - and reading `matchState` then would credit the whole deposit
 * to `unidentified_receipts` for a payout every item of which is matchable. One
 * `syncStoredMatches` pass over this payout costs one round of queries and makes
 * the split the same answer the drawer shows.
 *
 * 🛑 **It takes the accounting commit lock, so it must not run inside one.**
 * `ingestOne` (`sync.ts`) calls `gatherPayout` BEFORE the transaction that
 * writes the `payout` record and takes that lock; moving this call inside it
 * would deadlock nothing but would hold the org's lock across the split.
 */
async function storedSplit(
  db: Database,
  ctx: PayoutSourceCtx,
  payoutExternalId: string
): Promise<{ split: PayoutSplit; entryCount: number } | null> {
  const sourceAccountIds = await listPayoutFeedAccountIds(
    db,
    ctx.organizationId,
    ctx.sourceId,
    ctx.rail.id
  )
  if (!sourceAccountIds.length) return null
  // Cheap, unlocked: most payouts on a feed with no evidence lane answer here.
  const memberIds = await listPayoutMemberEntryIds(db, {
    organizationId: ctx.organizationId,
    sourceAccountIds,
    payoutExternalId,
  })
  if (!memberIds.length) return null

  const summaries = await db.transaction(async (tx) => {
    await withAccountingCommitLock(tx, ctx.organizationId)
    return syncStoredMatches(
      tx,
      ctx.organizationId,
      sourceAccountIds.map((sourceAccountId) => ({
        key: sourceAccountId,
        sourceAccountId,
        payoutExternalId,
      }))
    )
  })
  const values = [...summaries.values()]
  const entryCount = values.reduce((total, summary) => total + summary.entryCount, 0)
  if (!entryCount) return null
  return { split: sumSplits(values.map((summary) => summary.split)), entryCount }
}
