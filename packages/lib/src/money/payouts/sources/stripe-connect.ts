// packages/lib/src/money/payouts/sources/stripe-connect.ts

/**
 * Stripe Connect as a {@link PayoutSource}: what `gather.ts` and
 * `listGatewayPayouts` were before brief 27 unit 2 moved them behind the
 * interface. The only source whose HTTP lives in lib (27 §5): Connect is
 * auxx's own rail on the platform key, and there is no per-merchant app
 * installation to route it through.
 *
 * ## Why this is reachable with no new credentials
 *
 * `PaymentAccount.stripeAccountId` is stored per org and every merchant-facing
 * call already runs on the PLATFORM key with a per-request `{ stripeAccount }`
 * header (`money/payments/connect-client.ts`). `payouts.list` and
 * `balanceTransactions.list({ payout })` are the same shape as every other
 * Connect call this codebase makes.
 *
 * 🛑 **The fee this reads is the PROCESSOR's, from the balance transaction.**
 * `money/payments/fees.ts` is the Connect APPLICATION fee - auxx's own cut - and
 * is a different number entirely.
 *
 * ## Which record is the Connect rail (27 §6.2)
 *
 * A Stripe payout knows its Connect account, not a gateway handle, so the only
 * honest key is the record's own declaration of how it drains:
 * `settlementSource: 'stripe'`. Exactly one such record is the rail; none is the
 * role fallback (bit for bit what every org did before brief 26); two or more is
 * a REFUSAL stamped on every payout, never a guess (26 §13 decision 2). `status`
 * is deliberately not filtered: a closed rail is still a record claiming the
 * stream, and quietly preferring the active one would be guessing.
 */

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, isNotNull, isNull } from 'drizzle-orm'
import type Stripe from 'stripe'
import { BadRequestError } from '../../../errors'
import type { PaymentGatewayRow } from '../../../payment-gateways/client'
import { listPaymentGateways } from '../../../payment-gateways/reads'
import { getPaymentAccount } from '../../payments/account-state'
import { getStripeConnectClient } from '../../payments/connect-client'
import { type ResolvedPayoutGateway, resolvePayoutRail } from '../routing'
import type { PayoutHeader, PayoutItem, PayoutSource, PayoutSourceCtx } from '../source'

const logger = createScopedLogger('payouts:stripe-connect')

/** The registry id, and the `payment_gateway.settlementSource` value that names this feed. */
export const STRIPE_CONNECT_SOURCE_ID = 'stripe' as const

/**
 * Stripe's page ceiling for both lists. A busy day's payout can hold thousands
 * of balance transactions, so both walks page to exhaustion - a truncated read
 * would silently move charges to the unrecognised side and credit `2450` with
 * money auxx does in fact know about.
 */
const PAGE_SIZE = 100

/** How the Stripe rails split: the one record, or the several that conflict. */
export interface StripeRails {
  rail: PaymentGatewayRow | null
  conflictingRails: PaymentGatewayRow[]
}

/**
 * The record(s) claiming the Stripe stream. One is the rail; zero leaves the
 * role fallback; two or more is the conflict {@link resolvePayoutRail} refuses.
 */
export function resolveStripeRails(gateways: readonly PaymentGatewayRow[]): StripeRails {
  const stripeRails = gateways.filter((row) => row.settlementSource === STRIPE_CONNECT_SOURCE_ID)
  if (stripeRails.length === 1) return { rail: stripeRails[0] ?? null, conflictingRails: [] }
  return { rail: null, conflictingRails: stripeRails.length > 1 ? stripeRails : [] }
}

/**
 * Resolve the `payment_gateway` record a Stripe payout settles, or name why it
 * cannot be posted. The pre-unit-2 `resolvePayoutGateway`, kept for callers and
 * tests that hold gateway rows rather than a source context.
 */
export function resolvePayoutGatewayFrom(
  gateways: readonly PaymentGatewayRow[],
  payoutNumber: string
): ResolvedPayoutGateway {
  return resolvePayoutRail(
    { sourceId: STRIPE_CONNECT_SOURCE_ID, ...resolveStripeRails(gateways) },
    payoutNumber
  )
}

/** {@link resolvePayoutGatewayFrom} over the org's records, read here. */
export async function resolvePayoutGateway(
  db: Database,
  organizationId: string,
  payoutNumber: string
): Promise<ResolvedPayoutGateway> {
  const gateways = await listPaymentGateways(db, organizationId)
  if (gateways.isErr()) throw gateways.error
  return resolvePayoutGatewayFrom(gateways.value, payoutNumber)
}

/** The `PaymentAccount.stripeAccountId` the context was built with. */
function stripeAccountIdOf(ctx: PayoutSourceCtx): string {
  if (typeof ctx.handle !== 'string' || !ctx.handle) {
    throw new BadRequestError(
      'The Stripe payout source needs a connected-account id as its handle',
      {
        organizationId: ctx.organizationId,
      }
    )
  }
  return ctx.handle
}

/**
 * Every org holding a connected, non-disconnected `PaymentAccount` - one row
 * per org that ever ran Stripe Connect, so a scan of a few hundred rows.
 *
 * 🛑 A DISCONNECTED account is skipped here, and that is a deliberate
 * difference from `applyStripeEvent`'s `payout.paid` case, which does not skip.
 * A payout event that arrives for a disconnected account is real money that
 * settled and needs booking; polling an account whose authorization auxx no
 * longer holds would just 401 on every run forever.
 */
