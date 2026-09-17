// packages/lib/src/money/payouts/sync.ts
import { withAccountingCommitLock } from '@auxx/database'
import { flushTxWriteScope } from '../../resources/crud/tx-write-flush'
import { runInTxWrite } from '../../resources/crud/tx-write-scope'

/**
 * The WRITE half of the payout sync: raise a `payout` record for each settled
 * payout a source reports, post its entry, and stamp the posting back.
 *
 * This is the trigger `postPayoutEntry` shipped without in #2054, which is why
 * `1200` accumulated gross at every card sale and never drained
 * (HANDOFF §11.5 item 1).
 *
 * Writes only; the reads live in `reads.ts` and `gather.ts`. No permission
 * checks - the caller is a worker job or a router that has already asserted
 * `ledgerPost`.
 *
 * ## Provider-neutral since brief 27 unit 2
 *
 * Nothing in this file names Stripe. A {@link PayoutSourceCtx} carries the org,
 * the rail the source reads for and the handle it reaches its provider with;
 * the {@link PayoutSource} registered under `ctx.sourceId` lists the payouts and
 * their items; `gather.ts` splits them; this file writes. {@link syncPayouts}
 * is the org-level door (the `payout.paid` webhook, the "Sync now" button, the
 * nightly sweep): it asks every registered `api` source for the org's contexts
 * and runs each. {@link syncPayoutSource} is the door for ONE context, which is
 * what a file import hands over.
 *
 * ## The three properties this file exists to keep
 *
 * **A payout is posted at most once.** The PAIR (`payout_payment_gateway`,
 * `payout_gateway_id`) is the idempotency key (brief 27 §6.4) and is checked
 * before anything is written, because the sync is a POLL and sees every payout
 * again on every run. A watermark alone is not enough: it can be re-run, reset,
 * or overlap a boundary, and a second posting would relieve clearing twice with
 * both entries balancing. When no gateway record claims the source's rail the
 * pointer stays null and the lookup is by gateway id alone - see
 * `findPayoutByGatewayId` for why an unstamped row is adopted rather than
 * duplicated.
 *
 * **A payout still in transit gets a RECORD but no entry.** The money has not
 * reached the bank, so there is nothing for cash to be debited. The record is
 * raised anyway so the number is minted and the row is visible; the next run
 * posts it once the source says `paid`.
 *
 * 🛑 **The first run posts nothing older than its own start, per rail.** Payouts
 * that settled before the sync existed left a clearing balance that is already
 * inside the opening trial balance, and posting them now would relieve clearing
 * twice - the same double-count that `tasks/08` §3.6 avoids for invoices already
 * sent. `SYNC_LOOKBACK_DAYS` bounds an ordinary run; {@link resolveSince}
 * refuses to reach further back than the rail's first sync, and a rail that has
 * never synced starts from its hand-entered `lastSettlementAt` when it has one
 * (brief 27 §6.5).
 *
 * 🛑 **A payout debits a bank account, never a role (brief 13 §2.3).**
 * `ingestOne` resolves the payout's own destination hint against the org's
 * `bank_account` rows through a CONFIRMED `stripeExternalAccountId` identity -
 * never `last4`, which is strong evidence and not proof. Until a person
 * confirms that identity on exactly one bank account, the payout is raised
 * (so its number is minted and it is visible) but its entry refuses to post:
 * `payout_blocked_reason` names the payout, the destination and the remedy,
 * and `postPayoutEntry` is never even called - see `resolvePayoutBankAccount`.
 * A source that reports NO destination blocks the same way: the rail record
 * carries no bank-account field yet (27 §6.3, decision 3 owed), so there is
 * nothing else to resolve against.
 *
 * 🛑 **And it credits a clearing account, never a role (brief 26 §3).** The same
 * argument one leg over. The rail is IN the context: `resolvePayoutRail`
 * (`routing.ts`) passes its clearing account, its fee account and its fee
 * treatment down; NO record is the ordinary fallback to the roles, and TWO is a
 * refusal stamped the same way a bad destination is. Line 266 used to read
 * `clearingRole: ACCOUNT_ROLES.CLEARING` unconditionally, which meant the
 * fulfillment debit (id-routed since brief 13 §5.3) and the payout credit
 * stopped meeting the moment any rail was routed to its own account - in
 * balanced entries nothing complains about.
 *
 * **And it leaves a watermark on the rail (brief 27 §6.5).** After an entry
 * posts, the rail's `lastSettlementAt` is advanced to the payout's paid-at date
 * when that is later - the field used to be hand-entered and nothing derived it.
 * Informational; a failure to stamp it is logged and never fails the payout.
 */

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, asc, eq, isNull, or, type SQL } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { Result } from 'neverthrow'
import { UnprocessableEntityError } from '../../errors'
import { PAYMENT_GATEWAY_SETTLEMENT_SOURCE_LABELS } from '../../payment-gateways/client'
import { listPaymentGateways } from '../../payment-gateways/reads'
import { stampPaymentGatewayLastSettlement } from '../../payment-gateways/writes'
import { isAccountingEnabled } from '../../postings/accounting-enabled'
import { ACCOUNT_ROLES } from '../../postings/build-entry'
import { didLedgerAccept } from '../../postings/ledger-accepted'
import { resolvePeriodLock } from '../../postings/period-lock'
import { payoutAccountUnmappedResult, postPayoutEntry } from '../../postings/post-payout-entry'
import { reverseEntry } from '../../postings/reverse-entry'
import type { PostResult } from '../../postings/types'
import { UnifiedCrudHandler } from '../../resources/crud/unified-handler'
import { toRecordId } from '../../resources/resource-id'
import { SystemUserService } from '../../users/system-user-service'
import { type GatheredPayout, gatherPayout } from './gather'
import { guard } from './guard'
import { assertLegacyPayoutIngestionOwner } from './ingestion-owner'
import {
  findBankAccountByStripeExternalAccountId,
  findPayoutByGatewayId,
  type PayoutFieldContext,
  requirePayoutFieldContext,
} from './reads'
import { resolvePayoutRail } from './routing'
import type { PayoutHeader, PayoutSource, PayoutSourceCtx } from './source'
import { getPayoutSource, listPayoutSources } from './source-registry'
import type { SyncPayoutsResult } from './types'

