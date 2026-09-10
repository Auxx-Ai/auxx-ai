// packages/lib/src/money/payouts/sync.ts

/**
 * The WRITE half of the payout sync: raise a `payout` record for each settled
 * payout the gateway reports, post its entry, and stamp the posting back.
 *
 * This is the trigger `postPayoutEntry` shipped without in #2054, which is why
 * `1200` accumulated gross at every card sale and never drained
 * (HANDOFF §11.5 item 1).
 *
 * Writes only; the reads live in `reads.ts` and `gather.ts`. No permission
 * checks - the caller is a worker job or a router that has already asserted
 * `ledgerPost`.
 *
 * ## The three properties this file exists to keep
 *
 * **A payout is posted at most once.** `payout_gateway_id` is the idempotency
 * key and is checked before anything is written, because the sync is a POLL and
 * sees every payout again on every run. A watermark alone is not enough: it can
 * be re-run, reset, or overlap a boundary, and a second posting would relieve
 * clearing twice with both entries balancing.
 *
 * **A payout still in transit gets a RECORD but no entry.** The money has not
 * reached the bank, so there is nothing for cash to be debited. The record is
 * raised anyway so the number is minted and the row is visible; the next run
 * posts it once the gateway says `paid`.
 *
 * 🛑 **The first run posts nothing older than its own start.** Payouts that
 * settled before the sync existed left a clearing balance that is already inside
 * the opening trial balance, and posting them now would relieve clearing twice
 * - the same double-count that `tasks/08` §3.6 avoids for invoices already sent.
 * `SYNC_LOOKBACK_DAYS` bounds an ordinary run; {@link syncPayouts} refuses to
 * reach further back than the org's first sync, recorded as the earliest payout
 * record it holds.
 */

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, asc, eq } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import type Stripe from 'stripe'
import { UnprocessableEntityError } from '../../errors'
import { isAccountingEnabled } from '../../postings/accounting-enabled'
import { ACCOUNT_ROLES } from '../../postings/build-entry'
import { resolvePeriodLock } from '../../postings/period-lock'
import { postPayoutEntry } from '../../postings/post-payout-entry'
import { reverseEntry } from '../../postings/reverse-entry'
import { UnifiedCrudHandler } from '../../resources/crud/unified-handler'
import { toRecordId } from '../../resources/resource-id'
import { SystemUserService } from '../../users/system-user-service'
import { getPaymentAccount } from '../payments/account-state'
import { getStripeConnectClient } from '../payments/connect-client'
import { type GatheredPayout, gatherPayout } from './gather'
import { guard } from './guard'
import { findPayoutByGatewayId, type PayoutFieldContext, requirePayoutFieldContext } from './reads'
import type { SyncPayoutsResult } from './types'

const logger = createScopedLogger('payouts:sync')

/**
 * How far back an ordinary run looks. Generous against a worker that missed a
 * day or two, and bounded so a re-run never walks an account's whole history.
 */
const SYNC_LOOKBACK_DAYS = 30

/** Stripe's page ceiling for `payouts.list`. */
const PAGE_SIZE = 100

/**
 * Walk one org's recent payouts, raising a record and posting an entry for each.
 *
 * **Never throws for one bad payout.** A builder refusal - a gateway whose
 * arithmetic does not agree, a remainder that came out negative - is collected
 * into `refused` and the walk continues, because one unpostable payout must not
 * stop the twelve behind it. Only a failure to reach the gateway or the def
 * comes back as an `err`.
 */
