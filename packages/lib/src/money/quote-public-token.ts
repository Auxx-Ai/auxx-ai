// packages/lib/src/money/quote-public-token.ts

import { WEBAPP_URL } from '@auxx/config/urls'
import { database, schema } from '@auxx/database'
import type { TypedFieldValue } from '@auxx/types'
import { extractValue } from '@auxx/types'
import { toRecordId } from '@auxx/types/resource'
import { generateId } from '@auxx/utils'
import { eq } from 'drizzle-orm'
import { getOrgCache } from '../cache'
import type {
  DiscountType,
  DocumentBrandingSettings,
  DocumentBusinessSettings,
  QuotePdfContact,
  QuotePdfLineItem,
} from '../documents/payload'
import { FieldValueService } from '../field-values/field-value-service'
import { MediaAssetService } from '../files/core/media-asset-service'
import { UnifiedCrudHandler } from '../resources/crud'

/**
 * The public `/quote/{token}` capability-token machinery (v5 build spec 01 — client-facing
 * quote acceptance page). Direct mirror of `money/public-token.ts` (the invoice `/pay/{token}`
 * machinery). Kept free of any static import of `documents/payload.ts` — that module statically
 * imports `ensureInvoicePublicToken` from `public-token.ts` to inject the pay-link into the
 * invoice PDF payload, so `getPublicQuotePayload` below reaches back into `buildQuotePdfPayload`
 * via a dynamic `import()` for the same defensive reason (the repo's established
 * lazy-import fix for this exact shape — see `public-token.ts`'s module doc comment).
 */

/** Unwrap a `getFieldValues()` map entry — takes the first value if array-returned. */
function firstTyped(
  entry: TypedFieldValue | TypedFieldValue[] | undefined
): TypedFieldValue | undefined {
  if (!entry) return undefined
  return Array.isArray(entry) ? entry[0] : entry
}

/**
 * Mint-or-fetch a quote's `publicToken` (v5 build spec 01) — the unguessable capability token
 * backing `/quote/{token}`. Idempotent: reads first, only writes when empty. Writes bypass
 * `quote_public_token`'s `creatable:false`/`updatable:false` capability the same way
 * `ensureInvoicePublicToken` does — `FieldValueService` is a sanctioned-writer path that
 * structurally skips the system CRUD capability check. A rare concurrent double-mint (two
 * callers racing on an empty field) is acceptable — both writes are valid tokens and the last
 * one wins; nothing depends on token stability across that narrow window.
 */
export async function ensureQuotePublicToken(
  organizationId: string,
  quoteInstanceId: string
): Promise<string> {
  const quoteRecordId = toRecordId('quote', quoteInstanceId)
  const systemUserId = await getOrgCache().get(organizationId, 'systemUser')
  const handler = new UnifiedCrudHandler(organizationId, systemUserId)
  const cache = getOrgCache()

  const cf = await cache
    .from(organizationId, 'customFields')
    .bySystemAttributes(['quote_public_token'] as const)
  const field = cf.quote_public_token
  if (!field) {
    // Field not provisioned on this org yet (pre-041 org that hasn't run the migration) —
    // nothing to mint against. Callers treat an empty token as "acceptance page unavailable".
    return ''
  }

  const existingValues = await handler.getFieldValues(quoteRecordId, [field.id])
  const existingTyped = firstTyped(existingValues.get(field.id))
  const existing = existingTyped ? (extractValue(existingTyped) as string) : undefined
  if (existing) return existing

  const token = generateId()
  const fieldValueService = new FieldValueService(organizationId, systemUserId)
  await fieldValueService.setValuesForEntity({
    recordId: quoteRecordId,
    values: [{ fieldId: field.id, value: token }],
    publishEvents: false,
  })

  return token
}

/** Build the absolute `/quote/{token}` URL from a minted token. */
export function buildQuoteViewUrl(token: string): string {
  return `${WEBAPP_URL}/quote/${token}`
}

/**
 * Resolve a quote by its public `publicToken` — org-agnostic by design (the token IS the
 * capability, mirrors `resolveInvoiceByPublicToken`). Reads `FieldValue` directly rather than
 * through `UnifiedCrudHandler`/the org cache, since the caller doesn't know the organization
 * yet. `entityDefinitionId` is checked against the literal `'quote'` type-slug (the
 * `send-email.ts`/`quote-lifecycle.ts` convention: `toRecordId('quote', id)` stamps this
 * literal, not the def's cuid) as a defensive belt on top of the systemAttribute check.
 */