const logger = createScopedLogger('payouts:sync')

/**
 * How far back an ordinary run looks. Generous against a worker that missed a
 * day or two, and bounded so a re-run never walks an account's whole history.
 */
const SYNC_LOOKBACK_DAYS = 30

/** What every door shares once the org's gate and def are settled. */
interface RunParams {
  actorUserId: string
  fieldCtx: PayoutFieldContext
  now: Date
}

/**
 * Walk one org's recent payouts on every registered `api` source, raising a
 * record and posting an entry for each.
 *
 * **Never throws for one bad payout, and one rail's failure never stops the
 * others.** A builder refusal - a gateway whose arithmetic does not agree, a
 * remainder that came out negative - is collected into `refused` and the walk
 * continues, because one unpostable payout must not stop the twelve behind it.
 * A source that cannot be reached at all lands in `failed`, named by rail, and
 * the next source still runs. Only a failure to read the org's own def or
 * records comes back as an `err`.
 */
export async function syncPayouts(
  db: Database,
  params: { organizationId: string; actorUserId?: string; now?: Date }
): Promise<Result<SyncPayoutsResult, Error>> {
  const { organizationId, actorUserId, now = new Date() } = params

  return guard(
    async () => {
      // 🛑 Checked ONCE per org, before the source lookups, the payout lists and
      // the payout record writes - none of which this sync has any use for
      // when the org has never turned accounting on (task 17 section 3): a
      // payout record exists to reconcile a clearing account this org does not
      // have. The gate lives here rather than only in `postPayoutEntry` because
      // the sweep runs this nightly for every org a source can poll, and that
      // is the loop the brief means by "where it costs least" - skipping here
      // also skips the provider calls and the `payout` entity write.
      if (!(await isAccountingEnabled(db, organizationId))) return emptyResult()

      const fieldCtx = await requirePayoutFieldContext(organizationId)

      // Read ONCE per run, not once per source or payout: the rail is both half
      // of every payout's idempotency key and the clearing side of every entry,
      // and the records cannot change underneath a single run in any way this
      // sync would want to honour half-way through.
      const gateways = await listPaymentGateways(db, organizationId)
      if (gateways.isErr()) throw gateways.error

      const contexts: PayoutSourceCtx[] = []
      for (const source of listPayoutSources()) {
        if (source.kind !== 'api' || !source.resolveContexts) continue
        contexts.push(...(await source.resolveContexts(db, organizationId, gateways.value)))
      }
      if (contexts.length === 0) return emptyResult()

      // The sync runs from a worker with no signed-in person, so the writes are
      // attributed to the org's system user - the same actor
      // `seedDefaultChartOfAccounts` uses. A caller that DOES have a person
      // (the "Sync now" button) passes theirs and it wins.
      const actor = actorUserId ?? (await SystemUserService.getSystemUserForActions(organizationId))

      const result = emptyResult()
      for (const ctx of contexts) {
        let run: SyncPayoutsResult
        try {
          run = await runSource(db, ctx, { actorUserId: actor, fieldCtx, now })
        } catch (error) {
          // 🛑 Caught, named and carried - not rethrown. A provider that 401s
          // must not stop the rail behind it (brief 27 §7), and the sentence the
          // provider gave is the one a person needs, so it is kept verbatim
          // rather than flattened to `guard`'s "Internal error".
          const reason = error instanceof Error ? error.message : String(error)
          logger.error('Payout sync failed for one source', {
            organizationId,
            sourceId: ctx.sourceId,
            paymentGatewayId: ctx.rail?.id ?? null,
            error: reason,
          })
          result.failed.push({
            sourceId: ctx.sourceId,
            paymentGatewayId: ctx.rail?.id ?? null,
            reason,
          })
          continue
        }
        result.seen += run.seen
        result.created += run.created
        result.posted += run.posted
        result.alreadyPosted += run.alreadyPosted
        result.refused.push(...run.refused)
      }

      logger.info('Payout sync finished', {
        organizationId,
        ...result,
        refused: result.refused.length,
        failed: result.failed.length,
      })
      return result
    },
    'Failed to sync payouts',
    { organizationId }
  )
}

