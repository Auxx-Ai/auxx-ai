// packages/lib/src/accounting/money/payouts/gather.ts

/**
 * The READ half of the payout sync: what a source says one payout settled, and
 * which of it auxx has a record for.
 *
 * Reads only - it creates no record and posts nothing. `sync.ts` is what writes.
 * Provider-neutral since brief 27 unit 2: the items come through the
 * {@link PayoutSource} in hand, recognition is `recognise.ts`'s per `ref.kind`,
 * and the arithmetic is `client.ts`'s and pure.
 */

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { UnprocessableEntityError } from '../../../errors'
import { type PayoutSourceValue, type PayoutSplit, splitPayout, totalsOnlySplit } from './client'
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
  if (source.listItems) {
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
