// packages/lib/src/accounting/money/checkout/writes.ts

/**
 * Opening a Stripe Checkout Session on the org's connected account, for an
 * invoice balance or a quote deposit.
 *
 * The money-model rebuild of the legacy rail's `createStripeCheckout` /
 * `createStripeDepositCheckout` (accounting migration step 0). The shape that
 * changed: nothing is written to the money model here. The legacy rail inserted
 * a `pending PaymentTransaction` first and used its id as the idempotency key;
 * a `MoneyTransaction` has no pending state, so the money is recorded only when
 * Stripe says it moved - see `webhook.ts`. What this does record is the session
 * id, on the document, so the page can tell "a checkout is in flight" from
 * "nothing has been tried".
 *
 * No permission checks here. The public routes are token-gated; the router
 * asserts elsewhere (docs/lib-module-guide.md §6).
 */

import { type Database, database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { toRecordId } from '@auxx/types/resource'
import type { SystemAttribute } from '@auxx/types/system-attribute'
import { getOrgCache } from '../../../cache'
import { BadRequestError } from '../../../errors'
import { FieldValueService } from '../../../field-values/field-value-service'
import { systemFieldMap } from '../../../resources/system-records'
import { readOrganizationSettings } from '../../../settings/read'
import { buildPayUrl, ensureInvoicePublicToken } from '../../sales/public-token'
import { resolveQuoteDeposit } from '../../sales/quotes/quote-deposit'
import { buildQuoteViewUrl, ensureQuotePublicToken } from '../../sales/quotes/quote-public-token'
import { resolvePartialPaymentBounds } from '../customer-money/partial-payment'
import { getPaymentAccount } from '../stripe-connect/account'
import { resolveApplicationFee } from '../stripe-connect/application-fee'
import { getStripeConnectClient } from '../stripe-connect/client'
import { readInvoiceCheckoutTarget, readQuoteCheckoutTarget, sumQuoteDeposits } from './reads'

const logger = createScopedLogger('money-checkout')

/** What both doors return - the URL the public page redirects the payer to. */
export interface CheckoutSessionResult {
  checkoutUrl: string
  sessionId: string
}

export interface CreateInvoiceCheckoutInput {
  organizationId: string
  /** `EntityInstance` id of the invoice, not the `RecordId`. */
  invoiceInstanceId: string
  /**
   * Integer minor units - a partial payment. Absent charges the whole balance.
   * Never trusted: re-validated against the org's partial-payment settings.
   */
  amountMinor?: number
}

/** The connected account this org charges on, or a refusal. */
async function requireConnectedAccount(organizationId: string) {
  const account = await getPaymentAccount(organizationId)
  if (!account?.stripeAccountId || !account.chargesEnabled || account.disconnectedAt)
    throw new BadRequestError('Online payment is not available right now')
  return account
}

/** Best-effort stamp of the session id onto the document; a missing field is not an error. */
async function stampSessionId(
  organizationId: string,
  entityType: 'invoice' | 'quote',
  instanceId: string,
  attribute: SystemAttribute,
  sessionId: string
): Promise<void> {
  const cf = await systemFieldMap(undefined, organizationId, [attribute] as const)
  if (!cf[attribute]) return
  const systemUserId = await getOrgCache().get(organizationId, 'systemUser')
  const service = new FieldValueService(organizationId, systemUserId)
  await service.setValuesForEntity({
    recordId: toRecordId(entityType, instanceId),
    values: [{ fieldId: attribute, value: sessionId }],
  })
}

/**
 * Open a Checkout Session for an invoice's outstanding balance.
 *
 * Status and balance are re-read server-side on every call: the page that
 * offered the button may have been rendered before the invoice was voided.
 */
export async function createInvoiceCheckoutSession(
  input: CreateInvoiceCheckoutInput,
  db: Database = database
): Promise<CheckoutSessionResult> {
  const { organizationId, invoiceInstanceId } = input
  const invoice = await readInvoiceCheckoutTarget(organizationId, invoiceInstanceId)
  if (invoice.status !== 'sent' && invoice.status !== 'partially_paid')
    throw new BadRequestError(
      `Cannot start a payment - invoice must be sent or partially paid (currently '${invoice.status}')`
    )
  if (invoice.balanceMinor <= 0)
    throw new BadRequestError('This invoice has no outstanding balance')

  let chargeMinor = invoice.balanceMinor
  if (input.amountMinor !== undefined) {
    const partialPaymentSettings = await readOrganizationSettings(organizationId, [
      'documents.invoice.allowPartialPayments',
      'documents.invoice.partialPaymentMinPercent',
    ] as const)
    if (!partialPaymentSettings['documents.invoice.allowPartialPayments'])
      throw new BadRequestError('Partial payments are not enabled for this invoice')
    const minPercent = Number(
      partialPaymentSettings['documents.invoice.partialPaymentMinPercent'] ?? 10
    )
    const { min } = resolvePartialPaymentBounds(invoice.balanceMinor, minPercent)
    if (input.amountMinor < min || input.amountMinor > invoice.balanceMinor)
      throw new BadRequestError(
        `Payment amount must be between ${min} and ${invoice.balanceMinor} cents`
      )
    chargeMinor = input.amountMinor
  }

  const account = await requireConnectedAccount(organizationId)
  const currency = (
    await readOrganizationSettings(organizationId, ['organization.currency'] as const)
  )['organization.currency']
  const applicationFeeAmount = resolveApplicationFee(account, chargeMinor)
  const payUrl = buildPayUrl(await ensureInvoicePublicToken(organizationId, invoiceInstanceId))

  const session = await getStripeConnectClient().checkout.sessions.create(
    {
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency,
            unit_amount: chargeMinor,
            product_data: { name: `Invoice ${invoice.number}` },
          },
          quantity: 1,
        },
      ],
      // 🛑 Session metadata is NOT copied onto the PaymentIntent, and
      // `payment_intent.succeeded` can arrive before
      // `checkout.session.completed` - stamp both or the earlier event
      // resolves nothing.
      payment_intent_data: {
        application_fee_amount: applicationFeeAmount,
        metadata: { organizationId, invoiceInstanceId, amountMinor: String(chargeMinor) },
      },
      metadata: { organizationId, invoiceInstanceId, amountMinor: String(chargeMinor) },
      success_url: `${payUrl}?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${payUrl}?checkout=cancel`,
    },
    { stripeAccount: account.stripeAccountId! }
  )
  if (!session.url) throw new BadRequestError('Stripe did not return a checkout URL')

  await stampSessionId(
    organizationId,
    'invoice',
    invoiceInstanceId,
    'invoice_checkout_session_id',
    session.id
  ).catch((error) =>
    logger.warn('Could not record the checkout session on the invoice', {
      organizationId,
      invoiceInstanceId,
      error: error instanceof Error ? error.message : String(error),
    })
  )

  return { checkoutUrl: session.url, sessionId: session.id }
}

