// apps/web/src/app/(protected)/app/accounting/reports/[report]/page.tsx

import { notFound } from 'next/navigation'
import type { ComponentType } from 'react'
import { AgingReportPage } from '~/components/accounting/ui/reports/aging-report'
import { BalanceSheetReportPage } from '~/components/accounting/ui/reports/balance-sheet'
import { ProfitAndLossReportPage } from '~/components/accounting/ui/reports/profit-and-loss'
import { TrialBalanceReportPage } from '~/components/accounting/ui/reports/trial-balance'
import { Vendor1099ReportPage } from '~/components/accounting/ui/reports/vendor-1099-report'

const REPORT_PAGES: Record<string, ComponentType> = {
  'trial-balance': TrialBalanceReportPage,
  'balance-sheet': BalanceSheetReportPage,
  'profit-and-loss': ProfitAndLossReportPage,
  // HANDOFF slot 2H
  'ar-aging': () => <AgingReportPage side='receivable' />,
  'ap-aging': () => <AgingReportPage side='payable' />,
  'vendor-1099': Vendor1099ReportPage,
}

/**
 * One statement per `plans/accounting/ui-plan.md` §1.2 / §2.4. Anything
 * else - a stale link to an aging or clearing slug that hasn't shipped yet,
 * a typo - 404s rather than rendering a blank page.
 */
export default async function AccountingReportPage({
  params,
}: {
  params: Promise<{ report: string }>
}) {
  const { report } = await params
  const Page = REPORT_PAGES[report]
  if (!Page) notFound()
  return <Page />
}
