// packages/lib/src/accounting/providers/company-settings.ts

/** The connected company's own settings that setup derives; null where a provider does not expose one. */
export interface ProviderCompanySettings {
  companyName: string | null
  /** 1-12, 1 = January. */
  fiscalYearStartMonth: number | null
  country: string | null
  /** ISO 4217, e.g. `USD`. */
  homeCurrency: string | null
  multiCurrencyEnabled: boolean | null
  /** YYYY-MM-DD; the provider refuses edits on or before it. */
  lockDate: string | null
  reportingBasis: 'accrual' | 'cash' | null
}
