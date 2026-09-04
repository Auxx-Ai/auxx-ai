// apps/web/src/app/(protected)/app/accounting/banking/import/[jobId]/page.tsx

import { redirect } from 'next/navigation'
import { BankImportWizard } from '~/components/accounting/ui/banking/import/bank-import-wizard'

interface PageProps {
  params: Promise<{ jobId: string }>
}

/**
 * The shared import wizard for a bank statement, step-routed by query param.
 *
 * `new` redirects back to the landing page rather than rendering the generic
 * upload step: that step parses CSV only, knows nothing about OFX, and would
 * produce a job with no account behind it - which nothing downstream could file
 * or reverse.
 */
export default async function AccountingBankingImportStepPage({ params }: PageProps) {
  const { jobId } = await params
  if (jobId === 'new') redirect('/app/accounting/banking/import')

  return <BankImportWizard jobId={jobId} />
}