export async function syncPayouts(
  db: Database,
  params: { organizationId: string; actorUserId?: string; now?: Date }
): Promise<Result<SyncPayoutsResult, Error>> {
  const { organizationId, actorUserId, now = new Date() } = params

  return guard(
    async () => {
      // 🛑 Checked ONCE per org, before the Stripe account lookup, the payout
      // list and the payout record writes - none of which this sync has any
      // use for when the org has never turned accounting on (task 17 section
      // 3): a payout record exists to reconcile a clearing account this org
      // does not have. The gate lives here rather than only in
      // `postPayoutEntry` because `payoutSyncJob` runs this nightly for every
      // org with a live Stripe connection, and that is the loop the brief
      // means by "where it costs least" - skipping here also skips the Stripe
      // API call and the `payout` entity write, not just the posting.
      if (!(await isAccountingEnabled(db, organizationId))) {
        return { seen: 0, created: 0, posted: 0, alreadyPosted: 0, refused: [] }
      }

      const ctx = await requirePayoutFieldContext(organizationId)

      const account = await getPaymentAccount(organizationId)
      const stripeAccountId = account?.stripeAccountId
      if (!stripeAccountId) {
        logger.info('No connected Stripe account, nothing to sync', { organizationId })
        return { seen: 0, created: 0, posted: 0, alreadyPosted: 0, refused: [] }
      }

      // The sync runs from a worker with no signed-in person, so the writes are
      // attributed to the org's system user - the same actor
      // `seedDefaultChartOfAccounts` uses. A caller that DOES have a person
      // (the "Sync now" button) passes theirs and it wins.
      const actor = actorUserId ?? (await SystemUserService.getSystemUserForActions(organizationId))

      const since = await resolveSince(db, organizationId, ctx, now)
      const payouts = await listGatewayPayouts(stripeAccountId, since)

      const result: SyncPayoutsResult = {
        seen: payouts.length,
        created: 0,
        posted: 0,
        alreadyPosted: 0,
        refused: [],
      }

      for (const payout of payouts) {
        const outcome = await ingestOne(db, {
          organizationId,
          actorUserId: actor,
          ctx,
          stripeAccountId,
          payout,
        })
        result.created += outcome.created ? 1 : 0
        result.posted += outcome.posted ? 1 : 0
        result.alreadyPosted += outcome.alreadyPosted ? 1 : 0
        if (outcome.refusal) {
          result.refused.push({ payoutId: payout.id, reason: outcome.refusal })
        }
      }

      logger.info('Payout sync finished', {
        organizationId,
        ...result,
        refused: result.refused.length,
      })
      return result
    },
    'Failed to sync payouts',
    { organizationId }
  )
}

interface IngestOutcome {
  created: boolean
  posted: boolean
  alreadyPosted: boolean
  refusal?: string
}

/**
 * Raise (or find) the record for one payout, and post its entry when the money
 * has actually landed.
 *
 * ⚠️ **The record is created BEFORE the entry, in its own write.** The number
 * the entry keys its `periodKey` on is issued by the create hook, so there is no
 * order in which the entry could come first. A record whose posting then fails
 * is the recoverable state: the next run finds it by gateway id and posts it.
 * The reverse - an entry with no record - would be unattributable.
 */
