// packages/config/src/currencies.ts

/**
 * ISO 4217 Currency codes with labels and symbols
 * @see https://www.iso.org/iso-4217-currency-codes.html
 */
export interface Currency {
  /** ISO 4217 3-letter currency code */
  code: string
  /** Full currency name */
  label: string
  /** Currency symbol */
  symbol: string
  /** Number of decimal places (0 for JPY, KRW, etc.) */
  decimals: number
}

/**
 * Common currencies list
 * Sorted by code alphabetically with major currencies first
 */
export const CURRENCIES: Currency[] = [
  // Major currencies first
  { code: 'USD', label: 'US Dollar', symbol: '$', decimals: 2 },
  { code: 'EUR', label: 'Euro', symbol: '€', decimals: 2 },
  { code: 'GBP', label: 'British Pound', symbol: '£', decimals: 2 },
  { code: 'JPY', label: 'Japanese Yen', symbol: '¥', decimals: 0 },
  { code: 'CNY', label: 'Chinese Yuan', symbol: '¥', decimals: 0 },
  { code: 'CHF', label: 'Swiss Franc', symbol: 'CHF', decimals: 2 },
  { code: 'CAD', label: 'Canadian Dollar', symbol: 'CA$', decimals: 2 },
  { code: 'AUD', label: 'Australian Dollar', symbol: 'A$', decimals: 2 },
  // Other currencies alphabetically
  { code: 'AED', label: 'UAE Dirham', symbol: 'د.إ', decimals: 2 },
  { code: 'AFN', label: 'Afghan Afghani', symbol: '؋', decimals: 2 },
  { code: 'ARS', label: 'Argentine Peso', symbol: '$', decimals: 2 },
  { code: 'BGN', label: 'Bulgarian Lev', symbol: 'сом', decimals: 2 },
  { code: 'BRL', label: 'Brazilian Real', symbol: 'R$', decimals: 2 },
  { code: 'CLP', label: 'Chilean Peso', symbol: '$', decimals: 0 },
  { code: 'COP', label: 'Colombian Peso', symbol: '$', decimals: 2 },
  { code: 'CZK', label: 'Czech Koruna', symbol: 'Kč', decimals: 2 },
  { code: 'DKK', label: 'Danish Krone', symbol: 'kr', decimals: 2 },
  { code: 'HKD', label: 'Hong Kong Dollar', symbol: 'HK$', decimals: 2 },
  { code: 'ILS', label: 'Israeli New Shekel', symbol: '₪', decimals: 2 },
  { code: 'INR', label: 'Indian Rupee', symbol: '₹', decimals: 2 },
  { code: 'KHR', label: 'Cambodian Riel', symbol: '៛', decimals: 2 },
  { code: 'KMF', label: 'Comorian Franc', symbol: 'CF', decimals: 0 },
  { code: 'KRW', label: 'South Korean Won', symbol: '₩', decimals: 0 },
  { code: 'MXN', label: 'Mexican Peso', symbol: 'MX$', decimals: 2 },
  { code: 'NGN', label: 'Nigerian Naira', symbol: '₦', decimals: 2 },
  { code: 'NOK', label: 'Norwegian Krone', symbol: 'kr', decimals: 2 },
  { code: 'NZD', label: 'New Zealand Dollar', symbol: 'NZ$', decimals: 2 },
  { code: 'PEN', label: 'Peruvian Sol', symbol: 'S/', decimals: 2 },
  { code: 'PGK', label: 'Papua New Guinean Kina', symbol: 'K', decimals: 2 },
  { code: 'PHP', label: 'Philippine Peso', symbol: '₱', decimals: 2 },
  { code: 'PKR', label: 'Pakistani Rupee', symbol: '₨', decimals: 2 },
  { code: 'PLN', label: 'Polish Zloty', symbol: 'zł', decimals: 2 },
  { code: 'PYG', label: 'Paraguayan Guarani', symbol: '₲', decimals: 0 },
  { code: 'QAR', label: 'Qatari Riyal', symbol: 'ر.ق', decimals: 2 },
  { code: 'RUB', label: 'Russian Ruble', symbol: '₽', decimals: 2 },
  { code: 'RWF', label: 'Rwandan Franc', symbol: 'FRw', decimals: 0 },
  { code: 'SAR', label: 'Saudi Riyal', symbol: 'ر.س', decimals: 2 },
  { code: 'SEK', label: 'Swedish Krona', symbol: 'kr', decimals: 2 },
  { code: 'SGD', label: 'Singapore Dollar', symbol: 'S$', decimals: 2 },
  { code: 'THB', label: 'Thai Baht', symbol: '฿', decimals: 2 },
  { code: 'TRY', label: 'Turkish Lira', symbol: '₺', decimals: 2 },
  { code: 'TWD', label: 'New Taiwan Dollar', symbol: 'NT$', decimals: 2 },
  { code: 'UAH', label: 'Ukrainian Hryvnia', symbol: '₴', decimals: 2 },
  { code: 'UYU', label: 'Uruguayan Peso', symbol: '$U', decimals: 2 },
  { code: 'XPF', label: 'CFP Franc', symbol: '₣', decimals: 0 },
  { code: 'ZAR', label: 'South African Rand', symbol: 'R', decimals: 2 },
] as const

/** Currency code type */
export type CurrencyCode = (typeof CURRENCIES)[number]['code']

/**
 * Get currency by code
 * @param code - ISO 4217 currency code
 * @returns Currency object or undefined
 */
export function getCurrency(code: string): Currency | undefined {
  return CURRENCIES.find((c) => c.code === code)
}

/**
 * Get currency symbol by code
 * @param code - ISO 4217 currency code
 * @returns Currency symbol or the code itself as fallback
 */
export function getCurrencySymbol(code: string): string {
  const currency = getCurrency(code)
  return currency?.symbol || code
}

/**
 * Validate currency code
 * @param code - Currency code to validate
 * @returns True if valid ISO 4217 code
 */
export function isValidCurrency(code: string): boolean {
  return CURRENCIES.some((c) => c.code === code)
}