/**
 * Run ONE source context: the door a caller holding a context takes, which is
 * a file import (unit 3) or a test. The same gate and def refusal as
 * {@link syncPayouts}, for one rail.
 */
export async function syncPayoutSource(
  db: Database,
  ctx: PayoutSourceCtx,
  params: { actorUserId?: string; now?: Date } = {}
): Promise<Result<SyncPayoutsResult, Error>> {
  const { actorUserId, now = new Date() } = params
  return guard(
    async () => {
      if (!(await isAccountingEnabled(db, ctx.organizationId))) return emptyResult()
      const fieldCtx = await requirePayoutFieldContext(ctx.organizationId)
      const actor =
        actorUserId ?? (await SystemUserService.getSystemUserForActions(ctx.organizationId))
      return runSource(db, ctx, { actorUserId: actor, fieldCtx, now })
    },
    'Failed to sync payouts from one source',
    { organizationId: ctx.organizationId, sourceId: ctx.sourceId }
  )
}

function emptyResult(): SyncPayoutsResult {
  return { seen: 0, created: 0, posted: 0, alreadyPosted: 0, refused: [], failed: [] }
}

/** List one context's payouts and ingest each. Throws only for the source itself. */
async function runSource(
  db: Database,
  ctx: PayoutSourceCtx,
  params: RunParams
): Promise<SyncPayoutsResult> {
  await assertLegacyPayoutIngestionOwner(db, ctx)
  const source = getPayoutSource(ctx.sourceId)
  if (source.isErr()) throw source.error

  const since = await resolveSince(db, ctx, params.fieldCtx, params.now)
  const payouts = await source.value.listPayouts(ctx, since)

  const result = emptyResult()
  result.seen = payouts.length

  for (const header of payouts) {
    const outcome = await ingestOne(db, { ctx, source: source.value, header, ...params })
    result.created += outcome.created ? 1 : 0
    result.posted += outcome.posted ? 1 : 0
    result.alreadyPosted += outcome.alreadyPosted ? 1 : 0
    if (outcome.refusal) {
      result.refused.push({ payoutId: header.providerPayoutId, reason: outcome.refusal })
    }
  }

  logger.info('Payout source run finished', {
    organizationId: ctx.organizationId,
    sourceId: ctx.sourceId,
    paymentGatewayId: ctx.rail?.id ?? null,
    ...result,
    refused: result.refused.length,
    failed: undefined,
  })
  return result
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
  params: RunParams & { ctx: PayoutSourceCtx; source: PayoutSource; header: PayoutHeader }
): Promise<IngestOutcome> {
  const { ctx, source, header, actorUserId, fieldCtx } = params
  const { organizationId, rail } = ctx
  const providerPayoutId = header.providerPayoutId

  // The rail this payout is read FOR is in the context. Half of the idempotency
  // key (brief 27 §6.4) and what the record is stamped with; null is the role
  // fallback and an id-only lookup. A conflict is not decided here -
  // `resolvePayoutRail` refuses it once the record exists and has a number to
  // name in the refusal.
  const existing = await findPayoutByGatewayId(
    db,
    organizationId,
    providerPayoutId,
    rail?.id ?? null
  )
  // 🛑 Already posted is a SUCCESS and a full stop. The sync is a poll; this is
  // the branch every steady-state run takes.
  if (existing?.glPostingId) {
    return { created: false, posted: false, alreadyPosted: true }
  }

  const gathered = await gatherPayout(db, { ctx, source, header })
  // A previously resolved context must stand down if evidence streams were
  // enabled while the provider read was in flight.
  await assertLegacyPayoutIngestionOwner(db, ctx)
  const crud = new UnifiedCrudHandler(organizationId, actorUserId, db)

  let instanceId = existing?.payoutId
  let created = false
  const write = await db.transaction((tx) =>
    runInTxWrite({ organizationId, actorUserId }, async () => {
      await withAccountingCommitLock(tx, organizationId)
      await assertLegacyPayoutIngestionOwner(tx, ctx)
      const scopedCrud = crud.withDatabase(tx)
      if (!instanceId) {
        const record = await scopedCrud.create(fieldCtx.payoutDefId, payoutValues(gathered, ctx))
        instanceId = record.instance.id
        created = true
      } else {
        await scopedCrud.update(
          toRecordId(fieldCtx.payoutDefId, instanceId),
          payoutValues(gathered, ctx)
        )
      }
    })
  )
  if (write.owned) await flushTxWriteScope(write.scope)
  if (!instanceId) throw new Error('Payout record write returned no identity')
  const payoutInstanceId = instanceId

  if (gathered.gatewayStatus !== 'paid') {
    return { created, posted: false, alreadyPosted: false }
  }

  const record = await findPayoutByGatewayId(db, organizationId, providerPayoutId, rail?.id ?? null)
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

  // 🛑 Resolved and refused BEFORE the build (brief 13 §2.3): a bank account is
  // not a role, so the payout's own destination has to name one of the org's
  // `bank_account` rows through a CONFIRMED `stripeExternalAccountId` identity
  // - never `last4`. No entry is built and nothing is claimed when it cannot.
  const resolved = await resolvePayoutBankAccount(
    db,
    organizationId,
    gathered.destination,
    number,
    PAYMENT_GATEWAY_SETTLEMENT_SOURCE_LABELS[ctx.sourceId]
  )
  // 🛑 And the CLEARING side, resolved the same way and refused the same way
  // (brief 26 §3). A fulfillment debits the gateway record's clearing account by
  // id, so crediting the `clearing` role here would relieve a different
  // account the moment any rail is routed to its own - and nothing downstream
  // could detect it, because the entry balances either way.
  const gateway = resolvePayoutRail(ctx, number)

  /** Stamp the reason on the record and return the pre-claim result. Nothing is built. */
  const block = async (reason: string): Promise<PostResult> => {
    logger.warn('Payout blocked before its entry was built', {
      organizationId,
      sourceId: ctx.sourceId,
      payoutId: providerPayoutId,
      destination: gathered.destination,
      reason,
    })
    await crud.update(toRecordId(fieldCtx.payoutDefId, payoutInstanceId), {
      payout_blocked_reason: reason,
    })
    return payoutAccountUnmappedResult(reason)
  }

  let post: PostResult
  if (resolved.blockedReason !== null) {
    post = await block(resolved.blockedReason)
  } else if (gateway.blockedReason !== null) {
    post = await block(gateway.blockedReason)
  } else {
    await assertLegacyPayoutIngestionOwner(db, ctx)
    post = await postPayoutEntry(db, {
      beforeCommit: (tx) => assertLegacyPayoutIngestionOwner(tx, ctx),
      organizationId,
      actorUserId,
      payoutId: providerPayoutId,
      payoutNumber: number,
      bankAccountGlAccountId: resolved.glAccountId,
      grossMinor: gathered.split.grossMinor,
      feesMinor: gathered.split.feesMinor,
      netMinor: gathered.split.netMinor,
      unrecognisedNetMinor: gathered.split.unrecognisedNetMinor,
      // The ROLE fallback, unchanged and still guarded. It is what an org with
      // no `payment_gateway` record gets, which is bit for bit what every org
      // got before brief 26.
      clearingRole: ACCOUNT_ROLES.CLEARING,
      // The merchant account the money settled through (task 47 §4).
      //
      // 🛑 Spread only when the rail names one, exactly like the two account ids
      // below. An unconditional `?? null` puts the KEY on every input, including
      // a rail that has no merchant account - and `stripe-connect.test.ts` pins
      // this object bit for bit against what the pre-brief-26 pipeline produced,
      // so an always-present key reads there as a behaviour change. Absent means
      // "no scope", which resolves to the org-wide fee account exactly as it
      // always has; `null` would mean the same thing while looking deliberate.
      ...(ctx.rail?.processorAccountId ? { processorAccountId: ctx.rail.processorAccountId } : {}),
      ...(gateway.clearingGlAccountId ? { clearingGlAccountId: gateway.clearingGlAccountId } : {}),
      ...(gateway.feeGlAccountId ? { feeGlAccountId: gateway.feeGlAccountId } : {}),
      feeTreatment: gateway.feeTreatment,
      paidAt: gathered.paidAt,
      memo: `Payout ${number}`,
      // Why each resolver answered as it did, in words, frozen onto the bank
      // and clearing lines (brief 28 §5). Captured now, because the records
      // both resolvers read can change before anyone opens the entry.
      bankAccountReason: resolved.reason,
      clearingReason: gateway.reason,
    })
  }

  // ⚠️ Widened from `posted || already_posted` by the shared predicate. An org
  // with no provider connected, or one whose provider switch is off, still has a
  // real, balanced, persisted entry - refusing there left the payout un-`paid`
  // and its `glPostingId` unstamped over a ledger that held the entry.
  // `not_enabled` is unreachable here: the sync returns early for an org that
  // never turned accounting on.
  if (!didLedgerAccept(post)) {
    return {
      created,
      posted: false,
      alreadyPosted: false,
      refusal: post.error ?? `The entry came back ${post.status}`,
    }
  }

  await crud.update(toRecordId(fieldCtx.payoutDefId, payoutInstanceId), {
    payout_status: 'paid',
    // Cleared on success: a payout that was blocked on a prior run and has
    // since been confirmed must not keep showing the blocker banner.
    payout_blocked_reason: null,
    // The bank account the entry actually debited (brief 27 §6.1). Stamped
    // here and not at create, because until this point it was not resolved -
    // a blocked payout carries none, by construction.
    payout_bank_account: resolved.bankAccountRecordId,
    ...(post.glPostingId ? { payout_gl_posting_id: post.glPostingId } : {}),
  })

  // The watermark (brief 27 §6.5), advanced AFTER the entry is in the ledger
  // and the record says so. Informational: a rail whose date did not move is
  // still a rail whose payout posted, so a failure here is logged, never
  // surfaced as a refusal.
  if (gateway.paymentGatewayId) {
    const stamped = await stampPaymentGatewayLastSettlement(db, {
      organizationId,
      actorUserId,
      paymentGatewayId: gateway.paymentGatewayId,
      settledAt: gathered.paidAt,
    })
    if (stamped.isErr()) {
      logger.warn('Payout posted but the rail watermark could not be advanced', {
        organizationId,
        payoutId: providerPayoutId,
        paymentGatewayId: gateway.paymentGatewayId,
        error: stamped.error.message,
      })
    }
  }

  return {
    created,
    posted: post.status === 'posted',
    alreadyPosted: post.status === 'already_posted',
  }
}