export async function resolveQuoteByPublicToken(
  token: string
): Promise<{ organizationId: string; quoteInstanceId: string } | null> {
  if (!token) return null

  const row = await database.query.FieldValue.findFirst({
    where: eq(schema.FieldValue.valueText, token),
    with: { field: true },
  })
  if (!row) return null
  if (row.entityDefinitionId !== 'quote') return null
  if (row.field?.systemAttribute !== 'quote_public_token') return null

  return { organizationId: row.organizationId, quoteInstanceId: row.entityId }
}

/** One rendered line on the public quote acceptance page. */
export type PublicQuoteLine = QuotePdfLineItem

/** Everything the public `/quote/[token]` page needs to render (v5 build spec 01). */
export interface PublicQuotePayload {
  number: string
  /** `quote_status` — `'draft' | 'sent' | 'approved' | 'declined' | 'canceled'`. */
  status: string
  issuedAt: string
  /** ISO date, or `null` when unset. */
  validUntil: string | null
  /** `validUntil` strictly before today — only meaningful while `status === 'sent'`. */
  isExpired: boolean
  terms: string | null
  contact: QuotePdfContact
  lines: PublicQuoteLine[]
  /** Integer cents. */
  subtotal: number
  discountType: DiscountType | null
  discountValue: number | null
  /** Integer cents. */
  discountAmount: number
  taxName: string | null
  taxRate: number | null
  /** Integer cents. */
  taxTotal: number
  /** Integer cents. */
  total: number
  currency: string
  business: DocumentBusinessSettings
  branding: DocumentBrandingSettings
  /** Typed-signature name captured on accept, or `null`. */
  acceptedByName: string | null
  /** ISO timestamp captured on accept, or `null`. */
  acceptedAt: string | null
  /** Reason captured on decline, or `null`. */
  declineReason: string | null
  /** `documents.quote.acceptancePageEnabled` — `false` means the route 404s the visitor;
   * the payload is still returned (not `null`) so the page can distinguish "disabled" from
   * "unknown token" while testing. */
  acceptancePageEnabled: boolean
  /** `documents.quote.allowDecline` — gates the Decline action. */
  allowDecline: boolean
  /** `documents.quote.requireSignature` — gates whether the name field is required to accept. */
  requireSignature: boolean
}

/**
 * The public quote-page payload builder (v5 build spec 01). Resolves the token, reuses
 * `buildQuotePdfPayload` (documents MQ2 payload shaping, read-only) for the branded-document
 * fields, layers on the acceptance-evidence fields + the org's acceptance-page settings.
 * Returns `null` on an unknown/stale token — the route's `notFound()` trigger.
 */
