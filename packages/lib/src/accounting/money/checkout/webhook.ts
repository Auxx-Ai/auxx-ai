// packages/lib/src/accounting/money/checkout/webhook.ts

/**
 * The Stripe Connect webhook reducer for online checkout.
 *
 * One confirmed payment becomes one `MoneyTransaction` (purpose
 * `customer_receipt`, rail the org's Stripe gateway), applied to the invoice it
 * paid or held against the quote whose deposit it is, then posted.
 *
 * ## 🔑 The retry key is the PAYMENT INTENT, not the event
 *
 * Stripe sends BOTH `checkout.session.completed` and `payment_intent.succeeded`
 * for one Checkout payment, with two different event ids. Keying the money
 * command on the event id would record the same money twice - once per event -
 * so the key is the payment intent, which is one per payment and identical
 * across both events and across every redelivery of either.
 *
 * No permission checks here; the route verifies the signature (§6).
 */

import { type Database, database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { dayKeyInZone } from '@auxx/utils/calendar-day'
import { eq } from 'drizzle-orm'
import type Stripe from 'stripe'
import { getOrgCache } from '../../../cache'
import { readBookTimeZoneOrUtc } from '../../ledger/setup/book-time-zone'
import { insertMovement } from '../commands/insert-movement'
import { runMoneyCommand } from '../commands/run-money-command'
import { syncInvoicePaymentState } from '../invoice-payments/payment-state'
import { acceptInvoiceReceiptAccounting } from '../invoice-payments/receipt-accounting'
import { insertApplication } from '../writes'
import { acceptQuoteDepositAccounting } from './deposit-accounting'
import {
  INVOICE_CHECKOUT_COMMAND_KIND,
  QUOTE_DEPOSIT_COMMAND_KIND,
  readInvoiceCheckoutTarget,
  readQuoteCheckoutTarget,
  resolveStripeRail,
} from './reads'

const logger = createScopedLogger('money-checkout-webhook')

/** What a handled event boils down to. */
interface ConfirmedPayment {
  organizationId: string
  paymentIntentId: string
  amountMinor: number
  currency: string
  occurredAt: Date
  invoiceInstanceId?: string
  quoteInstanceId?: string
  workOrderInstanceId?: string
}

/** The org behind a connected account id, when the event carries no metadata. */
async function resolveOrgForConnectedAccount(
  db: Database,
  stripeAccountId: string | undefined
): Promise<string | null> {
  if (!stripeAccountId) return null
  const account = await db.query.PaymentAccount.findFirst({
    where: eq(schema.PaymentAccount.stripeAccountId, stripeAccountId),
  })
  return account?.organizationId ?? null
}

function readMetadata(
  metadata: Stripe.Metadata | null | undefined
): Record<string, string | undefined> {
  return (metadata ?? {}) as Record<string, string | undefined>
}

/**
 * Apply one Stripe Connect event.
 *
 * Unknown event types and events carrying no auxx metadata fall through
 * silently - the route answers 200 either way, so Stripe does not retry
 * forever on types this org never asked for.
 */
export async function applyStripeCheckoutEvent(
  event: Stripe.Event,
  db: Database = database
): Promise<void> {
  let payment: ConfirmedPayment | null = null

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session
    if (session.payment_status !== 'paid') return
    const intentId =
      typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.payment_intent?.id
    payment = await describe(db, event, readMetadata(session.metadata), {
      intentId,
      amountMinor: session.amount_total,
      currency: session.currency,
    })
  } else if (event.type === 'payment_intent.succeeded') {
    const intent = event.data.object as Stripe.PaymentIntent
    payment = await describe(db, event, readMetadata(intent.metadata), {
      intentId: intent.id,
      amountMinor: intent.amount_received,
      currency: intent.currency,
    })
  }
  if (!payment) return

  await recordCheckoutReceipt(db, payment)
}

async function describe(
  db: Database,
  event: Stripe.Event,
  metadata: Record<string, string | undefined>,
  stripe: { intentId?: string; amountMinor: number | null; currency: string | null }
): Promise<ConfirmedPayment | null> {
  if (!stripe.intentId || !stripe.amountMinor || stripe.amountMinor <= 0) return null
  if (!metadata.invoiceInstanceId && !metadata.quoteInstanceId) return null
  const organizationId =
    metadata.organizationId ?? (await resolveOrgForConnectedAccount(db, event.account))
  if (!organizationId) return null
  return {
    organizationId,
    paymentIntentId: stripe.intentId,
    amountMinor: stripe.amountMinor,
    currency: (stripe.currency ?? 'usd').toUpperCase(),
    occurredAt: new Date(event.created * 1000),
    ...(metadata.invoiceInstanceId ? { invoiceInstanceId: metadata.invoiceInstanceId } : {}),
    ...(metadata.quoteInstanceId ? { quoteInstanceId: metadata.quoteInstanceId } : {}),
    ...(metadata.workOrderInstanceId ? { workOrderInstanceId: metadata.workOrderInstanceId } : {}),
  }
}

