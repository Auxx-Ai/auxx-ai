// packages/lib/src/money/send-email.ts

import { database as db } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { RecordId, TypedFieldValue } from '@auxx/types'
import { extractValue } from '@auxx/types'
import { parseRecordId, toRecordId } from '@auxx/types/resource'
import { getOrgCache } from '../cache'
import type { DocumentType } from '../documents'
import { ensureDocumentPdf, ensureDocumentPdfViaQueue } from '../documents'
import { BadRequestError } from '../errors'
import { extractRelationshipRecordIds } from '../field-values/relationship-field'
import type { PlaceholderResolutionContext } from '../placeholders'
import { resolvePlaceholdersInHtml } from '../placeholders'
import { UnifiedCrudHandler } from '../resources/crud'
import { getOrganizationSetting } from '../settings/settings-service'
import { recordSignal, toSignalRecordKey } from '../signals'
import { getSystemSnippet } from '../snippets'
import { getPaymentAccount } from './payments/account-state'
import { buildPayUrl, ensureInvoicePublicToken, isPaymentsConnected } from './public-token'
import { buildQuoteViewUrl, ensureQuotePublicToken } from './quote-public-token'

const logger = createScopedLogger('money-send-email')

/** Unwrap a `getFieldValues()` map entry — takes the first value if array-returned. */
function firstTyped(
  entry: TypedFieldValue | TypedFieldValue[] | undefined
): TypedFieldValue | undefined {
  if (!entry) return undefined
  return Array.isArray(entry) ? entry[0] : entry
}

/**
 * Resolve a quote/invoice RecordId's document type. The def component arrives in TWO
 * conventions: the internal builders (`quote-lifecycle.ts`/`gather.ts`/`money.ts`) use the
 * literal system entityType string (`toRecordId('invoice', ...)`), while the records view /
 * drawer keys off the EntityDefinition CUID (`toRecordId(entityDefinitionId, ...)` in
 * records-view.tsx). The drawer's "Send" button uses the CUID form, so a plain
 * `=== 'invoice'` string check misclassifies every drawer-sent invoice as a quote (money MI1
 * build spec §H.2/§H.3). Match the literal first, then fall back to the org's `entityDefs`
 * cache so both conventions resolve correctly.
 */
async function documentTypeOf(organizationId: string, recordId: RecordId): Promise<DocumentType> {
  const { entityDefinitionId } = parseRecordId(recordId)
  if (entityDefinitionId === 'invoice') return 'invoice'
  if (entityDefinitionId === 'quote') return 'quote'
  const entityDefs = await getOrgCache().get(organizationId, 'entityDefs')
  return entityDefinitionId === entityDefs.invoice ? 'invoice' : 'quote'
}

export interface EnsureQuoteDocumentPdfInput {
  organizationId: string
  actorId: string
  /** A quote OR invoice RecordId (money MI1 §H.2) — the field name predates invoices and is
   * kept for the existing MQ2 call sites; `documentTypeOf` derives the branch from the
   * value itself, not from this name. */
  quoteRecordId: RecordId
}

export interface EnsureQuoteDocumentPdfResult {
  assetId: string
  fileName: string
}

/**
 * Render-or-reuse the quote/invoice PDF, preferring the queue-backed path
 * (`ensureDocumentPdfViaQueue` — keeps the CPU-bound yoga layout work off the
 * API request where possible) with a same-request inline fallback
 * (`ensureDocumentPdf`) if the queue await fails for any reason (worker down,
 * BullMQ hiccup, timeout, ...) — money MQ2 build spec §C.3/§E.1 step 4; MI1
 * §H.1 generalizes the underlying engine to `documentType`.
 * Shared by `prepareDocumentEmail` (below) and the `money.ensureDocumentPdf`
 * router mutation (the Download PDF button).
 */
