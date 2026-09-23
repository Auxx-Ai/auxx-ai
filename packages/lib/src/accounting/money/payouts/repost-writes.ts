// packages/lib/src/accounting/money/payouts/repost-writes.ts

/**
 * The T26 correction: an item matched after its payout posted, so the entry's
 * `unidentified_receipts` credit is no longer what the stored match adds up to
 * (`plans/accounting/payout-links.md` §13 Q6). Reversing frees the subject claim
 * and unfreezes the members (§9.1); {@link repostStoredPayouts} books it again
 * off the new split, from stored data, so a payout past the sync's lookback is
 * not left unbooked.
 */

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { resolvePeriodLock } from '../../ledger/periods/period-lock'
import { didLedgerAccept } from '../../ledger/post/ledger-accepted'
import { reverseEntry } from '../../ledger/post/reverse-entry'
import { listPaymentGateways } from '../../rails/reads'
import { upsertWorkItem } from '../../work-items/write'
import { findPayoutByGatewayId } from './reads'
import { type RepostTarget, STALE_REVERSAL_LINK } from './repost-reads'
import { getPayoutSource } from './source-registry'
import { repostStoredPayout } from './sync'

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
  params: { organizationId: string; glPostingId: string; transferId: string; actorUserId?: string }
): Promise<StaleReversal> {
  const { organizationId, glPostingId, transferId, actorUserId } = params
  const lock = await resolvePeriodLock(organizationId)
  const reversal = await reverseEntry(db, {
    organizationId,
    glPostingId,
    actorUserId,
    lock,
    memo: 'Reversing a payout settled against items that have since been matched',
    links: [{ ...STALE_REVERSAL_LINK, sourceId: transferId }],
  })
  if (didLedgerAccept(reversal)) {
    logger.info('Reversed a stale payout posting so it can be re-posted', {
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

export interface StoredRepostSummary {
  /** Transfers whose payout now carries a fresh entry. */
  postedTransferIds: string[]
  /** Refused by the ledger or unpostable from stored data; each parked a `payout` work item. */
  refused: number
}

/**
 * Re-post each target's payout from its stored record and evidence rows.
 *
 * **Never throws.** Call it outside any transaction: every post takes the accounting commit lock.
 */
export async function repostStoredPayouts(
  db: Database,
  params: { organizationId: string; targets: readonly RepostTarget[]; actorUserId?: string }
): Promise<StoredRepostSummary> {
  const { organizationId, targets, actorUserId } = params
  const summary: StoredRepostSummary = { postedTransferIds: [], refused: 0 }
  if (!targets.length) return summary
  const gateways = await listPaymentGateways(db, organizationId)
  if (gateways.isErr()) {
    logger.error('Could not read the rails to re-post payouts', {
      organizationId,
      error: gateways.error.message,
    })
    return summary
  }
  for (const target of targets) {
    const source = getPayoutSource(target.providerKey)
    if (source.isErr()) {
      logger.error('A reversed payout has no registered source to re-post through', {
        organizationId,
        transferId: target.transferId,
        providerKey: target.providerKey,
      })
      continue
    }
    const rail = gateways.value.find((row) => row.id === target.paymentGatewayId)
    if (!rail) {
      const record = await findPayoutByGatewayId(
        db,
        organizationId,
        target.payoutExternalId,
        target.paymentGatewayId
      )
      if (record?.status === 'paid') {
        summary.refused++
        await upsertWorkItem(db, organizationId, {
          sourceKind: 'payout',
          sourceId: record.payoutId,
          stage: 'post',
          reasonCode: 'GATEWAY_UNMAPPED',
        })
      }
      continue
    }
    const result = await repostStoredPayout(db, {
      ctx: { organizationId, sourceId: source.value.id, rail, handle: null },
      providerPayoutId: target.payoutExternalId,
      actorUserId,
    })
    if (result.isErr()) continue
    const outcome = result.value
    if (outcome.status === 'posted') summary.postedTransferIds.push(target.transferId)
    else if (outcome.status === 'refused') {
      summary.refused++
      logger.warn('A reversed payout could not be re-posted', {
        organizationId,
        transferId: target.transferId,
        reason: outcome.reason,
      })
    }
  }
  return summary
}
