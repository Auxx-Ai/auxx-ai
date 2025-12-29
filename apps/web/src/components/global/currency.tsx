export const DEFAULT_CURRENCY = 'USD'

export const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: DEFAULT_CURRENCY,
    minimumFractionDigits: 2,
  }).format(amount / 100) // Convert cents to dollars
}
