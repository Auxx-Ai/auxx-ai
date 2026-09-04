// packages/lib/src/money/send-email.ts

import { database as db } from '@auxx/database'
import type { SnippetSystemType } from '@auxx/database/enums'
import { createScopedLogger } from '@auxx/logger'
import type { RecordId, TypedFieldValue } from '@auxx/types'
import { extractValue } from '@auxx/types'
import { toResourceFieldId } from '@auxx/types/field'
import { parseRecordId, toRecordId } from '@auxx/types/resource'
import { getOrgCache } from '../cache'
import type { DocumentType } from '../documents'
import { ensureDocumentPdf, ensureDocumentPdfViaQueue } from '../documents'
// Imported from the registry's CLIENT-SAFE half, not `../documents/registry` — `registry.ts`
// pulls in `@react-pdf/renderer` components and the server-only payload builders, and
// `documents/index.ts` re-exports it. `documents/client.ts` is constants only (no react-pdf,
// no storage, no 'use client' directive) and is the module `registry.ts` itself imports its
// id/entityType pairing from, so this is the same source of truth with none of the weight.
import { DOCUMENT_TYPE_DESCRIPTORS } from '../documents/client'
import { BadRequestError } from '../errors'
import { formatToDisplayValue } from '../field-values/formatter'
import { extractRelationshipRecordIds } from '../field-values/relationship-field'
import type { PlaceholderResolutionContext } from '../placeholders'
import { resolvePlaceholdersInHtml } from '../placeholders'
import { UnifiedCrudHandler } from '../resources/crud'
import { getOrganizationSetting } from '../settings/settings-service'
import { recordSignal, toSignalRecordKey } from '../signals'
import { getSystemSnippet } from '../snippets'
import { markInvoiceSent } from './invoice-lifecycle'
import { getPaymentAccount } from './payments/account-state'
import { buildPayUrl, ensureInvoicePublicToken, isPaymentsConnected } from './public-token'
import { markPurchaseOrderSent } from './purchase-order-lifecycle'
import { markQuoteSent } from './quote-lifecycle'
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
 * Everything that used to be a `documentType === 'invoice' ? … : <quote>` ternary in
 * {@link prepareDocumentEmail}, as one row per document type.
 *
 * 🛑 The ternaries were the same "everything else is a quote" shape as the `documentTypeOf`
 * default fixed above (purchasing plan 07 §2.1). They fail loudly rather than silently — a
 * purchase order reported *"This quote has no contact"* — but they still blocked the PO send
 * path outright. A table means a fourth document type is a row, not another nested ternary.
 */
export interface DocumentEmailProfile {
  /**
   * `CustomField.systemAttribute` of the document's `belongs_to -> contact` field — the
   * EMAIL RECIPIENT.
   *
   * 🛑 A purchase order's addressee is genuinely different from a quote's or an invoice's and
   * this row is where that is resolved, not papered over. The party a PO is FOR is its
   * `purchase_order_vendor`, which points at a `company` — and `company` has no email field
   * at all, so it can never be a recipient. `purchase_order_contact` exists precisely to name
   * the PERSON at that vendor the order is sent to, and it is deliberately shaped as a copy
   * of `quote_contact` so this stays a map entry rather than a second code path. Never try to
   * email the vendor company.
   */
  contactSystemAttribute:
    | 'quote_contact'
    | 'invoice_contact'
    | 'purchase_order_contact'
    // 🛑 There is NO such CustomField, deliberately. A deposit slip has no
    // counterparty at all - it is OUR document about OUR bank run - so the
    // lookup resolves to null and the send path refuses with
    // {@link DocumentEmailProfile.noContactHint}'s sentence instead of mailing
    // an internal banking document to whoever happened to be on the invoice.
    // The alternative, pointing this at `invoice_contact`, would send it.
    | 'bank_deposit_contact'
  /** `entityDefs` cache key (the `EntityDefinition.entityType` slug) for the placeholder root. */
  entityDefsKey: string
  /** The org's seeded system snippet used as the email body. */
  snippetSystemType: SnippetSystemType
  /** Human noun for this document in error copy. */
  noun: string
  /** Tail of the no-contact error, after the em dash. Names the field as the UI labels it. */
  noContactHint: string
  /**
   * The sanctioned lifecycle writer for a CONFIRMED send — the one thing that may move this
   * document out of `draft` because an email went out.
   *
   * Deliberately a function pointer rather than declared data (`{ statusSystemAttribute,
   * sentValue }` + one generic writer). The three are genuinely different: quote and invoice
   * write `sent`, a purchase order writes `issued` AND defaults `purchase_order_expected_at`
   * from its lines. Declaring the shape would need a per-type extras hook back immediately —
   * a function pointer with more ceremony (dispatch/money plan 22 §6.2).
   *
   * Throws `BadRequestError` when the document is not a draft. Callers treat that as the
   * idempotent no-op it is: a resend, or a document somebody already marked sent by hand.
   */
  markSent: (input: { organizationId: string; userId: string; instanceId: string }) => Promise<void>
  /** Signal/timeline title for a send whose caller supplied no subject line. */
  sentSubjectFallback: string
}

