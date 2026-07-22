// packages/lib/src/money/public-token.ts

import { WEBAPP_URL } from '@auxx/config/urls'
import { database, schema } from '@auxx/database'
import type { TypedFieldValue } from '@auxx/types'
import { extractValue } from '@auxx/types'
import { toRecordId } from '@auxx/types/resource'
import { generateId } from '@auxx/utils'
import { and, eq, gt } from 'drizzle-orm'
import { getOrgCache } from '../cache'
import type {
  DiscountType,
  DocumentBrandingSettings,
  DocumentBusinessSettings,
  PdfPhotoRef,
  QuotePdfContact,
  QuotePdfLineItem,
} from '../documents/payload'
import { FieldValueService } from '../field-values/field-value-service'
import { UnifiedCrudHandler } from '../resources/crud'
import { getOrganizationSetting } from '../settings/settings-service'
import { getPaymentAccount } from './payments/account-state'
import { getInvoiceDepositApplied } from './payments/allocation-reads'
import { resolvePartialPaymentBounds } from './payments/partial'

/**
 * The public `/pay/{token}` capability-token machinery (money MP1 build spec §H/§I). Kept
 * free of any static import of `documents/payload.ts` — that module imports
 * `ensureInvoicePublicToken` from here (to inject the pay-link into the PDF payload/content
 * hash), so `getPublicInvoicePayload` below reaches back into `buildInvoicePdfPayload` via a
 * dynamic `import()` to avoid a static circular dependency (the repo's established
 * lazy-import fix for this exact shape — see the realtime-barrel/app-runtime precedents).
 */

/** Unwrap a `getFieldValues()` map entry — takes the first value if array-returned. */
function firstTyped(
  entry: TypedFieldValue | TypedFieldValue[] | undefined
): TypedFieldValue | undefined {
  if (!entry) return undefined
  return Array.isArray(entry) ? entry[0] : entry
}

/**
 * Mint-or-fetch an invoice's `publicToken` (money MP1 build spec §H) — the unguessable
 * capability token backing `/pay/{token}`. Idempotent: reads first, only writes when empty.
 * Writes bypass `invoice_public_token`'s `creatable:false`/`updatable:false` capability the
 * same way `invoice_pdf_asset` does — `FieldValueService` is a sanctioned-writer path that
 * structurally skips the system CRUD capability check (the `convert-quote.ts` precedent).
 * A rare concurrent double-mint (two callers racing on an empty field) is acceptable — both
 * writes are valid tokens and the last one wins; nothing depends on token stability across
 * that narrow window.
 */
export async function ensureInvoicePublicToken(
  organizationId: string,
  invoiceInstanceId: string
): Promise<string> {
  const invoiceRecordId = toRecordId('invoice', invoiceInstanceId)
  const systemUserId = await getOrgCache().get(organizationId, 'systemUser')
  const handler = new UnifiedCrudHandler(organizationId, systemUserId)
  const cache = getOrgCache()

  const cf = await cache
    .from(organizationId, 'customFields')
    .bySystemAttributes(['invoice_public_token'] as const)
  const field = cf.invoice_public_token
  if (!field) {
    // Field not provisioned on this org yet (pre-036 org that hasn't run the migration) —
    // nothing to mint against. Callers treat an empty token as "payments unavailable".
    return ''
  }

  const existingValues = await handler.getFieldValues(invoiceRecordId, [field.id])
  const existingTyped = firstTyped(existingValues.get(field.id))
  const existing = existingTyped ? (extractValue(existingTyped) as string) : undefined
  if (existing) return existing

  const token = generateId()
  const fieldValueService = new FieldValueService(organizationId, systemUserId)
  await fieldValueService.setValuesForEntity({
    recordId: invoiceRecordId,
    values: [{ fieldId: field.id, value: token }],
    publishEvents: false,
  })

  return token
}

/** Build the absolute `/pay/{token}` URL from a minted token. */
export function buildPayUrl(token: string): string {
  return `${WEBAPP_URL}/pay/${token}`
}

/** How long a `pending` Checkout row keeps the public page in its "processing" state. */
const PROCESSING_WINDOW_MS = 30 * 60 * 1000