export async function getPublicQuotePayload(token: string): Promise<PublicQuotePayload | null> {
  const resolved = await resolveQuoteByPublicToken(token)
  if (!resolved) return null
  const { organizationId, quoteInstanceId } = resolved

  // Dynamic import — see the module-doc comment above for why this can't be a static import.
  const { buildQuotePdfPayload } = await import('../documents/payload')
  const { getOrganizationSetting } = await import('../settings/settings-service')

  const systemUserId = await getOrgCache().get(organizationId, 'systemUser')
  const quoteRecordId = toRecordId('quote', quoteInstanceId)
  const handler = new UnifiedCrudHandler(organizationId, systemUserId)
  const cache = getOrgCache()

  const [{ payload }, acceptancePageEnabled, allowDecline, requireSignature, cf] =
    await Promise.all([
      buildQuotePdfPayload({ organizationId, userId: systemUserId, quoteRecordId }),
      getOrganizationSetting({ organizationId, key: 'documents.quote.acceptancePageEnabled' }),
      getOrganizationSetting({ organizationId, key: 'documents.quote.allowDecline' }),
      getOrganizationSetting({ organizationId, key: 'documents.quote.requireSignature' }),
      cache
        .from(organizationId, 'customFields')
        .bySystemAttributes([
          'quote_accepted_by_name',
          'quote_accepted_at',
          'quote_decline_reason',
        ] as const),
    ])

  const evidenceFieldIds = [
    cf.quote_accepted_by_name,
    cf.quote_accepted_at,
    cf.quote_decline_reason,
  ]
    .filter(Boolean)
    .map((f) => f!.id)
  const evidenceValues = evidenceFieldIds.length
    ? await handler.getFieldValues(quoteRecordId, evidenceFieldIds)
    : new Map<string, TypedFieldValue | TypedFieldValue[]>()
  const getEvidence = (f?: { id: string } | null) =>
    f ? firstTyped(evidenceValues.get(f.id)) : undefined

  const acceptedByNameTyped = getEvidence(cf.quote_accepted_by_name)
  const acceptedAtTyped = getEvidence(cf.quote_accepted_at)
  const declineReasonTyped = getEvidence(cf.quote_decline_reason)

  const acceptedByName = acceptedByNameTyped ? (extractValue(acceptedByNameTyped) as string) : null
  const acceptedAt = acceptedAtTyped ? (extractValue(acceptedAtTyped) as string) : null
  const declineReason = declineReasonTyped ? (extractValue(declineReasonTyped) as string) : null

  const todayIso = new Date().toISOString().split('T')[0]
  const isExpired = !!payload.validUntil && payload.validUntil < todayIso

  return {
    number: payload.number,
    status: payload.status,
    issuedAt: payload.issuedAt,
    validUntil: payload.validUntil,
    isExpired,
    terms: payload.terms,
    contact: payload.contact,
    lines: payload.lines,
    subtotal: payload.subtotal,
    discountType: payload.discountType,
    discountValue: payload.discountValue,
    discountAmount: payload.discountAmount,
    taxName: payload.taxName,
    taxRate: payload.taxRate,
    taxTotal: payload.taxTotal,
    total: payload.total,
    currency: payload.settings.currency,
    business: payload.settings.business,
    branding: payload.settings.branding,
    acceptedByName,
    acceptedAt,
    declineReason,
    acceptancePageEnabled: !!acceptancePageEnabled,
    allowDecline: !!allowDecline,
    requireSignature: !!requireSignature,
  }
}

/** Result of {@link getQuotePdfByToken} — raw bytes for an unauthenticated download response. */
export interface PublicQuotePdfResult {
  buffer: Buffer
  filename: string
  contentType: string
}

/**
 * Stream the quote PDF for the public page's "Download PDF" link — resolves the token, then
 * reuses the same render-or-reuse engine `prepareDocumentEmail`/the Download PDF button call
 * (`ensureDocumentPdf`, documents MQ2 build spec §C.2) so the public page never renders its own
 * copy, and reads the resulting `MediaAsset`'s bytes straight off storage via
 * `MediaAssetService.getContent` (the `message-sender.service.ts` attachment-read precedent).
 * Returns `null` on an unknown/stale token — the route's `notFound()` trigger.
 */
export async function getQuotePdfByToken(token: string): Promise<PublicQuotePdfResult | null> {
  const resolved = await resolveQuoteByPublicToken(token)
  if (!resolved) return null
  const { organizationId, quoteInstanceId } = resolved

  // The acceptance-page master switch gates EVERY public surface for this token — the page
  // 404s when it's off, so the PDF endpoint must too (same "don't leak which case" rule).
  const { getOrganizationSetting } = await import('../settings/settings-service')
  const acceptancePageEnabled = await getOrganizationSetting({
    organizationId,
    key: 'documents.quote.acceptancePageEnabled',
  })
  if (!acceptancePageEnabled) return null

  const { ensureDocumentPdf } = await import('../documents')

  const systemUserId = await getOrgCache().get(organizationId, 'systemUser')
  const quoteRecordId = toRecordId('quote', quoteInstanceId)

  const { assetId, fileName } = await ensureDocumentPdf({
    documentType: 'quote',
    organizationId,
    recordId: quoteRecordId,
    actorId: systemUserId,
  })

  const mediaAssetService = new MediaAssetService(organizationId, systemUserId)
  const [asset, buffer] = await Promise.all([
    mediaAssetService.getWithRelations(assetId),
    mediaAssetService.getContent(assetId),
  ])

  return {
    buffer,
    filename: asset?.name ?? fileName,
    contentType: asset?.mimeType ?? 'application/pdf',
  }
}
