// packages/lib/src/accounting/money/payouts/repost-writes.ts

/**
 * The T26 correction: an item matched after its payout posted, so the entry's
 * `unidentified_receipts` credit is no longer what the stored match adds up to
 * (`plans/accounting/payout-links.md` §13 Q6).
 *
 * There is no re-post mechanism here and there must not be one. Reversing frees
 * the subject claim and unfreezes the members (§9.1), and the next
 * `sweepPayouts` finds no live posting and posts the payout again off the new
 * split. This file only backs the stale entry out.
 */

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { resolvePeriodLock } from '../../ledger/periods/period-lock'
import { didLedgerAccept } from '../../ledger/post/ledger-accepted'
import { reverseEntry } from '../../ledger/post/reverse-entry'

const logger = createScopedLogger('payouts:repost')

export interface StaleReversal {
  glPostingId: string
  reversed: boolean
  /** The refusal, for the `MoneyTransfer` blocker. `null` when it landed. */
  refusal: string | null
}

/**
 * Back out one stale payout posting.
 *
 * **Never throws.** A closed period is the expected refusal - a match that
 * arrives after the books are closed cannot rewrite them - and it comes back as
 * a sentence the caller puts on the `MoneyTransfer` result. The stale posting
 * stays live, the blocker stays, and re-opening the period is what clears both.
 *
 * 🛑 Call this OUTSIDE the assessment transaction. `reverseEntry` takes the
 * accounting commit lock and posts its own entry; running it inside the
 * reconcile's transaction would hold that lock across a full post and make one
 * refusal roll the whole chunk's match writes back.
 */
export async function reverseStalePayoutPosting(
  db: Database,
  params: { organizationId: string; glPostingId: string; actorUserId?: string }
): Promise<StaleReversal> {
  const { organizationId, glPostingId, actorUserId } = params
  const lock = await resolvePeriodLock(organizationId)
  const reversal = await reverseEntry(db, {
    organizationId,
    glPostingId,
    actorUserId,
    lock,
    memo: 'Reversing a payout settled against items that have since been matched',
  })
  if (didLedgerAccept(reversal)) {
    logger.info('Reversed a stale payout posting so the sweep can re-post it', {
      organizationId,
      glPostingId,
    })
    return { glPostingId, reversed: true, refusal: null }
  }
  const refusal =
    reversal.status === 'period_closed'
      ? 'An item in this payout was matched after it posted, but its period is closed, so the ' +
        'entry cannot be reversed and re-posted. Re-open the period to correct it.'
      : `An item in this payout was matched after it posted, but its entry could not be ` +
        `reversed: ${reversal.error ?? reversal.status}`
  logger.warn('Could not reverse a stale payout posting', {
    organizationId,
    glPostingId,
    status: reversal.status,
    error: reversal.error,
  })
  return { glPostingId, reversed: false, refusal }
}
