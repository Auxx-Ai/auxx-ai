// apps/web/src/components/money/ui/settings/tax-rate-types.ts

/**
 * One entry in the `documents.taxRates` org setting (jsonb list). The line
 * builder's tax picker snapshots `name`/`rate` at pick time — editing a rate
 * here never rewrites an existing quote/invoice's stored value.
 */
export interface TaxRate {
  id: string
  name: string
  /** Percent, e.g. `8.5` for 8.5%. */
  rate: number
  isDefault?: boolean
}
