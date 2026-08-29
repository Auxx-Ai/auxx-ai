// apps/web/src/app/(protected)/app/accounting/[period]/page.tsx

import { LedgerPage } from '~/components/accounting/ui/ledger/ledger-page'

/**
 * One explicit accounting month. Same component as the module home — only the
 * period resolution differs (13-accounting-ui.md §5.1).
 */
export default async function AccountingPeriodPage({
  params,
}: {
  params: Promise<{ period: string }>
}) {
  const { period } = await params
  return <LedgerPage periodKey={period} />
}
