// apps/web/src/components/accounting/ui/setup-wizard/connect-and-go-accounts-page.tsx
'use client'

import type { ConnectAndGoPrepareReport } from '@auxx/lib/accounting/connect-and-go/client'
import { ConnectAndGoQuestions } from './connect-and-go-questions'
import { ConnectAndGoProviderAccounts } from './connect-and-go-summary'
import type { ConnectAndGoFlow } from './use-connect-and-go'

/** Does the accounts page have anything to show? The shell skips it when not. */
export function hasAccountQuestions(report: ConnectAndGoPrepareReport | null): boolean {
  if (!report) return true
  const { rails, bankAccounts } = report.questions
  return (
    rails.length + bankAccounts.length > 0 || (report.providerAccountsToCreate?.length ?? 0) > 0
  )
}

/** The rail banks and bank accounts only a person can answer, and what Finish creates in the provider. */
export function ConnectAndGoAccountsPage({
  flow,
  providerLabel,
}: {
  flow: ConnectAndGoFlow
  providerLabel: string
}) {
  const { report } = flow
  if (!report) return null
  return (
    <div className='flex flex-col'>
      <ConnectAndGoQuestions
        report={report}
        draft={flow.draft}
        onChange={flow.patchDraft}
        providerLabel={providerLabel}
        disabled={flow.finishing}
      />
      {report.providerAccountsToCreate && report.providerAccountsToCreate.length > 0 && (
        <ConnectAndGoProviderAccounts
          accounts={report.providerAccountsToCreate}
          providerLabel={providerLabel}
        />
      )}
    </div>
  )
}
