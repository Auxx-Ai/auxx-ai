// packages/lib/src/postings/post-payout-entry.ts

/**
 * The writer for `buildPayoutEntry`. Resolves the period lock and hands the
 * entry to `postEntry`; the accounting is all in the builder.
 *
 * `money/payouts/sync.ts` is the gatherer and the trigger: it lists an org's
 * payouts, resolves the rail through the source context (task 58 §5.5) and
 * calls this function with `rail`/`currency` set. See
 * {@link payoutAccountUnmappedResult} for the shape it returns INSTEAD of
 * calling this function when a payout has no rail to resolve - no entry is
 * built and nothing is claimed.
 *
 * ⚠️ **This file resolves nothing itself and must not start.** Every leg of
 * {@link BuildPayoutEntryInput} is a role line scoped to `rail`/`currency`
 * (task 58 §5.3); which `gl_account` each role names is `resolveAccountLines`'
 * job, inside `postEntry`, not this file's.
 */

import type { Database, Transaction } from '@auxx/database'
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
  /** Source ownership is checked inside the ledger acceptance transaction. */
  beforeCommit?: (tx: Transaction) => Promise<void>
}

/**
 * The `PostResult` a payout carries when it has no rail, or its rail has no
 * `bank` row mapped for its currency (task 58 §5.4 rule 1).
 *
 * 🛑 Never reached through {@link postPayoutEntry} - the caller (`money/payouts/
 * sync.ts`) constructs this DIRECTLY and skips the call. `account_unmapped` is
 * the same status `postEntry` returns for an unresolved ROLE (`post-entry.ts`),
 * and this is the pre-build refusal for the same fact: nothing is built,
 * nothing is written.
 */
export function payoutAccountUnmappedResult(message: string): PostResult {
  return { status: 'account_unmapped', failureClass: 'configuration', error: message }
}

/**
 * Build and post one payout entry.
 *
 * **Never throws.** A builder refusal - a gateway whose gross does not equal
 * net plus fees, a withheld fee on a rail that bills separately, an over-long
 * payout id, a missing rail or currency - comes back as `{ status: 'error' }`
 * with the builder's own message, which is what `EntryBlockers` renders.
 * Everything `postEntry` can answer passes through unchanged.
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
  const { organizationId, actorUserId, beforeCommit, ...input } = options

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
      beforeCommit,
      lock,
      memo: input.memo ?? `Payout ${built.periodKey}`,
      mode: 'post',
      railId: input.rail,
      sources: [{ sourceKind: 'payout', sourceId: input.payoutId, linkRole: 'subject' }],
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
