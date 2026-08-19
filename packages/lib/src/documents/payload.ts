// packages/lib/src/documents/payload.ts

import { database } from '@auxx/database'
import type { TypedFieldValue } from '@auxx/types'
import { extractValue } from '@auxx/types'
import { toResourceFieldId } from '@auxx/types/field'
import { parseRecordId, type RecordId, toRecordId } from '@auxx/types/resource'
import { stableHash } from '@auxx/utils/hash'
import { getOrgCache } from '../cache'
import type { ConditionGroup } from '../conditions'
import type { FileValue } from '../field-values/converters'
import { formatToDisplayValue } from '../field-values/formatter'
import type { TypedFieldValueResult } from '../field-values/types'
import { getPaymentAccount } from '../money/payments/account-state'
import { getInvoiceDepositApplied } from '../money/payments/allocation-reads'
import { buildPayUrl, ensureInvoicePublicToken, isPaymentsConnected } from '../money/public-token'
import { computeDocumentTotals } from '../money/totals'
import type { DiscountType } from '../money/types'
import type { LineItemUnit } from '../money/units'
import { UnifiedCrudHandler } from '../resources/crud'
import type { ResolvedDocumentSettings } from './resolve-settings'
import { resolveDocumentSettings } from './resolve-settings'

/** A customer-safe photo reference on a PDF payload (plan 37b §5) — `internal: true` rows
 * are dropped at `extractPhotos` build time, so this shape never carries that flag; PDF,
 * email, and public-page payloads all read this same filtered shape. */
export interface PdfPhotoRef {
  /** `"asset:<id>"` or `"file:<id>"` — resolved to bytes by `render.ts`'s photo resolver. */
  ref: string
  caption?: string
}

/** One rendered line on the quote PDF's line-item table. */
export interface QuotePdfLineItem {
  /** `line_item` EntityInstance id — the public quote page's optional-line checkbox `value`
   * (money plan 18 §4/amendment 1). Not present on any other document-payload line before
   * this. */
  lineInstanceId: string
  name: string
  description: string | null
  qty: number
  /** Immutable-at-copy-time display snapshot (money plan 13 §1/§6). `null` = unitless. */
  unit: LineItemUnit | null
  /** Integer cents. `null` = not yet priced (money MQ1 convention). */
  unitPrice: number | null
  /** Integer cents. */
  lineTotal: number | null
  taxable: boolean
  /** Customer-selectable upsell line (quotes only, money plan 18). `false` on invoice lines —
   * optionality never survives conversion (decision 6). */
  optional: boolean
  /** Current selection state — meaningful only when `optional` is true. */
  optionalSelected: boolean
  /** Site photos captured for this line (plan 37b §5), `line_item_photos`, in FieldValue
   * `sortKey` order. Internal-only photos are already filtered out (never present here). */
  photos?: PdfPhotoRef[]
}

/** Billing-party display fields — no street address on `contact` today (city/region/country only). */
export interface QuotePdfContact {
  name: string
  email: string | null
  phone: string | null
  city: string | null
  region: string | null
  country: string | null
}

/**
 * Everything `<QuotePdf>` needs to render, plus the resolved org document settings — the
 * full payload (not just the quote's own fields) is what gets content-hashed (§C.2), so a
 * branding/logo/setting change invalidates a cached render exactly like a data change does.
 * `documentType` is carried so `render.ts`/MI1's invoice payload share one dispatch point
 * without a separate payload builder per type.
 */
export interface QuotePdfPayload {
  documentType: 'quote'
  /** Needed by `render.ts` to load the logo `MediaAsset` bytes server-side. */
  organizationId: string
  number: string
  title: string
  status: string
  /** ISO date the quote was created — stable, used as the "issued" date on the PDF. */
  issuedAt: string
  /** ISO date, or `null` when unset. */
  validUntil: string | null
  terms: string | null
  contact: QuotePdfContact
  lines: QuotePdfLineItem[]
  /** Integer cents — sum of line totals. */
  subtotal: number
  discountType: DiscountType | null
  /** Percent (discountType `percent`) or integer cents (discountType `amount`). */
  discountValue: number | null
  /** Integer cents — derived via `computeDocumentTotals`, clamped to `[0, subtotal]`. */
  discountAmount: number
  taxName: string | null
  /** Percent, e.g. `7.5`. */
  taxRate: number | null
  /** Integer cents. */
  taxTotal: number
  /** Integer cents. */
  total: number
  settings: ResolvedDocumentSettings
  /** Header-level site photos (plan 37b §5), `quote_photos`, in FieldValue `sortKey` order.
   * Internal-only photos are already filtered out (never present here). */
  photos?: PdfPhotoRef[]
}

