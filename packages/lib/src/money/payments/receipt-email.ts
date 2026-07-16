// packages/lib/src/money/payments/receipt-email.ts
// Branded customer payment-receipt email (plans/dispatch/money/15-payment-receipt-emails.md).
// Fired from `markChargeSucceeded` (stripe-rail.ts) — the single exactly-once settlement point —
// for a settled quote deposit or invoice payment. Enqueues on the system-SES rail
// (`enqueueEmailJob`), resolving the org brand pack + recipient at enqueue time so the worker
// stays context-free. Never throws: a receipt failure must never fail (or look like it failed) a
// payment that already settled.

import type { PaymentTransactionEntity } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { TypedFieldValue } from '@auxx/types'
import { extractValue } from '@auxx/types'
import { parseRecordId, toRecordId } from '@auxx/types/resource'
import { getOrgCache } from '../../cache'
import { loadPdfContact, resolveDocumentSettings } from '../../documents'
import { extractRelationshipRecordIds } from '../../field-values/relationship-field'
import { enqueueEmailJob } from '../../jobs/email/enqueue-email-job'
import { UnifiedCrudHandler } from '../../resources/crud'
import { getOrganizationSetting } from '../../settings/settings-service'
import { recordSignal, toSignalRecordKey } from '../../signals'
import { buildPayUrl, ensureInvoicePublicToken } from '../public-token'
import { buildQuoteViewUrl, ensureQuotePublicToken } from '../quote-public-token'

const logger = createScopedLogger('money-receipt-email')

/** Unwrap a `getFieldValues()` map entry — takes the first value if array-returned. */
function firstTyped(
  entry: TypedFieldValue | TypedFieldValue[] | undefined
): TypedFieldValue | undefined {
  if (!entry) return undefined
  return Array.isArray(entry) ? entry[0] : entry
}