export async function ensureQuoteDocumentPdf(
  input: EnsureQuoteDocumentPdfInput
): Promise<EnsureQuoteDocumentPdfResult> {
  const { organizationId, actorId, quoteRecordId } = input
  const documentType = await documentTypeOf(organizationId, quoteRecordId)
  try {
    return await ensureDocumentPdfViaQueue({
      documentType,
      organizationId,
      recordId: quoteRecordId,
      actorId,
    })
  } catch {
    return await ensureDocumentPdf({
      documentType,
      organizationId,
      recordId: quoteRecordId,
      actorId,
    })
  }
}

export interface PrepareDocumentEmailInput {
  organizationId: string
  userId: string
  /** A quote OR invoice RecordId (money MI1 §H.2) — legacy field name, see
   * {@link EnsureQuoteDocumentPdfInput.quoteRecordId}. */
  quoteRecordId: RecordId
}

export interface PrepareDocumentEmailResult {
  to: { email: string; name?: string }[]
  subject: string
  contentHtml: string
  attachment: { id: string; name: string; type: 'asset' }
}

/**
 * Build the prefilled send-email payload for a quote OR invoice (money MQ2
 * build spec §E.1; MI1 §H.2 adds the invoice branch). Resolves the org's
 * seeded `quote_email`/`invoice_email` system snippet's placeholder spans
 * against the document + its contact at PREFILL time (not send time) — for
 * a brand-new outbound thread the primary-entity link is only applied AFTER
 * send (`thread.ts`'s `linkTicketId` block), so send-time resolution would
 * have no record to resolve `quote:*`/`invoice:*`/`contact:*` tokens
 * against. Resolving now means the user sees (and can edit) the final text
 * before it goes out, and the composer's own placeholder-resolution path
 * stays untouched.
 */