/**
 * One profile per {@link DocumentType} — keyed by the union derived from
 * `DOCUMENT_TYPE_DESCRIPTORS`, so registering a FOURTH document type for printing without
 * giving it a send profile here is a compile error rather than a runtime surprise.
 */
export const DOCUMENT_EMAIL_PROFILES: Record<DocumentType, DocumentEmailProfile> = {
  quote: {
    contactSystemAttribute: 'quote_contact',
    entityDefsKey: 'quote',
    snippetSystemType: 'quote_email',
    noun: 'quote',
    noContactHint: 'add one before sending',
    markSent: ({ organizationId, userId, instanceId }) =>
      markQuoteSent({ organizationId, userId, quoteInstanceId: instanceId }),
    sentSubjectFallback: 'Quote sent',
  },
  invoice: {
    contactSystemAttribute: 'invoice_contact',
    entityDefsKey: 'invoice',
    snippetSystemType: 'invoice_email',
    noun: 'invoice',
    noContactHint: 'add one before sending',
    markSent: ({ organizationId, userId, instanceId }) =>
      markInvoiceSent({ organizationId, userId, invoiceInstanceId: instanceId }),
    sentSubjectFallback: 'Invoice sent',
  },
  purchase_order: {
    contactSystemAttribute: 'purchase_order_contact',
    entityDefsKey: 'purchase_order',
    snippetSystemType: 'purchase_order_email',
    noun: 'purchase order',
    // ⚠️ `purchase_order_contact` is nullable and nothing prefills it, so "no contact" is the
    // COMMON case, not an edge case — the message has to be actionable rather than a bare
    // restatement. "Contact" is the field's label in `purchase-order-fields.ts`.
    noContactHint:
      'set the Contact field to the person at the vendor who should receive this order',
    // `issued` IS "sent to the vendor" — one event, no separate `sent` value.
    markSent: ({ organizationId, userId, instanceId }) =>
      markPurchaseOrderSent({ organizationId, userId, purchaseOrderInstanceId: instanceId }),
    sentSubjectFallback: 'Purchase order sent',
  },
  // Registered so `prepareDocumentEmail` does not throw on an unregistered type
  // and so the printing registry stays exhaustive - NOT because a deposit slip
  // is ever emailed. It is an internal document: carried to a teller or filed
  // against the statement. Both hooks below refuse rather than pretend.
  bank_deposit: {
    contactSystemAttribute: 'bank_deposit_contact',
    entityDefsKey: 'bank_deposit',
    // The nearest seeded snippet. Never rendered: the no-contact refusal fires
    // first, every time, because the contact field does not exist.
    snippetSystemType: 'invoice_email',
    noun: 'deposit slip',
    noContactHint:
      'a deposit slip is an internal banking document with no recipient - download it from ' +
      'the deposit instead',
    markSent: async () => {
      throw new BadRequestError(
        'A deposit slip is not sent to anyone. Download it from the deposit and file it ' +
          'against the bank statement.'
      )
    },
    sentSubjectFallback: 'Deposit slip',
  },
}

/**
 * The contact `systemAttribute` of every profile — the single `bySystemAttributes` batch both
 * {@link prepareDocumentEmail} and {@link recordDocumentSendSignal} resolve their recipient
 * field out of. Derived from the table so the fetched set can never drift from it.
 */
const DOCUMENT_CONTACT_SYSTEM_ATTRIBUTES = Object.values(DOCUMENT_EMAIL_PROFILES).map(
  (p) => p.contactSystemAttribute
)

/**
 * Look up the profile for a document type, or throw rather than guess a default. The runtime
 * guard is belt-and-braces over the compile-time `Record<DocumentType, …>` exhaustiveness:
 * `DocumentType` is derived from a mutable descriptor array, so a type registered at runtime
 * that never got a profile row must fail loudly here, the same way `documentTypeOf` does.
 */
export function documentEmailProfile(documentType: DocumentType): DocumentEmailProfile {
  const profile = DOCUMENT_EMAIL_PROFILES[documentType]
  if (!profile) {
    throw new BadRequestError(`No email profile is registered for document type "${documentType}"`)
  }
  return profile
}

