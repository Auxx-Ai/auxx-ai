// packages/lib/src/documents/resolve-settings.ts

import { getAllOrganizationSettings, getOrganizationSetting } from '../settings/settings-service'

/** Canonical structured address (`AddressStructFields`) — `street1/street2/city/state/zipCode/country`. */
export interface DocumentBusinessAddress {
  street1: string
  street2?: string
  city: string
  state?: string
  zipCode: string
  country: string
}

/** `documents.business` JSON blob — printed on quote/invoice PDFs (money MQ2 build spec §A.2). */
export interface DocumentBusinessSettings {
  companyName?: string
  address?: DocumentBusinessAddress
  phone?: string
  email?: string
  website?: string
  taxId?: { label: string; value: string }
}

/**
 * Map a stored business blob's address to the canonical `AddressStruct` keys, tolerating the
 * legacy `{line1,line2,region,zip}` shape saved before 10-settings-forms-unification.md. Few users,
 * so this read-time shim (no ledgered DataMigration) is enough — a legacy blob self-heals on its
 * next save from the Documents page, which now writes the new keys.
 */
function normalizeBusinessAddress(business: DocumentBusinessSettings): DocumentBusinessSettings {
  const raw = business.address as Record<string, string> | undefined
  if (!raw) return business
  return {
    ...business,
    address: {
      street1: raw.street1 ?? raw.line1 ?? '',
      street2: raw.street2 ?? raw.line2 ?? '',
      city: raw.city ?? '',
      state: raw.state ?? raw.region ?? '',
      zipCode: raw.zipCode ?? raw.zip ?? '',
      country: raw.country ?? '',
    },
  }
}

/** Logo ref stored in `documents.logo` — `assetId` is what the renderer loads bytes from. */
export interface DocumentLogo {
  assetId: string
  url: string
}

/** Flattened `documents.accentColor`/`paperSize`/`dateFormat` + the logo ref. */
export interface DocumentBrandingSettings {
  logo: DocumentLogo | null
  accentColor: string
  paperSize: 'a4' | 'letter'
  dateFormat: string
}

/** Flattened `documents.quote.*` keys. */
export interface DocumentQuoteSettings {
  defaultTerms: string
  validDays: number
  footerText: string
  lineDisplay: 'full' | 'amount_only'
  showDescriptions: boolean
}

/** Flattened `documents.invoice.*` keys (MI1 consumes; keys ship now). */
export interface DocumentInvoiceSettings {
  dueDays: number
  paymentInstructions: string
  footerText: string
  lineDisplay: 'full' | 'amount_only'
  showDescriptions: boolean
  showPaymentHistory: boolean
}

/**
 * The resolved document-settings contract (money MQ2 build spec §A.4, shape from
 * `02-document-settings.md`). Consumed by `buildQuotePdfPayload`/`renderDocumentPdf` and
 * embedded verbatim in the PDF content hash — logo/branding/terms changes must invalidate
 * cached renders.
 */
export interface ResolvedDocumentSettings {
  business: DocumentBusinessSettings
  branding: DocumentBrandingSettings
  quote: DocumentQuoteSettings
  invoice: DocumentInvoiceSettings
  /** `organization.currency` — GENERAL scope, edited on the General page regardless. */
  currency: string
}

/**
 * Assemble an organization's document (quote/invoice PDF) settings from the DOCUMENTS-scope
 * catalog keys plus `organization.currency`, merging in catalog defaults so missing/old
 * values never break the renderer (money MQ2 build spec §A.4). `getAllOrganizationSettings`
 * already merges persisted `OrganizationSetting` rows over catalog defaults (org-cache
 * backed), so this just reshapes the flat key map into the nested contract object.
 */
export async function resolveDocumentSettings(
  organizationId: string
): Promise<ResolvedDocumentSettings> {
  const [settings, currency] = await Promise.all([
    getAllOrganizationSettings({ organizationId, scope: 'DOCUMENTS' }),
    getOrganizationSetting({ organizationId, key: 'organization.currency' }),
  ])

  const business = normalizeBusinessAddress(
    (settings['documents.business'] as DocumentBusinessSettings | null) ?? {}
  )
  const logo = (settings['documents.logo'] as DocumentLogo | null) ?? null

  return {
    business,
    branding: {
      logo,
      accentColor: (settings['documents.accentColor'] as string | null) ?? '',
      paperSize: (settings['documents.paperSize'] as 'a4' | 'letter' | null) ?? 'a4',
      dateFormat: (settings['documents.dateFormat'] as string | null) ?? 'MMM d, yyyy',
    },
    quote: {
      defaultTerms: (settings['documents.quote.defaultTerms'] as string | null) ?? '',
      validDays: (settings['documents.quote.validDays'] as number | null) ?? 30,
      footerText: (settings['documents.quote.footerText'] as string | null) ?? '',
      lineDisplay:
        (settings['documents.quote.lineDisplay'] as 'full' | 'amount_only' | null) ?? 'full',
      showDescriptions: (settings['documents.quote.showDescriptions'] as boolean | null) ?? true,
    },
    invoice: {
      dueDays: (settings['documents.invoice.dueDays'] as number | null) ?? 30,
      paymentInstructions:
        (settings['documents.invoice.paymentInstructions'] as string | null) ?? '',
      footerText: (settings['documents.invoice.footerText'] as string | null) ?? '',
      lineDisplay:
        (settings['documents.invoice.lineDisplay'] as 'full' | 'amount_only' | null) ?? 'full',
      showDescriptions: (settings['documents.invoice.showDescriptions'] as boolean | null) ?? true,
      showPaymentHistory:
        (settings['documents.invoice.showPaymentHistory'] as boolean | null) ?? true,
    },
    currency: (currency as string | null) ?? 'USD',
  }
}