export async function prepareDocumentEmail(
  input: PrepareDocumentEmailInput
): Promise<PrepareDocumentEmailResult> {
  const { organizationId, userId, quoteRecordId: documentRecordId } = input
  const documentType = await documentTypeOf(organizationId, documentRecordId)
  const handler = new UnifiedCrudHandler(organizationId, userId)
  const cache = getOrgCache()

  const noContactMessage =
    documentType === 'invoice'
      ? 'This invoice has no contact — add one before sending'
      : 'This quote has no contact — add one before sending'
  const noEmailMessage =
    documentType === 'invoice'
      ? 'This invoice contact has no email address — add one before sending'
      : 'This quote contact has no email address — add one before sending'

  // ─── Step 1: the document's contact (email required to send) ───────────
  const cf = await cache
    .from(organizationId, 'customFields')
    .bySystemAttributes(['quote_contact', 'invoice_contact'] as const)
  const contactField = documentType === 'invoice' ? cf.invoice_contact : cf.quote_contact
  const contactFieldId = contactField?.id
  const documentValues = contactFieldId
    ? await handler.getFieldValues(documentRecordId, [contactFieldId])
    : new Map<string, TypedFieldValue | TypedFieldValue[]>()
  const contactTyped = contactFieldId ? firstTyped(documentValues.get(contactFieldId)) : undefined
  const contactRecordId = contactTyped?.type === 'relationship' ? contactTyped.recordId : undefined

  if (!contactRecordId) {
    throw new BadRequestError(noContactMessage)
  }

  const contactCf = await cache
    .from(organizationId, 'customFields')
    .bySystemAttributes(['full_name', 'primary_email'] as const)
  const contactFieldIds = [contactCf.full_name, contactCf.primary_email]
    .filter(Boolean)
    .map((f) => f!.id)
  const contactValues = await handler.getFieldValues(contactRecordId, contactFieldIds)
  const nameTyped = contactCf.full_name
    ? firstTyped(contactValues.get(contactCf.full_name.id))
    : undefined
  const emailTyped = contactCf.primary_email
    ? firstTyped(contactValues.get(contactCf.primary_email.id))
    : undefined

  const contactName = nameTyped ? (extractValue(nameTyped) as string) : undefined
  const contactEmail = emailTyped ? (extractValue(emailTyped) as string) : undefined

  if (!contactEmail) {
    throw new BadRequestError(noEmailMessage)
  }

  // ─── Step 2: the seeded quote_email/invoice_email system snippet ────────
  const snippet = await getSystemSnippet(
    db,
    organizationId,
    documentType === 'invoice' ? 'invoice_email' : 'quote_email'
  )

  // ─── Step 3: resolve the snippet's placeholder spans ────────────────────
  // recordIdsByRoot keys off `EntityDefinition.id` cuids (the field-token
  // root — see system-snippets.ts's `fieldToken`), NOT the RecordId's own
  // (possibly literal-type-string) def component.
  const entityDefs = await cache.get(organizationId, 'entityDefs')
  const documentDefId = documentType === 'invoice' ? entityDefs.invoice : entityDefs.quote
  const recordIdsByRoot = new Map<string, RecordId>()
  if (documentDefId) recordIdsByRoot.set(documentDefId, documentRecordId)
  if (entityDefs.contact) recordIdsByRoot.set(entityDefs.contact, contactRecordId)

  const placeholderCtx: PlaceholderResolutionContext = {
    db,
    organizationId,
    senderUserId: userId,
    recordIdsByRoot,
  }
  let contentHtml = await resolvePlaceholdersInHtml(snippet.contentHtml, placeholderCtx)

  // ─── Step 3b: append the pay-online link (money MP1 build spec §J, invoice only) ───────
  // Appended at prepare time rather than a snippet placeholder — the generic field-token
  // placeholder resolver (`resolvePlaceholdersInHtml`) resolves raw field VALUES, not a
  // conditionally-gated, freshly-minted absolute URL; appending here keeps that resolver
  // untouched and lets this stay a single well-documented call site. Only invoices get a
  // pay link (quotes have no balance to collect), and only when the org's Stripe account is
  // connected + chargesEnabled — otherwise the email would carry a dead link.
  if (documentType === 'invoice') {
    const { entityInstanceId: invoiceInstanceId } = parseRecordId(documentRecordId)
    const account = await getPaymentAccount(organizationId)
    if (isPaymentsConnected(account)) {
      const token = await ensureInvoicePublicToken(organizationId, invoiceInstanceId)
      if (token) {
        const payUrl = buildPayUrl(token)
        contentHtml += `<p><a href="${payUrl}" target="_blank" rel="noopener noreferrer">Pay online</a></p>`
      }
    }
  }

  // ─── Step 3c: append the view/accept-online link (v5 build spec 01 §"Quote email",
  // quote only) ──────────────────────────────────────────────────────────────────
  // Same rationale as the invoice pay-link above — appended here rather than a snippet
  // placeholder. Gated on `documents.quote.acceptancePageEnabled` only; when off, the email
  // is left exactly as resolved by the snippet (PDF-only behavior, unchanged).
  if (documentType === 'quote') {
    const { entityInstanceId: quoteInstanceId } = parseRecordId(documentRecordId)
    const acceptancePageEnabled = await getOrganizationSetting({
      organizationId,
      key: 'documents.quote.acceptancePageEnabled',
    })
    if (acceptancePageEnabled) {
      const token = await ensureQuotePublicToken(organizationId, quoteInstanceId)
      if (token) {
        const viewUrl = buildQuoteViewUrl(token)
        contentHtml += `<p><a href="${viewUrl}" target="_blank" rel="noopener noreferrer">View & accept this quote online</a></p>`
      }
    }
  }

  // ─── Step 4: ensure the PDF is ready to attach ───────────────────────────
  const { assetId, fileName } = await ensureQuoteDocumentPdf({
    organizationId,
    actorId: userId,
    quoteRecordId: documentRecordId,
  })

  return {
    to: [{ email: contactEmail, name: contactName }],
    subject: snippet.title,
    contentHtml,
    attachment: { id: assetId, name: fileName, type: 'asset' },
  }
}

export interface RecordDocumentSendSignalInput {
  organizationId: string
  userId: string
  documentType: DocumentType
  documentInstanceId: string
  /** `MessageSenderService.sendMessage`'s returned message id — the signal's `dedupeKey`. */
  messageId: string
  threadId: string
  /** The sent email's subject line — the timeline row's title. */
  subject: string
}