async function ingestOne(
  db: Database,
  params: {
    organizationId: string
    actorUserId: string
    ctx: PayoutFieldContext
    stripeAccountId: string
    payout: Stripe.Payout
  }
): Promise<IngestOutcome> {
  const { organizationId, actorUserId, ctx, stripeAccountId, payout } = params

  const existing = await findPayoutByGatewayId(db, organizationId, payout.id)
  // 🛑 Already posted is a SUCCESS and a full stop. The sync is a poll; this is
  // the branch every steady-state run takes.
  if (existing?.glPostingId) {
    return { created: false, posted: false, alreadyPosted: true }
  }

  const gathered = await gatherPayout(db, { organizationId, stripeAccountId, payout })
  const crud = new UnifiedCrudHandler(organizationId, actorUserId, db)

  let instanceId = existing?.payoutId
  let created = false
  if (!instanceId) {
    const record = await crud.create(ctx.payoutDefId, payoutValues(gathered))
    instanceId = record.instance.id
    created = true
  } else {
    // A record raised while the payout was in transit: refresh the numbers,
    // which can move as the gateway settles more into the same batch.
    await crud.update(toRecordId(ctx.payoutDefId, instanceId), payoutValues(gathered))
  }

  if (gathered.gatewayStatus !== 'paid') {
    return { created, posted: false, alreadyPosted: false }
  }

  const record = await findPayoutByGatewayId(db, organizationId, payout.id)
  const number = record?.number
  if (!number) {
    // The number hook is the only writer and runs on create, so this cannot
    // happen - but the entry would key its `periodKey` on `undefined` if it did.
    return {
      created,
      posted: false,
      alreadyPosted: false,
      refusal: 'The payout record has no number, so its entry has nothing to key on',
    }
  }

  const post = await postPayoutEntry(db, {
    organizationId,
    actorUserId,
    payoutId: payout.id,
    payoutNumber: number,
    grossMinor: gathered.split.grossMinor,
    feesMinor: gathered.split.feesMinor,
    netMinor: gathered.split.netMinor,
    unrecognisedNetMinor: gathered.split.unrecognisedNetMinor,
    clearingRole: ACCOUNT_ROLES.CLEARING_CARD,
    paidAt: gathered.paidAt,
    memo: `Payout ${number}`,
  })

  if (post.status !== 'posted' && post.status !== 'already_posted') {
    return {
      created,
      posted: false,
      alreadyPosted: false,
      refusal: post.error ?? `The entry came back ${post.status}`,
    }
  }

  await crud.update(toRecordId(ctx.payoutDefId, instanceId), {
    payout_status: 'paid',
    ...(post.glPostingId ? { payout_gl_posting_id: post.glPostingId } : {}),
  })

  return {
    created,
    posted: post.status === 'posted',
    alreadyPosted: post.status === 'already_posted',
  }
}

/** The field payload a payout record carries, from one gathered payout. */
function payoutValues(gathered: GatheredPayout): Record<string, unknown> {
  return {
    payout_gateway_id: gathered.payoutId,
    payout_status: gathered.gatewayStatus === 'paid' ? 'paid' : 'in_transit',
    payout_paid_at: gathered.paidAt,
    payout_currency: gathered.currency,
    payout_deposited: gathered.depositedMinor,
    payout_gross: gathered.split.grossMinor,
    payout_fees: gathered.split.feesMinor,
    payout_net: gathered.split.netMinor,
    payout_unrecognised_net: gathered.split.unrecognisedNetMinor,
    payout_unrecognised_count: gathered.split.unrecognisedCount,
  }
}

/**
 * How far back this run reads.
 *
 * 🛑 On an org's FIRST run this is `now`, not `now - 30 days`. Payouts that
 * settled before the sync existed left a clearing balance the opening trial
 * balance already carries; posting them now would relieve clearing twice. Once
 * the org holds at least one payout record the ordinary lookback applies, so a
 * worker that missed a few days catches up.
 */
async function resolveSince(
  db: Database,
  organizationId: string,
  ctx: PayoutFieldContext,
  now: Date
): Promise<Date> {
  const [earliest] = await db
    .select({ createdAt: schema.EntityInstance.createdAt })
    .from(schema.EntityInstance)
    .where(
      and(
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityInstance.entityDefinitionId, ctx.payoutDefId)
      )
    )
    .orderBy(asc(schema.EntityInstance.createdAt))
    .limit(1)

  const lookback = new Date(now.getTime() - SYNC_LOOKBACK_DAYS * 24 * 60 * 60 * 1000)
  if (!earliest) return now
  // Never reach further back than the org's first sync, however long the
  // lookback is: everything before it is in the opening balances.
  return lookback > earliest.createdAt ? lookback : earliest.createdAt
}

