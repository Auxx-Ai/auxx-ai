// apps/web/src/components/data-import/plan-preview/error-summary.tsx

'use client'

import { Alert, AlertDescription, AlertTitle } from '@auxx/ui/components/alert'
import { AlertTriangle, Info } from 'lucide-react'
import { api } from '~/trpc/react'

interface ErrorSummaryProps {
  errorCount: number
  planId: string
}

/**
 * Summary of rows with errors.
 */
export function ErrorSummary({ errorCount, planId }: ErrorSummaryProps) {
  const { data: errors } = api.dataImport.getPlanErrors.useQuery(
    { planId, limit: 5 },
    { enabled: errorCount > 0 }
  )

  return (
    <Alert variant='destructive'>
      <AlertTriangle className='h-4 w-4' />
      <AlertTitle>
        {errorCount} {errorCount === 1 ? 'row has' : 'rows have'} errors
      </AlertTitle>
      <AlertDescription className='mt-2'>
        <p className='mb-2'>These rows will be skipped during import:</p>
        <ul className='text-sm space-y-1'>
          {errors?.map((error, i) => (
            <li key={i} className='font-mono'>
              Row {error.rowIndex + 1}: {error.error}
            </li>
          ))}
        </ul>
        {errorCount > 5 && <p className='text-sm mt-2'>...and {errorCount - 5} more</p>}
      </AlertDescription>
    </Alert>
  )
}

interface WarningSummaryProps {
  planId: string
}

/**
 * Summary of rows that import with non-fatal warnings (invalid values dropped
 * from a multi-value cell, values already owned by another record).
 */
export function WarningSummary({ planId }: WarningSummaryProps) {
  const { data } = api.dataImport.getPlanWarnings.useQuery({ planId, limit: 5 })

  if (!data || data.total === 0) return null

  return (
    <Alert>
      <Info className='h-4 w-4' />
      <AlertTitle>
        {data.total} {data.total === 1 ? 'row has' : 'rows have'} warnings
      </AlertTitle>
      <AlertDescription className='mt-2'>
        <p className='mb-2'>These rows still import, but some values were skipped:</p>
        <ul className='text-sm space-y-1'>
          {data.warnings.map((warning, i) => (
            <li key={i} className='font-mono'>
              Row {warning.rowIndex + 1}: {warning.warning}
            </li>
          ))}
        </ul>
        {data.total > 5 && <p className='text-sm mt-2'>...and {data.total - 5} more</p>}
      </AlertDescription>
    </Alert>
  )
}