export interface CreateQuoteDepositCheckoutInput {
  organizationId: string
  /** `EntityInstance` id of the quote, not the `RecordId`. */
  quoteInstanceId: string
}

/**
 * Open a Checkout Session for a quote's configured deposit.
 *
 * ⚠️ The amount is always the CURRENTLY configured deposit and is never taken
 * from the caller. A quote has no self-correcting balance, so this re-reads what
 * has already been collected and refuses a second charge itself.
 */
export async function createQuoteDepositCheckoutSession(
  input: CreateQuoteDepositCheckoutInput,
  db: Database = database
): Promise<CheckoutSessionResult> {
  const { organizationId, quoteInstanceId } = input
  const quote = await readQuoteCheckoutTarget(organizationId, quoteInstanceId)
  if (quote.status !== 'approved')
    throw new BadRequestError(
      `Cannot start a deposit payment - quote must be approved (currently '${quote.status}')`
    )

  const { depositAmount } = await resolveQuoteDeposit(
    organizationId,
    quoteInstanceId,
    quote.totalMinor
  )
  if (depositAmount <= 0) throw new BadRequestError('No deposit is configured for this quote')

  const collected = await sumQuoteDeposits(db, organizationId, quoteInstanceId)
  if (collected.heldMinor + collected.appliedMinor >= depositAmount)
    throw new BadRequestError("This quote's deposit has already been paid")

  const account = await requireConnectedAccount(organizationId)
  const currency = (
    await readOrganizationSettings(organizationId, ['organization.currency'] as const)
  )['organization.currency']
  const applicationFeeAmount = resolveApplicationFee(account, depositAmount)
  const quoteUrl = buildQuoteViewUrl(await ensureQuotePublicToken(organizationId, quoteInstanceId))

  const metadata: Record<string, string> = {
    organizationId,
    quoteInstanceId,
    amountMinor: String(depositAmount),
    ...(quote.workOrderInstanceId ? { workOrderInstanceId: quote.workOrderInstanceId } : {}),
  }
  const session = await getStripeConnectClient().checkout.sessions.create(
    {
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency,
            unit_amount: depositAmount,
            product_data: { name: `Deposit - Quote ${quote.number}` },
          },
          quantity: 1,
        },
      ],
      payment_intent_data: { application_fee_amount: applicationFeeAmount, metadata },
      metadata,
      success_url: `${quoteUrl}?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${quoteUrl}?checkout=cancel`,
    },
    { stripeAccount: account.stripeAccountId! }
  )
  if (!session.url) throw new BadRequestError('Stripe did not return a checkout URL')

  await stampSessionId(
    organizationId,
    'quote',
    quoteInstanceId,
    'quote_deposit_session_id',
    session.id
  ).catch((error) =>
    logger.warn('Could not record the deposit session on the quote', {
      organizationId,
      quoteInstanceId,
      error: error instanceof Error ? error.message : String(error),
    })
  )

  return { checkoutUrl: session.url, sessionId: session.id }
}
