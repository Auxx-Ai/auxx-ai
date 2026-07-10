// packages/lib/src/money/payments/stripe-rail.ts
// The Stripe rail on MI1's ledger (money MP1 build spec §E) — Checkout creation, the webhook
// reducer, and admin refunds. Composes `ledger.ts`'s `syncTransaction`/`syncInvoicePaymentState`
// (the sole converging writer of entity mirrors + invoice state) rather than duplicating them.
// Kept as a sibling to `ledger.ts` (not inline) so the manual-payment path stays free of any
// `stripe` import — `ledger.ts` itself never imports `stripe`.

import type { PaymentTransactionEntity } from '@auxx/database'
import { database, schema } from '@auxx/database'
import type { TypedFieldValue } from '@auxx/types'
import { extractValue } from '@auxx/types'
import { toRecordId } from '@auxx/types/resource'
import { and, eq, inArray } from 'drizzle-orm'
import type Stripe from 'stripe'
import { getOrgCache } from '../../cache'
import { BadRequestError, NotFoundError } from '../../errors'
import { UnifiedCrudHandler } from '../../resources/crud'
import { getOrganizationSetting } from '../../settings/settings-service'
import { buildPayUrl, ensureInvoicePublicToken } from '../public-token'
import { getPaymentAccount, syncAccountState, upsertPaymentAccount } from './account-state'
import { getStripeConnectClient } from './connect-client'
import { resolveApplicationFee } from './fees'
import { syncInvoicePaymentState, syncTransaction } from './ledger'

/** Unwrap a `getFieldValues()` map entry — takes the first value if array-returned. */
function firstTyped(
  entry: TypedFieldValue | TypedFieldValue[] | undefined
): TypedFieldValue | undefined {
  if (!entry) return undefined
  return Array.isArray(entry) ? entry[0] : entry
}

/** Input for `createStripeCheckout`. */
export interface CreateStripeCheckoutInput {
  organizationId: string
  /** EntityInstance id of the invoice (not the RecordId). */
  invoiceInstanceId: string
}

/** Result of `createStripeCheckout` — the pay page redirects here. */
export interface CreateStripeCheckoutResult {
  checkoutUrl: string
}

/**
 * Start a Stripe Checkout session for an invoice's outstanding balance (money MP1 build spec
 * §E, decision: hosted Checkout, balance-only, full only — no custom/partial amounts). Re-checks
 * status/balance server-side (never trusts a stale client render — the void-mid-render race).
 * Inserts the `pending` ledger row FIRST — its id is both the idempotency key on
 * `checkout.sessions.create` and the row the webhook (`applyStripeEvent`) later resolves by
 * `stripePaymentIntentId`. No entity mirror is created here: `pending` ≠ `succeeded`, so
 * `syncTransaction` only runs once the webhook confirms payment.
 */