/** One payment-history row on the invoice PDF (money MI1 build spec §H.1) — a succeeded
 * ledger charge (positive) or refund (negative), read straight off `PaymentTransaction`. */
export interface InvoicePdfPaymentRow {
  /** ISO date — the user-picked payment date from the ledger row's `metadata.date`,
   * falling back to the row's `createdAt` (no dedicated business-date column in v1). */
  date: string
  method: string | null
  reference: string | null
  /** Integer cents — refund rows are negative. */
  amount: number
}

/**
 * Everything `<InvoicePdf>` needs to render (money MI1 build spec §H.1) — the invoice
 * analog of `QuotePdfPayload`, sharing its `contact`/`lines` shapes. `subtotal`/`taxTotal`/
 * `total`/`discountAmount` are recomputed from the lines via `computeDocumentTotals` (same
 * as the quote path); `amountPaid`/`balance` are read as the STORED ledger-sync mirrors
 * (`invoice_amount_paid`/`invoice_balance`) since they aren't derivable from lines alone.
 */
export interface InvoicePdfPayload {
  documentType: 'invoice'
  organizationId: string
  number: string
  status: string
  /** ISO date — `invoice_issued_at` if stamped, else the instance's `createdAt` (never
   * `new Date()` — that would defeat the content-hash cache, the MQ2 lesson). */
  issuedAt: string
  /** ISO date, or `null` when unset. */
  dueDate: string | null
  terms: string | null
  contact: QuotePdfContact
  lines: QuotePdfLineItem[]
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
  /** Integer cents — the `invoice_amount_paid` mirror. */
  amountPaid: number
  /** Integer cents — the `invoice_balance` mirror. */
  balance: number
  /** Integer cents — deposit-accounting plan 16 §E. Σ allocation amounts posted against this
   * invoice from succeeded quote-deposit charges (refund copies net back to zero); `0` when no
   * deposit was ever applied. Already netted into `amountPaid`/`balance` above — purely the
   * PDF's labeled "Deposit applied" totals-block line, not additional money. */
  depositApplied: number
  payments: InvoicePdfPaymentRow[]
  /** Absolute `/pay/{token}` URL, or `null` when the org has no connected, chargesEnabled
   * `PaymentAccount` (money MP1 build spec §J) — printed as a "Pay online" line on the PDF.
   * Part of the payload object that gets content-hashed, so a newly-connected account
   * naturally busts the cached render. */
  payLink: string | null
  settings: ResolvedDocumentSettings
  /** Header-level photos (plan 37b §5), `invoice_photos`, in FieldValue `sortKey` order. No
   * auto-copy from `quote_photos` (decision 7) — office attaches directly. Internal-only
   * photos are already filtered out (never present here). */
  photos?: PdfPhotoRef[]
}

/** The render/content-hash dispatch union — `render.ts` and `ensure-pdf.ts` branch on
 * `documentType` to pick the right PDF template and pointer systemAttribute. */
export type DocumentPdfPayload = QuotePdfPayload | InvoicePdfPayload

/** Unwrap a `getFieldValues()` map entry — takes the first value if array-returned. */
function firstTyped(
  entry: TypedFieldValue | TypedFieldValue[] | undefined
): TypedFieldValue | undefined {
  if (!entry) return undefined
  return Array.isArray(entry) ? entry[0] : entry
}

/**
 * Extract a payload-safe photo list from a batched FILE field-value read (plan 37b §5) —
 * `getValues`/`batchGetValues` already order FILE's multiple rows by `FieldValue.sortKey`
 * (`field-value-queries.ts`), so this preserves capture order as-is. Drops `internal: true`
 * rows here — the single server-side choke point that keeps internal photos out of every
 * downstream consumer (PDF, email, and — once wired — the public quote/pay pages, since
 * `PublicQuoteLine`/`PublicInvoiceLine` = `QuotePdfLineItem`).
 */
