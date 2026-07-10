// packages/lib/src/documents/payload.ts

import { database } from '@auxx/database'
import type { TypedFieldValue } from '@auxx/types'
import { extractValue } from '@auxx/types'
import { parseRecordId, type RecordId, toRecordId } from '@auxx/types/resource'
import { stableHash } from '@auxx/utils/hash'
import { getOrgCache } from '../cache'
import { computeDocumentTotals } from '../money/totals'
import type { DiscountType } from '../money/types'
import { UnifiedCrudHandler } from '../resources/crud'
import type { ResolvedDocumentSettings } from './resolve-settings'
import { resolveDocumentSettings } from './resolve-settings'

/** One rendered line on the quote PDF's line-item table. */
export interface QuotePdfLineItem {
  name: string
  description: string | null
  qty: number
  /** Integer cents. `null` = not yet priced (money MQ1 convention). */
  unitPrice: number | null
  /** Integer cents. */
  lineTotal: number | null
  taxable: boolean
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
 * `documentType` is carried so `render.ts`/future MI1 invoice code can share one dispatch
 * point without a separate payload builder per type.
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
}

/** Unwrap a `getFieldValues()` map entry — takes the first value if array-returned. */
function firstTyped(
  entry: TypedFieldValue | TypedFieldValue[] | undefined
): TypedFieldValue | undefined {
  if (!entry) return undefined
  return Array.isArray(entry) ? entry[0] : entry
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

  // ─── Contact display fields (billing party block) ──────────────────────────
  let contact: QuotePdfContact = {
    name: '',
    email: null,
    phone: null,
    city: null,
    region: null,
    country: null,
  }
  if (contactRecordId) {
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
    const contactFieldIds = [
      contactCf.full_name,
      contactCf.primary_email,
      contactCf.phone,
      contactCf.city,
      contactCf.region,
      contactCf.country,
    ]
      .filter(Boolean)
      .map((f) => f!.id)
    const contactValues = await handler.getFieldValues(contactRecordId, contactFieldIds)
    const getContact = (f?: { id: string } | null) =>
      f ? firstTyped(contactValues.get(f.id)) : undefined

    const nameTyped = getContact(contactCf.full_name)
    const emailTyped = getContact(contactCf.primary_email)
    const phoneTyped = getContact(contactCf.phone)
    const cityTyped = getContact(contactCf.city)
    const regionTyped = getContact(contactCf.region)
    const countryTyped = getContact(contactCf.country)

    contact = {
      name: nameTyped ? (extractValue(nameTyped) as string) : '',
      email: emailTyped ? (extractValue(emailTyped) as string) : null,
      phone: phoneTyped ? (extractValue(phoneTyped) as string) : null,
      city: cityTyped ? (extractValue(cityTyped) as string) : null,
      region: regionTyped ? (extractValue(regionTyped) as string) : null,
      country: countryTyped ? (extractValue(countryTyped) as string) : null,
    }
  }

  // ─── Line items, ordered by sortOrder ───────────────────────────────────────
  const lineCf = await cache
    .from(organizationId, 'customFields')
    .bySystemAttributes([
      'line_item_name',
      'line_item_description',
      'line_item_qty',
      'line_item_unit_price',
      'line_item_line_total',
      'line_item_taxable',
    ] as const)

  const { ids: lineInstanceIds } = await handler.listFiltered({
    entityDefinitionId: 'line_item',
    filters: [
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
    ],
    sorting: [{ id: 'sortOrder', desc: false }],
    limit: 1000,
    mode: 'oneshot',
  })

  const lineFieldIds = [
    lineCf.line_item_name,
    lineCf.line_item_description,
    lineCf.line_item_qty,
    lineCf.line_item_unit_price,
    lineCf.line_item_line_total,
    lineCf.line_item_taxable,
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
    const unitPriceTyped = getLine(lineCf.line_item_unit_price)
    const lineTotalTyped = getLine(lineCf.line_item_line_total)
    const taxableTyped = getLine(lineCf.line_item_taxable)

    lines.push({
      name: nameTyped ? (extractValue(nameTyped) as string) : '',
      description: descriptionTyped ? (extractValue(descriptionTyped) as string) : null,
      qty: qtyTyped ? (extractValue(qtyTyped) as number) : 0,
      unitPrice: unitPriceTyped ? (extractValue(unitPriceTyped) as number) : null,
      lineTotal: lineTotalTyped ? (extractValue(lineTotalTyped) as number) : null,
      taxable: taxableTyped ? (extractValue(taxableTyped) as boolean) : true,
    })
  }

  // ─── Totals (pure function — same math the totals-engine hook writes) ──────
  const totals = computeDocumentTotals(
    lines.map((l) => ({ lineTotal: l.lineTotal, taxable: l.taxable })),
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
      name: 'Site inspection',
      description: 'On-site assessment and measurements',
      qty: 1,
      unitPrice: 15000,
      lineTotal: 15000,
      taxable: true,
    },
    {
      name: 'Materials',
      description: 'Parts and supplies per estimate',
      qty: 4,
      unitPrice: 5000,
      lineTotal: 20000,
      taxable: true,
    },
    {
      name: 'Labor',
      description: 'Installation and cleanup',
      qty: 3,
      unitPrice: 8000,
      lineTotal: 24000,
      taxable: false,
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
    branding: { logo: null, accentColor: '', paperSize: 'a4', dateFormat: 'MMM d, yyyy' },
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
