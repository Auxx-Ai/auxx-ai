// apps/web/src/components/accounting/ui/banking/import/bank-import-wizard.tsx

'use client'

// The shared import wizard, mounted for `bank_transaction` with the three
// optional hooks a statement import needs (HANDOFF slot 3D).
//
// ⚠️ Every hook is OPTIONAL on `ImportPage`, so the generic importer is byte-for
// -byte unchanged for contacts, invoices and every other def. What rides them:
//
// - `extraQuery` carries `?account=` across step navigations. The target account
//   is chosen before the file and is not a column, so nothing downstream could
//   re-derive it.
// - `confirmExtra` is the coverage effect and the cross-source overlap.
// - `onJobFinished` FILES the run against the account: stamps `source`,
//   `importBatchId`, `bankAccount` and `matchKey`, links what the feed already
//   had, and moves the coverage floor. 🛑 It hangs on the run terminating, not
//   on the "Done" button - a person who closes the tab on the green tick must
//   not be left with unfiled lines that no reverse can find.

import { toastError } from '@auxx/ui/components/toast'
import { useSearchParams } from 'next/navigation'
import { useCallback } from 'react'
import { ImportPage } from '~/components/data-import/import-page'
import { api } from '~/trpc/react'
import { BankCoverageEffect } from './bank-coverage-effect'

interface BankImportWizardProps {
  jobId: string
}

export function BankImportWizard({ jobId }: BankImportWizardProps) {
  const searchParams = useSearchParams()
  const bankAccountId = searchParams.get('account')
  const utils = api.useUtils()
  const finalize = api.banking.bankingImport.finalize.useMutation()

  const handleJobFinished = useCallback(
    async (finishedJobId: string) => {
      if (!bankAccountId) return
      try {
        await finalize.mutateAsync({ jobId: finishedJobId, bankAccountId })
        await Promise.all([
          utils.banking.bankingImport.listBatches.invalidate(),
          utils.banking.bankAccount.list.invalidate(),
          utils.banking.bankAccount.coverage.invalidate({ id: bankAccountId }),
        ])
      } catch (error) {
        // 🛑 A toast, and only here. Filing happens after the run is already
        // over, so there is no blockers card still on screen to carry it - and
        // the recovery is to press Import again on the same job, which
        // `finalizeBankImport` is idempotent for.
        toastError({
          title: 'The statement imported but could not be filed against the account',
          description:
            error instanceof Error
              ? `${error.message} Re-open this import and finish it, or the lines will have no batch to reverse.`
              : 'An error occurred',
        })
      }
    },
    [bankAccountId, finalize, utils]
  )

  return (
    <ImportPage
      entityDefinitionId='bank_transaction'
      resourceLabel='Banking'
      basePath='/app/accounting/banking'
      importBasePath='/app/accounting/banking/import'
      importTitle='Import statements'
      jobId={jobId}
      extraQuery={bankAccountId ? `&account=${encodeURIComponent(bankAccountId)}` : ''}
      confirmExtra={
        bankAccountId ? (
          <BankCoverageEffect jobId={jobId} bankAccountId={bankAccountId} />
        ) : (
          <div className='border-b bg-amber-50 p-4 text-sm dark:bg-amber-950/40'>
            No bank account is selected for this import, so its rows cannot be filed against one.
            Start again from the Import page and pick an account first.
          </div>
        )
      }
      onJobFinished={(finishedJobId) => void handleJobFinished(finishedJobId)}
    />
  )
}