function extractPhotos(entry: TypedFieldValue | TypedFieldValue[] | undefined): PdfPhotoRef[] {
  if (!entry) return []
  const rows = Array.isArray(entry) ? entry : [entry]
  const photos: PdfPhotoRef[] = []
  for (const row of rows) {
    if (row.type !== 'json' || !row.value) continue
    const file = row.value as unknown as FileValue
    if (!file.ref || file.internal === true) continue
    photos.push(file.caption ? { ref: file.ref, caption: file.caption } : { ref: file.ref })
  }
  return photos
}

/**
 * Shared billing-party (contact) loader for the quote/invoice PDF payloads — same fields,
 * same "no street address on contact today" shape (§ QuotePdfContact).
 */
/**
 * Resolve a document's billing-party contact (name/email/phone/address) via `batchGetValues` so
 * the NAME field composes correctly (see the reader note below). Exported so the branded
 * payment-receipt path (money/15) can reuse the exact same contact resolution the PDF uses.
 */
export async function loadPdfContact(
  cache: ReturnType<typeof getOrgCache>,
  handler: UnifiedCrudHandler,
  organizationId: string,
  contactRecordId: RecordId | undefined
): Promise<QuotePdfContact> {
  const contact: QuotePdfContact = {
    name: '',
    email: null,
    phone: null,
    city: null,
    region: null,
    country: null,
  }
  if (!contactRecordId) return contact

  const contactCf = await cache
    .from(organizationId, 'customFields')
    .bySystemAttributes([
      'full_name',
      'primary_email',
      'phone',
      'city',
      'region',
      'country',
    ] as const)

  // Read through `batchGetValues`, NOT the naive `getFieldValues`/`getValues` path: `full_name`
  // is a NAME field type (a first/last composite with no stored FieldValue row), so the plain
  // `FieldValue` join silently returns nothing for it and the billing-party name comes back
  // empty. `batchGetValues` is the resolver that composes NAME (and system/virtual/relationship)
  // fields — the same reader the placeholder engine uses. See `resolveNameFieldValues`.
  const { entityDefinitionId } = parseRecordId(contactRecordId)
  const fieldIds = [
    contactCf.full_name,
    contactCf.primary_email,
    contactCf.phone,
    contactCf.city,
    contactCf.region,
    contactCf.country,
  ]
    .filter(Boolean)
    .map((f) => f!.id)
  if (fieldIds.length === 0) return contact

  // Build the refs and remember which cache fieldId each maps to — `batchGetValues` echoes the
  // exact ref we passed on each result, so we match on it rather than re-parsing the id.
  const fieldIdByRef = new Map<string, string>()
  const fieldReferences = fieldIds.map((id) => {
    const ref = toResourceFieldId(entityDefinitionId, id)
    fieldIdByRef.set(ref, id)
    return ref
  })

  const { values } = await handler.fieldValueService.batchGetValues({
    recordIds: [contactRecordId],
    fieldReferences,
  })

  // Index resolved values by their cache fieldId. Only direct refs here (no relationship paths).
  const resolvedByFieldId = new Map<string, TypedFieldValueResult>()
  for (const v of values) {
    if (Array.isArray(v.fieldRef)) continue
    const fieldId = fieldIdByRef.get(v.fieldRef)
    if (fieldId) resolvedByFieldId.set(fieldId, v)
  }

  /** Format a resolved value to its display string — NAME composes "First Last" via its converter. */
  const displayOf = (f?: { id: string } | null): string | null => {
    if (!f) return null
    const hit = resolvedByFieldId.get(f.id)
    if (!hit) return null
    const typed = firstTyped(Array.isArray(hit.value) ? hit.value[0] : (hit.value ?? undefined))
    if (!typed) return null
    const formatted = formatToDisplayValue(typed, hit.fieldType, hit.fieldOptions)
    if (formatted === null || formatted === undefined) return null
    return Array.isArray(formatted) ? formatted.filter(Boolean).join(', ') : String(formatted)
  }

  contact.name = displayOf(contactCf.full_name) ?? ''
  contact.email = displayOf(contactCf.primary_email)
  contact.phone = displayOf(contactCf.phone)
  contact.city = displayOf(contactCf.city)
  contact.region = displayOf(contactCf.region)
  contact.country = displayOf(contactCf.country)
  return contact
}

