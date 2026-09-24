// apps/web/src/components/accounting/ui/setup-wizard/connect-and-go-finish-page.tsx
'use client'

import { ConnectAndGoBacklog } from './connect-and-go-backlog'
import { ConnectAndGoStepList } from './connect-and-go-summary'
import type { ConnectAndGoFlow } from './use-connect-and-go'

/** The backlog after the cutover and what each finish step did; Finish is in the shell's footer. */
export function ConnectAndGoFinishPage({
  flow,
  providerLabel,
}: {
  flow: ConnectAndGoFlow
  providerLabel: string
}) {
  const { report, outcome, draft } = flow
  if (!report) return null

  return (
    <div className='flex flex-col'>
      {outcome && (
        <ConnectAndGoStepList
          report={outcome}
          providerLabel={providerLabel}
          currencyCode={report.company?.homeCurrency ?? 'USD'}
        />
      )}

      {flow.done ? (
        <p className='px-4 py-3 text-muted-foreground text-sm'>
          Your opening is posted and the ledger is open. Everything after {draft.cutoffPeriod} now
          posts and exports on its own.
        </p>
      ) : (
        <>
          <ConnectAndGoBacklog
            cutoffPeriod={draft.cutoffPeriod}
            bookTimeZone={draft.bookTimeZone || null}
            exportMode={draft.exportMode}
            providerLabel={providerLabel}
          />
          {flow.booksInvalid && (
            <p className='px-4 pt-3 text-muted-foreground text-xs'>{flow.booksInvalid}</p>
          )}
        </>
      )}
    </div>
  )
}
