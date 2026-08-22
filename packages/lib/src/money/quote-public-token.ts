// packages/lib/src/money/quote-public-token.ts

import { WEBAPP_URL } from '@auxx/config/urls'
import { database, schema } from '@auxx/database'
import type { TypedFieldValue } from '@auxx/types'
import { extractValue } from '@auxx/types'
import { toRecordId } from '@auxx/types/resource'
import { generateId } from '@auxx/utils'
import { and, eq, gt } from 'drizzle-orm'
import { getOrgCache } from '../cache'
import type { PdfPhotoRef, QuotePdfContact, QuotePdfLineItem } from '../documents/payload'
import type {
  DocumentBrandingSettings,
  DocumentBusinessSettings,
} from '../documents/resolve-settings'
import { FieldValueService } from '../field-values/field-value-service'
import { MediaAssetService } from '../files/core/media-asset-service'
import { UnifiedCrudHandler } from '../resources/crud'
import { quietSession } from '../resources/crud/write-origin'
import { getPaymentAccount } from './payments/account-state'
import { resolveQuoteDeposit } from './payments/deposit'
import { isPaymentsConnected } from './public-token'
import type { DiscountType } from './types'

/**
 * C5 (plan 04 §3), and the silence here is LOAD-BEARING, not incidental (O-5).
 * Tier-1 `fieldValues:updated` carries raw stored values to a room gated only on
 * org membership plus `canViewEntity(defId)`. A public token is a bearer
 * capability — the public resolver is org-agnostic by design — so broadcasting
 * it to every member with def-level view on quotes is a WIDER audience than the
 * read path grants. Un-suppressing this is a confidentiality regression, not a
 * fidelity improvement.
 */