/**
 * Shared line-item loader for the quote/invoice PDF payloads, ordered by `sortOrder`. The
 * caller supplies the `line_item` filter — quote: `line_item:quote is X`; invoice:
 * `line_item:invoice is X AND line_item:workOrder is empty` (the MI1 §B.3 invariant that
 * excludes source work-order lines a gather stamped, not copied, onto the invoice).
 */
async function loadPdfLines(
  cache: ReturnType<typeof getOrgCache>,
  handler: UnifiedCrudHandler,
  organizationId: string,
  filters: ConditionGroup[]
): Promise<QuotePdfLineItem[]> {
  const lineCf = await cache
    .from(organizationId, 'customFields')
    .bySystemAttributes([
      'line_item_name',
      'line_item_description',
      'line_item_qty',
      'line_item_unit',
      'line_item_unit_price',
      'line_item_line_total',
      'line_item_taxable',
      'line_item_optional',
      'line_item_optional_selected',
      'line_item_photos',
    ] as const)

  const { ids: lineInstanceIds } = await handler.listFiltered({
    entityDefinitionId: 'line_item',
    filters,
    sorting: [{ id: 'sortOrder', desc: false }],
    limit: 1000,
  })

  const lineFieldIds = [
    lineCf.line_item_name,
    lineCf.line_item_description,
    lineCf.line_item_qty,
    lineCf.line_item_unit,
    lineCf.line_item_unit_price,
    lineCf.line_item_line_total,
    lineCf.line_item_taxable,
    lineCf.line_item_optional,
    lineCf.line_item_optional_selected,
    lineCf.line_item_photos,
  ]
    .filter(Boolean)
    .map((f) => f!.id)

  const lines: QuotePdfLineItem[] = []
  for (const lineInstanceId of lineInstanceIds) {
    const lineRecordId = toRecordId('line_item', lineInstanceId)
    const values = await handler.getFieldValues(lineRecordId, lineFieldIds)
    const getLine = (f?: { id: string } | null) => (f ? firstTyped(values.get(f.id)) : undefined)

    const nameTyped = getLine(lineCf.line_item_name)
    const descriptionTyped = getLine(lineCf.line_item_description)
    const qtyTyped = getLine(lineCf.line_item_qty)
    const unitTyped = getLine(lineCf.line_item_unit)
    const unitPriceTyped = getLine(lineCf.line_item_unit_price)
    const lineTotalTyped = getLine(lineCf.line_item_line_total)
    const taxableTyped = getLine(lineCf.line_item_taxable)
    const optionalTyped = getLine(lineCf.line_item_optional)
    const optionalSelectedTyped = getLine(lineCf.line_item_optional_selected)
    const photosEntry = lineCf.line_item_photos ? values.get(lineCf.line_item_photos.id) : undefined

    lines.push({
      lineInstanceId,
      name: nameTyped ? (extractValue(nameTyped) as string) : '',
      description: descriptionTyped ? (extractValue(descriptionTyped) as string) : null,
      qty: qtyTyped ? (extractValue(qtyTyped) as number) : 0,
      unit: unitTyped ? (extractValue(unitTyped) as LineItemUnit) : null,
      unitPrice: unitPriceTyped ? (extractValue(unitPriceTyped) as number) : null,
      lineTotal: lineTotalTyped ? (extractValue(lineTotalTyped) as number) : null,
      taxable: taxableTyped ? (extractValue(taxableTyped) as boolean) : true,
      optional: optionalTyped ? (extractValue(optionalTyped) as boolean) : false,
      optionalSelected: optionalSelectedTyped
        ? (extractValue(optionalSelectedTyped) as boolean)
        : true,
      photos: extractPhotos(photosEntry),
    })
  }

  return lines
}

