// packages/lib/src/accounting/money/payouts/sources/stripe-connect.ts

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
 * ## Which record is the Connect rail (task 58 §5.5)
 *
 * `resolveContexts` builds one context per live `FinancialSourceAccount` a
 * person has linked to a `payment_gateway` record (`listLinkedFeedAccounts`),
 * scoped to the org's own connected account id - never the retired
 * `settlementSource` enum. A feed nothing has linked yet is a manual rail and
 * never reaches this poll.
 */

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { toDateKey } from '@auxx/utils/calendar-day'
import { and, eq, isNotNull, isNull } from 'drizzle-orm'
import type Stripe from 'stripe'
import { BadRequestError } from '../../../../errors'
import type { PaymentGatewayRow } from '../../../rails/client'
import { getPaymentAccount } from '../../stripe-connect/account'
import { getStripeConnectClient } from '../../stripe-connect/client'
import { listLinkedFeedAccounts } from '../reads'
import type { PayoutHeader, PayoutItem, PayoutSource, PayoutSourceCtx } from '../source'

const logger = createScopedLogger('payouts:stripe-connect')

/** The registry id, and the `providerKey` a linked feed carries for this rail. */
export const STRIPE_CONNECT_SOURCE_ID = 'stripe' as const

/**
 * Stripe's page ceiling for both lists. A busy day's payout can hold thousands
 * of balance transactions, so both walks page to exhaustion - a truncated read
 * would silently move charges to the unrecognised side and credit `2450` with
 * money auxx does in fact know about.
 */
const PAGE_SIZE = 100

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
 * 🛑 A DISCONNECTED account is skipped here: polling an account whose
 * authorization auxx no longer holds would just 401 on every run forever. Its
 * payouts reach the ledger only if someone reconnects, because the `payout.paid`
 * webhook that used to book them regardless no longer exists - the nightly sweep
 * and the "Sync now" button are the whole set of doors.
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
 * One context per live feed linked to a rail (task 58 §5.5): the org's
 * connected account is required (nothing to poll without one), and each
 * linked `FinancialSourceAccount` whose `externalAccountId` matches it gets
 * its own context - a stale link left over from a disconnected or re-connected
 * account is skipped rather than polled against the wrong Connect account.
 */
async function resolveContexts(
  db: Database,
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
  const linked = await listLinkedFeedAccounts(db, organizationId, STRIPE_CONNECT_SOURCE_ID)
  const contexts: PayoutSourceCtx[] = []
  for (const feed of linked) {
    if (feed.externalAccountId !== stripeAccountId) continue
    const rail = rails.find((row) => row.id === feed.paymentGatewayId)
    if (!rail) continue
    contexts.push({
      organizationId,
      sourceId: STRIPE_CONNECT_SOURCE_ID,
      rail,
      handle: stripeAccountId,
    })
  }
  return contexts
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
    // Stripe reports `arrival_date` as UNIX seconds; the ledger dates in `YYYY-MM-DD`.
    paidAt: toDateKey(new Date(payout.arrival_date * 1000)),
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

/** The Stripe Connect source, registered by `money/payout-sources.ts`. */
export const STRIPE_CONNECT_PAYOUT_SOURCE: PayoutSource = {
  id: STRIPE_CONNECT_SOURCE_ID,
  kind: 'api',
  listOrganizations,
  resolveContexts,
  listPayouts,
  listItems,
}