/** Every payout the gateway settled since `since`, oldest first. */
async function listGatewayPayouts(stripeAccountId: string, since: Date): Promise<Stripe.Payout[]> {
  const stripe = getStripeConnectClient()
  const payouts: Stripe.Payout[] = []
  let startingAfter: string | undefined

  for (;;) {
    const page: Stripe.ApiList<Stripe.Payout> = await stripe.payouts.list(
      {
        limit: PAGE_SIZE,
        arrival_date: { gte: Math.floor(since.getTime() / 1000) },
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      },
      { stripeAccount: stripeAccountId }
    )
    payouts.push(...page.data)
    if (!page.has_more) break
    const last = page.data.at(-1)
    if (!last) break
    startingAfter = last.id
  }

  // Oldest first, so a run that is interrupted leaves the OLDER payouts posted
  // and the gap at the recent end, which is the end the next run reaches first.
  return payouts.reverse()
}

/**
 * A payout the gateway announced and then took back: reverse the entry that
 * said the money arrived, and mark the record `reversed`.
 *
 * 🛑 **Reversed, never edited and never deleted.** The entry was true when it
 * posted - the gateway said the payout was paid - and the correction is a second
 * entry that backs it out, which is the rule the whole ledger keeps. Deleting it
 * would leave the bank line matched to nothing and `1200` relieved of money that
 * came back.
 *
 * ⚠️ **The bank feed will show the reversal too**, as a debit against the same
 * account. That line is matched by the bank-review queue against the reversing
 * entry, exactly as the original was against the original.
 *
 * A no-op when the payout has no posting (it was in transit and never posted) or
 * is already `reversed` - both are ordinary states for a webhook that arrives
 * twice.
 */
export async function reverseFailedPayout(
  db: Database,
  params: { organizationId: string; gatewayPayoutId: string; actorUserId?: string }
): Promise<Result<{ reversed: boolean }, Error>> {
  const { organizationId, gatewayPayoutId, actorUserId } = params

  return guard(
    async () => {
      const ctx = await requirePayoutFieldContext(organizationId)
      const record = await findPayoutByGatewayId(db, organizationId, gatewayPayoutId)
      if (!record) {
        logger.info('A payout failed that auxx never ingested, nothing to reverse', {
          organizationId,
          gatewayPayoutId,
        })
        return { reversed: false }
      }

      const actor = actorUserId ?? (await SystemUserService.getSystemUserForActions(organizationId))
      const crud = new UnifiedCrudHandler(organizationId, actor, db)
      const recordId = toRecordId(ctx.payoutDefId, record.payoutId)

      // Never posted, so there is nothing to back out - just record the failure.
      if (!record.glPostingId || record.status === 'reversed') {
        await crud.update(recordId, { payout_status: 'failed' })
        return { reversed: false }
      }

      const lock = await resolvePeriodLock(organizationId)
      const reversal = await reverseEntry(db, {
        organizationId,
        glPostingId: record.glPostingId,
        actorUserId: actor,
        lock,
        memo: `Payout ${record.number ?? gatewayPayoutId} failed - reversing the settlement`,
      })

      if (reversal.status !== 'posted' && reversal.status !== 'already_posted') {
        // 🛑 The record is NOT flipped to `reversed` when the reversal did not
        // land. A row saying reversed over a posting that is still `posted`
        // would hide a real overstatement of cash behind a status nobody
        // re-checks. It stays `paid` and the next run tries again.
        logger.error('Could not reverse a failed payout', {
          organizationId,
          gatewayPayoutId,
          status: reversal.status,
          error: reversal.error,
        })
        throw new UnprocessableEntityError(
          `Payout ${record.number ?? gatewayPayoutId} failed at the gateway but its entry could ` +
            `not be reversed: ${reversal.error ?? reversal.status}`,
          { gatewayPayoutId }
        )
      }

      await crud.update(recordId, { payout_status: 'reversed' })
      logger.info('Reversed a failed payout', { organizationId, gatewayPayoutId })
      return { reversed: true }
    },
    'Failed to reverse a failed payout',
    { organizationId, gatewayPayoutId }
  )
}
