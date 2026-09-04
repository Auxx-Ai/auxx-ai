// packages/lib/src/money/payments/stripe-rail.ts
// The Stripe rail on MI1's ledger (money MP1 build spec §E) — Checkout creation, the webhook
// reducer, and admin refunds. Composes `ledger.ts`'s `syncTransaction`/`syncInvoicePaymentState`
// (the sole converging writer of entity mirrors + invoice state) rather than duplicating them.
// Kept as a sibling to `ledger.ts` (not inline) so the manual-payment path stays free of any
// `stripe` import — `ledger.ts` itself never imports `stripe`.

import type { PaymentTransactionEntity } from '@auxx/database'
import { database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { TypedFieldValue } from '@auxx/types'
import { extractValue } from '@auxx/types'
import { parseRecordId, toRecordId } from '@auxx/types/resource'
import { and, eq, inArray, ne } from 'drizzle-orm'
import type Stripe from 'stripe'
import { getOrgCache } from '../../cache'
import { BadRequestError, NotFoundError } from '../../errors'
import { extractRelationshipRecordIds } from '../../field-values/relationship-field'
import { UnifiedCrudHandler } from '../../resources/crud'
import { getOrganizationSetting } from '../../settings/settings-service'
import { buildPayUrl, ensureInvoicePublicToken } from '../public-token'
import { buildQuoteViewUrl, ensureQuotePublicToken } from '../quote-public-token'
import { getPaymentAccount, syncAccountState, upsertPaymentAccount } from './account-state'
import { getStripeConnectClient } from './connect-client'
import { resolveQuoteDeposit } from './deposit'
import { resolveApplicationFee } from './fees'
import { syncInvoicePaymentState, syncTransaction } from './ledger'
import { sendPaymentReceipt } from './receipt-email'

const logger = createScopedLogger('money-stripe-rail')

/** Unwrap a `getFieldValues()` map entry — takes the first value if array-returned. */
function firstTyped(
  entry: TypedFieldValue | TypedFieldValue[] | undefined
): TypedFieldValue | undefined {
  if (!entry) return undefined
  return Array.isArray(entry) ? entry[0] : entry
}

/** Extract an EntityInstance id from a relationship-typed field value, given the raw
 * `getFieldValues()` map entry for a contact field — the shared resolution shape
 * `createStripeCheckout`/`createStripeDepositCheckout` use to stamp `contactInstanceId` (money
 * 16-deposit-accounting.md §B/§C.8). `null` when the field is empty. */
function resolveContactInstanceId(
  entry: TypedFieldValue | TypedFieldValue[] | undefined
): string | null {
  const contactTyped = firstTyped(entry)
  const contactRecordId = contactTyped?.type === 'relationship' ? contactTyped.recordId : undefined
  return contactRecordId ? parseRecordId(contactRecordId).entityInstanceId : null
}

/** Input for `createStripeCheckout`. */
export interface CreateStripeCheckoutInput {
  organizationId: string
  /** EntityInstance id of the invoice (not the RecordId). */
  invoiceInstanceId: string
  /** Integer cents — optional custom/partial amount (money MP2 build spec §C). Absent = full
   * current balance, behavior byte-identical to pre-MP2. When present, server-validated
   * against `documents.invoice.allowPartialPayments`/`partialPaymentMinPercent` — never trusts
   * a client-supplied amount past that range. */
  amount?: number
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
    .bySystemAttributes([
      'invoice_status',
      'invoice_number',
      'invoice_balance',
      'invoice_contact',
    ] as const)
  const fieldIds = [cf.invoice_status, cf.invoice_number, cf.invoice_balance, cf.invoice_contact]
    .filter(Boolean)
    .map((f) => f!.id)
  const values = await handler.getFieldValues(invoiceRecordId, fieldIds)

  // money 16-deposit-accounting.md §B/§C.8 — denormalized contact linkage, stamped at insert.
  // Resolution failure must never fail checkout — falls back to `null` with a scoped warning.
  let contactInstanceId: string | null = null
  try {
    contactInstanceId = cf.invoice_contact
      ? resolveContactInstanceId(values.get(cf.invoice_contact.id))
      : null
  } catch (error) {
    logger.warn('Failed to resolve invoice contact for checkout', {
      organizationId,
      invoiceInstanceId,
      error: error instanceof Error ? error.message : String(error),
    })
  }

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

  // §C — optional custom/partial amount. Absent = full balance, byte-identical to pre-MP2
  // behavior (every existing caller). Server-validated against the org's partial-payment
  // settings — never trusts a client-supplied amount past this range.
  let chargeAmount = balance
  if (input.amount !== undefined) {
    const allowPartialPayments = await getOrganizationSetting({
      organizationId,
      key: 'documents.invoice.allowPartialPayments',
    })
    if (!allowPartialPayments) {
      throw new BadRequestError('Partial payments are not enabled for this invoice')
    }
    const minPercent = Number(
      (await getOrganizationSetting({
        organizationId,
        key: 'documents.invoice.partialPaymentMinPercent',
      })) ?? 10
    )
    const minAmount = Math.ceil((balance * minPercent) / 100)
    if (input.amount < minAmount || input.amount > balance) {
      throw new BadRequestError(`Payment amount must be between ${minAmount} and ${balance} cents`)
    }
    chargeAmount = input.amount
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
  const applicationFeeAmount = resolveApplicationFee(account, chargeAmount)

  const [transaction] = await database
    .insert(schema.PaymentTransaction)
    .values({
      organizationId,
      paymentAccountId: account.id,
      provider: 'stripe',
      kind: 'charge',
      status: 'pending',
      amount: chargeAmount,
      currency,
      applicationFeeAmount,
      invoiceInstanceId,
      contactInstanceId,
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
            unit_amount: chargeAmount,
            product_data: { name: `Invoice ${invoiceNumber}` },
          },
          quantity: 1,
        },
      ],
      payment_intent_data: {
        application_fee_amount: applicationFeeAmount,
        // Customer receipt is sent by Auxx on settlement (branded, both rails) — see
        // plans/dispatch/money/15-payment-receipt-emails.md. Stripe's own `receipt_email` is
        // intentionally NOT set (it would double-send).
        // Session metadata is NOT copied onto the PaymentIntent — stamp it there too so
        // `payment_intent.succeeded` can resolve the row even if it arrives before
        // `checkout.session.completed` (webhook ordering is not guaranteed).
        metadata: { transactionId: transaction!.id, organizationId, invoiceInstanceId },
      },
      metadata: { transactionId: transaction!.id, organizationId, invoiceInstanceId },
      // Stamped return URLs: `success` arms the pay page's processing state through the
      // webhook race, and carries Stripe's own `session_id` placeholder so the page can
      // reconcile the return directly if the webhook hasn't landed yet (dev without `stripe
      // listen`, or a not-yet-set prod webhook secret); `cancel` lets the page flip this very
      // row to `canceled` so an abandoned Checkout never wedges the page in "processing" (see
      // `cancelAbandonedCheckout`).
      success_url: `${payUrl}?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
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

/** Input for `createStripeDepositCheckout`. */
export interface CreateStripeDepositCheckoutInput {
  organizationId: string
  /** EntityInstance id of the quote (not the RecordId). */
  quoteInstanceId: string
}

/**
 * Start a Stripe Checkout session for a quote's configured deposit (money MP2 build spec
 * §B.6) — the pre-payment-held-against-the-quote/job rail. Structurally a clone of
 * `createStripeCheckout`: pending-row-first, the newly-inserted row's id as the idempotency
 * key, same `pending`-until-webhook posture. Deltas: `quote_status === 'approved'` gate (a
 * quote must be accepted before its deposit can be paid) instead of the invoice's
 * sent/partially_paid check; the amount comes from `resolveQuoteDeposit`, not an invoice
 * balance; and a re-query guard against double-charging an already-succeeded deposit — a
 * quote has no self-correcting `balance` the way an invoice does, so this function must check
 * for an existing succeeded charge itself before inserting a second pending row.
 */
export async function createStripeDepositCheckout(
  input: CreateStripeDepositCheckoutInput
): Promise<CreateStripeCheckoutResult> {
  const { organizationId, quoteInstanceId } = input
  const systemUserId = await getOrgCache().get(organizationId, 'systemUser')
  const quoteRecordId = toRecordId('quote', quoteInstanceId)
  const handler = new UnifiedCrudHandler(organizationId, systemUserId)
  const cache = getOrgCache()

  const cf = await cache
    .from(organizationId, 'customFields')
    .bySystemAttributes([
      'quote_status',
      'quote_number',
      'quote_total',
      'quote_work_orders',
      'quote_contact',
    ] as const)
  const fieldIds = [
    cf.quote_status,
    cf.quote_number,
    cf.quote_total,
    cf.quote_work_orders,
    cf.quote_contact,
  ]
    .filter(Boolean)
    .map((f) => f!.id)
  const values = await handler.getFieldValues(quoteRecordId, fieldIds)

  // money 16-deposit-accounting.md §B/§C.8 — denormalized contact linkage, stamped at insert.
  // Resolution failure must never fail checkout — falls back to `null` with a scoped warning.
  let contactInstanceId: string | null = null
  try {
    contactInstanceId = cf.quote_contact
      ? resolveContactInstanceId(values.get(cf.quote_contact.id))
      : null
  } catch (error) {
    logger.warn('Failed to resolve quote contact for deposit checkout', {
      organizationId,
      quoteInstanceId,
      error: error instanceof Error ? error.message : String(error),
    })
  }

  const statusTyped = cf.quote_status ? firstTyped(values.get(cf.quote_status.id)) : undefined
  const status = statusTyped ? (extractValue(statusTyped) as string) : undefined
  if (status !== 'approved') {
    throw new BadRequestError(
      `Cannot start a deposit payment — quote must be approved (currently '${status ?? 'unknown'}')`
    )
  }

  const totalTyped = cf.quote_total ? firstTyped(values.get(cf.quote_total.id)) : undefined
  const total = totalTyped ? (extractValue(totalTyped) as number) : 0
  const { depositAmount } = await resolveQuoteDeposit(organizationId, quoteInstanceId, total)
  if (depositAmount <= 0) {
    throw new BadRequestError('No deposit is configured for this quote')
  }

  // A quote's deposit balance never self-corrects the way an invoice's does — re-query for an
  // already-succeeded charge before inserting a second pending row (the invoice flow doesn't
  // need this check; `balance <= 0` already covers a fully-paid invoice).
  const existingSucceeded = await database.query.PaymentTransaction.findFirst({
    where: and(
      eq(schema.PaymentTransaction.organizationId, organizationId),
      eq(schema.PaymentTransaction.quoteInstanceId, quoteInstanceId),
      eq(schema.PaymentTransaction.kind, 'charge'),
      eq(schema.PaymentTransaction.status, 'succeeded')
    ),
    columns: { id: true },
  })
  if (existingSucceeded) {
    throw new BadRequestError("This quote's deposit has already been paid")
  }

  const numberTyped = cf.quote_number ? firstTyped(values.get(cf.quote_number.id)) : undefined
  const quoteNumber = numberTyped ? (extractValue(numberTyped) as string) : quoteInstanceId

  const account = await getPaymentAccount(organizationId)
  if (!account?.stripeAccountId || !account.chargesEnabled || account.disconnectedAt) {
    throw new BadRequestError('Online payment is not available for this quote')
  }

  const currency = (await getOrganizationSetting({
    organizationId,
    key: 'organization.currency',
  })) as string
  const applicationFeeAmount = resolveApplicationFee(account, depositAmount)

  // Auto-convert (if `documents.quote.autoConvertOnAccept` is on) runs synchronously on
  // accept, so a work order may already exist by the time the customer reaches this deposit
  // step — stamp it now if so; otherwise `convertQuoteToWorkOrder`'s manual-convert path
  // back-fills `workOrderInstanceId` later (money MP2 build spec §B.6 point 3).
  const workOrderRecordId = cf.quote_work_orders
    ? extractRelationshipRecordIds(values.get(cf.quote_work_orders.id))[0]
    : undefined
  const workOrderInstanceId = workOrderRecordId
    ? parseRecordId(workOrderRecordId).entityInstanceId
    : null

  const [transaction] = await database
    .insert(schema.PaymentTransaction)
    .values({
      organizationId,
      paymentAccountId: account.id,
      provider: 'stripe',
      kind: 'charge',
      status: 'pending',
      amount: depositAmount,
      currency,
      applicationFeeAmount,
      invoiceInstanceId: null,
      quoteInstanceId,
      workOrderInstanceId,
      contactInstanceId,
      updatedAt: new Date(),
    })
    .returning()

  const quoteToken = await ensureQuotePublicToken(organizationId, quoteInstanceId)
  const quoteUrl = buildQuoteViewUrl(quoteToken)

  const stripe = getStripeConnectClient()
  const session = await stripe.checkout.sessions.create(
    {
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency,
            unit_amount: depositAmount,
            product_data: { name: `Deposit — Quote ${quoteNumber}` },
          },
          quantity: 1,
        },
      ],
      payment_intent_data: {
        application_fee_amount: applicationFeeAmount,
        // Customer receipt is sent by Auxx on settlement — see money/15. Stripe's own
        // `receipt_email` is intentionally NOT set (it would double-send).
        // Session metadata is NOT copied onto the PaymentIntent — stamp it there too so
        // `payment_intent.succeeded` can resolve the row even if it arrives before
        // `checkout.session.completed` (webhook ordering is not guaranteed).
        metadata: { transactionId: transaction!.id, organizationId, quoteInstanceId },
      },
      metadata: { transactionId: transaction!.id, organizationId, quoteInstanceId },
      success_url: `${quoteUrl}?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${quoteUrl}?checkout=cancel&tx=${transaction!.id}`,
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
 * row is a no-op. The in-memory `transaction.status === 'succeeded'` check alone isn't a safe
 * idempotency guard: a browser reconcile (`reconcileStripe(Deposit)CheckoutReturn`) can race a
 * concurrent webhook delivery for the same row, both reading `pending` before either writes,
 * which would otherwise double-run `syncTransaction` and mint a duplicate `payment` mirror.
 * The UPDATE itself is therefore status-guarded (`status <> 'succeeded'` in the WHERE) — only
 * the writer that actually flips the row proceeds to `syncTransaction`; the loser's `.returning()`
 * comes back empty and it returns without syncing.
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
    .where(
      and(
        eq(schema.PaymentTransaction.id, transaction.id),
        ne(schema.PaymentTransaction.status, 'succeeded')
      )
    )
    .returning()

  // No row came back — a concurrent writer (webhook or browser reconcile) already flipped this
  // transaction to `succeeded` first. It already ran `syncTransaction`; running it again here
  // would create a duplicate `payment` mirror.
  if (!updated) return

  // money 16-deposit-accounting.md §C.4 — an invoice checkout (this row's intent
  // `invoiceInstanceId` is set) allocates its full amount the moment it succeeds; a deposit
  // checkout (`invoiceInstanceId: null`) allocates nothing here — it stays held until
  // `applyHeldDepositsToInvoice` picks it up at the job's next invoice creation. Insert BEFORE
  // `syncTransaction` so the mirror-creation loop in there finds the allocation already in place.
  // `onConflictDoNothing` backstops the (paymentTransactionId, invoiceInstanceId) unique index —
  // this status-guarded UPDATE already runs exactly once, but belt-and-suspenders is cheap.
  if (updated.invoiceInstanceId) {
    await database
      .insert(schema.PaymentAllocation)
      .values({
        organizationId: updated.organizationId,
        paymentTransactionId: updated.id,
        invoiceInstanceId: updated.invoiceInstanceId,
        amount: updated.amount,
        createdByUserId: null,
      })
      .onConflictDoNothing()
  }

  await syncTransaction({
    organizationId: transaction.organizationId,
    userId: systemUserId,
    transaction: updated,
  })

  // Branded customer receipt (money/15) — this is the exactly-once flip (the status-guarded
  // UPDATE above bails for a concurrent loser), and `syncTransaction` has already reprojected the
  // invoice balance, so the remaining-balance figure is fresh. `sendPaymentReceipt` never throws.
  await sendPaymentReceipt({ organizationId: updated.organizationId, transaction: updated })
}

/** Input for reconciling a successful invoice Checkout browser return. */
export interface ReconcileStripeCheckoutReturnInput {
  organizationId: string
  /** EntityInstance id of the invoice whose balance was paid. */
  invoiceInstanceId: string
  /** Stripe Checkout Session id returned through the success URL placeholder. */
  sessionId: string
}

/**
 * Reconcile an invoice Checkout return when the Connect webhook has not landed yet (dev without
 * `stripe listen`, or a not-yet-set prod webhook secret) — the public pay page's fallback path so
 * "Payment processing…" doesn't wedge forever waiting on a webhook that may never arrive.
 *
 * The browser-provided session id is never trusted by itself: the pending ledger row must match
 * the organization, invoice, and stored Checkout Session id; Stripe must report the connected-
 * account Session as complete and paid; and its metadata transaction id must match that row.
 * Success converges on the same idempotent writer as the webhook reducer (`markChargeSucceeded`),
 * whose own UPDATE is status-guarded — safe to call even if the webhook wins the race first.
 */
export async function reconcileStripeCheckoutReturn(
  input: ReconcileStripeCheckoutReturnInput
): Promise<{ reconciled: true }> {
  const transaction = await database.query.PaymentTransaction.findFirst({
    where: and(
      eq(schema.PaymentTransaction.organizationId, input.organizationId),
      eq(schema.PaymentTransaction.invoiceInstanceId, input.invoiceInstanceId),
      eq(schema.PaymentTransaction.stripeCheckoutSessionId, input.sessionId),
      eq(schema.PaymentTransaction.provider, 'stripe'),
      eq(schema.PaymentTransaction.kind, 'charge')
    ),
  })
  if (!transaction) {
    throw new NotFoundError('Checkout session not found')
  }

  const account = await getPaymentAccount(input.organizationId)
  if (!account?.stripeAccountId || account.disconnectedAt) {
    throw new NotFoundError('No Stripe account connected for this organization')
  }
  if (transaction.paymentAccountId && transaction.paymentAccountId !== account.id) {
    throw new BadRequestError('Checkout session belongs to a different payment account')
  }

  const stripe = getStripeConnectClient()
  const session = await stripe.checkout.sessions.retrieve(input.sessionId, {
    stripeAccount: account.stripeAccountId,
  })
  if (session.status !== 'complete' || session.payment_status !== 'paid') {
    throw new BadRequestError('Checkout payment is not complete')
  }
  if (session.metadata?.transactionId !== transaction.id) {
    throw new BadRequestError('Checkout transaction metadata does not match')
  }

  const paymentIntentId =
    typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id
  await markChargeSucceeded(transaction, { stripePaymentIntentId: paymentIntentId })
  return { reconciled: true }
}

/** Input for reconciling a successful quote-deposit Checkout browser return. */
export interface ReconcileStripeDepositCheckoutReturnInput {
  organizationId: string
  /** EntityInstance id of the quote whose deposit was paid. */
  quoteInstanceId: string
  /** Stripe Checkout Session id returned through the success URL placeholder. */
  sessionId: string
}

/**
 * Reconcile a quote-deposit Checkout return when the Connect webhook has not landed yet.
 *
 * The browser-provided session id is never trusted by itself: the pending ledger row must match
 * the organization, quote, and stored Checkout Session id; Stripe must report the connected-
 * account Session as complete and paid; and its metadata transaction id must match that row.
 * Success converges on the same idempotent writer as the webhook reducer.
 */
export async function reconcileStripeDepositCheckoutReturn(
  input: ReconcileStripeDepositCheckoutReturnInput
): Promise<{ reconciled: true }> {
  const transaction = await database.query.PaymentTransaction.findFirst({
    where: and(
      eq(schema.PaymentTransaction.organizationId, input.organizationId),
      eq(schema.PaymentTransaction.quoteInstanceId, input.quoteInstanceId),
      eq(schema.PaymentTransaction.stripeCheckoutSessionId, input.sessionId),
      eq(schema.PaymentTransaction.provider, 'stripe'),
      eq(schema.PaymentTransaction.kind, 'charge')
    ),
  })
  if (!transaction) {
    throw new NotFoundError('Deposit Checkout session not found')
  }

  const account = await getPaymentAccount(input.organizationId)
  if (!account?.stripeAccountId || account.disconnectedAt) {
    throw new NotFoundError('No Stripe account connected for this organization')
  }
  if (transaction.paymentAccountId && transaction.paymentAccountId !== account.id) {
    throw new BadRequestError('Deposit Checkout session belongs to a different payment account')
  }

  const stripe = getStripeConnectClient()
  const session = await stripe.checkout.sessions.retrieve(input.sessionId, {
    stripeAccount: account.stripeAccountId,
  })
  if (session.status !== 'complete' || session.payment_status !== 'paid') {
    throw new BadRequestError('Deposit Checkout payment is not complete')
  }
  if (session.metadata?.transactionId !== transaction.id) {
    throw new BadRequestError('Deposit Checkout transaction metadata does not match')
  }

  const paymentIntentId =
    typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id
  await markChargeSucceeded(transaction, { stripePaymentIntentId: paymentIntentId })
  return { reconciled: true }
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

      // A disputed held deposit (money MP2 §B.6) has no invoice to reproject yet — the status
      // flip above is the whole effect until settle (and `applyHeldDepositsToInvoice`'s loader is
      // succeeded-only, money 16-deposit-accounting.md §J.3, so a disputed deposit's remainder
      // never silently allocates).
      if (transaction.invoiceInstanceId) {
        const systemUserId = await getOrgCache().get(transaction.organizationId, 'systemUser')
        await syncInvoicePaymentState({
          organizationId: transaction.organizationId,
          userId: systemUserId,
          invoiceInstanceId: transaction.invoiceInstanceId,
        })
      }
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

    default: {
      // ── The bank feed (plans/bank-connection/01 §3, HANDOFF slot 3A) ──────────
      //
      // 🛑 ONE case, and it names no provider logic of its own: it asks the feed
      // module whether this event type is one of its four, and hands the event over.
      // The list and the handler live together in `banking/feed/webhook.ts` so they
      // cannot drift - a case list here that fell behind the handler would silently
      // stop routing an event type, and a bank feed that stops and says nothing is
      // the most expensive bug in this subsystem.
      //
      // The lookup it does (`fca_...` → `Credential.metadata.providerAccountId` →
      // `DataConnector`) exists nowhere else: both webhook dispatch jobs key on
      // org-scoped ids that a PLATFORM Stripe event does not carry
      // (plans/accounting/implementation-review.md §2).
      //
      // Lazy-imported so `money/` never statically pulls the connector engine.
      // A throw propagates: the route 500s and Stripe retries, which is what we want.
      const { applyFinancialConnectionsEvent, isFinancialConnectionsEvent } = await import(
        '../../banking/feed/webhook'
      )
      if (isFinancialConnectionsEvent(event.type)) {
        await applyFinancialConnectionsEvent(
          event as unknown as Parameters<typeof applyFinancialConnectionsEvent>[0]
        )
      }
      return
    }
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
      // MP2 §B.10 — carry a deposit's quote/work-order linkage onto its refund row too, so a
      // refunded deposit stays queryable by the same `listWorkOrderPayments` extension.
      quoteInstanceId: charge.quoteInstanceId,
      workOrderInstanceId: charge.workOrderInstanceId,
      // money 16-deposit-accounting.md §C.5 — carry the charge's denormalized contact linkage
      // onto its refund row too (same posture as the quote/work-order copy above).
      contactInstanceId: charge.contactInstanceId,
      refundedTransactionId: charge.id,
      createdByUserId: userId,
      updatedAt: new Date(),
    })
    .returning()

  // money 16-deposit-accounting.md §C.5 — copy the charge's allocations onto the refund row
  // (same invoices, same amounts — full-only refunds make this exact) so `computeAmountPaid`
  // nets to zero per invoice once this refund succeeds. No mirrors for refund allocations
  // (mirrors stay charge-only — refunds already render from the ledger row). Refunding a held
  // deposit (zero allocations) copies nothing and touches no invoice — the null-guard behavior
  // MP2 had, now structural. The refund row is still `pending` here (the `charge.refunded`
  // webhook is what flips it to `succeeded` and calls `syncTransaction`), so `computeAmountPaid`
  // won't count these allocations until then — this sync is a harmless, correctly-computed
  // no-op today, kept for parity with every other allocation-mutating writer in this module.
  const chargeAllocations = await database.query.PaymentAllocation.findMany({
    where: eq(schema.PaymentAllocation.paymentTransactionId, charge.id),
  })
  if (chargeAllocations.length > 0) {
    await database.insert(schema.PaymentAllocation).values(
      chargeAllocations.map((allocation) => ({
        organizationId,
        paymentTransactionId: refundRow!.id,
        invoiceInstanceId: allocation.invoiceInstanceId,
        amount: allocation.amount,
        createdByUserId: userId,
      }))
    )
    for (const invoiceInstanceId of new Set(chargeAllocations.map((a) => a.invoiceInstanceId))) {
      await syncInvoicePaymentState({ organizationId, userId, invoiceInstanceId })
    }
  }

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