/**
 * Flip an abandoned Checkout's `pending` ledger row to `canceled` (money MP1 §I) — called by
 * the pay page when the shopper lands back via `cancel_url` (`?checkout=cancel&tx=…`). Guarded
 * by the token AND the row's invoice/provider/kind/status, so the public `tx` param can only
 * ever cancel the invoice's own pending Stripe charge — never anything else, never twice.
 * Safe even if the shopper later pays the (still-open) Stripe session anyway: the webhook's
 * `markChargeSucceeded` flips `canceled → succeeded` and the payment settles normally.
 */
export async function cancelAbandonedCheckout(token: string, transactionId: string): Promise<void> {
  const resolved = await resolveInvoiceByPublicToken(token)
  if (!resolved) return

  await database
    .update(schema.PaymentTransaction)
    .set({ status: 'canceled' })
    .where(
      and(
        eq(schema.PaymentTransaction.id, transactionId),
        eq(schema.PaymentTransaction.organizationId, resolved.organizationId),
        eq(schema.PaymentTransaction.invoiceInstanceId, resolved.invoiceInstanceId),
        eq(schema.PaymentTransaction.provider, 'stripe'),
        eq(schema.PaymentTransaction.kind, 'charge'),
        eq(schema.PaymentTransaction.status, 'pending')
      )
    )
}

/**
 * The single "can this org accept a Stripe payment right now" predicate — connected,
 * chargesEnabled, not disconnected (money MP1 build spec §J/§I). Centralized so the three
 * pay-link gates (email, PDF, public page) can't drift out of sync with each other.
 */
export function isPaymentsConnected(
  account: {
    chargesEnabled: boolean
    disconnectedAt: Date | null
    credentialId: string | null
  } | null
): boolean {
  return !!(account?.chargesEnabled && !account.disconnectedAt && account.credentialId)
}

/**
 * Resolve an invoice by its public `publicToken` — org-agnostic by design (the token IS the
 * capability, money MP1 build spec §I). Reads `FieldValue` directly rather than through
 * `UnifiedCrudHandler`/the org cache, since the caller doesn't know the organization yet.
 * `entityDefinitionId` is checked against the literal `'invoice'` type-slug (the
 * `send-email.ts`/`gather.ts` convention: `toRecordId('invoice', id)` stamps this literal,
 * not the def's cuid) as a defensive belt on top of the systemAttribute check.
 */
export async function resolveInvoiceByPublicToken(
  token: string
): Promise<{ organizationId: string; invoiceInstanceId: string } | null> {
  if (!token) return null

  const row = await database.query.FieldValue.findFirst({
    where: eq(schema.FieldValue.valueText, token),
    with: { field: true },
  })
  if (!row) return null
  if (row.entityDefinitionId !== 'invoice') return null
  if (row.field?.systemAttribute !== 'invoice_public_token') return null

  return { organizationId: row.organizationId, invoiceInstanceId: row.entityId }
}

/** One rendered line on the public pay page. */
export type PublicInvoiceLine = QuotePdfLineItem

/** Everything the public `/pay/[token]` page needs to render (money MP1 build spec §I). */
export interface PublicInvoicePayload {
  number: string
  status: string
  issuedAt: string
  dueDate: string | null
  terms: string | null
  contact: QuotePdfContact
  lines: PublicInvoiceLine[]
  /** Header-level photos (plan 37b §6), `invoice_photos` — already internal-filtered by
   * `buildInvoicePdfPayload`. Backs the "Photos" gallery section on the public pay page. */
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
  /** Integer cents. */
  amountPaid: number
  /** Integer cents. */
  balance: number
  /** Integer cents — deposit-accounting plan 16 §E. Σ allocation amounts posted against this
   * invoice from succeeded quote-deposit charges (refund copies net back to zero). `0` when no
   * deposit was ever applied — the "Deposit applied" line only renders when this is positive.
   * Already netted into `amountPaid`/`balance` above (allocations ARE the payment math, §C.1)
   * — this is purely the labeled breakout line, not additional money. */
  depositApplied: number
  currency: string
  business: DocumentBusinessSettings
  branding: DocumentBrandingSettings
  /** Org has a connected, chargesEnabled, non-disconnected `PaymentAccount` — gates the Pay button. */
  paymentsEnabled: boolean
  /** A pending Stripe charge ledger row exists for this invoice — never render "Paid" while true. */
  processingPayment: boolean
  /** `documents.invoice.allowPartialPayments` — lets the pay page accept a custom amount. */
  allowPartialPayments: boolean
  /** Integer cents — the smallest amount the pay page will submit, per
   * `documents.invoice.partialPaymentMinPercent` (money MP2 §C). Pre-computed here via
   * `resolvePartialPaymentBounds` so the client never re-derives the percent math. */
  minPaymentAmount: number
}