export async function createStripeCheckout(
  input: CreateStripeCheckoutInput
): Promise<CreateStripeCheckoutResult> {
  const { organizationId, invoiceInstanceId } = input
  const systemUserId = await getOrgCache().get(organizationId, 'systemUser')
  const invoiceRecordId = toRecordId('invoice', invoiceInstanceId)
  const handler = new UnifiedCrudHandler(organizationId, systemUserId)
  const cache = getOrgCache()

  const cf = await cache
    .from(organizationId, 'customFields')
    .bySystemAttributes(['invoice_status', 'invoice_number', 'invoice_balance'] as const)
  const fieldIds = [cf.invoice_status, cf.invoice_number, cf.invoice_balance]
    .filter(Boolean)
    .map((f) => f!.id)
  const values = await handler.getFieldValues(invoiceRecordId, fieldIds)

  const statusTyped = cf.invoice_status ? firstTyped(values.get(cf.invoice_status.id)) : undefined
  const status = statusTyped ? (extractValue(statusTyped) as string) : undefined
  if (status !== 'sent' && status !== 'partially_paid') {
    throw new BadRequestError(
      `Cannot start a payment — invoice must be sent or partially paid (currently '${status ?? 'unknown'}')`
    )
  }

  const balanceTyped = cf.invoice_balance
    ? firstTyped(values.get(cf.invoice_balance.id))
    : undefined
  const balance = balanceTyped ? (extractValue(balanceTyped) as number) : 0
  if (balance <= 0) {
    throw new BadRequestError('This invoice has no outstanding balance')
  }

  const numberTyped = cf.invoice_number ? firstTyped(values.get(cf.invoice_number.id)) : undefined
  const invoiceNumber = numberTyped ? (extractValue(numberTyped) as string) : invoiceInstanceId

  const account = await getPaymentAccount(organizationId)
  if (!account?.stripeAccountId || !account.chargesEnabled || account.disconnectedAt) {
    throw new BadRequestError('Online payment is not available for this invoice')
  }

  const currency = (await getOrganizationSetting({
    organizationId,
    key: 'organization.currency',
  })) as string
  const applicationFeeAmount = resolveApplicationFee(account, balance)

  const [transaction] = await database
    .insert(schema.PaymentTransaction)
    .values({
      organizationId,
      paymentAccountId: account.id,
      provider: 'stripe',
      kind: 'charge',
      status: 'pending',
      amount: balance,
      currency,
      applicationFeeAmount,
      invoiceInstanceId,
      updatedAt: new Date(),
    })
    .returning()

  const token = await ensureInvoicePublicToken(organizationId, invoiceInstanceId)
  const payUrl = buildPayUrl(token)

  const stripe = getStripeConnectClient()
  const session = await stripe.checkout.sessions.create(
    {
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency,
            unit_amount: balance,
            product_data: { name: `Invoice ${invoiceNumber}` },
          },
          quantity: 1,
        },
      ],
      payment_intent_data: {
        application_fee_amount: applicationFeeAmount,
        // Session metadata is NOT copied onto the PaymentIntent — stamp it there too so
        // `payment_intent.succeeded` can resolve the row even if it arrives before
        // `checkout.session.completed` (webhook ordering is not guaranteed).
        metadata: { transactionId: transaction!.id, organizationId, invoiceInstanceId },
      },
      metadata: { transactionId: transaction!.id, organizationId, invoiceInstanceId },
      // Stamped return URLs: `success` arms the pay page's processing state through the
      // webhook race; `cancel` lets the page flip this very row to `canceled` so an abandoned
      // Checkout never wedges the page in "processing" (see `cancelAbandonedCheckout`).
      success_url: `${payUrl}?checkout=success`,
      cancel_url: `${payUrl}?checkout=cancel&tx=${transaction!.id}`,
    },
    { stripeAccount: account.stripeAccountId, idempotencyKey: transaction!.id }
  )

  const paymentIntentId =
    typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id
  await database
    .update(schema.PaymentTransaction)
    .set({
      stripeCheckoutSessionId: session.id,
      stripePaymentIntentId: paymentIntentId ?? null,
    })
    .where(eq(schema.PaymentTransaction.id, transaction!.id))

  if (!session.url) {
    throw new BadRequestError('Stripe did not return a checkout URL')
  }
  return { checkoutUrl: session.url }
}

/** Resolve the ledger row a webhook event is about, by intent id first, then `metadata.transactionId`. */
async function findTransactionForEvent(
  paymentIntentId: string | null | undefined,
  transactionId: string | null | undefined
): Promise<PaymentTransactionEntity | null> {
  if (paymentIntentId) {
    const row = await database.query.PaymentTransaction.findFirst({
      where: eq(schema.PaymentTransaction.stripePaymentIntentId, paymentIntentId),
    })
    if (row) return row
  }
  if (transactionId) {
    const row = await database.query.PaymentTransaction.findFirst({
      where: eq(schema.PaymentTransaction.id, transactionId),
    })
    if (row) return row
  }
  return null
}

/**
 * Flip a `charge` row to `succeeded` and converge on `syncTransaction` (creates the `payment`
 * mirror + reprojects the invoice). Idempotent — a replayed webhook for an already-`succeeded`
 * row is a no-op.
 */
async function markChargeSucceeded(
  transaction: PaymentTransactionEntity,
  updates: {
    stripeChargeId?: string | null
    stripePaymentIntentId?: string | null
    applicationFeeAmount?: number | null
    method?: string | null
  }
): Promise<void> {
  if (transaction.status === 'succeeded' || transaction.kind !== 'charge') return

  const systemUserId = await getOrgCache().get(transaction.organizationId, 'systemUser')
  const [updated] = await database
    .update(schema.PaymentTransaction)
    .set({
      status: 'succeeded',
      stripeChargeId: updates.stripeChargeId ?? transaction.stripeChargeId,
      stripePaymentIntentId: updates.stripePaymentIntentId ?? transaction.stripePaymentIntentId,
      applicationFeeAmount: updates.applicationFeeAmount ?? transaction.applicationFeeAmount,
      method: updates.method ?? transaction.method ?? 'card',
    })
    .where(eq(schema.PaymentTransaction.id, transaction.id))
    .returning()

  await syncTransaction({
    organizationId: transaction.organizationId,
    userId: systemUserId,
    transaction: updated!,
  })
}