/** Compose the business address blob into printable lines, dropping empties. */
function composeAddressLines(
  address:
    | {
        street1?: string
        street2?: string
        city?: string
        state?: string
        zipCode?: string
        country?: string
      }
    | undefined
): string[] {
  if (!address) return []
  const cityLine = [address.city, [address.state, address.zipCode].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(', ')
  return [address.street1, address.street2, cityLine, address.country]
    .map((line) => line?.trim())
    .filter((line): line is string => !!line)
}

/**
 * Resolve + enqueue the branded receipt for a just-settled `charge` row. Context is derived from
 * the row: an `invoiceInstanceId` → invoice payment; else a `quoteInstanceId` → held deposit;
 * neither → nothing to receipt. Silently returns (logging, never throwing) on any missing
 * precondition (kill switch off, no contact email, etc).
 */
export async function sendPaymentReceipt(params: {
  organizationId: string
  transaction: PaymentTransactionEntity
}): Promise<void> {
  const { organizationId, transaction } = params
  try {
    if (transaction.kind !== 'charge' || transaction.status !== 'succeeded') return

    const context: 'deposit' | 'invoice' | null = transaction.invoiceInstanceId
      ? 'invoice'
      : transaction.quoteInstanceId
        ? 'deposit'
        : null
    if (!context) return

    // ─── Kill switch (documents.receiptEmail.enabled, default on) ───────────────────
    const enabled = await getOrganizationSetting({
      organizationId,
      key: 'documents.receiptEmail.enabled',
    })
    if (enabled === false) return

    const systemUserId = await getOrgCache().get(organizationId, 'systemUser')
    const handler = new UnifiedCrudHandler(organizationId, systemUserId)
    const cache = getOrgCache()

    // ─── Document fields (number, total/balance, contact, work order) ───────────────
    const isDeposit = context === 'deposit'
    const documentRecordId = isDeposit
      ? toRecordId('quote', transaction.quoteInstanceId!)
      : toRecordId('invoice', transaction.invoiceInstanceId!)

    const cf = await cache
      .from(organizationId, 'customFields')
      .bySystemAttributes([
        'quote_number',
        'quote_total',
        'quote_contact',
        'quote_work_orders',
        'invoice_number',
        'invoice_balance',
        'invoice_contact',
        'invoice_work_order',
      ] as const)

    const numberField = isDeposit ? cf.quote_number : cf.invoice_number
    const amountField = isDeposit ? cf.quote_total : cf.invoice_balance
    const contactField = isDeposit ? cf.quote_contact : cf.invoice_contact
    const workOrderField = isDeposit ? cf.quote_work_orders : cf.invoice_work_order

    const fieldIds = [numberField, amountField, contactField, workOrderField]
      .filter(Boolean)
      .map((f) => f!.id)
    const values = await handler.getFieldValues(documentRecordId, fieldIds)

    const numberTyped = numberField ? firstTyped(values.get(numberField.id)) : undefined
    const documentNumber = numberTyped
      ? (extractValue(numberTyped) as string)
      : isDeposit
        ? transaction.quoteInstanceId!
        : transaction.invoiceInstanceId!

    // Deposit: remaining on the quote = quote_total − deposit paid. Invoice: the freshly
    // reprojected invoice_balance (syncTransaction already ran before this call).
    const amountTyped = amountField ? firstTyped(values.get(amountField.id)) : undefined
    const amountFieldValue = amountTyped ? (extractValue(amountTyped) as number) : 0
    const remainingBalance = isDeposit
      ? Math.max(0, amountFieldValue - transaction.amount)
      : Math.max(0, amountFieldValue)

    // ─── Recipient contact (name + email via the PDF's NAME-aware resolver) ─────────
    const contactTyped = contactField ? firstTyped(values.get(contactField.id)) : undefined
    const contactRecordId =
      contactTyped?.type === 'relationship' ? contactTyped.recordId : undefined
    if (!contactRecordId) {
      logger.info('No contact on document — skipping receipt', { organizationId, context })
      return
    }
    const contact = await loadPdfContact(cache, handler, organizationId, contactRecordId)
    if (!contact.email) {
      logger.info('Contact has no email — skipping receipt', { organizationId, context })
      return
    }

    // ─── Brand pack (documents settings) + org name fallback ────────────────────────
    const [settings, orgProfile] = await Promise.all([
      resolveDocumentSettings(organizationId),
      cache.get(organizationId, 'orgProfile'),
    ])
    const businessName = settings.business.companyName?.trim() || orgProfile.name || 'Receipt'
    const logoUrl = settings.branding.logo?.url
    const accentColor = settings.branding.accentColor || undefined

    // ─── Public link back to the quote/invoice ──────────────────────────────────────
    const viewUrl = isDeposit
      ? buildQuoteViewUrl(
          await ensureQuotePublicToken(organizationId, transaction.quoteInstanceId!)
        )
      : buildPayUrl(await ensureInvoicePublicToken(organizationId, transaction.invoiceInstanceId!))

    const paymentDate =
      (transaction.metadata as { date?: string } | null)?.date ??
      transaction.createdAt.toISOString().split('T')[0] ??
      transaction.createdAt.toISOString()

    await enqueueEmailJob('payment-receipt', {
      recipient: { email: contact.email, name: contact.name || undefined },
      context,
      documentNumber,
      amountPaid: transaction.amount,
      currency: transaction.currency,
      remainingBalance,
      paymentDate,
      method: transaction.method ?? undefined,
      viewUrl,
      // Brand identity — From address stays the verified SES domain; these carry the business.
      fromName: businessName,
      replyTo: settings.business.email || undefined,
      businessName,
      businessAddressLines: composeAddressLines(settings.business.address),
      businessPhone: settings.business.phone || undefined,
      businessWebsite: settings.business.website || orgProfile.website || undefined,
      logoUrl: logoUrl?.startsWith('http') ? logoUrl : undefined,
      accentColor,
      // Enqueue context — jobId `email-payment-receipt-<txid>` is the queue-level exactly-once guard.
      organizationId,
      source: 'money:receipt',
      idempotencyKey: transaction.id,
    })

    // ─── Communications-timeline signal (job/contact Communications view) ───────────
    const contactInstanceId = parseRecordId(contactRecordId).entityInstanceId
    const links = [
      toSignalRecordKey(
        isDeposit ? 'quote' : 'invoice',
        parseRecordId(documentRecordId).entityInstanceId
      ),
      toSignalRecordKey('contact', contactInstanceId),
    ]
    const workOrderTyped = workOrderField ? values.get(workOrderField.id) : undefined
    const workOrderRecordId = extractRelationshipRecordIds(workOrderTyped)[0]
    if (workOrderRecordId) {
      links.push(toSignalRecordKey('work_order', parseRecordId(workOrderRecordId).entityInstanceId))
    }
    await recordSignal({
      organizationId,
      kind: 'message:sent',
      subtype: 'receipt',
      occurredAt: new Date(),
      dedupeKey: `receipt:${transaction.id}`,
      contactEntityInstanceId: contactInstanceId,
      title: isDeposit
        ? `Deposit receipt — Quote ${documentNumber}`
        : `Payment receipt — Invoice ${documentNumber}`,
      metadata: { context, amountPaid: transaction.amount, recipientEmail: contact.email },
      links,
    })
  } catch (error) {
    // Never fail settlement over a receipt problem.
    logger.error('sendPaymentReceipt failed', {
      organizationId,
      transactionId: transaction.id,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