/**
 * Load a quote + its line items + its contact through the same `FieldValueService`/
 * `UnifiedCrudHandler` read helpers MQ1's totals/convert code uses (`packages/lib/src/
 * money/totals-hooks.ts`, `convert-quote.ts`) — never raw Drizzle — embed the org's
 * resolved document settings, and hash the whole thing with `stableHash` (sorted-key
 * SHA-256; never plain `JSON.stringify` — the jsonb-hash lesson) for the render-or-reuse
 * cache check (§C.2).
 */
export async function buildQuotePdfPayload(params: {
  organizationId: string
  userId: string
  quoteRecordId: RecordId
}): Promise<{ payload: QuotePdfPayload; hash: string }> {
  const { organizationId, userId, quoteRecordId } = params
  const { entityInstanceId: quoteInstanceId } = parseRecordId(quoteRecordId)
  const handler = new UnifiedCrudHandler(organizationId, userId)
  const cache = getOrgCache()

  // `createdAt` is a dbColumn-backed system field (no FieldValue row), so it's read
  // straight off `EntityInstance` — also this is what keeps the content hash STABLE
  // across repeated calls: never use `new Date()` here, that would defeat the whole
  // cache-hit check (§C.2 — every call would look like a content change).
  const quoteInstance = await database.query.EntityInstance.findFirst({
    columns: { createdAt: true },
    where: (t, { eq }) => eq(t.id, quoteInstanceId),
  })
  const issuedAt = (quoteInstance?.createdAt ?? new Date()).toISOString()

  const cf = await cache
    .from(organizationId, 'customFields')
    .bySystemAttributes([
      'quote_number',
      'quote_title',
      'quote_status',
      'quote_valid_until',
      'quote_terms',
      'quote_tax_name',
      'quote_tax_rate',
      'quote_discount_type',
      'quote_discount_value',
      'quote_contact',
      'quote_photos',
    ] as const)

  const quoteFieldIds = [
    cf.quote_number,
    cf.quote_title,
    cf.quote_status,
    cf.quote_valid_until,
    cf.quote_terms,
    cf.quote_tax_name,
    cf.quote_tax_rate,
    cf.quote_discount_type,
    cf.quote_discount_value,
    cf.quote_contact,
    cf.quote_photos,
  ]
    .filter(Boolean)
    .map((f) => f!.id)
  const quoteValues = await handler.getFieldValues(quoteRecordId, quoteFieldIds)
  const get = (f?: { id: string } | null) => (f ? firstTyped(quoteValues.get(f.id)) : undefined)

  const numberTyped = get(cf.quote_number)
  const titleTyped = get(cf.quote_title)
  const statusTyped = get(cf.quote_status)
  const validUntilTyped = get(cf.quote_valid_until)
  const termsTyped = get(cf.quote_terms)
  const taxNameTyped = get(cf.quote_tax_name)
  const taxRateTyped = get(cf.quote_tax_rate)
  const discountTypeTyped = get(cf.quote_discount_type)
  const discountValueTyped = get(cf.quote_discount_value)
  const contactTyped = get(cf.quote_contact)

  const number = numberTyped ? (extractValue(numberTyped) as string) : ''
  const title = titleTyped ? (extractValue(titleTyped) as string) : ''
  const status = statusTyped ? (extractValue(statusTyped) as string) : 'draft'
  const validUntil = validUntilTyped ? (extractValue(validUntilTyped) as string) : null
  const terms = termsTyped ? (extractValue(termsTyped) as string) : null
  const taxName = taxNameTyped ? (extractValue(taxNameTyped) as string) : null
  const taxRate = taxRateTyped ? (extractValue(taxRateTyped) as number) : null
  const discountType = discountTypeTyped ? (extractValue(discountTypeTyped) as DiscountType) : null
  const discountValue = discountValueTyped ? (extractValue(discountValueTyped) as number) : null
  const contactRecordId = contactTyped?.type === 'relationship' ? contactTyped.recordId : undefined
  const photos = extractPhotos(cf.quote_photos ? quoteValues.get(cf.quote_photos.id) : undefined)

  // ─── Contact display fields (billing party block) ──────────────────────────
  const contact = await loadPdfContact(cache, handler, organizationId, contactRecordId)

  // ─── Line items, ordered by sortOrder ───────────────────────────────────────
  const lines = await loadPdfLines(cache, handler, organizationId, [
    {
      id: 'quote-lines',
      logicalOperator: 'AND',
      conditions: [
        {
          id: 'quote-lines-c1',
          fieldId: 'line_item:quote',
          operator: 'is',
          value: quoteRecordId,
        },
      ],
    },
  ])

  // ─── Totals (pure function — same math the totals-engine hook writes). Pass the
  // optional/optionalSelected flags so a deselected upsell line is excluded from the
  // recomputed payload total exactly like the stored `quote_total` mirror (decision 4). ──────
  const totals = computeDocumentTotals(
    lines.map((l) => ({
      lineTotal: l.lineTotal,
      taxable: l.taxable,
      optional: l.optional,
      optionalSelected: l.optionalSelected,
    })),
    { discountType, discountValue, taxRate }
  )

  const settings = await resolveDocumentSettings(organizationId)

  const payload: QuotePdfPayload = {
    documentType: 'quote',
    organizationId,
    number,
    title,
    status,
    issuedAt,
    validUntil,
    terms,
    contact,
    lines,
    subtotal: totals.subtotal,
    discountType,
    discountValue,
    discountAmount: totals.discountAmount,
    taxName,
    taxRate,
    taxTotal: totals.taxTotal,
    total: totals.total,
    settings,
    photos,
  }

  return { payload, hash: stableHash(payload) }
}