/**
 * The Connect webhook reducer (money MP1 build spec §E bullet 2 — called by the route handler,
 * §F). Every branch guards on the row's current status before writing, so a Stripe retry (or a
 * manually re-sent event) is a safe no-op. Unknown/unhandled event types fall through silently —
 * the route returns 200 either way so Stripe doesn't retry forever on types we don't subscribe to.
 */
export async function applyStripeEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session
      const paymentIntentId =
        typeof session.payment_intent === 'string'
          ? session.payment_intent
          : session.payment_intent?.id
      const transaction = await findTransactionForEvent(
        paymentIntentId,
        session.metadata?.transactionId
      )
      if (!transaction) return
      await markChargeSucceeded(transaction, { stripePaymentIntentId: paymentIntentId })
      return
    }

    case 'payment_intent.succeeded': {
      const intent = event.data.object as Stripe.PaymentIntent
      const chargeId =
        typeof intent.latest_charge === 'string' ? intent.latest_charge : intent.latest_charge?.id
      const transaction = await findTransactionForEvent(intent.id, intent.metadata?.transactionId)
      if (!transaction) return
      await markChargeSucceeded(transaction, {
        stripeChargeId: chargeId,
        stripePaymentIntentId: intent.id,
        applicationFeeAmount: intent.application_fee_amount ?? undefined,
      })
      return
    }

    case 'payment_intent.payment_failed': {
      const intent = event.data.object as Stripe.PaymentIntent
      const transaction = await findTransactionForEvent(intent.id, intent.metadata?.transactionId)
      if (!transaction || transaction.status !== 'pending') return
      await database
        .update(schema.PaymentTransaction)
        .set({
          status: 'failed',
          failureCode: intent.last_payment_error?.code ?? null,
          failureMessage: intent.last_payment_error?.message ?? null,
        })
        .where(eq(schema.PaymentTransaction.id, transaction.id))
      return
    }

    case 'charge.refunded': {
      const charge = event.data.object as Stripe.Charge
      // Primary resolution: by the refund id (stamped on the row by `refundTransaction`).
      // `charge.refunds` is an expandable that newer API versions may omit from webhook
      // payloads, so fall back to the charge row's own open refund via `refundedTransactionId`.
      const latestRefund = charge.refunds?.data?.[0]
      let refundRow = latestRefund
        ? await database.query.PaymentTransaction.findFirst({
            where: and(
              eq(schema.PaymentTransaction.stripeRefundId, latestRefund.id),
              eq(schema.PaymentTransaction.kind, 'refund')
            ),
          })
        : undefined
      if (!refundRow) {
        const chargeRow = await database.query.PaymentTransaction.findFirst({
          where: and(
            eq(schema.PaymentTransaction.stripeChargeId, charge.id),
            eq(schema.PaymentTransaction.kind, 'charge')
          ),
        })
        if (!chargeRow) return
        refundRow = await database.query.PaymentTransaction.findFirst({
          where: and(
            eq(schema.PaymentTransaction.refundedTransactionId, chargeRow.id),
            eq(schema.PaymentTransaction.kind, 'refund'),
            inArray(schema.PaymentTransaction.status, ['pending', 'processing'])
          ),
        })
      }
      if (!refundRow || refundRow.status === 'succeeded') return

      const systemUserId = await getOrgCache().get(refundRow.organizationId, 'systemUser')
      const [updated] = await database
        .update(schema.PaymentTransaction)
        .set({ status: 'succeeded' })
        .where(eq(schema.PaymentTransaction.id, refundRow.id))
        .returning()
      await syncTransaction({
        organizationId: refundRow.organizationId,
        userId: systemUserId,
        transaction: updated!,
      })
      return
    }

    case 'charge.dispute.created': {
      const dispute = event.data.object as Stripe.Dispute
      const paymentIntentId =
        typeof dispute.payment_intent === 'string'
          ? dispute.payment_intent
          : dispute.payment_intent?.id
      if (!paymentIntentId) return
      const transaction = await database.query.PaymentTransaction.findFirst({
        where: and(
          eq(schema.PaymentTransaction.stripePaymentIntentId, paymentIntentId),
          eq(schema.PaymentTransaction.kind, 'charge')
        ),
      })
      if (!transaction || transaction.status === 'disputed') return

      // Flag only (v1) — a dispute does NOT subtract from `amountPaid` until it resolves.
      // `ledger.ts`'s `computeAmountPaid`/`hasSucceededCharges` count `disputed` charge rows
      // alongside `succeeded` ones for exactly this reason.
      await database
        .update(schema.PaymentTransaction)
        .set({ status: 'disputed' })
        .where(eq(schema.PaymentTransaction.id, transaction.id))

      const systemUserId = await getOrgCache().get(transaction.organizationId, 'systemUser')
      await syncInvoicePaymentState({
        organizationId: transaction.organizationId,
        userId: systemUserId,
        invoiceInstanceId: transaction.invoiceInstanceId,
      })
      return
    }

    case 'account.updated': {
      const account = event.data.object as Stripe.Account
      const paymentAccount = await database.query.PaymentAccount.findFirst({
        where: eq(schema.PaymentAccount.stripeAccountId, account.id),
      })
      if (!paymentAccount) return
      await syncAccountState(paymentAccount.organizationId, account.id)
      return
    }

    case 'account.application.deauthorized': {
      const stripeAccountId = event.account
      if (!stripeAccountId) return
      const paymentAccount = await database.query.PaymentAccount.findFirst({
        where: eq(schema.PaymentAccount.stripeAccountId, stripeAccountId),
      })
      if (!paymentAccount || paymentAccount.disconnectedAt) return
      await upsertPaymentAccount({
        organizationId: paymentAccount.organizationId,
        provider: 'stripe',
        disconnectedAt: new Date(),
      })
      return
    }

    default:
      return
  }
}

