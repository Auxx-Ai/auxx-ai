// packages/lib/src/accounting/ledger/post/post-payout-entry.ts

/**
 * The writer for `buildPayoutEntry`. Hands the entry to `postEntry`; the accounting is all in the builder.
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
import { type BuildPayoutEntryInput, buildPayoutEntry } from '../builders/payout'
import { isAccountingActive } from '../setup/accounting-enabled'
import type { PostResult } from '../types'
import { postEntry } from './post-entry'

const logger = createScopedLogger('postings:payout')

export interface PostPayoutEntryOptions extends BuildPayoutEntryInput {
  organizationId: string
  /**
   * The `payout` record's `EntityInstance` id - the subject row's `sourceId`,
   * NOT the provider's payout id, because every `LedgerCard` looks a posting up
   * by the record's own instance id (`plans/accounting/payout-links.md` §11.5).
   */
  payoutInstanceId: string
  /**
   * The `ProcessorBalanceEntry` ids this payout's clearing credit summed; one
   * `member` row each (§5). Empty for a feed with no evidence rows.
   */
  memberEntryIds?: readonly string[]
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
 * Answers `{ status: 'not_enabled' }` silently, before the build, when accounting is not active.
 */
export async function postPayoutEntry(
  db: Database,
  options: PostPayoutEntryOptions
): Promise<PostResult> {
  const { organizationId, actorUserId, beforeCommit, payoutInstanceId, memberEntryIds, ...input } =
    options

  if (!(await isAccountingActive(organizationId))) {
    return { status: 'not_enabled' }
  }

  try {
    const built = buildPayoutEntry(input)
    const post = await postEntry(db, {
      organizationId,
      entry: built.entry,
      actorUserId,
      beforeCommit,
      memo: input.memo ?? `Payout ${built.periodKey}`,
      railId: input.rail,
      sources: [
        { sourceKind: 'payout', sourceId: payoutInstanceId, linkRole: 'subject' },
        // What the clearing credit summed, durable from here (§5). The
        // outgoing-transfer item is not one of them and the caller excludes it.
        ...(memberEntryIds ?? []).map((entryId) => ({
          sourceKind: 'processor_balance_entry',
          sourceId: entryId,
          linkRole: 'member' as const,
        })),
      ],
    })

    logger.info('Posted a payout entry', {
      organizationId,
      payoutId: input.payoutId,
      payoutInstanceId,
      members: memberEntryIds?.length ?? 0,
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