/**
 * Load an invoice + its owned line items + its contact + its ledger payment history, embed
 * the org's resolved document settings, and hash the whole thing (money MI1 build spec
 * §H.1) — the invoice analog of `buildQuotePdfPayload`. `subtotal`/`taxTotal`/`total` are
 * recomputed from the lines via `computeDocumentTotals` (same math the totals-engine hook
 * writes); `amountPaid`/`balance` are read as the stored `invoice_amount_paid`/
 * `invoice_balance` mirrors (the ledger-sync writer, §E.4) since they aren't derivable from
 * lines alone.
 */
export async function buildInvoicePdfPayload(params: {
  organizationId: string
  userId: string
  invoiceRecordId: RecordId
}): Promise<{ payload: InvoicePdfPayload; hash: string }> {
  const { organizationId, userId, invoiceRecordId } = params
  const { entityInstanceId: invoiceInstanceId } = parseRecordId(invoiceRecordId)
  const handler = new UnifiedCrudHandler(organizationId, userId)
  const cache = getOrgCache()

  // Stable fallback for `issuedAt` when `invoice_issued_at` is unset (a not-yet-sent
  // draft) — `EntityInstance.createdAt`, never `new Date()` (defeats the content-hash cache).
  const invoiceInstance = await database.query.EntityInstance.findFirst({
    columns: { createdAt: true },
    where: (t, { eq }) => eq(t.id, invoiceInstanceId),
  })

  const cf = await cache
    .from(organizationId, 'customFields')
    .bySystemAttributes([
      'invoice_number',
      'invoice_status',
      'invoice_issued_at',
      'invoice_due_date',
      'invoice_terms',
      'invoice_tax_name',
      'invoice_tax_rate',
      'invoice_discount_type',
      'invoice_discount_value',
      'invoice_contact',
      'invoice_amount_paid',
      'invoice_balance',
      'invoice_photos',
    ] as const)

  const invoiceFieldIds = [
    cf.invoice_number,
    cf.invoice_status,
    cf.invoice_issued_at,
    cf.invoice_due_date,
    cf.invoice_terms,
    cf.invoice_tax_name,
    cf.invoice_tax_rate,
    cf.invoice_discount_type,
    cf.invoice_discount_value,
    cf.invoice_contact,
    cf.invoice_amount_paid,
    cf.invoice_balance,
    cf.invoice_photos,
  ]
    .filter(Boolean)
    .map((f) => f!.id)
  const invoiceValues = await handler.getFieldValues(invoiceRecordId, invoiceFieldIds)
  const get = (f?: { id: string } | null) => (f ? firstTyped(invoiceValues.get(f.id)) : undefined)

  const numberTyped = get(cf.invoice_number)
  const statusTyped = get(cf.invoice_status)
  const issuedAtTyped = get(cf.invoice_issued_at)
  const dueDateTyped = get(cf.invoice_due_date)
  const termsTyped = get(cf.invoice_terms)
  const taxNameTyped = get(cf.invoice_tax_name)
  const taxRateTyped = get(cf.invoice_tax_rate)
  const discountTypeTyped = get(cf.invoice_discount_type)
  const discountValueTyped = get(cf.invoice_discount_value)
  const contactTyped = get(cf.invoice_contact)
  const amountPaidTyped = get(cf.invoice_amount_paid)
  const balanceTyped = get(cf.invoice_balance)

  const number = numberTyped ? (extractValue(numberTyped) as string) : ''
  const status = statusTyped ? (extractValue(statusTyped) as string) : 'draft'
  const issuedAt = issuedAtTyped
    ? (extractValue(issuedAtTyped) as string)
    : (invoiceInstance?.createdAt ?? new Date(0)).toISOString()
  const dueDate = dueDateTyped ? (extractValue(dueDateTyped) as string) : null
  const terms = termsTyped ? (extractValue(termsTyped) as string) : null
  const taxName = taxNameTyped ? (extractValue(taxNameTyped) as string) : null
  const taxRate = taxRateTyped ? (extractValue(taxRateTyped) as number) : null
  const discountType = discountTypeTyped ? (extractValue(discountTypeTyped) as DiscountType) : null
  const discountValue = discountValueTyped ? (extractValue(discountValueTyped) as number) : null
  const contactRecordId = contactTyped?.type === 'relationship' ? contactTyped.recordId : undefined
  const photos = extractPhotos(
    cf.invoice_photos ? invoiceValues.get(cf.invoice_photos.id) : undefined
  )

  // ─── Contact display fields (billing party block) ──────────────────────────
  const contact = await loadPdfContact(cache, handler, organizationId, contactRecordId)

  // ─── Line items — OWNED lines only: `invoice = X AND workOrder is empty` (the MI1 §B.3
  // invariant that excludes source work-order lines a gather stamped rather than copied) ──
  const lines = await loadPdfLines(cache, handler, organizationId, [
    {
      id: 'invoice-lines',
      logicalOperator: 'AND',
      conditions: [
        {
          id: 'invoice-lines-c1',
          fieldId: 'line_item:invoice',
          operator: 'is',
          value: invoiceRecordId,
        },
        { id: 'invoice-lines-c2', fieldId: 'line_item:workOrder', operator: 'empty', value: null },
      ],
    },
  ])

  // ─── Totals (pure function — same math the totals-engine hook writes) ──────
  const totals = computeDocumentTotals(
    lines.map((l) => ({ lineTotal: l.lineTotal, taxable: l.taxable })),
    { discountType, discountValue, taxRate }
  )

  const amountPaid = amountPaidTyped ? (extractValue(amountPaidTyped) as number) : 0
  const balance = balanceTyped ? (extractValue(balanceTyped) as number) : totals.total

  // ─── Payment history — succeeded ledger rows only (charges positive, refunds negative) ──
  const [paymentRows, depositApplied] = await Promise.all([
    database.query.PaymentTransaction.findMany({
      where: (t, { and: andOp, eq: eqOp }) =>
        andOp(
          eqOp(t.organizationId, organizationId),
          eqOp(t.invoiceInstanceId, invoiceInstanceId),
          eqOp(t.status, 'succeeded')
        ),
      orderBy: (t, { asc }) => asc(t.createdAt),
    }),
    // Deposit-accounting plan 16 §E — same figure the public pay page shows, see the field doc.
    getInvoiceDepositApplied(organizationId, invoiceInstanceId),
  ])
  const payments: InvoicePdfPaymentRow[] = paymentRows.map((row) => ({
    // The user-picked (possibly backdated) payment date rides in `metadata.date`
    // (recordManualPayment, ledger.ts) — the row's createdAt is only the fallback.
    date: (row.metadata as { date?: string } | null)?.date ?? row.createdAt.toISOString(),
    method: row.method,
    reference: row.reference,
    amount: row.kind === 'refund' ? -row.amount : row.amount,
  }))

  const settings = await resolveDocumentSettings(organizationId)

  // ─── Pay-online link (money MP1 build spec §J) — only when payments are connected +
  // chargesEnabled + not disconnected; otherwise the PDF never shows a dead link. Minting
  // here (rather than only at send time) makes this the "pay-link builder" §H refers to —
  // any render (preview/download/send) is a valid first-mint moment, and re-renders are a
  // cheap idempotent read after the first write. ──────────────────────────────────────────
  const account = await getPaymentAccount(organizationId)
  let payLink: string | null = null
  if (isPaymentsConnected(account)) {
    const token = await ensureInvoicePublicToken(organizationId, invoiceInstanceId)
    payLink = token ? buildPayUrl(token) : null
  }

  const payload: InvoicePdfPayload = {
    documentType: 'invoice',
    organizationId,
    number,
    status,
    issuedAt,
    dueDate,
    terms,
    contact,
    lines,
    subtotal: totals.subtotal,
    discountType,
    discountValue,
    discountAmount: totals.discountAmount,
    taxName,
    taxRate,
    taxTotal: totals.taxTotal,
    total: totals.total,
    amountPaid,
    balance,
    depositApplied,
    payments,
    payLink,
    settings,
    photos,
  }

  return { payload, hash: stableHash(payload) }
}