const QUIET_PUBLIC_TOKEN = quietSession(
  'a public token is a bearer capability; tier-1 frames carry raw values to a def-room audience wider than the token read path grants (plan 04 O-5)'
)

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
  const fieldValueService = new FieldValueService(
    organizationId,
    systemUserId,
    undefined,
    undefined,
    { session: QUIET_PUBLIC_TOKEN }
  )
  await fieldValueService.setValuesForEntity({
    recordId: quoteRecordId,
    values: [{ fieldId: field.id, value: token }],
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

/**
 * Flip an abandoned deposit Checkout's `pending` ledger row to `canceled` (money MP2 §B.6) —
 * called by the quote page when the customer lands back via `cancel_url`
 * (`?checkout=cancel&tx=…`). Direct mirror of the invoice flow's `cancelAbandonedCheckout`
 * (`public-token.ts`): guarded by the token AND the row's quote/provider/kind/status, so the
 * public `tx` param can only ever cancel this quote's own pending deposit charge — never
 * anything else, never twice. Safe even if the customer later pays the (still-open) Stripe
 * session anyway: the webhook's `markChargeSucceeded` flips `canceled → succeeded` and the
 * deposit settles normally.
 */
export async function cancelAbandonedDepositCheckout(
  token: string,
  transactionId: string
): Promise<void> {
  const resolved = await resolveQuoteByPublicToken(token)
  if (!resolved) return

  await database
    .update(schema.PaymentTransaction)
    .set({ status: 'canceled' })
    .where(
      and(
        eq(schema.PaymentTransaction.id, transactionId),
        eq(schema.PaymentTransaction.organizationId, resolved.organizationId),
        eq(schema.PaymentTransaction.quoteInstanceId, resolved.quoteInstanceId),
        eq(schema.PaymentTransaction.provider, 'stripe'),
        eq(schema.PaymentTransaction.kind, 'charge'),
        eq(schema.PaymentTransaction.status, 'pending')
      )
    )
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
  /** Header-level site photos (plan 37b §6), `quote_photos` — already internal-filtered by
   * `buildQuotePdfPayload`. Backs the "Photos" gallery section on the public quote page. */
  photos: PdfPhotoRef[]
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
  /** Integer cents — resolved via `resolveQuoteDeposit`. 0 = no deposit configured, hides the
   * deposit card entirely (money MP2 build spec §B.5). */
  depositAmount: number
  /** A succeeded Stripe charge exists for this quote's deposit. */
  depositPaid: boolean
  /** A pending Stripe charge exists for this quote's deposit — mirrors the invoice payload's
   * `processingPayment` flag. */
  depositPending: boolean
  /** Org has a connected, chargesEnabled, non-disconnected `PaymentAccount` — same predicate
   * `/pay/[token]` uses. Gates the deposit Pay button. */
  paymentsEnabled: boolean
}

/** How long a `pending` deposit Checkout row keeps the quote page in its "processing" state —
 * mirrors `public-token.ts`'s `PROCESSING_WINDOW_MS` for the invoice pay page. */
const DEPOSIT_PROCESSING_WINDOW_MS = 30 * 60 * 1000

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
          'quote_total',
        ] as const),
    ])

  const evidenceFieldIds = [
    cf.quote_accepted_by_name,
    cf.quote_accepted_at,
    cf.quote_decline_reason,
    cf.quote_total,
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
  const storedTotalTyped = getEvidence(cf.quote_total)

  const acceptedByName = acceptedByNameTyped ? (extractValue(acceptedByNameTyped) as string) : null
  const acceptedAt = acceptedAtTyped ? (extractValue(acceptedAtTyped) as string) : null
  const declineReason = declineReasonTyped ? (extractValue(declineReasonTyped) as string) : null
  // Read the stored `quote_total` mirror (not `payload.total`, which `buildQuotePdfPayload`
  // recomputes from lines) — `resolveQuoteDeposit`'s own contract resolves against "the
  // quote's `quote_total`", and using the same source here as `createStripeDepositCheckout`
  // does keeps the displayed deposit amount byte-identical to what gets charged.
  const storedTotal = storedTotalTyped ? (extractValue(storedTotalTyped) as number) : payload.total

  const todayIso = new Date().toISOString().slice(0, 10)
  const isExpired = !!payload.validUntil && payload.validUntil < todayIso

  const [{ depositAmount }, account, pendingDeposit, succeededDeposit] = await Promise.all([
    resolveQuoteDeposit(organizationId, quoteInstanceId, storedTotal),
    getPaymentAccount(organizationId),
    database.query.PaymentTransaction.findFirst({
      // Time-bounded the same way the invoice payload's `pendingCharge` lookup is
      // (`public-token.ts`) — a `pending` row is minted at Checkout CREATION, so its bare
      // existence only means a session was opened, not that money moved. Silently-abandoned
      // tabs age out of this window instead of wedging the page in "processing" forever; the
      // webhook remains the truth — a stale session paid after the window still settles.
      where: and(
        eq(schema.PaymentTransaction.organizationId, organizationId),
        eq(schema.PaymentTransaction.quoteInstanceId, quoteInstanceId),
        eq(schema.PaymentTransaction.provider, 'stripe'),
        eq(schema.PaymentTransaction.kind, 'charge'),
        eq(schema.PaymentTransaction.status, 'pending'),
        gt(schema.PaymentTransaction.updatedAt, new Date(Date.now() - DEPOSIT_PROCESSING_WINDOW_MS))
      ),
      columns: { id: true },
    }),
    database.query.PaymentTransaction.findFirst({
      where: and(
        eq(schema.PaymentTransaction.organizationId, organizationId),
        eq(schema.PaymentTransaction.quoteInstanceId, quoteInstanceId),
        eq(schema.PaymentTransaction.provider, 'stripe'),
        eq(schema.PaymentTransaction.kind, 'charge'),
        eq(schema.PaymentTransaction.status, 'succeeded')
      ),
      columns: { id: true },
    }),
  ])

  return {
    number: payload.number,
    status: payload.status,
    issuedAt: payload.issuedAt,
    validUntil: payload.validUntil,
    isExpired,
    terms: payload.terms,
    contact: payload.contact,
    lines: payload.lines,
    photos: payload.photos ?? [],
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
    depositAmount,
    depositPaid: !!succeededDeposit,
    depositPending: !!pendingDeposit,
    paymentsEnabled: isPaymentsConnected(account),
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
