// apps/web/src/components/manufacturing/stock-setup/stock-setup-href.ts

export const STOCK_SETUP_HREF = '/app/inventory/setup'

export type StockSetupStep = 'kinds' | 'costs' | 'builds' | 'count'

/** Link to the Stock setup page, optionally on a step with extra query params (e.g. `parts`, `job`). */
export function stockSetupHref(step?: StockSetupStep, extra?: Record<string, string>): string {
  const params = new URLSearchParams()
  if (step) params.set('step', step)
  for (const [key, value] of Object.entries(extra ?? {})) params.set(key, value)
  const query = params.toString()
  return query ? `${STOCK_SETUP_HREF}?${query}` : STOCK_SETUP_HREF
}