/**
 * Either the resolved `gl_account` id with the sentence that explains it, or
 * the sentence a blocked payout carries. Never both.
 *
 * `reason` (brief 28 §5) is the unblocked arm's counterpart to `blockedReason`:
 * a refusal always said WHY, and an answer used to say nothing, so the reason an
 * entry hit the account it hit existed for one stack frame and was gone before
 * the row was written. It rides through `postPayoutEntry` onto the bank line.
 */
export type ResolvedPayoutBankAccount =
  | {
      blockedReason: null
      glAccountId: string
      /** The `bank_account` record, as `<defId>:<id>`, for the payout's own pointer (brief 27 §6.1). */
      bankAccountRecordId: string
      reason: string
    }
  | { blockedReason: string; glAccountId?: never; bankAccountRecordId?: never; reason?: never }

/**
 * Resolve a payout's destination hint to the org's own `bank_account`, or name
 * why it cannot be posted.
 *
 * `sourceLabel` names the provider in the sentence (`Stripe` unless told
 * otherwise, which keeps every existing message byte-identical). A source that
 * reports NO destination is blocked here too: the rail record has no
 * bank-account field yet (27 §6.3, decision 3 owed), so there is nothing else to
 * resolve against, and a blocked payout is visible where a guessed account is
 * not.
 *
 * Exported for direct testing - `ingestOne` is not, because reaching it
 * exercises the whole source-backed gatherer this function is deliberately
 * factored out of.
 */