/** The money, the application, the invoice projection and the posting. */
async function recordCheckoutReceipt(db: Database, payment: ConfirmedPayment): Promise<void> {
  const { organizationId } = payment
  const systemUserId = await getOrgCache().get(organizationId, 'systemUser')
  const rail = await resolveStripeRail(db, organizationId)

  const target = payment.invoiceInstanceId
    ? await readInvoiceCheckoutTarget(organizationId, payment.invoiceInstanceId)
    : await readQuoteCheckoutTarget(organizationId, payment.quoteInstanceId!)
  // An invoice receipt applies only when the whole amount still fits what the
  // invoice owes. Anything else is money with no home yet and is held, because
  // a partly-applied receipt has no honest entry.
  const outstandingMinor = payment.invoiceInstanceId
    ? (target as { balanceMinor: number }).balanceMinor
    : 0
  const appliesToInvoice = !!payment.invoiceInstanceId && outstandingMinor >= payment.amountMinor
  // The application is dated the same book-zone day the receipt itself posts on.
  const zone = await readBookTimeZoneOrUtc(organizationId)

  const result = await runMoneyCommand(
    db,
    {
      organizationId,
      userId: systemUserId,
      commandKey: `stripe-checkout:${payment.paymentIntentId}`,
      kind: payment.invoiceInstanceId ? INVOICE_CHECKOUT_COMMAND_KIND : QUOTE_DEPOSIT_COMMAND_KIND,
      payload: { paymentIntentId: payment.paymentIntentId },
    },
    async (tx, commandId) => {
      const money = await insertMovement(tx, organizationId, commandId, {
        purpose: 'customer_receipt',
        amountMinor: payment.amountMinor,
        // `instant`: Stripe observed the moment the money moved.
        when: { instant: payment.occurredAt },
        partyInstanceId: target.contactInstanceId,
        endpoint: {
          paymentGatewayId: rail?.paymentGatewayId ?? null,
          cashAccountInstanceId: null,
          currency: payment.currency,
        },
        method: 'card',
        reference: payment.paymentIntentId,
        // MIGRATION follow-up 7 - the durable link a held deposit needs to its
        // quote/work order, on the row itself rather than the command's snapshot.
        quoteInstanceId: payment.quoteInstanceId,
        workOrderInstanceId: payment.workOrderInstanceId,
        // Exponent 2 as this lane has always written it; Stripe's zero-decimal
        // currencies are not offered at checkout.
        currency: { code: payment.currency, exponent: 2 },
      })

      if (appliesToInvoice) {
        await insertApplication(tx, organizationId, commandId, {
          moneyTransactionId: money.id,
          operation: 'apply',
          amountMinor: payment.amountMinor,
          invoiceInstanceId: payment.invoiceInstanceId!,
          appliedAt: payment.occurredAt,
          effectiveDate: dayKeyInZone(payment.occurredAt, zone),
          commandItemKey: 'checkout_payment',
        })
        await syncInvoicePaymentState({
          organizationId,
          userId: systemUserId,
          invoiceInstanceId: payment.invoiceInstanceId!,
          db: tx as unknown as Database,
        })
      }
      return { moneyTransactionId: money.id }
    }
  )

  const posted = appliesToInvoice
    ? await acceptInvoiceReceiptAccounting(db, {
        organizationId,
        moneyTransactionId: result.moneyTransactionId,
        actorUserId: systemUserId,
      })
    : rail
      ? await acceptQuoteDepositAccounting(db, {
          organizationId,
          moneyTransactionId: result.moneyTransactionId,
          parentKind: payment.quoteInstanceId ? 'quote' : 'invoice',
          parentInstanceId: (payment.quoteInstanceId ?? payment.invoiceInstanceId)!,
          actorUserId: systemUserId,
        })
      : null

  if (!posted || posted.status === 'blocked')
    logger.warn('An online payment was recorded but not posted', {
      organizationId,
      moneyTransactionId: result.moneyTransactionId,
      status: posted?.status ?? 'no_stripe_rail',
    })
}
