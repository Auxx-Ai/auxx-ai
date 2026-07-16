// apps/worker/scripts/verify-money-payment-receipt.ts
/**
 * Branded payment-receipt verification (plans/dispatch/money/15-payment-receipt-emails.md).
 * Exercises `sendPaymentReceipt` — the resolver fired from `markChargeSucceeded` on every settled
 * Stripe charge — for both a quote deposit and an invoice payment.
 *
 * SEND-SAFE: the dev `.env` points at LIVE email, so this script stops at the ENQUEUE boundary. It
 * asserts the BullMQ job that `enqueueEmailJob('payment-receipt', ...)` adds to the email queue
 * (deterministic jobId `email-payment-receipt-<txid>`) and its payload, then removes the job — the
 * worker never runs it, so no mail is sent. It never calls the Stripe rail or a real send.
 *
 * Creates records prefixed "[MRE-verify]" and removes everything (records, ledger rows, queued
 * jobs, signals) in a try/finally; restores the receipt-email org setting.
 *
 * Run (from repo root) under the worker runtime:
 *   node --conditions source --env-file .env --import tsx/esm \
 *     apps/worker/scripts/verify-money-payment-receipt.ts
 */

import { database, schema } from '@auxx/database'
import { getOrgCache } from '@auxx/lib/cache'
import { getQueue, Queues } from '@auxx/lib/jobs/queues'
import { sendPaymentReceipt } from '@auxx/lib/money'
import { UnifiedCrudHandler } from '@auxx/lib/resources'
import { getOrganizationSetting, updateOrganizationSetting } from '@auxx/lib/settings'

function toRecordId(entityDefinitionId: string, entityInstanceId: string) {
  return `${entityDefinitionId}:${entityInstanceId}` as never
}

let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) {
    pass++
    console.log(`  ✅ ${name}`)
  } else {
    fail++
    console.log(`  ❌ ${name}`, detail ?? '')
  }
}

/** Insert a settled Stripe `charge` ledger row directly (bypasses the Stripe rail). */
async function insertSucceededCharge(input: {
  organizationId: string
  amount: number
  quoteInstanceId?: string
  invoiceInstanceId?: string
}) {
  const [row] = await database
    .insert(schema.PaymentTransaction)
    .values({
      organizationId: input.organizationId,
      provider: 'stripe',
      kind: 'charge',
      status: 'succeeded',
      amount: input.amount,
      currency: 'USD',
      method: 'card',
      quoteInstanceId: input.quoteInstanceId ?? null,
      invoiceInstanceId: input.invoiceInstanceId ?? null,
      updatedAt: new Date(),
    })
    .returning()
  return row!
}

/** Read + remove the receipt job the resolver should have queued for a transaction. */
async function takeReceiptJob(transactionId: string) {
  const job = await getQueue(Queues.emailQueue).getJob(`email-payment-receipt-${transactionId}`)
  if (!job) return null
  const data = job.data as { emailType: string; payload: Record<string, unknown> }
  await job.remove()
  return data
}