/**
 * The public pay-page payload builder (money MP1 build spec §I). Resolves the token,
 * reuses `buildInvoicePdfPayload` (documents MQ2/MI1 payload shaping, read-only) for the
 * branded-document fields, then layers on the two payment-gating flags the public page needs.
 * Returns `null` on an unknown/stale token — the route's `notFound()` trigger.
 */
export async function getPublicInvoicePayload(token: string): Promise<PublicInvoicePayload | null> {
  const resolved = await resolveInvoiceByPublicToken(token)
  if (!resolved) return null
  const { organizationId, invoiceInstanceId } = resolved

  // Dynamic import — see the module-doc comment above for why this can't be a static import.
  const { buildInvoicePdfPayload } = await import('../documents/payload')

  const systemUserId = await getOrgCache().get(organizationId, 'systemUser')
  const invoiceRecordId = toRecordId('invoice', invoiceInstanceId)

  const [
    { payload },
    account,
    pendingCharge,
    allowPartialPayments,
    partialPaymentMinPercent,
    depositApplied,
  ] = await Promise.all([
    buildInvoicePdfPayload({ organizationId, userId: systemUserId, invoiceRecordId }),
    getPaymentAccount(organizationId),
    database.query.PaymentTransaction.findFirst({
      // Time-bounded: a `pending` row is minted at Checkout CREATION, so its bare existence
      // only means a session was opened, not that money moved. Rows the shopper explicitly
      // canceled out of get flipped by `cancelAbandonedCheckout`; silently-abandoned tabs
      // age out of this window instead of wedging the page in "processing" forever. The
      // webhook remains the truth — a stale session paid after the window still settles.
      where: and(
        eq(schema.PaymentTransaction.organizationId, organizationId),
        eq(schema.PaymentTransaction.invoiceInstanceId, invoiceInstanceId),
        eq(schema.PaymentTransaction.provider, 'stripe'),
        eq(schema.PaymentTransaction.kind, 'charge'),
        eq(schema.PaymentTransaction.status, 'pending'),
        gt(schema.PaymentTransaction.updatedAt, new Date(Date.now() - PROCESSING_WINDOW_MS))
      ),
      columns: { id: true },
    }),
    getOrganizationSetting({ organizationId, key: 'documents.invoice.allowPartialPayments' }),
    getOrganizationSetting({ organizationId, key: 'documents.invoice.partialPaymentMinPercent' }),
    // Deposit-accounting plan 16 §E — labeled breakout, see the field doc on the payload type.
    getInvoiceDepositApplied(organizationId, invoiceInstanceId),
  ])

  const paymentsEnabled = isPaymentsConnected(account)
  const minPaymentAmount = resolvePartialPaymentBounds(
    payload.balance,
    Number(partialPaymentMinPercent ?? 10)
  ).min

  return {
    number: payload.number,
    status: payload.status,
    issuedAt: payload.issuedAt,
    dueDate: payload.dueDate,
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
    amountPaid: payload.amountPaid,
    balance: payload.balance,
    depositApplied,
    currency: payload.settings.currency,
    business: payload.settings.business,
    branding: payload.settings.branding,
    paymentsEnabled,
    processingPayment: !!pendingCharge,
    allowPartialPayments: !!allowPartialPayments,
    minPaymentAmount,
  }
}