/**
 * Resolve a document RecordId's {@link DocumentType} against the document-type registry, or
 * throw.
 *
 * The def component arrives in TWO conventions, and both must keep working: the internal
 * builders (`quote-lifecycle.ts`/`gather.ts`/`money.ts`) use the literal system entityType
 * string (`toRecordId('invoice', ...)`), while the records view / drawer keys off the
 * EntityDefinition CUID (`toRecordId(entityDefinitionId, ...)` in records-view.tsx). The
 * drawer's "Send" button uses the CUID form, so a plain `=== 'invoice'` string check
 * misclassifies every drawer-sent invoice as a quote (money MI1 build spec §H.2/§H.3). Match
 * the literal against every registered `entityType` first, then fall back to the org's
 * `entityDefs` cache so both conventions resolve correctly.
 *
 * Resolution runs over `DOCUMENT_TYPE_DESCRIPTORS` and THROWS on an unregistered def — it
 * must never default. The previous version fell back to `'quote'`, so anything that was not
 * an invoice was classified a quote: the first purchase order sent through this path would
 * have run the quote branch in {@link prepareDocumentEmail} and been minted a public,
 * customer-facing approve/decline link for a document addressed to a vendor (purchasing plan
 * 07 §2.1). Nothing threw — the email sent and the PDF attached. A function that cannot fail
 * cannot tell you it guessed. Adding an entry to the registry is now all that send needs, and
 * forgetting to is a loud error rather than a wrong branch.
 *
 * @param organizationId Org whose `entityDefs` cache resolves the CUID convention.
 * @param recordId The document record being sent.
 * @throws {BadRequestError} when no registered document type matches the record's def.
 */
