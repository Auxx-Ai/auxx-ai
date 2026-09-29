// packages/lib/src/accounting/providers/catalogue.ts

/** What the UI needs to offer, name and connect one accounting system. Client-safe: no adapter code. */
export interface AccountingProviderCatalogueEntry {
  /** The id its `AccountingProvider` adapter registers under. */
  id: string
  /** The installed app that carries the connection; install, connect and settings go through it. */
  appSlug: string
  /** The product's full name, e.g. "QuickBooks Online". */
  label: string
  /** The name in running copy, e.g. "Refresh from QuickBooks". */
  shortLabel: string
  /** One line for a choose-a-system list. */
  description: string
  /** The `RecordIdentity.appFieldKey` its app writes a Customer (`contact`) and Vendor (`company`) id under. */
  partyIdFieldKeys: { customer: string; vendor: string }
}

/** QuickBooks' id-map fields; the adapter reads the same constants. */
export const QUICKBOOKS_PARTY_ID_FIELD_KEYS = {
  customer: 'qboCustomerId',
  vendor: 'qboVendorId',
} as const

/** Every accounting system Auxx can export to. Adding one is one entry here plus its adapter. */
export const ACCOUNTING_PROVIDER_CATALOGUE: readonly AccountingProviderCatalogueEntry[] = [
  {
    id: 'quickbooks',
    appSlug: 'quickbooks',
    label: 'QuickBooks Online',
    shortLabel: 'QuickBooks',
    description: 'Mirror posted entries into QuickBooks Online and import its chart of accounts.',
    partyIdFieldKeys: QUICKBOOKS_PARTY_ID_FIELD_KEYS,
  },
]

/** The catalogue entry for a provider id, or `null` for `'none'` or an id nothing ships. */
export function getAccountingProviderEntry(
  id: string | null | undefined
): AccountingProviderCatalogueEntry | null {
  return ACCOUNTING_PROVIDER_CATALOGUE.find((entry) => entry.id === id) ?? null
}

/** The catalogue entry whose app carries this installed-app slug, or `null`. */
export function getAccountingProviderByAppSlug(
  appSlug: string
): AccountingProviderCatalogueEntry | null {
  return ACCOUNTING_PROVIDER_CATALOGUE.find((entry) => entry.appSlug === appSlug) ?? null
}

/** Every provider's short name, lowercased, for navigation search keywords. */
export const ACCOUNTING_PROVIDER_KEYWORDS: readonly string[] = ACCOUNTING_PROVIDER_CATALOGUE.map(
  (entry) => entry.shortLabel.toLowerCase()
)