/**
 * Manual document-send signal writer (client-notifications plan §4.8/Phase 4) — called from
 * `thread.ts`'s `sendMessage` procedure right after a CONFIRMED successful send flips the
 * quote/invoice to `sent`. Resolves the recipient contact and the linked work order (if any)
 * so the job/contact communications view is honest about manual sends, not just sequence
 * sends. Never throws — a signal-write failure must not fail (or retroactively look like it
 * failed) an email that already went out.
 */
export async function recordDocumentSendSignal(
  input: RecordDocumentSendSignalInput
): Promise<void> {
  const { organizationId, userId, documentType, documentInstanceId, messageId, threadId, subject } =
    input
  try {
    const documentRecordId = toRecordId(documentType, documentInstanceId)
    const handler = new UnifiedCrudHandler(organizationId, userId)
    const cache = getOrgCache()

    // ─── Recipient contact ──────────────────────────────────────────────────
    const contactCf = await cache
      .from(organizationId, 'customFields')
      .bySystemAttributes(['quote_contact', 'invoice_contact', 'primary_email'] as const)
    const contactField =
      documentType === 'invoice' ? contactCf.invoice_contact : contactCf.quote_contact

    let contactEntityInstanceId: string | undefined
    let recipientEmail: string | undefined
    if (contactField) {
      const values = await handler.getFieldValues(documentRecordId, [contactField.id])
      const typed = firstTyped(values.get(contactField.id))
      const contactRecordId = typed?.type === 'relationship' ? typed.recordId : undefined
      if (contactRecordId) {
        contactEntityInstanceId = parseRecordId(contactRecordId).entityInstanceId
        if (contactCf.primary_email) {
          const contactValues = await handler.getFieldValues(contactRecordId, [
            contactCf.primary_email.id,
          ])
          const emailTyped = firstTyped(contactValues.get(contactCf.primary_email.id))
          recipientEmail = emailTyped ? (extractValue(emailTyped) as string) : undefined
        }
      }
    }

    // ─── Linked work order (invoice: singular `invoice_work_order`; quote: array
    // `quote_work_orders`, first entry — a quote can spawn more than one job) ──────────
    const woCf = await cache
      .from(organizationId, 'customFields')
      .bySystemAttributes(['invoice_work_order', 'quote_work_orders'] as const)

    let workOrderInstanceId: string | undefined
    if (documentType === 'invoice' && woCf.invoice_work_order) {
      const values = await handler.getFieldValues(documentRecordId, [woCf.invoice_work_order.id])
      const typed = firstTyped(values.get(woCf.invoice_work_order.id))
      const workOrderRecordId = typed?.type === 'relationship' ? typed.recordId : undefined
      if (workOrderRecordId) workOrderInstanceId = parseRecordId(workOrderRecordId).entityInstanceId
    } else if (documentType === 'quote' && woCf.quote_work_orders) {
      const values = await handler.getFieldValues(documentRecordId, [woCf.quote_work_orders.id])
      const workOrderRecordIds = extractRelationshipRecordIds(values.get(woCf.quote_work_orders.id))
      if (workOrderRecordIds[0]) {
        workOrderInstanceId = parseRecordId(workOrderRecordIds[0]).entityInstanceId
      }
    }

    const links = [toSignalRecordKey(documentType, documentInstanceId)]
    if (contactEntityInstanceId) links.push(toSignalRecordKey('contact', contactEntityInstanceId))
    if (workOrderInstanceId) links.push(toSignalRecordKey('work_order', workOrderInstanceId))

    await recordSignal({
      organizationId,
      kind: 'message:sent',
      subtype: 'document_send',
      occurredAt: new Date(),
      dedupeKey: `doc:${messageId}`,
      contactEntityInstanceId,
      messageId,
      threadId,
      title: subject,
      metadata: { documentType, documentInstanceId, recipientEmail },
      links,
    })
  } catch (error) {
    // Never fail the send over a signal-write problem — the email already went out.
    logger.error('recordDocumentSendSignal failed', {
      organizationId,
      documentType,
      documentInstanceId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