/**
 * Hardcoded sample document for the Documents-settings "Preview PDF" button (§F.4) — 3
 * lines, a percent discount, and a tax rate, so every visual toggle (lineDisplay,
 * showDescriptions, accent color, logo) has something to show. Ships with a generic
 * default `settings` object; callers building a real preview should spread in the org's
 * live `resolveDocumentSettings(orgId)` result (`{ ...SAMPLE_QUOTE_PDF_PAYLOAD, settings }`)
 * — the sample's own `settings` only exists so this constant renders standalone (smoke
 * tests, storybook-style checks) without hitting the database.
 */
export const SAMPLE_QUOTE_PDF_PAYLOAD: QuotePdfPayload = {
  documentType: 'quote',
  organizationId: 'sample',
  number: 'QUO-0001',
  title: 'Sample Quote',
  status: 'draft',
  issuedAt: '2026-01-05T00:00:00.000Z',
  validUntil: '2026-02-04T00:00:00.000Z',
  terms: 'Payment due within 30 days of acceptance. Prices valid for 30 days.',
  contact: {
    name: 'Jordan Rivera',
    email: 'jordan@example.com',
    phone: '+1 (555) 123-4567',
    city: 'Austin',
    region: 'TX',
    country: 'US',
  },
  lines: [
    {
      lineInstanceId: 'sample-line-1',
      name: 'Site inspection',
      description: 'On-site assessment and measurements',
      qty: 1,
      unit: null,
      unitPrice: 15000,
      lineTotal: 15000,
      taxable: true,
      optional: false,
      optionalSelected: true,
    },
    {
      lineInstanceId: 'sample-line-2',
      name: 'Materials',
      description: 'Parts and supplies per estimate',
      qty: 4,
      unit: 'each',
      unitPrice: 5000,
      lineTotal: 20000,
      taxable: true,
      optional: false,
      optionalSelected: true,
    },
    {
      lineInstanceId: 'sample-line-3',
      name: 'Labor',
      description: 'Installation and cleanup',
      qty: 3,
      unit: 'hour',
      unitPrice: 8000,
      lineTotal: 24000,
      taxable: false,
      optional: false,
      optionalSelected: true,
    },
  ],
  subtotal: 59000,
  discountType: 'percent',
  discountValue: 10,
  discountAmount: 5900,
  taxName: 'Sales Tax',
  taxRate: 8.25,
  taxTotal: 2599,
  total: 55699,
  settings: {
    business: { companyName: 'Your Company' },
    branding: { logo: null, accentColor: '', paperSize: 'letter', dateFormat: 'MMM d, yyyy' },
    quote: {
      defaultTerms: '',
      validDays: 30,
      footerText: '',
      lineDisplay: 'full',
      showDescriptions: true,
    },
    invoice: {
      dueDays: 30,
      paymentInstructions: '',
      footerText: '',
      lineDisplay: 'full',
      showDescriptions: true,
      showPaymentHistory: true,
    },
    currency: 'USD',
  },
}