/** Input for `refundTransaction`. */
export interface RefundTransactionInput {
  organizationId: string
  userId: string
  /** `PaymentTransaction.id` of the `succeeded` `stripe` `charge` row to refund. */
  transactionId: string
}

/** Result of `refundTransaction`. */
export interface RefundTransactionResult {
  /** The new `refund` ledger row's id. */
  transactionId: string
}

/**
 * Admin full-refund of a succeeded Stripe charge (money MP1 build spec §E bullet 3, decision:
 * full refunds only in v1). Inserts a `pending` `refund` row, then calls `refunds.create` with
 * `refund_application_fee: true` (the platform fee is refunded too) and stamps `stripeRefundId`.
 * The `charge.refunded` webhook (`applyStripeEvent`) is what actually flips the row to
 * `succeeded` and reprojects the invoice — this function only initiates the refund. Router-gated
 * admin-only (§L) — this function itself does not check roles, matching `deleteManualPayment`.
 */
export async function refundTransaction(
  input: RefundTransactionInput
): Promise<RefundTransactionResult> {
  const { organizationId, userId, transactionId } = input

  const charge = await database.query.PaymentTransaction.findFirst({
    where: and(
      eq(schema.PaymentTransaction.id, transactionId),
      eq(schema.PaymentTransaction.organizationId, organizationId)
    ),
  })
  if (!charge) {
    throw new NotFoundError('Payment not found')
  }
  if (charge.provider !== 'stripe' || charge.kind !== 'charge') {
    throw new BadRequestError('Only Stripe charges can be refunded')
  }
  if (charge.status !== 'succeeded' && charge.status !== 'disputed') {
    throw new BadRequestError(`Cannot refund a payment in status '${charge.status}'`)
  }
  if (!charge.stripeChargeId) {
    throw new BadRequestError('This payment has no Stripe charge to refund')
  }

  const existingRefund = await database.query.PaymentTransaction.findFirst({
    where: and(
      eq(schema.PaymentTransaction.refundedTransactionId, charge.id),
      eq(schema.PaymentTransaction.kind, 'refund'),
      inArray(schema.PaymentTransaction.status, ['pending', 'processing', 'succeeded'])
    ),
  })
  if (existingRefund) {
    throw new BadRequestError('This payment has already been refunded')
  }

  const account = await getPaymentAccount(organizationId)
  if (!account?.stripeAccountId) {
    throw new NotFoundError('No Stripe account connected for this organization')
  }

  const [refundRow] = await database
    .insert(schema.PaymentTransaction)
    .values({
      organizationId,
      paymentAccountId: charge.paymentAccountId,
      provider: 'stripe',
      kind: 'refund',
      status: 'pending',
      amount: charge.amount,
      currency: charge.currency,
      invoiceInstanceId: charge.invoiceInstanceId,
      refundedTransactionId: charge.id,
      createdByUserId: userId,
      updatedAt: new Date(),
    })
    .returning()

  const stripe = getStripeConnectClient()
  const refund = await stripe.refunds.create(
    { charge: charge.stripeChargeId, refund_application_fee: true },
    { stripeAccount: account.stripeAccountId, idempotencyKey: refundRow!.id }
  )

  await database
    .update(schema.PaymentTransaction)
    .set({ stripeRefundId: refund.id })
    .where(eq(schema.PaymentTransaction.id, refundRow!.id))

  return { transactionId: refundRow!.id }
}