async function listOrganizations(db: Database): Promise<string[]> {
  const accounts = await db
    .select({ organizationId: schema.PaymentAccount.organizationId })
    .from(schema.PaymentAccount)
    .where(
      and(
        eq(schema.PaymentAccount.provider, 'stripe'),
        isNull(schema.PaymentAccount.disconnectedAt),
        isNotNull(schema.PaymentAccount.stripeAccountId)
      )
    )
  return accounts.map((row) => row.organizationId)
}

/**
 * One context per org: its connected account as the handle and the single
 * `stripe` rail (or the conflict) from the records the caller read once.
 * Empty when the org has no connected account - nothing to poll.
 */
async function resolveContexts(
  _db: Database,
  organizationId: string,
  rails: readonly PaymentGatewayRow[]
): Promise<PayoutSourceCtx[]> {
  // `getPaymentAccount` reads the app-level pool by design (`account-state.ts`
  // is the one writer to `PaymentAccount` and binds its own connection).
  const account = await getPaymentAccount(organizationId)
  const stripeAccountId = account?.stripeAccountId
  if (!stripeAccountId) {
    logger.info('No connected Stripe account, nothing to sync', { organizationId })
    return []
  }
  return [
    {
      organizationId,
      sourceId: STRIPE_CONNECT_SOURCE_ID,
      ...resolveStripeRails(rails),
      handle: stripeAccountId,
    },
  ]
}

/** Every payout the account settled since `since`, oldest first. */
async function listPayouts(ctx: PayoutSourceCtx, since: Date): Promise<PayoutHeader[]> {
  const stripeAccountId = stripeAccountIdOf(ctx)
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
  return payouts.reverse().map(toHeader)
}

/**
 * Every balance transaction in one payout, reduced to {@link PayoutItem}.
 *
 * 🛑 Paged to exhaustion. A truncated read is not a smaller answer, it is a
 * WRONG one: the charges it missed fall to the unrecognised side, `2450` is
 * credited with money auxx has a payment for, and clearing is left holding a
 * balance that will never drain.
 */
async function listItems(ctx: PayoutSourceCtx, payout: PayoutHeader): Promise<PayoutItem[]> {
  const stripeAccountId = stripeAccountIdOf(ctx)
  const stripe = getStripeConnectClient()
  const items: PayoutItem[] = []
  let startingAfter: string | undefined

  for (;;) {
    const page: Stripe.ApiList<Stripe.BalanceTransaction> = await stripe.balanceTransactions.list(
      {
        payout: payout.providerPayoutId,
        limit: PAGE_SIZE,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      },
      { stripeAccount: stripeAccountId }
    )

    for (const txn of page.data) {
      // The payout itself appears in its own balance-transaction list as the
      // `payout` type. Counting it would double the whole deposit.
      if (txn.type === 'payout') continue
      const chargeId = resolveChargeId(txn)
      items.push({
        externalId: txn.id,
        grossMinor: txn.amount,
        // Stripe reports the fee as a positive number withheld; the entry wants
        // it positive too, and `direction` carries the sign.
        feeMinor: txn.fee,
        ref: chargeId ? { kind: 'stripe_charge', id: chargeId } : { kind: 'none' },
      })
    }

    if (!page.has_more) break
    const last = page.data.at(-1)
    if (!last) break
    startingAfter = last.id
  }

  return items
}

/** One Stripe payout as the pipeline sees it. `depositedMinor` is `payout.amount`, transcribed. */
export function toHeader(payout: Stripe.Payout): PayoutHeader {
  const destination = resolveDestinationId(payout.destination)
  return {
    providerPayoutId: payout.id,
    paidAt: toIsoDay(payout.arrival_date),
    currency: payout.currency,
    status: toHeaderStatus(payout.status),
    depositedMinor: payout.amount,
    ...(destination ? { destinationHint: destination } : {}),
  }
}

/**
 * Stripe's `pending` is money that has not left the balance yet, which the
 * pipeline treats exactly as `in_transit`: a record, no entry, until `paid`.
 */
function toHeaderStatus(status: Stripe.Payout['status']): PayoutHeader['status'] {
  switch (status) {
    case 'paid':
    case 'failed':
    case 'canceled':
      return status
    default:
      return 'in_transit'
  }
}

/**
 * The bare external-account id off `payout.destination`, whatever shape it
 * arrived in. A string when unexpanded (this source never expands it); an
 * object carrying its own `id` when a future caller does. Never Stripe's
 * `last4` - see `sync.ts` on why.
 */
function resolveDestinationId(destination: Stripe.Payout['destination']): string | null {
  if (!destination) return null
  return typeof destination === 'string' ? destination : destination.id
}

/**
 * The charge a balance transaction settled, when it settled one.
 *
 * `source` is an id string or an expanded object depending on the call; this
 * never expands, so the string branch is the live one and the object branch is
 * defensive. A `charge` type carries the charge directly; a `refund` carries the
 * refund, whose `charge` is what matters - but an unexpanded refund source is
 * just `re_…`, so a refund is matched through the `PaymentTransaction` refund
 * column instead (see `readRecognisedChargeIds`).
 */
function resolveChargeId(txn: Stripe.BalanceTransaction): string | null {
  const source = txn.source
  if (!source) return null
  const id = typeof source === 'string' ? source : source.id
  return id.startsWith('ch_') || id.startsWith('py_') || id.startsWith('re_') ? id : null
}

/** Stripe reports `arrival_date` as UNIX seconds; the ledger dates in `YYYY-MM-DD`. */
function toIsoDay(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10)
}

/** The Stripe Connect source, registered by `money/payout-sources.ts`. */
export const STRIPE_CONNECT_PAYOUT_SOURCE: PayoutSource = {
  id: STRIPE_CONNECT_SOURCE_ID,
  kind: 'api',
  listOrganizations,
  resolveContexts,
  listPayouts,
  listItems,
}