async function main() {
  const user = await database.query.User.findFirst({
    columns: { id: true },
    where: (t, { eq: e }) => e(t.email, 'm4rkuskk@gmail.com'),
  })
  if (!user) throw new Error('Dev user not found')
  const organizationId = 'u45w22ft66ymiaa19ohs7m9f' // Marki Corp (primary dev org)
  const userId = user.id
  console.log(`Org ${organizationId}, user ${userId}`)

  const handler = new UnifiedCrudHandler(organizationId, userId)

  const createdContactIds: string[] = []
  const createdQuoteIds: string[] = []
  const createdInvoiceIds: string[] = []
  const createdTxIds: string[] = []
  let settingChanged = false
  let originalSetting: unknown = null

  // PAUSE the email queue for the whole test: the dev worker is live and would otherwise drain
  // (and actually SEND) each receipt job before we can inspect it. Paused, jobs stay queued and
  // inspectable; we remove them here and resume in `finally`, so no mail is ever sent.
  await getQueue(Queues.emailQueue).pause()

  try {
    // ── Fixture: a contact with a name + email ──────────────────────────────
    const contact = await handler.create('contact', {
      first_name: 'Receipt',
      last_name: 'Verify',
      primary_email: 'mre-verify@example.com',
    })
    createdContactIds.push(contact.instance.id)
    const contactRecordId = toRecordId('contact', contact.instance.id)

    // ── 1: DEPOSIT receipt ──────────────────────────────────────────────────
    console.log('1: deposit receipt')
    const quote = await handler.create('quote', {
      quote_contact: contactRecordId,
      quote_title: '[MRE-verify] Deposit test',
    })
    createdQuoteIds.push(quote.instance.id)
    // Set a known quote_total so remaining-balance math is deterministic. `setValuesForEntity`
    // resolves the systemAttribute string to the real fieldId; the sanctioned writer bypasses
    // lifecycle pre-hooks.
    await handler.fieldValueService.setValuesForEntity({
      recordId: toRecordId('quote', quote.instance.id),
      values: [{ fieldId: 'quote_total', value: 100000 }],
      publishEvents: false,
    })

    const depositTx = await insertSucceededCharge({
      organizationId,
      amount: 25000,
      quoteInstanceId: quote.instance.id,
    })
    createdTxIds.push(depositTx.id)

    await sendPaymentReceipt({ organizationId, transaction: depositTx })
    const depositJob = await takeReceiptJob(depositTx.id)
    check('deposit: receipt job enqueued', !!depositJob, depositJob)
    if (depositJob) {
      const p = depositJob.payload
      check('deposit: emailType payment-receipt', depositJob.emailType === 'payment-receipt')
      check('deposit: context = deposit', p.context === 'deposit', p.context)
      check(
        'deposit: recipient = contact email',
        (p.recipient as { email?: string })?.email === 'mre-verify@example.com',
        p.recipient
      )
      check(
        'deposit: recipient name composed',
        (p.recipient as { name?: string })?.name === 'Receipt Verify',
        p.recipient
      )
      check('deposit: amountPaid = 25000', p.amountPaid === 25000, p.amountPaid)
      check(
        'deposit: remaining = total − deposit = 75000',
        p.remainingBalance === 75000,
        p.remainingBalance
      )
      check(
        'deposit: viewUrl is a quote link',
        typeof p.viewUrl === 'string' && (p.viewUrl as string).includes('/quote/'),
        p.viewUrl
      )
      check(
        'deposit: fromName present',
        typeof p.fromName === 'string' && (p.fromName as string).length > 0,
        p.fromName
      )
    }

    // ── 2: DEPOSIT exactly-once (idempotent enqueue) ────────────────────────
    console.log('2: exactly-once')
    await sendPaymentReceipt({ organizationId, transaction: depositTx })
    const dupJob = await getQueue(Queues.emailQueue).getJob(`email-payment-receipt-${depositTx.id}`)
    // The first call already consumed (removed) the job; a re-run must re-add exactly one under
    // the same deterministic jobId (never a second job) — assert it exists and remove it.
    check('exactly-once: re-run yields the same single jobId (no duplicate)', !!dupJob)
    if (dupJob) await dupJob.remove()

    // ── 3: INVOICE receipt ──────────────────────────────────────────────────
    console.log('3: invoice receipt')
    const invoice = await handler.create('invoice', { invoice_contact: contactRecordId })
    createdInvoiceIds.push(invoice.instance.id)
    await handler.fieldValueService.setValuesForEntity({
      recordId: toRecordId('invoice', invoice.instance.id),
      values: [{ fieldId: 'invoice_balance', value: 4000 }],
      publishEvents: false,
    })

    const invoiceTx = await insertSucceededCharge({
      organizationId,
      amount: 6000,
      invoiceInstanceId: invoice.instance.id,
    })
    createdTxIds.push(invoiceTx.id)

    await sendPaymentReceipt({ organizationId, transaction: invoiceTx })
    const invoiceJob = await takeReceiptJob(invoiceTx.id)
    check('invoice: receipt job enqueued', !!invoiceJob, invoiceJob)
    if (invoiceJob) {
      const p = invoiceJob.payload
      check('invoice: context = invoice', p.context === 'invoice', p.context)
      check('invoice: amountPaid = 6000', p.amountPaid === 6000, p.amountPaid)
      check(
        'invoice: remaining = invoice_balance = 4000',
        p.remainingBalance === 4000,
        p.remainingBalance
      )
      check(
        'invoice: viewUrl is a pay link',
        typeof p.viewUrl === 'string' && (p.viewUrl as string).includes('/pay/'),
        p.viewUrl
      )
    }

    // ── 4: kill switch (documents.receiptEmail.enabled = false) ─────────────
    console.log('4: kill switch')
    originalSetting = await getOrganizationSetting({
      organizationId,
      key: 'documents.receiptEmail.enabled',
    })
    await updateOrganizationSetting({
      organizationId,
      key: 'documents.receiptEmail.enabled',
      value: false,
    })
    // The raw lib writer doesn't invalidate the `orgSettings` org-cache that `getOrganizationSetting`
    // reads (the settings tRPC mutation does that in-app); do it here so the switch takes effect.
    await getOrgCache().invalidateAndRecompute(organizationId, ['orgSettings'])
    settingChanged = true

    const offTx = await insertSucceededCharge({
      organizationId,
      amount: 5000,
      quoteInstanceId: quote.instance.id,
    })
    createdTxIds.push(offTx.id)
    await sendPaymentReceipt({ organizationId, transaction: offTx })
    const offJob = await getQueue(Queues.emailQueue).getJob(`email-payment-receipt-${offTx.id}`)
    check('kill switch off ⇒ no receipt job', !offJob)
    if (offJob) await offJob.remove()

    // Restore before the no-contact/no-email checks so they aren't masked by the switch.
    await updateOrganizationSetting({
      organizationId,
      key: 'documents.receiptEmail.enabled',
      value: (originalSetting ?? true) as boolean,
    })
    await getOrgCache().invalidateAndRecompute(organizationId, ['orgSettings'])
    settingChanged = false

    // ── 5: no contact ⇒ no receipt, no throw ─────────────────────────────────
    console.log('5: contactless quote')
    const bareQuote = await handler.create('quote', { quote_title: '[MRE-verify] No contact' })
    createdQuoteIds.push(bareQuote.instance.id)
    const bareTx = await insertSucceededCharge({
      organizationId,
      amount: 5000,
      quoteInstanceId: bareQuote.instance.id,
    })
    createdTxIds.push(bareTx.id)
    let threw = false
    try {
      await sendPaymentReceipt({ organizationId, transaction: bareTx })
    } catch {
      threw = true
    }
    const bareJob = await getQueue(Queues.emailQueue).getJob(`email-payment-receipt-${bareTx.id}`)
    check('no contact ⇒ no job and no throw', !bareJob && !threw)
    if (bareJob) await bareJob.remove()

    // ── 6: comms signal recorded (deposit) ──────────────────────────────────
    console.log('6: comms signal')
    const signal = await database.query.EntitySignal.findFirst({
      where: (t, { and: a, eq: e }) =>
        a(e(t.organizationId, organizationId), e(t.dedupeKey, `receipt:${depositTx.id}`)),
    })
    check(
      'deposit: message:sent/receipt signal recorded',
      !!signal && signal.kind === 'message:sent' && signal.subtype === 'receipt',
      signal
    )

    // ── 7: a charge with neither quote nor invoice ⇒ no-op ───────────────────
    console.log('7: unlinked charge')
    const orphanTx = await insertSucceededCharge({ organizationId, amount: 5000 })
    createdTxIds.push(orphanTx.id)
    await sendPaymentReceipt({ organizationId, transaction: orphanTx })
    const orphanJob = await getQueue(Queues.emailQueue).getJob(
      `email-payment-receipt-${orphanTx.id}`
    )
    check('unlinked charge ⇒ no job', !orphanJob)
    if (orphanJob) await orphanJob.remove()
  } finally {
    console.log('cleanup')
    if (settingChanged) {
      await updateOrganizationSetting({
        organizationId,
        key: 'documents.receiptEmail.enabled',
        value: (originalSetting ?? true) as boolean,
      }).catch(() => {})
      await getOrgCache()
        .invalidateAndRecompute(organizationId, ['orgSettings'])
        .catch(() => {})
    }
    // Remove any receipt signals + queued jobs left for our transactions.
    for (const txId of createdTxIds) {
      const job = await getQueue(Queues.emailQueue)
        .getJob(`email-payment-receipt-${txId}`)
        .catch(() => null)
      if (job) await job.remove().catch(() => {})
      // EntitySignalLink cascades on the signal delete (onDelete: 'cascade').
      await database.$client
        .query('DELETE FROM "EntitySignal" WHERE "organizationId" = $1 AND "dedupeKey" = $2', [
          organizationId,
          `receipt:${txId}`,
        ])
        .catch(() => {})
      await database.$client
        .query('DELETE FROM "PaymentTransaction" WHERE id = $1', [txId])
        .catch(() => {})
    }
    for (const id of createdInvoiceIds)
      await handler.delete(toRecordId('invoice', id)).catch(() => {})
    for (const id of createdQuoteIds) await handler.delete(toRecordId('quote', id)).catch(() => {})
    for (const id of createdContactIds)
      await handler.delete(toRecordId('contact', id)).catch(() => {})
    // Resume LAST — after every receipt job has been removed — so the worker never sends one.
    await getQueue(Queues.emailQueue)
      .resume()
      .catch(() => {})
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