export async function resolvePayoutBankAccount(
  db: Database,
  organizationId: string,
  destination: string | null,
  payoutNumber: string,
  sourceLabel = 'Stripe'
): Promise<ResolvedPayoutBankAccount> {
  if (!destination) {
    return {
      blockedReason:
        `Payout ${payoutNumber} settled with no destination reported by ${sourceLabel}, so there is no ` +
        'bank account to debit. Confirm its bank account on Accounting > Settings > Bank accounts.',
    }
  }
  const match = await findBankAccountByStripeExternalAccountId(db, organizationId, destination)
  if (!match?.glAccountId) {
    return {
      blockedReason:
        `Payout ${payoutNumber} settled to ${destination}, which is not confirmed on any bank ` +
        'account. Confirm it on Accounting > Settings > Bank accounts.',
    }
  }
  return {
    blockedReason: null,
    glAccountId: match.glAccountId,
    bankAccountRecordId: match.recordId,
    reason:
      `Debited because ${sourceLabel} reported destination ${destination}, which is confirmed on this ` +
      'bank account.',
  }
}

/**
 * The field payload a payout record carries, from one gathered payout and the
 * context it was read in.
 *
 * `payout_source` is what the gatherer decided: `synced` for an itemised
 * source, `imported` for totals only (§4 rule 2). The rail pointer is written
 * on create AND on every refresh, which is how a row that predates the pointer
 * adopts it (see `findPayoutByGatewayId`); `undefined` on the role fallback
 * leaves the cell as it was rather than clearing it.
 */