export async function documentTypeOf(
  organizationId: string,
  recordId: RecordId
): Promise<DocumentType> {
  const { entityDefinitionId } = parseRecordId(recordId)

  // Convention 1 — the literal `EntityDefinition.entityType` slug.
  const byEntityType = DOCUMENT_TYPE_DESCRIPTORS.find((d) => d.entityType === entityDefinitionId)
  if (byEntityType) return byEntityType.id

  // Convention 2 — the per-org `EntityDefinition.id` cuid. `entityDefs` maps entityType slug
  // to def id, which is exactly the pairing the descriptors carry.
  const entityDefs = await getOrgCache().get(organizationId, 'entityDefs')
  const byDefId = DOCUMENT_TYPE_DESCRIPTORS.find(
    (d) => entityDefs[d.entityType] === entityDefinitionId
  )
  if (byDefId) return byDefId.id

  throw new BadRequestError(
    `No document type is registered for entity definition "${entityDefinitionId}" — it cannot be sent as a document`
  )
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
 * Build the prefilled send-email payload for any registered document type — quote, invoice or
 * purchase order (money MQ2 build spec §E.1; MI1 §H.2 added the invoice branch; purchasing
 * plan 07 replaced the branches with {@link DOCUMENT_EMAIL_PROFILES}). Resolves the org's
 * seeded `quote_email`/`invoice_email`/`purchase_order_email` system snippet's placeholder
 * spans against the document + its contact at PREFILL time (not send time) — for
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

  const profile = documentEmailProfile(documentType)

  const noContactMessage = `This ${profile.noun} has no contact — ${profile.noContactHint}`
  const noEmailMessage = `This ${profile.noun} contact has no email address — add one before sending`

  // ─── Step 1: the document's contact (email required to send) ───────────
  // The fetched attribute set is derived from the profile table so the two can never drift.
  const cf = await cache
    .from(organizationId, 'customFields')
    .bySystemAttributes(DOCUMENT_CONTACT_SYSTEM_ATTRIBUTES)
  const contactField = cf[profile.contactSystemAttribute]
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

  // Resolve through `batchGetValues`, NOT the naive `getFieldValues`: `full_name` is a NAME
  // field type (first/last composite, no stored FieldValue row), so the plain join returns
  // nothing for it and the email would go out with a blank recipient name. `batchGetValues`
  // composes NAME (the same resolver placeholders + the PDF payload use).
  const { entityDefinitionId: contactDefId } = parseRecordId(contactRecordId)
  const nameFieldId = contactCf.full_name?.id
  const emailFieldId = contactCf.primary_email?.id
  const fieldIdByRef = new Map<string, string>()
  const fieldReferences = [nameFieldId, emailFieldId]
    .filter((id): id is string => Boolean(id))
    .map((id) => {
      const ref = toResourceFieldId(contactDefId, id)
      fieldIdByRef.set(ref, id)
      return ref
    })
  const { values } = fieldReferences.length
    ? await handler.fieldValueService.batchGetValues({
        recordIds: [contactRecordId],
        fieldReferences,
      })
    : { values: [] }
  const resolvedByFieldId = new Map<string, (typeof values)[number]>()
  for (const v of values) {
    if (Array.isArray(v.fieldRef)) continue
    const fieldId = fieldIdByRef.get(v.fieldRef)
    if (fieldId) resolvedByFieldId.set(fieldId, v)
  }

  const nameHit = nameFieldId ? resolvedByFieldId.get(nameFieldId) : undefined
  const nameTyped = nameHit
    ? firstTyped(Array.isArray(nameHit.value) ? nameHit.value[0] : (nameHit.value ?? undefined))
    : undefined
  const emailHit = emailFieldId ? resolvedByFieldId.get(emailFieldId) : undefined
  const emailTyped = emailHit
    ? firstTyped(Array.isArray(emailHit.value) ? emailHit.value[0] : (emailHit.value ?? undefined))
    : undefined

  const contactName =
    nameTyped && nameHit
      ? (() => {
          const formatted = formatToDisplayValue(nameTyped, nameHit.fieldType, nameHit.fieldOptions)
          return formatted === null || formatted === undefined ? undefined : String(formatted)
        })()
      : undefined
  const contactEmail = emailTyped ? (extractValue(emailTyped) as string) : undefined

  if (!contactEmail) {
    throw new BadRequestError(noEmailMessage)
  }

  // ─── Step 2: the seeded per-document-type system snippet ────────────────
  const snippet = await getSystemSnippet(db, organizationId, profile.snippetSystemType)

  // ─── Step 3: resolve the snippet's placeholder spans ────────────────────
  // recordIdsByRoot keys off `EntityDefinition.id` cuids (the field-token
  // root — see system-snippets.ts's `fieldToken`), NOT the RecordId's own
  // (possibly literal-type-string) def component.
  const entityDefs = await cache.get(organizationId, 'entityDefs')
  const documentDefId = entityDefs[profile.entityDefsKey]
  const recordIdsByRoot = new Map<string, RecordId>()
  if (documentDefId) recordIdsByRoot.set(documentDefId, documentRecordId)
  if (entityDefs.contact) recordIdsByRoot.set(entityDefs.contact, contactRecordId)

  const placeholderCtx: PlaceholderResolutionContext = {
    db,
    organizationId,
    senderUserId: userId,
    recordIdsByRoot,
  }
  // `Snippet.contentHtml` is nullable — an org that cleared the seeded system snippet
  // sends an empty body plus the appended link, rather than crashing the resolver.
  let contentHtml = await resolvePlaceholdersInHtml(snippet.contentHtml ?? '', placeholderCtx)

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
  //
  // DO NOT HOIST `ensureQuotePublicToken` / `buildQuoteViewUrl` OUT OF THIS BRANCH.
  // `./quote-public-token` is imported at module level, so the only thing keeping a quote
  // public token off a non-quote document is this `documentType === 'quote'` test
  // (purchasing plan 07 §2.3). A quote's public link exists so a CUSTOMER can approve or
  // decline; a purchase order is addressed to a VENDOR, who responds by email or by shipping,
  // and must never be handed an approve/decline link. Minting one fails silently — the email
  // still sends, the PDF still attaches — so a refactor that lifts token minting to the
  // common path would re-acquire the §2.1 bug with no test and no exception to notice it by.
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
 * document's lifecycle status (quote/invoice `sent`, purchase order `issued`). Resolves the
 * recipient contact — through the same {@link DOCUMENT_EMAIL_PROFILES} table the email itself
 * used — and the linked work order (if any) so the job/contact communications view is honest
 * about manual sends, not just sequence sends. Never throws — a signal-write failure must not
 * fail (or retroactively look like it failed) an email that already went out.
 *
 * `documentType` flows straight into `toSignalRecordKey`, so every `DocumentType` must also
 * be a `SignalRecordKind` (`signals/record-signal.ts`).
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
    // Same profile table as `prepareDocumentEmail`, so the signal's recipient is by
    // construction the address the email actually went to.
    const contactCf = await cache
      .from(organizationId, 'customFields')
      .bySystemAttributes([...DOCUMENT_CONTACT_SYSTEM_ATTRIBUTES, 'primary_email' as const])
    const contactField = contactCf[documentEmailProfile(documentType).contactSystemAttribute]

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
    // NOT table-ified: this is not one concept with three spellings. The two fields have
    // different cardinality (belongs_to vs has_many) and therefore different extraction, and
    // a purchase order has no work-order link at all — it is a supplier document, not a job
    // document. Both `if` arms simply don't fire for it, which is the correct behavior.
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
