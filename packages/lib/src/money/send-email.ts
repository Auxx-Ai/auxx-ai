// packages/lib/src/money/send-email.ts

import { database as db } from '@auxx/database'
import type { RecordId, TypedFieldValue } from '@auxx/types'
import { extractValue } from '@auxx/types'
import { getOrgCache } from '../cache'
import { ensureQuotePdf, ensureQuotePdfViaQueue } from '../documents'
import { BadRequestError } from '../errors'
import type { PlaceholderResolutionContext } from '../placeholders'
import { resolvePlaceholdersInHtml } from '../placeholders'
import { UnifiedCrudHandler } from '../resources/crud'
import { getSystemSnippet } from '../snippets'

/** Unwrap a `getFieldValues()` map entry — takes the first value if array-returned. */
function firstTyped(
  entry: TypedFieldValue | TypedFieldValue[] | undefined
): TypedFieldValue | undefined {
  if (!entry) return undefined
  return Array.isArray(entry) ? entry[0] : entry
}

export interface EnsureQuoteDocumentPdfInput {
  organizationId: string
  actorId: string
  quoteRecordId: RecordId
}

export interface EnsureQuoteDocumentPdfResult {
  assetId: string
  fileName: string
}

/**
 * Render-or-reuse the quote PDF, preferring the queue-backed path
 * (`ensureQuotePdfViaQueue` — keeps the CPU-bound yoga layout work off the
 * API request where possible) with a same-request inline fallback
 * (`ensureQuotePdf`) if the queue await fails for any reason (worker down,
 * BullMQ hiccup, timeout, ...) — money MQ2 build spec §C.3/§E.1 step 4.
 * Shared by `prepareDocumentEmail` (below) and the `money.ensureDocumentPdf`
 * router mutation (the Download PDF button).
 */
export async function ensureQuoteDocumentPdf(
  input: EnsureQuoteDocumentPdfInput
): Promise<EnsureQuoteDocumentPdfResult> {
  const { organizationId, actorId, quoteRecordId } = input
  try {
    return await ensureQuotePdfViaQueue({ organizationId, quoteRecordId, actorId })
  } catch {
    return await ensureQuotePdf({ organizationId, quoteRecordId, actorId })
  }
}

export interface PrepareDocumentEmailInput {
  organizationId: string
  userId: string
  quoteRecordId: RecordId
}

export interface PrepareDocumentEmailResult {
  to: { email: string; name?: string }[]
  subject: string
  contentHtml: string
  attachment: { id: string; name: string; type: 'asset' }
}

/**
 * Build the prefilled send-email payload for a quote (money MQ2 build spec
 * §E.1). Resolves the org's seeded `quote_email` system snippet's
 * placeholder spans against the quote + its contact at PREFILL time (not
 * send time) — for a brand-new outbound thread the primary-entity link is
 * only applied AFTER send (`thread.ts`'s `linkTicketId` block), so send-time
 * resolution would have no record to resolve `quote:*`/`contact:*` tokens
 * against. Resolving now means the user sees (and can edit) the final text
 * before it goes out, and the composer's own placeholder-resolution path
 * stays untouched.
 */
export async function prepareDocumentEmail(
  input: PrepareDocumentEmailInput
): Promise<PrepareDocumentEmailResult> {
  const { organizationId, userId, quoteRecordId } = input
  const handler = new UnifiedCrudHandler(organizationId, userId)
  const cache = getOrgCache()

  // ─── Step 1: the quote's contact (email required to send) ──────────────
  const cf = await cache
    .from(organizationId, 'customFields')
    .bySystemAttributes(['quote_contact'] as const)
  const contactFieldId = cf.quote_contact?.id
  const quoteValues = contactFieldId
    ? await handler.getFieldValues(quoteRecordId, [contactFieldId])
    : new Map<string, TypedFieldValue | TypedFieldValue[]>()
  const contactTyped = contactFieldId ? firstTyped(quoteValues.get(contactFieldId)) : undefined
  const contactRecordId = contactTyped?.type === 'relationship' ? contactTyped.recordId : undefined

  if (!contactRecordId) {
    throw new BadRequestError('This quote has no contact — add one before sending')
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
    throw new BadRequestError('This quote contact has no email address — add one before sending')
  }

  // ─── Step 2: the seeded quote_email system snippet ──────────────────────
  const snippet = await getSystemSnippet(db, organizationId, 'quote_email')

  // ─── Step 3: resolve the snippet's placeholder spans ────────────────────
  // recordIdsByRoot keys off `EntityDefinition.id` cuids (the field-token
  // root — see system-snippets.ts's `fieldToken`), NOT the RecordId's own
  // (possibly literal-type-string) def component.
  const entityDefs = await cache.get(organizationId, 'entityDefs')
  const recordIdsByRoot = new Map<string, RecordId>()
  if (entityDefs.quote) recordIdsByRoot.set(entityDefs.quote, quoteRecordId)
  if (entityDefs.contact) recordIdsByRoot.set(entityDefs.contact, contactRecordId)

  const placeholderCtx: PlaceholderResolutionContext = {
    db,
    organizationId,
    senderUserId: userId,
    recordIdsByRoot,
  }
  const contentHtml = await resolvePlaceholdersInHtml(snippet.contentHtml, placeholderCtx)

  // ─── Step 4: ensure the PDF is ready to attach ───────────────────────────
  const { assetId, fileName } = await ensureQuoteDocumentPdf({
    organizationId,
    actorId: userId,
    quoteRecordId,
  })

  return {
    to: [{ email: contactEmail, name: contactName }],
    subject: snippet.title,
    contentHtml,
    attachment: { id: assetId, name: fileName, type: 'asset' },
  }
}