function payoutValues(gathered: GatheredPayout, ctx: PayoutSourceCtx): Record<string, unknown> {
  return {
    payout_gateway_id: gathered.payoutId,
    payout_payment_gateway: ctx.rail?.recordId ?? undefined,
    payout_source: gathered.source,
    payout_status: gathered.gatewayStatus === 'paid' ? 'paid' : 'in_transit',
    payout_paid_at: gathered.paidAt,
    payout_destination: gathered.destination ?? undefined,
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
 * How far back this run reads, per rail (brief 27 §6.5).
 *
 * The floor is the rail's FIRST sync: the earliest payout record stamped with
 * this rail (or unstamped, which the pair lookup adopts - every pre-157 row and
 * every role-fallback row). Everything before it is in the opening balances.
 * Bounded by `SYNC_LOOKBACK_DAYS`, so a worker that missed a few days catches
 * up and a re-run never walks an account's whole history.
 *
 * 🛑 A rail that has NEVER synced starts from its hand-entered
 * `lastSettlementAt` when it has one - "this rail last settled on D" is exactly
 * the floor a person onboarding a rail means - and from `now` when it has none,
 * so the first run posts nothing older than itself.
 *
 * ⚠️ **The stamped watermark is deliberately NOT the `since` of a steady-state
 * run.** It advances to the latest POSTED payout, so reading only from it would
 * never re-read a payout that arrived earlier and was REFUSED - an unconfirmed
 * bank account, a conflict of rails, a builder refusal - and the remedy a person
 * applies would never be retried. The 30-day lookback is what retries it, as it
 * always has.
 */
async function resolveSince(
  db: Database,
  ctx: PayoutSourceCtx,
  fieldCtx: PayoutFieldContext,
  now: Date
): Promise<Date> {
  const lookback = new Date(now.getTime() - SYNC_LOOKBACK_DAYS * 24 * 60 * 60 * 1000)

  const earliest = await readEarliestPayoutCreatedAt(db, ctx, fieldCtx)
  if (earliest) return lookback > earliest ? lookback : earliest

  const watermark = ctx.rail?.lastSettlementAt
  if (watermark) {
    const floor = new Date(`${watermark}T00:00:00.000Z`)
    return lookback > floor ? lookback : floor
  }
  return now
}

/**
 * When this rail's first payout record was written, or `null` for none.
 *
 * The pointer predicate is `findPayoutByGatewayId`'s: a row stamped with THIS
 * rail, or with no rail at all. With `ctx.rail` null (the role fallback) every
 * payout in the org counts, which is the pre-unit-2 org-wide rule verbatim.
 */
async function readEarliestPayoutCreatedAt(
  db: Database,
  ctx: PayoutSourceCtx,
  fieldCtx: PayoutFieldContext
): Promise<Date | null> {
  const railField = fieldCtx.fields.payout_payment_gateway
  const byRail = ctx.rail !== null && railField !== null

  let query = db
    .select({ createdAt: schema.EntityInstance.createdAt })
    .from(schema.EntityInstance)
    .$dynamic()

  const where: SQL[] = [
    eq(schema.EntityInstance.organizationId, ctx.organizationId),
    eq(schema.EntityInstance.entityDefinitionId, fieldCtx.payoutDefId),
  ]

  if (byRail && ctx.rail) {
    const pointer = alias(schema.FieldValue, 'payout_payment_gateway_v')
    query = query.leftJoin(
      pointer,
      and(
        eq(pointer.entityId, schema.EntityInstance.id),
        eq(pointer.organizationId, schema.EntityInstance.organizationId),
        eq(pointer.fieldId, railField.id)
      )
    )
    const pointerMatches = or(
      isNull(pointer.relatedEntityId),
      eq(pointer.relatedEntityId, ctx.rail.id)
    )
    if (pointerMatches) where.push(pointerMatches)
  }

  const [earliest] = await query
    .where(and(...where))
    .orderBy(asc(schema.EntityInstance.createdAt))
    .limit(1)
  return earliest?.createdAt ?? null
}

/**
 * A payout the provider announced and then took back: reverse the entry that
 * said the money arrived, and mark the record `reversed`.
 *
 * 🛑 **Reversed, never edited and never deleted.** The entry was true when it
 * posted - the provider said the payout was paid - and the correction is a
 * second entry that backs it out, which is the rule the whole ledger keeps.
 * Deleting it would leave the bank line matched to nothing and `1200` relieved
 * of money that came back.
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
      // Id-only: a `payout.failed` webhook names the Stripe id and nothing
      // else, and the row it undoes was written by this same sync, so there is
      // one candidate per org today (Stripe is the only source that writes).
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

      if (!didLedgerAccept(reversal)) {
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
