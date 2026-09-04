// packages/lib/src/postings/post-payout-entry.ts

/**
 * The writer for `buildPayoutEntry`. Resolves the period lock and hands the
 * entry to `postEntry`; the accounting is all in the builder.
 *
 * ## ⚠️ There is still no trigger, and that is the honest state
 *
 * auxx stores no payout: there is no `payout` entity, no Stripe payout ingest,
 * no `payout.*` webhook case in `applyStripeEvent`, and no balance-transaction
 * row carrying the fee the processor withheld (`money/payments/fees.ts` is the
 * Connect APPLICATION fee, a different number - `implementation-review.md` §1
 * corrects the brief on this). So the GATHERER for this entry is still not
 * written.
 *
 * 🛑 The reason is no longer "the data cannot be reached". A 2026-09-04 survey
 * of the Stripe surface found the credentials already in place - see
 * `build-payout-entry.ts`'s scope section, which names the three things that
 * are actually missing and the one that is a product decision rather than code
 * (charges settled in a payout that auxx never posted to clearing). Do not read
 * this file as saying a gatherer is impossible; read it as saying nobody has
 * decided what the clearing account should do about money auxx did not take.
 *
 * What ships is the pure builder and this writer, so the day a payout source
 * lands the only new code is the read that fills
 * `{ payoutId, payoutNumber, gross, fees, net }`.
 */

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { type BuildPayoutEntryInput, buildPayoutEntry } from './build-payout-entry'
import { resolvePeriodLock } from './period-lock'
import { postEntry } from './post-entry'
import type { PostResult } from './types'

const logger = createScopedLogger('postings:payout')

export interface PostPayoutEntryOptions extends BuildPayoutEntryInput {
  organizationId: string
  actorUserId?: string
}

/**
 * Build and post one payout entry.
 *
 * **Never throws.** A builder refusal - a gateway whose gross does not equal
 * net plus fees, an over-long payout id, a clearing role that is not one -
 * comes back as `{ status: 'error' }` with the builder's own message, which is
 * what `EntryBlockers` renders. Everything `postEntry` can answer passes
 * through unchanged.
 */
export async function postPayoutEntry(
  db: Database,
  options: PostPayoutEntryOptions
): Promise<PostResult> {
  const { organizationId, actorUserId, ...input } = options

  try {
    const built = buildPayoutEntry(input)
    const lock = await resolvePeriodLock(organizationId)
    const post = await postEntry(db, {
      organizationId,
      entry: built.entry,
      actorUserId,
      lock,
      memo: input.memo ?? `Payout ${built.periodKey}`,
    })

    logger.info('Posted a payout entry', {
      organizationId,
      payoutId: input.payoutId,
      periodKey: built.periodKey,
      grossMinor: built.grossMinor,
      status: post.status,
    })
    return post
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.warn('Refused to build a payout entry', {
      organizationId,
      payoutId: input.payoutId,
      error: message,
    })
    return { status: 'error', failureClass: 'data', retryable: false, error: message }
  }
}
