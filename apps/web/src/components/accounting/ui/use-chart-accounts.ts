// apps/web/src/components/accounting/ui/use-chart-accounts.ts

'use client'

import type { ChartAccountRow } from '@auxx/lib/postings/client'
import { api } from '~/trpc/react'

/**
 * Reads the org's chart of accounts through `ledger.chartAccounts`.
 *
 * Lives on its own so `account-label.tsx` and `gl-account-picker.tsx` can
 * both read it without importing each other. The picker re-exports it, so
 * every existing `import { useChartAccounts } from '../gl-account-picker'`
 * keeps working.
 *
 * `listChartAccounts` (the lib read behind this procedure) filters
 * `archivedAt IS NULL` server-side, so an archived `gl_account` never reaches
 * this hook at all: there is no per-row flag to check for it. The only
 * "disabled for a reason" case this data can express is `isActive: false`
 * (deactivated but not archived), which is what `GlAccountPicker` renders
 * disabled.
 */
export function useChartAccounts() {
  const query = api.ledger.chartAccounts.useQuery()
  return {
    accounts: (query.data ?? []) as ChartAccountRow[],
    isLoading: query.isLoading,
    isError: query.isError,
  }
}
