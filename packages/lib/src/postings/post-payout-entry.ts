// packages/lib/src/postings/post-payout-entry.ts

/**
 * The writer for `buildPayoutEntry`. Resolves the period lock and hands the
 * entry to `postEntry`; the accounting is all in the builder.
 *
 * `money/payouts/sync.ts` is the gatherer and the trigger: it lists an org's
 * Stripe payouts, resolves each payout's destination to a confirmed
 * `bank_account` (brief 13 §2.3), and calls this function once it has a
 * `bankAccountGlAccountId` to pass in. See {@link payoutAccountUnmappedResult}
 * for the shape it returns INSTEAD of calling this function when that
 * resolution fails - no entry is built and nothing is claimed.
 */

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { isAccountingEnabled } from './accounting-enabled'
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
 * The `PostResult` a payout carries when its Stripe destination cannot be
 * resolved to a confirmed bank account (brief 13 §2.3).
 *
 * 🛑 Never reached through {@link postPayoutEntry} - the caller (`money/payouts/
 * sync.ts`) constructs this DIRECTLY and skips the call, because there is no
 * `bankAccountGlAccountId` to build with. `account_unmapped` is the same
 * status `postEntry` returns for an unresolved ROLE (`post-entry.ts`); this is
 * the closest existing status for an unresolved bank-account IDENTITY, and
 * brief 13 §2.4's DECIDED block says not to add a new one. Pre-claim, like
 * every `account_unmapped`: nothing is built, nothing is written.
 */
export function payoutAccountUnmappedResult(message: string): PostResult {
  return { status: 'account_unmapped', failureClass: 'configuration', error: message }
}

/**
 * Build and post one payout entry.
 *
 * **Never throws.** A builder refusal - a gateway whose gross does not equal
 * net plus fees, an over-long payout id, a clearing role that is not one -
 * comes back as `{ status: 'error' }` with the builder's own message, which is
 * what `EntryBlockers` renders. Everything `postEntry` can answer passes
 * through unchanged.
 *
 * Checked FIRST, before the builder: an org that has never turned accounting on
 * gets `{ status: 'not_enabled' }` with no build, no period-lock read and no
 * log line (task 17 section 3) - the same first-class silent case as
 * `not_connected`. `money/payouts/sync.ts` also short-circuits per org before
 * it ever calls this, which is where the real saving is (it skips the Stripe
 * payout list and the record write too); the check is repeated here so this
 * function is correct on its own for any future caller.
 */
export async function postPayoutEntry(
  db: Database,
  options: PostPayoutEntryOptions
): Promise<PostResult> {
  const { organizationId, actorUserId, ...input } = options

  if (!(await isAccountingEnabled(db, organizationId))) {
    return { status: 'not_enabled' }
  }

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
